import crypto from 'node:crypto';
import { config } from './config.js';

// 恒定时间字符串比较，避免 token/密码比较被计时侧信道攻击（b7）
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// 零依赖解析 Cookie 头（项目 VPS 部署为「源码直拉 + 重启」，未引入 cookie-parser，
// 避免新增运行时依赖破坏部署；express 的 res.cookie 原生可用，仅解析需自实现）。
export function parseCookies(req) {
  const out = {};
  const raw = req && req.headers && req.headers.cookie;
  if (!raw) return out;
  for (const part of String(raw).split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    let v = part.slice(idx + 1).trim();
    try { v = decodeURIComponent(v); } catch { /* 保留原值 */ }
    if (k) out[k] = v;
  }
  return out;
}

// 写操作 / 管理接口鉴权。REQUIRE_AUTH=false 时直接放行，保证开箱即跑。
// 凭证来源（任一即可）：Authorization: Bearer <token>（API 客户端 / 旧前端）、
// 或 HttpOnly 会话 Cookie（zb_token，#190 防 XSS 窃取）。
export function authRequired(req, res, next) {
  if (config.openMode || !config.requireAuth) return next();
  const h = req.headers.authorization || '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
  const token = bearer || parseCookies(req).zb_token || '';
  if (token && safeEqual(token, config.apiToken)) return next();
  return res.status(401).json({ error: 'unauthorized', message: '缺少或无效的 Token' });
}

// 允许 Bearer 头或 ?token= 查询参数二选一（用于「一键安装」油猴脚本直链）。
// 浏览器导航到 .user.js 无法携带 Authorization 头，故允许用 ?token= 传入「窄权限 INSTALL_TOKEN」
// （H-04 修复：该 token 仅用于自动推送 Cookie，泄露面有限，且改 .env 即可吊销）；同时接受
// zb_token 会话 Cookie（#190）。注意：后端早已忽略 ?server= 参数，安装脚本不再依赖它。
export function authRequiredOrQuery(req, res, next) {
  if (config.openMode || !config.requireAuth) return next();
  const h = req.headers.authorization || '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
  const q = String(req.query.token || '');
  const cookie = parseCookies(req).zb_token || '';
  if (
    (bearer && safeEqual(bearer, config.apiToken)) ||
    (q && safeEqual(q, config.apiToken)) ||
    (cookie && safeEqual(cookie, config.apiToken))
  ) return next();
  return res.status(401).json({ error: 'unauthorized', message: '缺少或无效的 Token' });
}

// 录入接口专用：除通用 API_TOKEN / 独立 ADMIN_TOKEN 外，额外接受窄权限 INSTALL_TOKEN（Bearer 或 ?token= 二选一）。
// 油猴脚本自动推送 Cookie（POST /users/import）使用 INSTALL_TOKEN，避免把全权限会话/API token 固化进可分发脚本（P1-2 修复）。
// 同时接受 zb_token 会话 Cookie（#190）。
export function authRequiredOrInstall(req, res, next) {
  if (config.openMode || !config.requireAuth) return next();
  const h = req.headers.authorization || '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
  const q = String(req.query.token || '');
  const cookie = parseCookies(req).zb_token || '';
  const candidates = [config.apiToken, config.adminToken, config.installToken].filter(Boolean);
  if (candidates.some((c) => (bearer && safeEqual(bearer, c)) || (q && safeEqual(q, c)) || (cookie && safeEqual(cookie, c)))) return next();
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
  // 凭证来源优先级：X-Admin-Token 头 > POST body.adminToken > zb_admin_token 会话 Cookie（#190）> Authorization（支持 Admin 与 Bearer 方案）。
  let provided = req.headers['x-admin-token'] || (req.body && req.body.adminToken) || parseCookies(req).zb_admin_token || '';
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

// 解析真实访客 IP。安全模型（P0-2 修复）：
// - 仅当显式信任代理（config.trustProxy=true，即确有多层可信反代已剥离客户端伪造的 XFF）时，
//   才采用 X-Forwarded-For 首段；否则一律返回真实套接字对端 IP（req.ip，不可伪造）。
// 绝不默认可信 XFF——否则匿名可伪造 X-Forwarded-For 命中同 /24 网段判定，越权读取他人账号数据。
// 开放录入的「同IP段可见」依赖此值，故该修复同时加固了 P0-3 水平越权防护。
// 解析真实访客 IP。安全模型（H-04 修复）：始终返回 Express 依据「受信任代理网段」计算出的真实访客 IP，
// 不再自行解析 X-Forwarded-For 最左段。Express 底层 proxy-addr 从右向左剔除可信代理，
// 客户端伪造的 XFF 左段会被忽略，从根本上杜绝「伪造 XFF 命中同 /24 网段判定」的水平越权（P0-3）。
// 仅当显式信任代理（config.trustProxy=true，即确有多层可信反代已剥离客户端伪造的 XFF）时，
// proxy-addr 才会采信 XFF；直连暴露时 req.ip 为真实套接字对端、不可伪造。
export function getClientIp(req) {
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

// 解析 IP/CIDR 白名单字符串（逗号分隔）。返回 [{ base, mask }]，非法项忽略。
export function parseCidrList(str) {
  if (!str) return [];
  return String(str)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      if (s.includes('/')) {
        const [ip, bitsStr] = s.split('/');
        const bits = Number(bitsStr);
        const base = ipToLong(ip);
        if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
        const mask = bits >= 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
        return { base, mask };
      }
      const ip = ipToLong(s);
      if (ip === null) return null;
      return { base: ip, mask: 0xffffffff };
    })
    .filter(Boolean);
}

// 判断 IPv4 是否命中白名单。list 为空（未配置）返回 true（不限制来源，由上层 proxyAuthHeader 兜底）。
export function ipInCidrList(ip, list) {
  if (!list || !list.length) return true;
  const v = ipToLong(ip);
  if (v === null) return false;
  return list.some(({ base, mask }) => (v & mask) === (base & mask));
}

// 从请求中提取管理员 Token（与 requireAdmin 同源）：X-Admin-Token 头 > body.adminToken > Authorization。
export function extractAdminToken(req) {
  const h = req.headers.authorization || '';
  let provided = req.headers['x-admin-token'] || (req.body && req.body.adminToken) || parseCookies(req).zb_admin_token || '';
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

// 运营/管理类端点守卫（Phase 2 隔离缺口修复）：
// 开放模式（OPEN_MODE）下强制 requireAdmin —— 全局运营统计、任务端点配置等不应向匿名访客暴露；
// 非开放模式维持原 authRequired（含 REQUIRE_AUTH=false 时免鉴权开箱即跑，行为不变）。
export function adminOrAuthRequired(req, res, next) {
  if (config.openMode) return requireAdmin(req, res, next);
  return authRequired(req, res, next);
}

// 计算当前请求者「可见的账号 id 集合」（用于 OPEN_MODE 资产数据按 /24 网段隔离）。
// 返回 null 表示「全部可见」（管理员 / 非开放模式）；返回 Set 表示仅这些 id 可见（开放模式非管理员，按网段过滤）。
// M-10 修复：移除「无 recordedIp 的遗留账号对所有人可见」特例——遗留数据归属不明，
// 不应对匿名访客可见，仅同网段录入的账号或管理员可见，杜绝匿名跨网段读取遗留数据（水平越权）。
export function computeVisibleUserIds(db, req) {
  if (isAdminRequest(req)) return null;
  if (config.openMode) {
    const viewerIp = getClientIp(req);
    const set = new Set();
    for (const u of db.users || []) {
      if (sameSegment(viewerIp, u.recordedIp, 24)) set.add(u.id);
    }
    return set;
  }
  return null;
}

// 判断是否可访问某个账号的私有数据（签到记录/streak/points、真机自检等）。
// 用于修复 P0-3 水平越权：开放模式下非管理员只能访问「同 /24 网段」录入的账号；
// 管理员（有效 ADMIN_TOKEN）可访问全部；非开放模式下 apiToken 持有者即操作员，允许全部。
// M-10 修复：移除「无 recordedIp 的遗留账号对所有人可见」特例——遗留数据归属不明，
// 不对匿名访客可见；仅同网段录入或管理员可访问。
export function canAccessUser(req, userRecord) {
  if (isAdminRequest(req)) return true;
  if (config.openMode) {
    if (!userRecord) return false;
    const viewerIp = getClientIp(req);
    return sameSegment(viewerIp, userRecord.recordedIp, 24);
  }
  return true;
}
