<template>
  <section class="card rise">
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
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { getTaskRuns } from '../api/client.js';

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

defineExpose({ loadRuns });

onMounted(loadRuns);
</script>

<style scoped>
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
