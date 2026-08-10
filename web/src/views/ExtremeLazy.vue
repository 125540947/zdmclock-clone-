<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>🚀 极端偷懒模式</h1>
        <div class="sub">一键全自动流水线：签到 → 刷新好价 → 互动 → 抽奖，全自动跑完</div>
      </div>
    </header>

    <section class="card rise hero" style="animation-delay:.05s">
      <div class="hero-emoji">{{ running ? '⚡' : '😴' }}</div>
      <div class="hero-title">{{ running ? '正在执行中…' : '准备好了吗？' }}</div>
      <div class="hero-sub">{{ running ? runningStep || '执行中' : '点一下，剩下的全交给系统' }}</div>
      <button
        class="btn launch"
        :class="{ pulse: running }"
        :disabled="running || launching"
        @click="launch"
      >
        {{ running ? '执行中…' : launching ? '启动中…' : '🚀 开始极端偷懒' }}
      </button>
      <div v-if="running" class="progress-bar">
        <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
      </div>
    </section>

    <section class="card rise log-card" style="animation-delay:.1s" v-if="logs.length">
      <h2>实时日志</h2>
      <div class="log-box" ref="logBox">
        <div v-for="(line, i) in logs" :key="i + '-' + line" class="log-line" :class="{ dim: i < logs.length - 1 }">
          {{ line }}
        </div>
      </div>
    </section>

    <section class="card rise" style="animation-delay:.15s">
      <h2>历史记录</h2>
      <div v-if="!runs.length" class="empty-hint">暂无运行记录</div>
      <div v-for="run in runs" :key="run.id" class="run-item" :class="{ done: run.status === 'done', partial: run.status === 'partial', error: run.status === 'error' }">
        <div class="run-header">
          <span class="run-status">{{ statusIcon(run) }}</span>
          <span class="run-time">{{ fmtTime(run.startedAt) }}</span>
          <span class="run-dur">{{ run.finishedAt ? fmtDur(run.startedAt, run.finishedAt) : '进行中…' }}</span>
        </div>
        <div class="run-summary">{{ run.result?.message || '—' }}</div>
        <div v-if="run.result?.steps?.length" class="run-steps">
          <span v-for="s in run.result.steps" :key="s.name" class="step-chip" :class="s.ok ? 'ok' : 'fail'">
            {{ s.ok ? '✓' : '✗' }} {{ s.name }}
          </span>
        </div>
        <details v-if="run.logs?.length" class="run-logs-detail">
          <summary>查看日志</summary>
          <pre class="run-logs-pre">{{ run.logs.join('\n') }}</pre>
        </details>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import api, { runExtremeLazy, getExtremeLazyRuns } from '../api/client.js';

const running = ref(false);
const launching = ref(false);
const runningStep = ref('');
const logs = ref([]);
const progressPct = ref(0);
const runs = ref([]);
const logBox = ref(null);
let pollTimer = null;

function statusIcon(run) {
  if (run.status === 'done') return '✅';
  if (run.status === 'partial') return '⚠️';
  if (run.status === 'error') return '❌';
  return '⏳';
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtDur(start, end) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const sec = Math.max(0, Math.round((e - s) / 1000));
  if (sec < 60) return sec + ' 秒';
  return Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒';
}

async function loadRuns() {
  try {
    const { data } = await getExtremeLazyRuns();
    runs.value = data.runs || [];
  } catch { /* ignore */ }
}

async function launch() {
  if (running.value || launching.value) return;
  launching.value = true;
  logs.value = [];
  progressPct.value = 5;
  try {
    await runExtremeLazy();
  } catch { /* ignore */ }
  launching.value = false;
  running.value = true;
  runningStep.value = '开始执行…';
  progressPct.value = 10;
  pollStatus();
}

async function pollStatus() {
  pollTimer = setInterval(async () => {
    try {
      const { data } = await getExtremeLazyRuns();
      const latest = (data.runs || [])[0];
      if (!latest) return;
      runs.value = data.runs;
      if (latest.status === 'running') {
        logs.value = latest.logs || [];
        const steps = (latest.result?.steps || []).filter((s) => s.ok).length;
        const total = (latest.result?.steps || []).length;
        progressPct.value = total > 0 ? Math.round(10 + (steps / total) * 80) : 20;
        await nextTick();
        if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight;
      } else {
        logs.value = latest.logs || [];
        progressPct.value = 100;
        running.value = false;
        runningStep.value = '';
        clearInterval(pollTimer);
        pollTimer = null;
        await nextTick();
        if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight;
      }
    } catch { /* ignore */ }
  }, 1500);
}

onMounted(loadRuns);
// 离开页面时清理轮询定时器，避免内存泄漏与离屏轮询（P1-3）
onBeforeUnmount(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});
</script>

<style scoped>
.hero {
  text-align: center;
  padding: 24px 20px;
}
.hero-emoji {
  font-size: 48px;
  margin-bottom: 8px;
  transition: transform 0.3s;
}
.pulse .hero-emoji {
  animation: pulse 0.8s ease-in-out infinite alternate;
}
@keyframes pulse {
  from { transform: scale(1); }
  to { transform: scale(1.15); }
}
.hero-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 4px;
}
.hero-sub {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 16px;
}
.launch {
  font-size: 16px;
  padding: 14px 36px;
  border-radius: 14px;
  border: none;
  cursor: pointer;
  font-weight: 600;
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  color: #fff;
  transition: opacity 0.2s, transform 0.15s;
  box-shadow: 0 4px 20px rgba(245, 158, 11, 0.3);
}
.launch:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  box-shadow: none;
}
.launch:not(:disabled):active {
  transform: scale(0.97);
}
.progress-bar {
  margin-top: 14px;
  height: 6px;
  border-radius: 3px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #f59e0b, #ef4444);
  transition: width 0.5s ease;
}
.log-card h2, .card h2 {
  font-size: 14px;
  margin: 0 0 10px;
}
.log-box {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  max-height: 320px;
  overflow-y: auto;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.7;
}
.log-line {
  white-space: pre-wrap;
  word-break: break-all;
}
.log-line.dim {
  color: var(--text-dim);
}
.empty-hint {
  font-size: 13px;
  color: var(--text-faint);
  padding: 12px 0;
}
.run-item {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 8px;
  background: var(--surface);
}
.run-item.done { border-left: 3px solid #79e08f; }
.run-item.partial { border-left: 3px solid #ffcf6b; }
.run-item.error { border-left: 3px solid #ff5a4d; }
.run-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.run-status { font-size: 16px; }
.run-time { font-size: 12px; color: var(--text-dim); flex: 1; }
.run-dur { font-size: 11px; color: var(--text-faint); }
.run-summary {
  font-size: 12px;
  color: var(--text);
  margin-bottom: 6px;
}
.run-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.step-chip {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 999px;
}
.step-chip.ok {
  color: #79e08f;
  background: rgba(120, 224, 143, 0.1);
  border: 1px solid rgba(120, 224, 143, 0.3);
}
.step-chip.fail {
  color: #ff5a4d;
  background: rgba(255, 90, 77, 0.1);
  border: 1px solid rgba(255, 90, 77, 0.3);
}
.run-logs-detail {
  margin-top: 6px;
}
.run-logs-detail summary {
  font-size: 11px;
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
}
.run-logs-pre {
  margin-top: 6px;
  padding: 8px;
  background: var(--bg);
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.6;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
