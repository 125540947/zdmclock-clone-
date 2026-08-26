import axios from 'axios';
import { session, applySession } from './session.js';

const base = import.meta.env.VITE_API_BASE || '/api';

export const api = axios.create({
  baseURL: base,
  timeout: 15000,
  // #190：开启凭据，使浏览器自动携带（同域）HttpOnly 会话 Cookie（zb_token / zb_admin_token），
  // 无需再把 Token 暴露在 JS 可读的 localStorage 中（防 XSS 窃取）。
  withCredentials: true
});

// 全局 401 拦截：凭证失效时清掉会话并广播「需要登录」事件，由 App.vue 的登录浮层接管。
// 例外（P1-4）：开放模式下匿名调用「需管理员」的写/触发接口会收到 admin_token_required，
// 这是预期的「无权」结果，不应弹登录浮层（避免误登出），交由调用方显示错误提示即可。
api.interceptors.response.use(
  (resp) => resp,
  (err) => {
    if (err && err.response && err.response.status === 401) {
      const body = err.response.data || {};
      const isExpectedNoPermission = body.error === 'admin_token_required';
      if (!isExpectedNoPermission) {
        // P2-1 / #190：真正的 401（非预期的「无权写」）→ 调后端清掉 HttpOnly 会话 Cookie，并广播需要登录
        logout();
        window.dispatchEvent(new Event('zdm:unauthorized'));
      }
    }
    return Promise.reject(err);
  }
);

// #190：会话 Token 已改为 HttpOnly Cookie，前端不再经手明文 Token。
// setToken 仅作为「登录成功」的语义钩子（供调用方刷新页面/状态），不再读写 localStorage。
export function setToken() {
  /* no-op：明文 Token 不再存于前端 */
}

// 登出：调后端清除 HttpOnly 会话 Cookie，并同步本地会话状态。
export async function logout() {
  try {
    await api.post('/auth/logout');
  } catch {
    /* 忽略网络错误，仍按本地登出处理 */
  }
  session.loggedIn = false;
  session.isAdmin = false;
}

// 取独立管理员 Token：#190 起由 HttpOnly Cookie 自动携带，前端不再持有明文，故返回空串
// （历史调用方如系统更新接口无需再手动附加 X-Admin-Token 头）。
export function getAdminToken() {
  return '';
}

export async function login(username, password) {
  const { data } = await api.post('/auth/login', { username, password });
  // 后端已在响应里下发 HttpOnly 会话 Cookie；这里用 /config 刷新前端会话态（loggedIn / isAdmin）。
  try {
    const cfg = await getAuthConfig();
    applySession(cfg);
  } catch {
    /* 配置失败不阻塞登录流程 */
  }
  return data;
}

// 公开鉴权配置：前端据此决定走「密码登录」还是「前置代理自动登录」，并感知会话登录/管理员态。
export async function getAuthConfig() {
  const { data } = await api.get('/auth/config');
  applySession(data);
  return data;
}

export default api;

// ===== 好价爆料（后端存储）=====
export async function listBaoliao(userId) {
  const { data } = await api.get('/baoliao' + (userId ? `?userId=${encodeURIComponent(userId)}` : ''));
  return data;
}
export async function createBaoliao(payload) {
  const { data } = await api.post('/baoliao', payload);
  return data;
}
export async function updateBaoliao(id, payload) {
  const { data } = await api.put(`/baoliao/${id}`, payload);
  return data;
}
export async function deleteBaoliao(id) {
  const { data } = await api.delete(`/baoliao/${id}`);
  return data;
}
export async function submitBaoliao(id, userId) {
  const { data } = await api.post(`/baoliao/${id}/submit`, { userId });
  return data;
}
export async function refreshBaoliao(limit = 20) {
  const { data } = await api.post('/baoliao/refresh', { limit });
  return data;
}

// ===== 账号签到时间设置 =====
export async function updateUser(id, payload) {
  const { data } = await api.put(`/users/${id}`, payload);
  return data;
}

// ===== 管理后台：签到时间分布统计 =====
export async function getClockDistribution(params = {}) {
  const qs = new URLSearchParams();
  if (params.mode) qs.set('mode', params.mode);
  if (params.bucketMinutes) qs.set('bucketMinutes', String(params.bucketMinutes));
  if (params.start) qs.set('start', params.start);
  if (params.end) qs.set('end', params.end);
  const { data } = await api.get('/admin/clock-distribution' + (qs.toString() ? `?${qs}` : ''));
  return data;
}

// ===== 管理后台：风控（反检测/反封号）设置 =====
export async function getRiskSettings() {
  const { data } = await api.get('/admin/risk-settings');
  return data;
}
export async function saveRiskSettings(settings) {
  const { data } = await api.put('/admin/risk-settings', { settings });
  return data;
}

// ===== 资产仪表盘（模块 B）：读取共享资产账本 =====
export async function getAssetsSummary() {
  const { data } = await api.get('/assets/summary');
  return data;
}
export async function getAssetsDaily(days = 30) {
  const { data } = await api.get('/assets/daily?days=' + days);
  return data;
}
export async function getAssetsByTask(days = 30) {
  const { data } = await api.get('/assets/by-task?days=' + days);
  return data;
}
export async function getAssetsLedger(limit = 50) {
  const { data } = await api.get('/assets/ledger?limit=' + limit);
  return data;
}

// ===== 任务接口配置（抓包结果）：模块 A 的"其他接口来源" =====
export async function getTaskEndpoints() {
  const { data } = await api.get('/tasks/endpoints');
  return data;
}
export async function saveTaskEndpoint(type, payload) {
  const { data } = await api.put('/tasks/endpoints', { type, ...payload });
  return data;
}
// 推荐端点模板（社区逆向的真实形态），前端"加载推荐模板"用
export async function getTaskTemplates() {
  const { data } = await api.get('/tasks/templates');
  return data.templates || {};
}
// 任务执行明细（只读）：「每天哪些任务做了、哪些失败、失败原因是什么」。
// params: { date, taskId, userId, fail(bool), limit }
export async function getTaskRuns(params = {}) {
  const qs = new URLSearchParams();
  if (params.date) qs.set('date', params.date);
  if (params.taskId) qs.set('taskId', params.taskId);
  if (params.userId) qs.set('userId', params.userId);
  if (params.fail) qs.set('fail', '1');
  if (params.limit) qs.set('limit', String(params.limit));
  const { data } = await api.get('/tasks/runs' + (qs.toString() ? `?${qs}` : ''));
  return data;
}
// 扫描 captures 目录：读取 importCapture.mjs 生成的 detected.json
export async function getCaptures() {
  const { data } = await api.get('/tasks/captures');
  return data.items || [];
}
// 应用抓包结果到任务接口配置
export async function applyCaptures(items) {
  const { data } = await api.post('/tasks/captures/apply', { items });
  return data;
}

// ===== Cookie 健康检测：手动触发全部账号探活（M-07：POST，避免 GET 误触发副作用）=====
export async function checkCookies() {
  const { data } = await api.post('/health/cookies');
  return data;
}

// ===== 真机端点一键自检（针对单个账号）=====
export async function verifyReal(userId, withCheckin = false) {
  const { data } = await api.post('/health/verify', { userId, withCheckin });
  return data;
}

// ===== 油猴抓取脚本源码（前端「复制/下载」用）=====
export async function getCookieGrabberScript() {
  const { data } = await api.get('/users/import-script', { responseType: 'text' });
  return data;
}

// ===== 系统更新（从 Git 仓库拉取最新代码，需独立管理员 Token）=====
export async function getUpdateStatus() {
  const { data } = await api.get('/update/status', {
    headers: { 'X-Admin-Token': getAdminToken() } // #190：管理员令牌改由 HttpOnly Cookie 自动携带，此头仅作兼容占位
  });
  return data;
}
export async function checkUpdateRepo() {
  const { data } = await api.post(
    '/update/check',
    {},
    { headers: { 'X-Admin-Token': getAdminToken() } }
  );
  return data;
}
export async function applyUpdateRepo() {
  const { data } = await api.post(
    '/update/apply',
    {},
    { headers: { 'X-Admin-Token': getAdminToken() } }
  );
  return data;
}
