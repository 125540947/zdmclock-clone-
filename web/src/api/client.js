import axios from 'axios';

const base = import.meta.env.VITE_API_BASE || '/api';

export const api = axios.create({
  baseURL: base,
  timeout: 15000
});

// 若本地已登录，自动携带 Token
const token = localStorage.getItem('zdm_token');
if (token) {
  api.defaults.headers.common['Authorization'] = 'Bearer ' + token;
}

// 请求拦截器：若本地存有管理员 Token（开放模式下管理员登录后写入），为所有请求附加 X-Admin-Token，
// 使管理员在开放模式下能突破同网段过滤、执行改删/系统更新等高权限操作；匿名访客无此头，不受影响。
api.interceptors.request.use((cfg) => {
  const at = localStorage.getItem('zdm_admin_token');
  if (at) {
    cfg.headers = cfg.headers || {};
    cfg.headers['X-Admin-Token'] = at;
  }
  return cfg;
});

// 全局 401 拦截：凭证失效时清掉本地 token 并广播「需要登录」事件，
// 由 App.vue 的登录浮层接管。避免各页面各自处理鉴权。
// 例外（P1-4）：开放模式下匿名调用「需管理员」的写/触发接口会收到 admin_token_required，
// 这是预期的「无权」结果，不应弹登录浮层（避免误登出），交由调用方显示错误提示即可。
api.interceptors.response.use(
  (resp) => resp,
  (err) => {
    if (err && err.response && err.response.status === 401) {
      const body = err.response.data || {};
      const isExpectedNoPermission = body.error === 'admin_token_required';
      if (!isExpectedNoPermission) {
        // P2-1：真正的 401（非预期的「无权写」）需同时清除管理员令牌，避免残留越权态
        setToken(null, null);
        window.dispatchEvent(new Event('zdm:unauthorized'));
      }
    }
    return Promise.reject(err);
  }
);

export function setToken(t, adminToken) {
  if (t) {
    localStorage.setItem('zdm_token', t);
    api.defaults.headers.common['Authorization'] = 'Bearer ' + t;
  } else {
    localStorage.removeItem('zdm_token');
    delete api.defaults.headers.common['Authorization'];
  }
  if (adminToken !== undefined) {
    if (adminToken) localStorage.setItem('zdm_admin_token', adminToken);
    else localStorage.removeItem('zdm_admin_token');
  }
}

// 取独立管理员 Token（用于系统更新等高危操作）；未单独配置时回落为空（客户端不发头，由服务端兜底）。
export function getAdminToken() {
  return localStorage.getItem('zdm_admin_token') || '';
}

export async function login(username, password) {
  const { data } = await api.post('/auth/login', { username, password });
  if (data.token) setToken(data.token, data.adminToken);
  return data;
}

// 公开鉴权配置：前端据此决定走「密码登录」还是「前置代理自动登录」
export async function getAuthConfig() {
  const { data } = await api.get('/auth/config');
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

// ===== Cookie 健康检测：手动触发全部账号探活 =====
export async function checkCookies() {
  const { data } = await api.get('/health/cookies');
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

// ===== 偷懒-极端（一键全自动流水线）=====
export async function runExtremeLazy() {
  const { data } = await api.post('/extreme-lazy/run');
  return data;
}
export async function getExtremeLazyRuns() {
  const { data } = await api.get('/extreme-lazy/runs');
  return data;
}

// ===== 系统更新（从 Git 仓库拉取最新代码，需独立管理员 Token）=====
export async function getUpdateStatus() {
  const { data } = await api.get('/update/status', {
    headers: { 'X-Admin-Token': getAdminToken() }
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
