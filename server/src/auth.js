import crypto from 'node:crypto';
import { config } from './config.js';

// 恒定时间字符串比较，避免 token/密码比较被计时侧信道攻击（b7）
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// 写操作 / 管理接口鉴权。REQUIRE_AUTH=false 时直接放行，保证开箱即跑。
export function authRequired(req, res, next) {
  if (!config.requireAuth) return next();
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (token && safeEqual(token, config.apiToken)) return next();
  return res.status(401).json({ error: 'unauthorized', message: '缺少或无效的 Token' });
}

// 对外展示时遮罩 cookie，避免敏感信息泄露（S7：不再暴露前后缀，统一隐藏）
export function maskCookie(cookie = '') {
  return cookie ? '已保存(已隐藏)' : '';
}
