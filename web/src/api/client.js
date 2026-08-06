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
