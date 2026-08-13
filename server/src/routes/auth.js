import { Router } from 'express';
import { config } from '../config.js';
import { safeEqual, getClientIp, parseCidrList, ipInCidrList, parseCookies } from '../auth.js';

// 前置代理来源 IP 白名单（启动时解析一次；为空表示不限制来源，仅靠 proxyAuthHeader 存在性兜底）
const PROXY_TRUSTED = parseCidrList(config.proxyTrustedIps);

const router = Router();

// #190：会话 Cookie 名称与签发选项。HttpOnly 防止 JS（含 XSS）读取 Token；
// sameSite=lax 缓解 CSRF；secure 仅在 HTTPS 部署（COOKIE_SECURE=1 或 production+req.secure）时开启，
// 自托管 http 场景保持 false 以保证 Cookie 可被发送。
const TOKEN_COOKIE = 'zb_token';
const ADMIN_COOKIE = 'zb_admin_token';
function sessionCookieOpts(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.COOKIE_SECURE === '1' || (config.nodeEnv === 'production' && !!req.secure)
  };
}
function setSessionCookies(res, req, token, adminToken) {
  const opts = sessionCookieOpts(req);
  if (token) res.cookie(TOKEN_COOKIE, token, opts);
  if (adminToken) res.cookie(ADMIN_COOKIE, adminToken, opts);
}
function clearSessionCookies(res) {
  const opts = { httpOnly: true, sameSite: 'lax', path: '/' };
  res.clearCookie(TOKEN_COOKIE, opts);
  res.clearCookie(ADMIN_COOKIE, opts);
}

// 公开配置：前端据此决定是否走「前置代理自动登录」（无需弹密码框），并感知当前会话是否已登录 / 是否管理员。
// loggedIn / isAdmin 由 #190 引入的 HttpOnly 会话 Cookie 推导（前端无法读取 HttpOnly Cookie，故由后端告知），
// 供前端决定登录浮层与后台入口显隐，避免再把 Token 落到 localStorage 被 XSS 窃取。
router.get('/config', (req, res) => {
  const cookies = parseCookies(req);
  const loggedIn = !!(cookies.zb_token && safeEqual(cookies.zb_token, config.apiToken));
  const isAdmin = !!(config.adminToken && cookies.zb_admin_token && safeEqual(cookies.zb_admin_token, config.adminToken));
  res.json({
    openMode: config.openMode,
    trustProxyAuth: config.trustProxyAuth,
    proxyAuthHeader: !!config.proxyAuthHeader,
    requireAuth: config.requireAuth,
    loggedIn,
    isAdmin
  });
});

// #190：登出。清除 HttpOnly 会话 Cookie（普通与管理员），前端无需自行清理 localStorage Token。
router.post('/logout', (req, res) => {
  clearSessionCookies(res);
  res.json({ ok: true });
});

// 管理员登录：校验 ADMIN_USERNAME/ADMIN_PASSWORD，签发通用 API_TOKEN 与独立 adminToken。
// adminToken 用于「系统更新」等高危操作；未单独配置 ADMIN_TOKEN 时回落为 API_TOKEN（兼容性）。
// 前置代理已认证模式（TRUST_PROXY_AUTH=true）：不再校验 ADMIN_PASSWORD，login 自动放行并返回 token；
// 若同时配置了 PROXY_AUTH_HEADER，则要求该注入头存在才放行（否则 401，防止前置失效时裸奔）。
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  // 开放模式（OPEN_MODE）：彻底免登录，login 直接返回合法 token，前端可自动注入后正常调用所有接口。
  if (config.openMode) {
    // 匿名自动登录：仅签发普通 token，绝不向访客泄露管理员 Token（修复：此前会把 ADMIN_TOKEN 发给所有匿名访客，
    // 导致「匿名不能改删」形同虚设——任何人都能拿到管理员令牌去改删账号、触发系统更新）。
    // 注意：匿名登录【不】下发 adminToken 字段（而非空串 ''）。
    // 前端 setToken(token, undefined) 会跳过管理员令牌分支、保留已有令牌；
    // 若下发 '' 则会被前端当作「清空」处理，把刚登录成功的管理员令牌在页面 reload 时误删，
    // 导致开放模式下后台入口闪现后消失、#/admin 被守卫弹回前台。
    const resp = { token: config.apiToken, username: username || 'open' };
    // 管理员通道：提交正确的 ADMIN_TOKEN（作为 adminToken 或 password 字段）才签发管理员 Token，
    // 使「保留管理员改删/更新能力」在开放模式下可用，且不对匿名访客开放。
    if (config.adminToken) {
      const provided = req.body && (req.body.adminToken || req.body.password || '');
      if (provided && safeEqual(provided, config.adminToken)) {
        resp.adminToken = config.adminToken;
        resp.username = config.adminUsername || 'admin';
      }
    }
    setSessionCookies(res, req, resp.token, resp.adminToken);
    return res.json(resp);
  }
  if (config.trustProxyAuth) {
    // 防御纵深：TRUST_PROXY_AUTH=true 但未配 PROXY_AUTH_HEADER 属致命误配，启动阶段已拒绝；
    // 此处再加一道运行期校验（防止配置热更/遗漏），直接拒签 Token。
    if (!config.proxyAuthHeader) {
      return res.status(503).json({
        error: 'proxy_auth_misconfigured',
        message: 'TRUST_PROXY_AUTH=true 但未配置 PROXY_AUTH_HEADER，拒绝签发 Token（请修正配置或关闭该模式）'
      });
    }
    const h = req.headers[String(config.proxyAuthHeader).toLowerCase()];
    if (!h) {
      return res.status(401).json({ error: 'proxy_unauthenticated', message: '前置代理未认证，拒绝放行' });
    }
    // 来源 IP 白名单：即便攻击者可伪造 proxyAuthHeader，只要来源不在可信网段（如前置私有接口）即拒绝，
    // 防直连暴露时绕过代理认证拿到 Token。PROXY_TRUSTED_IPS 未配置时退化为不限制（仅靠请求头兜底）。
    if (!ipInCidrList(getClientIp(req), PROXY_TRUSTED)) {
      return res.status(403).json({ error: 'proxy_source_forbidden', message: '来源 IP 不在可信代理网段，拒绝签发 Token' });
    }
    setSessionCookies(res, req, config.apiToken, config.adminToken || config.apiToken);
    return res.json({
      token: config.apiToken,
      adminToken: config.adminToken || config.apiToken,
      username: username || 'proxy'
    });
  }
  if (
    safeEqual(username, config.adminUsername) &&
    safeEqual(password, config.adminPassword)
  ) {
    setSessionCookies(res, req, config.apiToken, config.adminToken || config.apiToken);
    return res.json({
      token: config.apiToken,
      adminToken: config.adminToken || config.apiToken,
      username
    });
  }
  res.status(401).json({ error: 'invalid_credentials', message: '账号或密码错误' });
});

export default router;
