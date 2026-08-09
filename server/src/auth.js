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
  if (config.openMode || !config.requireAuth) return next();
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (token && safeEqual(token, config.apiToken)) return next();
  return res.status(401).json({ error: 'unauthorized', message: '缺少或无效的 Token' });
}

// 允许 Bearer 头或 ?token= 查询参数二选一（用于「一键安装」油猴脚本直链）。
// 浏览器导航到 .user.js 无法携带 Authorization 头，前端改从已登录会话的 localStorage 取 token 作为 ?token= 传入；
// 该 token 本就会写进脚本用于自动推送 Cookie，用 query 传不增加额外泄露面，从而开启鉴权时也能一键安装。
export function authRequiredOrQuery(req, res, next) {
  if (config.openMode || !config.requireAuth) return next();
  const h = req.headers.authorization || '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
  const q = String(req.query.token || '');
  if ((bearer && safeEqual(bearer, config.apiToken)) || (q && safeEqual(q, config.apiToken))) return next();
  return res.status(401).json({ error: 'unauthorized', message: '缺少或无效的 Token' });
}

// 管理级 / 高危操作鉴权（H2 修复）：用于「系统更新」等会执行 git pull + 重启的接口。
// 关键差异：不受 REQUIRE_AUTH=false 影响——更新接口永远需要鉴权，绝不匿名放行。
// 优先级：
//   1) 配置了独立 ADMIN_TOKEN → 必须提供且匹配 ADMIN_TOKEN（与通用 API_TOKEN 隔离）。
//   2) 未配置 ADMIN_TOKEN → 退回要求通用 API_TOKEN 且 REQUIRE_AUTH 已开启（仍不允许匿名）。
// 凭证来源：请求头 X-Admin-Token，或 Authorization: Admin <token>，或 POST body 里的 adminToken。
export function requireAdmin(req, res, next) {
  const h = req.headers.authorization || '';
  // 凭证来源优先级：X-Admin-Token 头 > POST body.adminToken > Authorization（支持 Admin 与 Bearer 方案）。
  let provided = req.headers['x-admin-token'] || (req.body && req.body.adminToken) || '';
  if (!provided && h) {
    if (h.startsWith('Admin ')) provided = h.slice(6);
    else if (h.startsWith('Bearer ')) provided = h.slice(7);
  }
  if (config.adminToken) {
    if (provided && safeEqual(provided, config.adminToken)) return next();
    return res.status(401).json({
      error: 'admin_token_required',
      message: '更新操作需要独立的管理员 Token（ADMIN_TOKEN）'
    });
  }
  // 兜底：未单独配置 ADMIN_TOKEN 时，至少要求通用 API_TOKEN 且鉴权已开启（绝不匿名放行）。
  if (config.requireAuth && provided && safeEqual(provided, config.apiToken)) return next();
  return res.status(401).json({ error: 'unauthorized', message: '缺少或无效的 Token' });
}

// 对外展示时遮罩 cookie，避免敏感信息泄露（S7：不再暴露前后缀，统一隐藏）
export function maskCookie(cookie = '') {
  return cookie ? '已保存(已隐藏)' : '';
}

// 解析真实访客 IP：优先取 X-Forwarded-For 首段（兼容 Cloudflare / 宝塔 / nginx 反代），
// 回退到 req.ip（已配合 app.set('trust proxy')）。开放录入的「同IP段可见」依赖此值。
export function getClientIp(req) {
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  return (req && req.ip) || '';
}

// 将 IPv4 字符串转为 32 位无符号整数；非法（含非 IPv4）返回 null。
export function ipToLong(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || '').trim());
  if (!m) return null;
  const parts = [m[1], m[2], m[3], m[4]].map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// 判断两个 IPv4 是否同网段（默认 /24）。任一非 IPv4 返回 false（IPv6 不纳入同段判定）。
export function sameSegment(ipA, ipB, bits = 24) {
  const a = ipToLong(ipA);
  const b = ipToLong(ipB);
  if (a === null || b === null) return false;
  const mask = bits >= 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
}

// 从请求中提取管理员 Token（与 requireAdmin 同源）：X-Admin-Token 头 > body.adminToken > Authorization。
export function extractAdminToken(req) {
  const h = req.headers.authorization || '';
  let provided = req.headers['x-admin-token'] || (req.body && req.body.adminToken) || '';
  if (!provided && h) {
    if (h.startsWith('Admin ')) provided = h.slice(6);
    else if (h.startsWith('Bearer ')) provided = h.slice(7);
  }
  return provided;
}

// 是否为「管理员请求」：提供了有效的独立 ADMIN_TOKEN（高权限，可绕过开放模式的可见/改删限制）。
// 关键：开放模式下 apiToken 对所有人自动签发，绝不能据此判定管理员，因此仅认 ADMIN_TOKEN。
export function isAdminRequest(req) {
  if (!config.adminToken) return false;
  const provided = extractAdminToken(req);
  return !!(provided && safeEqual(provided, config.adminToken));
}

// 写操作守卫（改/删账号）：开放模式下要求管理员 Token（匿名不能改/删）；非开放模式维持原鉴权（authRequired）。
export function mutationGuard(req, res, next) {
  if (config.openMode) return requireAdmin(req, res, next);
  return authRequired(req, res, next);
}
