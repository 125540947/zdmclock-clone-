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

export function setToken(t) {
  if (t) {
    localStorage.setItem('zdm_token', t);
    api.defaults.headers.common['Authorization'] = 'Bearer ' + t;
  } else {
    localStorage.removeItem('zdm_token');
    delete api.defaults.headers.common['Authorization'];
  }
}

export async function login(username, password) {
  const { data } = await api.post('/auth/login', { username, password });
  if (data.token) setToken(data.token);
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
