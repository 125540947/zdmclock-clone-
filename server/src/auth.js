import { config } from './config.js';

// 写操作 / 管理接口鉴权。REQUIRE_AUTH=false 时直接放行，保证开箱即跑。
export function authRequired(req, res, next) {
  if (!config.requireAuth) return next();
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (token && token === config.apiToken) return next();
  return res.status(401).json({ error: 'unauthorized', message: '缺少或无效的 Token' });
}

// 对外展示时遮罩 cookie，避免敏感信息泄露
export function maskCookie(cookie = '') {
  if (!cookie || cookie.length <= 8) return '***';
  return cookie.slice(0, 4) + '****' + cookie.slice(-4);
}
