<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>系统更新</h1>
        <div class="sub">从 Git 仓库拉取最新代码</div>
      </div>
    </header>

    <section class="card rise" style="animation-delay:0.05s">
      <p class="card-title">当前版本</p>
      <div class="kv"><span>运行环境</span><span class="pill" :class="channelClass">{{ channelLabel }}</span></div>
      <div class="kv"><span>分支</span><span>{{ state.branch || '—' }}</span></div>
      <div class="kv"><span>提交</span><span class="mono">{{ state.commitShort || '—' }}</span></div>
      <div class="kv"><span>说明</span><span class="msg">{{ state.commitMsg || '—' }}</span></div>
      <div v-if="state.dirty" class="warn">
        ⚠ 工作区有 {{ state.dirtyFiles.length }} 个未提交修改，更新前需先提交或 stash。
      </div>
    </section>

    <section class="card rise" style="animation-delay:0.1s">
      <p class="card-title">仓库更新</p>

      <div v-if="!state.supported && !loading" class="note">
        <template v-if="state.channel === 'docker'">
          🐳 检测到运行在 Docker 容器内，容器内 <code>git pull</code> 不会在容器重建后保留。<br />
          请在宿主机执行：<br />
          <code>docker compose pull &amp;&amp; docker compose up -d</code>
        </template>
        <template v-else>⚠ 当前不是 Git 仓库或未配置 origin 远程，无法自动更新。</template>
      </div>

      <template v-else>
        <div v-if="checkResult" class="status" :class="statusClass">
          <template v-if="checkResult.behind > 0">
            有 {{ checkResult.behind }} 个新提交可更新（远程 {{ (checkResult.remoteCommit || '').slice(0, 7) }}）
          </template>
          <template v-else-if="checkResult.behind === 0">✓ 已是最新版本</template>
          <template v-else>检查失败：{{ checkResult.error }}</template>
        </div>

        <div v-if="state.untrackedFiles && state.untrackedFiles.length" class="note">
          ℹ 工作区有 {{ state.untrackedFiles.length }} 个未跟踪文件（如日志/产物），不影响 ff-only 更新。
        </div>

        <div class="acts">
          <button class="btn ghost sm" :disabled="checking || !state.supported" @click="check">
            {{ checking ? '检查中…' : '检查更新' }}
          </button>
          <button class="btn sm" :disabled="!canApply" @click="apply">
            {{ applying ? '更新中…' : '立即更新' }}
          </button>
        </div>

        <div v-if="applyLog.length" class="log">{{ applyLog.join('\n') }}</div>
        <div v-if="willRestart" class="note ok">✔ 更新完成，服务即将重启以加载新代码，页面会自动刷新…</div>
        <div v-if="applyError" class="warn">{{ applyError }}</div>
      </template>
    </section>

    <section class="card rise" style="animation-delay:0.15s">
      <p class="card-title">自动更新（环境变量）</p>
      <p class="hint">
        自动检查由调度器按 <code>UPDATE_CHECK_INTERVAL_MIN</code>（默认 1440 分钟，即每天）节流执行，仅生产环境生效。<br />
        设为 <code>AUTO_UPDATE_APPLY=true</code> 后，检查到落后会自动拉取 + 重建 + 重启；否则仅推送"有更新"通知，需手动点上方按钮升级。
      </p>
    </section>

    <transition name="toast">
      <div v-if="toast" class="toast" :class="toastType">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import api, { getUpdateStatus, checkUpdateRepo, applyUpdateRepo } from '../api/client.js';
import { useToast } from '../composables/useToast.js';

const state = ref({
  channel: 'native',
  branch: '',
  commitShort: '',
  commitMsg: '',
  dirty: false,
  dirtyFiles: [],
  untrackedFiles: [],
  supported: false,
  isRepo: false,
  hasRemote: false,
  apply: null
});
const loading = ref(false);
const checking = ref(false);
const applying = ref(false);
const checkResult = ref(null);
const applyLog = ref([]);
const willRestart = ref(false);
const applyError = ref('');
const { toast, toastType, showToast } = useToast();
let pollTimer = null;

const channelLabel = computed(() => (state.value.channel === 'docker' ? 'Docker' : '原生 Node'));
const channelClass = computed(() => (state.value.channel === 'docker' ? 'docker' : 'native'));
const statusClass = computed(() => {
  const r = checkResult.value;
  if (!r) return '';
  if (r.behind > 0) return 'behind';
  if (r.behind === 0) return 'up';
  return 'fail';
});
const canApply = computed(
  () =>
    state.value.supported &&
    !state.value.dirty &&
    !applying.value &&
    !willRestart.value &&
    !(state.value.apply && state.value.apply.status === 'running')
);


// 把后端错误码翻译成可读文案（含 H2 新增的 admin_token_required）
function errText(e) {
  const code = e.response?.data?.error;
  if (code === 'admin_token_required')
    return '需要管理员令牌，请退出重新登录后再试';
  return e.response?.data?.error || e.response?.data?.message || '操作失败';
}

async function load() {
  loading.value = true;
  try {
    const d = await getUpdateStatus();
    state.value = d;
  } catch (e) {
    showToast(errText(e), 'err');
  } finally {
    loading.value = false;
  }
}

async function check() {
  checking.value = true;
  checkResult.value = null;
  try {
    const d = await checkUpdateRepo();
    checkResult.value = d;
    if (!d.ok) showToast(d.error || '检查失败', 'err');
  } catch (e) {
    showToast(errText(e), 'err');
  } finally {
    checking.value = false;
  }
}

// 轮询后台更新进度：apply 接口立即返回 202，真正的更新在后端异步跑，前端定时拉 /status。
function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollApply() {
  try {
    const d = await getUpdateStatus();
    state.value = d;
    const ap = d.apply;
    if (!ap) {
      stopPoll();
      return;
    }
    applyLog.value = ap.log || [];
    if (ap.status === 'running') return; // 继续轮询
    // 任务结束
    stopPoll();
    applying.value = false;
    const r = ap.result || {};
    if (ap.status === 'failed') {
      applyError.value = r.error || '更新失败';
    } else if (r.restarting) {
      willRestart.value = true;
      // 服务即将自重启，稍后刷新页面以加载新版本
      setTimeout(() => location.reload(), 4000);
    } else if (!r.ok) {
      applyError.value = r.error || '更新失败';
    } else {
      showToast('已是最新，无需更新');
    }
  } catch {
    // 服务可能正在重启中，轮询会自然恢复，这里不报错打断流程
  }
}

async function apply() {
  applying.value = true;
  applyLog.value = ['▶ 已提交更新任务，后台执行中（不阻塞页面）…'];
  applyError.value = '';
  willRestart.value = false;
  try {
    await applyUpdateRepo(); // 返回 202 accepted，随后轮询进度（修复 M1）
    pollTimer = setInterval(pollApply, 1500);
  } catch (e) {
    applying.value = false;
    applyError.value = errText(e);
  }
}

onMounted(load);
onUnmounted(stopPoll);
</script>

<style scoped>
.kv {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--border);
  font-size: 14px;
}
.kv:last-child {
  border-bottom: none;
}
.kv > span:first-child {
  color: var(--text-dim);
  flex: none;
}
.kv > span:last-child {
  text-align: right;
}
.mono {
  font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  color: var(--gold);
  font-size: 13px;
}
.msg {
  color: var(--text);
  font-size: 13px;
  max-width: 70%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pill {
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--border);
}
.pill.native {
  color: #b7f3c6;
  background: rgba(120, 224, 143, 0.14);
}
.pill.docker {
  color: #9fc6ff;
  background: rgba(90, 150, 255, 0.14);
}
.note {
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}
.note.ok {
  color: #b7f3c6;
  border-color: rgba(120, 224, 143, 0.3);
}
.note code,
.hint code {
  font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  background: var(--surface-strong);
  padding: 1px 5px;
  border-radius: 5px;
  font-size: 11.5px;
  color: var(--gold);
}
.status {
  font-size: 13.5px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  margin-bottom: 12px;
  border: 1px solid var(--border);
}
.status.up {
  color: #b7f3c6;
  background: rgba(120, 224, 143, 0.12);
  border-color: rgba(120, 224, 143, 0.3);
}
.status.behind {
  color: #ffd06b;
  background: rgba(245, 185, 66, 0.12);
  border-color: rgba(245, 185, 66, 0.3);
}
.status.fail {
  color: #ffb3ac;
  background: rgba(255, 90, 77, 0.12);
  border-color: rgba(255, 90, 77, 0.3);
}
.acts {
  display: flex;
  gap: 10px;
}
.btn.sm {
  padding: 11px 16px;
  font-size: 14px;
  border-radius: 12px;
  flex: 1;
}
.log {
  margin-top: 12px;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 12px;
  font-family: ui-monospace, 'SFMono-Regular', Menlo, monospace;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-dim);
  white-space: pre-wrap;
  max-height: 240px;
  overflow: auto;
}
.warn {
  margin-top: 12px;
  font-size: 12.5px;
  line-height: 1.5;
  color: #ffb3ac;
  background: rgba(255, 90, 77, 0.1);
  border: 1px solid rgba(255, 90, 77, 0.3);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}
.hint {
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-dim);
  margin: 0;
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 100px;
  transform: translateX(-50%);
  z-index: 50;
  padding: 12px 18px;
  border-radius: 12px;
  font-size: 14px;
  background: rgba(20, 17, 15, 0.92);
  border: 1px solid var(--border-strong);
}
.toast.ok {
  border-color: rgba(120, 224, 143, 0.5);
  color: #b7f3c6;
}
.toast.err {
  border-color: rgba(255, 90, 77, 0.6);
  color: #ffb3ac;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}
</style>
