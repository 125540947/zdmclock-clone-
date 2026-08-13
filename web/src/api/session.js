// #190：会话状态（响应式）。前端无法读取 HttpOnly 会话 Cookie，故由后端 /api/auth/config
// 推导并下发 loggedIn / isAdmin，前端据此驱动登录浮层与后台入口显隐，避免把 Token 落到
// localStorage 被 XSS 窃取。
import { reactive } from 'vue';

export const session = reactive({
  ready: false,
  loggedIn: false,
  isAdmin: false
});

// 用后端 /config 响应刷新会话状态。
export function applySession(cfg) {
  if (!cfg) return;
  session.loggedIn = !!cfg.loggedIn;
  session.isAdmin = !!cfg.isAdmin;
  session.ready = true;
}
