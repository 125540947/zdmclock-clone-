<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>我的账号</h1>
        <div class="sub">共 {{ users.length }} 个 smzdm 账号</div>
      </div>
      <button class="btn ghost" @click="$router.push({ name: 'addCookies' })">+ 录入</button>
      <button v-if="canWrite" class="btn ghost" :disabled="checking" @click="checkAll">🍪 检测</button>
    </header>

    <section class="card grab rise" style="animation-delay: 0.03s">
      <div class="grab-head">
        <span>🍪 自动抓 Cookie（油猴一键推送）</span>
        <span class="tag on">推荐</span>
      </div>
      <p class="hint">
        在 smzdm 网页登录后，点一下页面上的「🍪 推送到 zdmclock」按钮，自动把登录态推送到本服务
        （按账号去重更新，不重复建号）。<b>服务地址和 Token 已自动写入脚本，无需在油猴里手动配置</b>。
        比手动去 DevTools 复制 Cookie 更省事，且能读取 HttpOnly 的会话 Cookie、不碰你的 smzdm 密码。
      </p>
      <ol class="steps">
        <li>浏览器装一次 <a href="https://www.tampermonkey.net/" target="_blank" rel="noreferrer">Tampermonkey</a> 插件</li>
        <li>点下方「🚀 一键安装」→ 油猴自动弹出安装，确认即可</li>
        <li>打开 smzdm 任意页面，点「🍪 推送到 zdmclock」完成</li>
      </ol>
      <div class="grab-actions">
        <a class="btn primary sm" :href="installUrl" target="_blank" rel="noreferrer">🚀 一键安装</a>
        <button class="btn ghost sm" :disabled="loadingScript" @click="copyScript">📋 复制脚本</button>
        <button class="btn ghost sm" :disabled="loadingScript" @click="toggleScript">{{ showScript ? '隐藏脚本' : '👁 查看脚本' }}</button>
      </div>
      <pre v-if="showScript" class="script-box">{{ scriptText }}</pre>
    </section>

    <section v-if="users.length" class="card rise" style="animation-delay: 0.05s">
      <div v-for="u in users" :key="u.id" class="acc">
        <div class="acc-top">
          <div class="avatar">{{ (u.nickname || '?').slice(0, 1) }}</div>
          <div class="acc-meta">
            <div class="nm">
              {{ u.nickname }}
              <span v-if="u.vip" class="tag on">VIP</span>
              <span v-if="u.cookieExpired" class="tag danger">🍪 Cookie 失效</span>
            </div>
            <div class="sub">{{ u.smzdmId || '未识别' }} · {{ u.level || '—' }}</div>
          </div>
          <div class="acc-pts">
            <div class="display">{{ u.points }}</div>
            <div class="muted">金币</div>
          </div>
        </div>
        <div class="acc-stats">
          <span class="tag">🔥 连击 {{ u.streak }}</span>
          <span class="tag">✅ 累计 {{ u.totalClockIn }}</span>
          <span class="tag">🍪 {{ u.cookie }}</span>
        </div>

        <!-- 智能启动调度 -->
        <div class="sched">
          <div class="sched-head" @click="toggleSched(u.id)">
            <span>🚀 智能启动调度</span>
            <span class="sched-val">
              {{ schedLabel(u) }}
              <span class="caret" :class="{ open: openSched[u.id] }">▾</span>
            </span>
          </div>
          <div v-if="openSched[u.id]" class="sched-body">
            <div class="seg">
              <button
                v-for="m in schedModes"
                :key="m.value"
                class="seg-btn"
                :class="{ active: draft[u.id]?.mode === m.value }"
                @click="setMode(u, m.value)"
              >{{ m.label }}</button>
            </div>
            <div v-if="draft[u.id]?.mode === 'manual'" class="sched-time">
              <input type="time" step="60" v-model="draft[u.id].time" />
              <span class="hint">手动指定每日启动时间（24 小时制），届时触发完整日常流水线（签到/互动/抽奖等）。</span>
            </div>
            <div v-else class="hint">
              系统将在 {{ autoWindow }} 窗口内自动分配一个分散的固定启动时间（当前：{{ u.checkInTime || '—' }}），避免多账号同时启动造成 VPS 卡顿。
            </div>
            <button v-if="canWrite" class="btn sm" :disabled="saving === u.id" @click="saveSched(u)">
              {{ saving === u.id ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>

        <div v-if="canWrite" class="acc-actions">
          <button class="btn ghost sm" :disabled="busy === u.id" @click="refresh(u)">刷新资料</button>
          <button class="btn ghost sm" :disabled="!u.cookie || verifyState[u.id]?.loading" @click="verify(u)">🔍 自检</button>
          <button class="btn ghost sm danger" @click="remove(u)">删除</button>
        </div>

        <!-- 真机端点一键自检结果 -->
        <div v-if="verifyState[u.id]" class="verify-box">
          <div class="vhead">
            <span>🔍 真机端点自检</span>
            <span class="vbadge" :class="verifyState[u.id].failedCount ? 'bad' : 'good'">
              {{ verifyState[u.id].failedCount ? verifyState[u.id].failedCount + ' 项异常' : '全部通过' }}
            </span>
          </div>
          <div v-if="verifyState[u.id].loading" class="vloading">探测中…（含网络请求，请稍候）</div>
          <div v-else-if="verifyState[u.id].error" class="verr">{{ verifyState[u.id].error }}</div>
          <VerifyChart
            v-else
            :results="verifyState[u.id].results"
            :failed-count="verifyState[u.id].failedCount"
            :nickname="u.nickname"
          />
        </div>
      </div>
    </section>

    <p v-else class="empty rise">还没有账号，点右上角「录入」添加 👉</p>

    <transition name="toast">
      <div v-if="toast" class="toast" :class="toastType">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, inject, computed } from 'vue';
import VerifyChart from '../components/VerifyChart.vue';
import api, { updateUser, getClockDistribution, checkCookies, verifyReal, getCookieGrabberScript } from '../api/client.js';
import { useToast } from '../composables/useToast.js';

// 开放模式下匿名访客无改删权限（后端 mutationGuard 强制管理员），这里隐藏写/触发按钮，
// 避免点击后收到 401（P1-4）。注入 App.vue 透传的 openMode / isAdmin。
const openMode = inject('openMode', ref(false));
const isAdmin = inject('isAdmin', ref(false));
const canWrite = computed(() => !(openMode.value && !isAdmin.value));

const users = ref([]);
const busy = ref('');
const saving = ref('');
const checking = ref(false);
const { toast, toastType, showToast } = useToast();
const openSched = reactive({});
const draft = reactive({});
const verifyState = reactive({});
const schedModes = [
  { value: 'auto', label: '系统自动' },
  { value: 'manual', label: '手动指定' }
];
const autoWindow = ref('08:00~10:59');
const scriptText = ref('');
const loadingScript = ref(false);
// 一键安装链接：指向服务端注入好「服务地址 + 窄权限 INSTALL_TOKEN」的 .user.js，油猴导航到此即弹安装。
// 链接不再携带会话 token（P1-2 修复）：浏览器直链本就无法带 Authorization 头，原用 ?token= 传入会话 token 会落入
// 历史/Referer/日志；现改为服务端注入窄权限 INSTALL_TOKEN，URL 干净、泄露面更小。
const installUrl = computed(() => `/api/users/import-script.user.js?server=${encodeURIComponent(window.location.origin)}`);
const showScript = ref(false);


async function load() {
  const { data } = await api.get('/users');
  users.value = data.list || [];
}
async function refresh(u) {
  busy.value = u.id;
  try {
    await api.post(`/users/${u.id}/refresh`);
    showToast('资料已刷新');
    await load();
  } catch (e) {
    showToast(e.response?.data?.message || '刷新失败', 'err');
  } finally {
    busy.value = '';
  }
}
async function remove(u) {
  if (!confirm(`确认删除账号「${u.nickname}」？`)) return;
  await api.delete(`/users/${u.id}`);
  showToast('已删除');
  await load();
}

// 手动触发全部账号 Cookie 健康检测
async function checkAll() {
  if (!users.value.length) {
    showToast('暂无账号', 'err');
    return;
  }
  checking.value = true;
  try {
    const data = await checkCookies();
    showToast(data.message || '检测完成');
    await load(); // 刷新列表以反映 cookieExpired 徽标
  } catch (e) {
    showToast(e.response?.data?.message || '检测失败', 'err');
  } finally {
    checking.value = false;
  }
}

// 真机端点一键自检（针对单个账号）：逐项报告各内置端点是否仍通
async function verify(u) {
  verifyState[u.id] = { loading: true, results: [], failedCount: 0, error: '' };
  try {
    const data = await verifyReal(u.id);
    verifyState[u.id] = {
      loading: false,
      results: data.results || [],
      failedCount: data.failedCount || 0,
      error: ''
    };
  } catch (e) {
    verifyState[u.id] = {
      loading: false,
      results: [],
      failedCount: 0,
      error: e.response?.data?.error || '自检失败'
    };
  }
}

function schedLabel(u) {
  const mode = u.schedMode || 'auto';
  if (mode === 'manual') return '手动 ' + (u.checkInTime || '—');
  return '系统自动 ' + (u.checkInTime || '');
}
function toggleSched(id) {
  openSched[id] = !openSched[id];
  if (openSched[id] && !draft[id]) {
    const u = users.value.find((x) => x.id === id);
    draft[id] = { mode: (u && u.schedMode) || 'auto', time: (u && u.checkInTime) || '09:00' };
  }
}
function setMode(u, mode) {
  if (!draft[u.id]) draft[u.id] = { mode, time: u.checkInTime || '09:00' };
  draft[u.id].mode = mode;
  if (mode === 'manual' && !draft[u.id].time) draft[u.id].time = '09:00';
}
async function saveSched(u) {
  saving.value = u.id;
  try {
    const d = draft[u.id];
    const payload = { schedMode: d.mode };
    if (d.mode === 'manual') payload.checkInTime = d.time;
    await updateUser(u.id, payload);
    showToast('签到时间已保存');
    await load();
    openSched[u.id] = false;
  } catch (e) {
    showToast(e.response?.data?.message || '保存失败', 'err');
  } finally {
    saving.value = '';
  }
}

onMounted(async () => {
  await load();
  try {
    const { data } = await getClockDistribution({ mode: 'hour' });
    if (data.autoWindowStart && data.autoWindowEnd) {
      autoWindow.value = `${data.autoWindowStart}~${data.autoWindowEnd}`;
    }
  } catch {
    /* 后台接口不可用不影响账号列表 */
  }
});

// ===== 油猴抓取脚本：复制 / 查看（客户端仅注入服务地址；Token 由服务端注入窄权限 INSTALL_TOKEN）=====
// 把模板里的 __SERVER__ 占位符替换为当前访问地址；__TOKEN__ 已由服务端在 /import-script(.user.js) 注入
// 为窄权限 INSTALL_TOKEN（非会话 token，见 P1-2 修复），前端不再接触、也不固化任何会话令牌。
function bake(raw) {
  const origin = window.location.origin;
  return String(raw).replace(/__SERVER__/g, JSON.stringify(origin));
}
async function ensureScript() {
  if (scriptText.value) return;
  loadingScript.value = true;
  try {
    const raw = await getCookieGrabberScript();
    scriptText.value = bake(raw);
  } catch (e) {
    showToast(e.response?.data?.message || '脚本加载失败', 'err');
  } finally {
    loadingScript.value = false;
  }
}
async function copyScript() {
  await ensureScript();
  if (!scriptText.value) return;
  const text = scriptText.value;
  try {
    // 优先用标准 Clipboard API（HTTPS/localhost 可用）
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      // HTTP（非安全上下文）降级：临时 textarea + execCommand 复制
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (!ok) throw new Error('execCommand copy failed');
    }
    showToast('脚本已复制，去 Tampermonkey 新建脚本粘贴即可');
  } catch {
    showToast('复制失败，请点「查看脚本」手动长按复制', 'err');
  }
}
async function toggleScript() {
  if (showScript.value) {
    showScript.value = false;
    return;
  }
  await ensureScript();
  showScript.value = true;
}
</script>

<style scoped>
.acc {
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.acc:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.acc-top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.avatar {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-family: var(--font-display);
  font-size: 22px;
  color: #3a2a06;
  background: linear-gradient(135deg, #ffd06b, var(--gold));
}
.acc-meta {
  flex: 1;
}
.nm {
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 7px;
}
.acc-meta .sub {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 2px;
}
.acc-pts {
  text-align: right;
}
.acc-pts .display {
  font-size: 22px;
  color: var(--gold);
}
.acc-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin: 12px 0;
}
.acc-actions {
  display: flex;
  gap: 8px;
}
.btn.sm {
  padding: 9px 13px;
  font-size: 13px;
  border-radius: 11px;
}
.sched {
  margin: 12px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.02);
  overflow: hidden;
}
.sched-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 11px 13px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
}
.sched-val {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-dim);
  font-weight: 500;
}
.caret {
  transition: transform 0.2s;
}
.caret.open {
  transform: rotate(180deg);
}
.sched-body {
  padding: 0 13px 14px;
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.seg {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}
.seg-btn {
  flex: 1;
  min-width: 84px;
  padding: 9px 8px;
  font-size: 13px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition: all 0.15s;
}
.seg-btn.active {
  border-color: var(--primary);
  color: var(--primary);
  background: rgba(255, 208, 107, 0.1);
}
.sched-time {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.sched-time input[type='time'] {
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
}
.hint {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.5;
}
.btn.danger {
  color: #ffb3ac;
  border-color: rgba(255, 90, 77, 0.4);
}
.btn.primary {
  background: linear-gradient(135deg, #ffd06b, var(--gold));
  color: #3a2a06;
  border-color: transparent;
  font-weight: 600;
}
.btn.primary:hover {
  filter: brightness(1.05);
}
.grab {
  padding: 16px 14px 14px;
}
.grab-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 8px;
}
.grab .steps {
  margin: 10px 0 12px;
  padding-left: 20px;
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.9;
}
.grab .steps a {
  color: var(--primary);
}
.grab-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.grab-actions a {
  text-decoration: none;
}
.script-box {
  margin: 12px 0 0;
  max-height: 320px;
  overflow: auto;
  padding: 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.35);
  color: var(--text-dim);
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre;
  word-break: break-all;
  -webkit-user-select: text;
  user-select: text;
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
.verify-box {
  margin: 12px 0 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.02);
  padding: 12px 13px;
}
.vhead {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 9px;
}
.vbadge {
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 20px;
  font-weight: 600;
}
.vbadge.good {
  color: #b7f3c6;
  background: rgba(120, 224, 143, 0.14);
}
.vbadge.bad {
  color: #ffb3ac;
  background: rgba(255, 90, 77, 0.14);
}
.vloading,
.verr {
  font-size: 13px;
  color: var(--text-dim);
  padding: 6px 0;
}
.verr {
  color: #ffb3ac;
}
</style>
