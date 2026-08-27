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

    <TaskRunsPanel />

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
import api, { getAuthConfig } from '../api/client.js';
import TaskRunsPanel from '../components/TaskRunsPanel.vue';

const adapter = ref('mock');
const requireAuth = ref(false);
const openMode = ref(false);
const running = ref(false);
const log = ref([]);

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
</style>
