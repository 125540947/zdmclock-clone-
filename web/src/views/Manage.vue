<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>运行台</h1>
        <div class="sub">环境与一键执行</div>
      </div>
    </header>

    <section class="card rise" style="animation-delay: 0.05s">
      <p class="card-title">⚙️ 运行环境</p>
      <div class="row">
        <span class="l"><span class="t">smzdm 适配器</span><span class="d">mock=仿真 / real=需自行实现</span></span>
        <span class="tag" :class="adapter === 'real' ? 'on' : 'off'">{{ adapter }}</span>
      </div>
      <div class="row">
        <span class="l"><span class="t">接口鉴权</span><span class="d">REQUIRE_AUTH</span></span>
        <span class="tag" :class="requireAuth ? 'on' : 'off'">{{ requireAuth ? '开启' : '关闭' }}</span>
      </div>
      <div class="row">
        <span class="l"><span class="t">开放模式</span><span class="d">OPEN_MODE（匿名可录入）</span></span>
        <span class="tag" :class="openMode ? 'on' : 'off'">{{ openMode ? '开启' : '关闭' }}</span>
      </div>
      <p class="muted" style="margin-bottom: 0">
        数据以 JSON 文件持久化于 <code>server/data/db.json</code>，无需外部数据库。
      </p>
    </section>

    <div v-if="adapter !== 'real'" class="warn-banner">
      ⚠️ 当前为 <b>模拟模式（mock）</b>：签到不会真实生效（只写库、不请求 smzdm）。
      请在服务端 <code>.env</code> 设置 <code>SMZDM_ADAPTER=real</code> 并
      <code>systemctl restart zdmclock</code> 后才会真正签到。
    </div>

    <section class="card rise" style="animation-delay: 0.1s">
      <p class="card-title">🚀 一键执行</p>
      <button class="btn block gold" :disabled="running" @click="runAll">
        {{ running ? '执行中…' : '运行全部已启用任务' }}
      </button>
      <div v-if="log.length" class="log">
        <div v-for="(l, i) in log" :key="i + '-' + l.text" class="log-line" :class="l.type">
          <span class="dot"></span>{{ l.text }}
        </div>
      </div>
    </section>

    <section class="card rise" style="animation-delay: 0.12s">
      <p class="card-title">📋 执行明细 <span class="muted" style="font-weight: 400">每天哪些任务做了 / 失败 / 原因</span></p>
      <div class="runs-toolbar">
        <input type="date" v-model="runsDate" class="input" @change="loadRuns" />
        <label class="chk"><input type="checkbox" v-model="runsFailOnly" @change="loadRuns" /> 仅失败</label>
        <button class="btn ghost sm" :disabled="runsLoading" @click="loadRuns">
          {{ runsLoading ? '加载中…' : '刷新' }}
        </button>
      </div>
      <div v-if="runsSummary" class="runs-summary">
        <span class="pill" :class="{ ok: runsSummary.ok }">成功 {{ runsSummary.ok }}</span>
        <span class="pill" :class="{ bad: runsSummary.failed }">失败 {{ runsSummary.failed }}</span>
        <span class="pill" v-if="runsSummary.partial">部分 {{ runsSummary.partial }}</span>
        <span class="pill" v-if="runsSummary.skipped">跳过 {{ runsSummary.skipped }}</span>
        <span class="pill">共 {{ runsSummary.total }}</span>
      </div>
      <div v-if="runsError" class="runs-error">⚠️ {{ runsError }}</div>
      <div v-else-if="!runs.length" class="muted" style="margin-top: 10px">
        当日暂无执行记录（定时任务成功执行后会自动累计，手动运行也会计入）。
      </div>
      <div v-else class="runs-list">
        <div v-for="r in runs" :key="r.id" class="run-item" :class="runStatusClass(r)">
          <div class="run-head">
            <span class="run-name">{{ r.taskName || r.taskId }}</span>
            <span class="run-badge" :class="runStatusClass(r)">{{ runStatusText(r) }}</span>
            <span class="run-time">{{ fmtTime(r.finishedAt) }}</span>
          </div>
          <div v-for="(p, i) in r.perUser" :key="i" class="run-peruser">{{ p }}</div>
          <div v-if="r.reasons && r.reasons.length" class="run-reasons">
            <div v-for="(rs, i) in r.reasons" :key="i" class="run-reason">
              <span class="reason-tag">{{ rs.action || '失败' }}</span>
              <span v-if="rs.articleId" class="reason-aid">文章 {{ rs.articleId }}</span>
              <span v-if="rs.user" class="reason-user">{{ rs.user }}</span>
              <span class="reason-msg">{{ rs.error_msg }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="card rise" style="animation-delay: 0.15s">
      <p class="card-title">🔗 快捷入口</p>
      <div class="links">
        <button class="btn ghost sm" @click="$router.push({ name: 'addCookies' })">录入账号</button>
        <button class="btn ghost sm" @click="$router.push({ name: 'tasks' })">任务配置</button>
        <button class="btn ghost sm" @click="$router.push({ name: 'admin' })">运行概览</button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api, { getAuthConfig, getTaskRuns } from '../api/client.js';

const adapter = ref('mock');
const requireAuth = ref(false);
const openMode = ref(false);
const running = ref(false);
const log = ref([]);

// ===== 执行明细（每天任务做了啥 / 失败 / 原因）=====
const runsDate = ref(todayLocal());
const runsFailOnly = ref(false);
const runs = ref([]);
const runsSummary = ref(null);
const runsLoading = ref(false);
const runsError = ref('');

function todayLocal() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function runStatusClass(r) {
  if (r.skipped) return 'skip';
  if (r.ok) return r.partial ? 'partial' : 'ok';
  return 'bad';
}
function runStatusText(r) {
  if (r.skipped) return '跳过';
  if (r.ok) return r.partial ? '部分成功' : '成功';
  return '失败';
}
async function loadRuns() {
  runsLoading.value = true;
  runsError.value = '';
  try {
    const data = await getTaskRuns({ date: runsDate.value, fail: runsFailOnly.value, limit: 100 });
    runs.value = data.runs || [];
    runsSummary.value = data.summary || null;
  } catch (e) {
    runsError.value = e.response?.data?.message || '加载失败';
    runs.value = [];
    runsSummary.value = null;
  } finally {
    runsLoading.value = false;
  }
}

async function loadEnv() {
  try {
    const { data } = await api.get('/admin/stats');
    adapter.value = data.adapter;
  } catch {
    /* 接口不可用不影响其余展示 */
  }
  // 鉴权状态以 /auth/config 为准（P1-5）：避免 requireAuth 永远显示「关闭」误导
  try {
    const cfg = await getAuthConfig();
    requireAuth.value = !!(cfg && cfg.requireAuth);
    openMode.value = !!(cfg && cfg.openMode);
  } catch {
    /* 接口不可用时不覆盖默认 */
  }
}
async function runAll() {
  running.value = true;
  log.value = [];
  try {
    const { data } = await api.get('/tasks');
    const enabled = (data.list || []).filter((t) => t.enabled);
    if (!enabled.length) {
      log.value.push({ type: 'warn', text: '没有已启用的任务' });
      return;
    }
    for (const t of enabled) {
      log.value.push({ type: 'info', text: `▶ 运行 ${t.name}…` });
      try {
        const r = await api.post(`/tasks/${t.id}/run`);
        log.value.push({ type: 'ok', text: `✓ ${t.name}：${r.data?.result?.message || '完成'}` });
      } catch (e) {
        log.value.push({ type: 'err', text: `✗ ${t.name}：${e.response?.data?.message || '失败'}` });
      }
    }
  } catch (e) {
    log.value.push({ type: 'err', text: '获取任务失败' });
  } finally {
    running.value = false;
  }
}
onMounted(() => {
  loadEnv();
  loadRuns();
});
</script>

<style scoped>
code {
  background: var(--surface-2);
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--gold);
}
.log {
  margin-top: 14px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.log-line {
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-dim);
}
.log-line .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-faint);
}
.log-line.ok {
  color: #b7f3c6;
}
.log-line.ok .dot {
  background: #78e08f;
}
.log-line.err {
  color: #ffb3ac;
}
.log-line.err .dot {
  background: var(--primary);
}
.log-line.warn {
  color: var(--gold);
}
.log-line.warn .dot {
  background: var(--gold);
}
.links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.btn.sm {
  padding: 9px 13px;
  font-size: 13px;
  border-radius: 11px;
}
.runs-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.input {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 13px;
}
.chk {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-dim);
  cursor: pointer;
}
.runs-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.pill {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-dim);
  border: 1px solid var(--border);
}
.pill.ok {
  color: #78e08f;
  border-color: rgba(120, 224, 143, 0.4);
}
.pill.bad {
  color: #ffb3ac;
  border-color: rgba(255, 179, 172, 0.4);
}
.runs-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.run-item {
  border: 1px solid var(--border);
  border-left-width: 3px;
  border-radius: 12px;
  padding: 11px 13px;
  background: var(--surface-2);
}
.run-item.ok {
  border-left-color: #78e08f;
}
.run-item.bad {
  border-left-color: var(--primary);
}
.run-item.partial {
  border-left-color: var(--gold);
}
.run-item.skip {
  border-left-color: var(--text-faint);
}
.run-head {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}
.run-name {
  font-weight: 600;
  font-size: 14px;
}
.run-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-dim);
}
.run-badge.ok {
  color: #78e08f;
}
.run-badge.bad {
  color: #ffb3ac;
}
.run-badge.partial {
  color: var(--gold);
}
.run-badge.skip {
  color: var(--text-faint);
}
.run-time {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.run-peruser {
  font-size: 12.5px;
  color: var(--text-dim);
  margin-top: 6px;
}
.run-reasons {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  border-top: 1px dashed var(--border);
  padding-top: 8px;
}
.run-reason {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: center;
  font-size: 12.5px;
}
.reason-tag {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(255, 179, 172, 0.15);
  color: #ffb3ac;
}
.reason-aid {
  color: var(--gold);
}
.reason-user {
  color: var(--text-dim);
}
.reason-msg {
  color: var(--text-dim);
}
.runs-error {
  color: #ffb3ac;
  font-size: 13px;
  margin-top: 10px;
}
</style>
