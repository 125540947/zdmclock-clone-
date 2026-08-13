// auth 路由层测试：覆盖 /api/auth 的公开 config 与 login 各鉴权分支
// （正常凭据 / 错误凭据 / OPEN_MODE 匿名+管理员通道 / TRUST_PROXY_AUTH 前置代理）。
// 通过运行时切换 config 字段复用同一 app 实例（auth.js 运行时读取 config）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-authroute-' + process.pid + '-' + Date.now());
const { createApp } = await import('../src/index.js');
const { config } = await import('../src/config.js');

config.requireAuth = false;

// 本文件对 /api/auth/login 连续发起大量 POST（覆盖多分支 + #190 + H-06 等），
// 会触达登录接口 max:10/60s 的固定窗口限流而被 429 误伤；限流逻辑由 rateLimit.test.js 独立覆盖，
// 故此处关闭限流以专注鉴权行为验证（createApp({ rateLimit:false })）。
const app = createApp({ rateLimit: false });
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = 'http://localhost:' + server.address().port;

async function j(method, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch { /* 可能无 JSON 体 */ }
  return { status: res.status, data };
}

test('GET /api/auth/config 公开返回鉴权模式字段', async () => {
  const r = await j('GET', '/api/auth/config');
  assert.equal(r.status, 200);
  assert.equal(typeof r.data.openMode, 'boolean');
  assert.equal(typeof r.data.requireAuth, 'boolean');
  assert.ok('trustProxyAuth' in r.data);
});

test('POST /api/auth/login 正确凭据签发会话 Cookie（不再回显明文 token，M-13）', async () => {
  config.openMode = false;
  config.trustProxyAuth = false;
  const r = await j('POST', '/api/auth/login', { username: config.adminUsername, password: config.adminPassword });
  assert.equal(r.status, 200);
  assert.equal(r.data.username, config.adminUsername);
  assert.ok(!('token' in r.data), 'M-13：登录响应不应回显明文 token（HttpOnly 会话 Cookie 承载鉴权）');
  assert.ok(!('adminToken' in r.data), 'M-13：登录响应不应回显明文 adminToken');
});

// H-06：标准 TLS 部署（COOKIE_SECURE=1）下，登录签发的会话 Cookie 必须带 Secure 属性，
// 避免 HTTPS 站点下会话 Cookie 在 HTTP 链路/降级中被发送。
test('H-06：COOKIE_SECURE=1 时登录会话 Cookie 带 Secure', async () => {
  const prev = process.env.COOKIE_SECURE;
  process.env.COOKIE_SECURE = '1';
  config.openMode = false;
  config.trustProxyAuth = false;
  try {
    const loginRes = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: config.adminUsername, password: config.adminPassword })
    });
    const sc = loginRes.headers.get('set-cookie') || '';
    assert.ok(/zb_token=/.test(sc), '应签发 zb_token');
    assert.ok(/Secure/i.test(sc), 'COOKIE_SECURE=1 应使会话 Cookie 带 Secure（H-06）');
  } finally {
    if (prev === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = prev;
  }
});

test('POST /api/auth/login 错误凭据返回 401', async () => {
  config.openMode = false;
  config.trustProxyAuth = false;
  const r = await j('POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'invalid_credentials');
});

test('OPEN_MODE：匿名登录不回显明文 token，仅发普通会话 Cookie；正确 ADMIN_TOKEN 才发管理员 Cookie', async () => {
  const prevAdminToken = config.adminToken;
  config.openMode = true;
  config.adminToken = 'adminsecret';
  // 匿名登录：不应回显明文 token，仅签发普通会话 Cookie
  const anonRes = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'open' })
  });
  const anonData = await anonRes.json();
  const anonSc = anonRes.headers.get('set-cookie') || '';
  assert.equal(anonRes.status, 200);
  assert.equal(anonData.openMode, true);
  assert.ok(!('token' in anonData), '登录响应不应回显静态 token（M-13 修复）');
  assert.ok(!('adminToken' in anonData), '匿名不应拿到管理员令牌字段');
  assert.ok(/zb_token=/.test(anonSc), '应签发普通会话 Cookie');
  assert.ok(/HttpOnly/i.test(anonSc), '会话 Cookie 应为 HttpOnly（防 XSS 读取）');
  assert.ok(!/zb_admin_token=/.test(anonSc), '匿名不应签发管理员 Cookie');
  // 提交正确 ADMIN_TOKEN → 签发管理员 Cookie（且不回显明文 adminToken）
  const adminRes = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'open', adminToken: 'adminsecret' })
  });
  const adminData = await adminRes.json();
  const adminSc = adminRes.headers.get('set-cookie') || '';
  assert.ok(!('adminToken' in adminData), '登录响应不应回显明文 adminToken（M-13 修复）');
  assert.ok(/zb_admin_token=/.test(adminSc), '提交正确 ADMIN_TOKEN 应签发管理员 Cookie');
  assert.equal(adminData.username, config.adminUsername || 'admin');
  // 错误 ADMIN_TOKEN → 不签发管理员 Cookie
  const badRes = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'open', adminToken: 'wrong' })
  });
  const badSc = badRes.headers.get('set-cookie') || '';
  assert.ok(!/zb_admin_token=/.test(badSc), '错误 ADMIN_TOKEN 不应签发管理员 Cookie');
  config.openMode = false;
  config.adminToken = prevAdminToken;
});

test('TRUST_PROXY_AUTH：缺注入头 401，带注入头放行（不回显明文 token，改发 HttpOnly 会话 Cookie）', async () => {
  config.openMode = false;
  config.trustProxyAuth = true;
  config.proxyAuthHeader = 'x-proxy-auth';
  const noHeader = await j('POST', '/api/auth/login', { username: 'proxy' });
  assert.equal(noHeader.status, 401);
  assert.equal(noHeader.data.error, 'proxy_unauthenticated');
  const withHeaderRes = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-proxy-auth': 'user@corp' },
    body: JSON.stringify({ username: 'proxy' })
  });
  const withHeaderData = await withHeaderRes.json();
  const sc = withHeaderRes.headers.get('set-cookie') || '';
  assert.equal(withHeaderRes.status, 200);
  assert.ok(!('token' in withHeaderData), '登录响应不应回显明文 token（M-13 修复）');
  assert.ok(/zb_token=/.test(sc), '应签发 HttpOnly 会话 Cookie');
  config.trustProxyAuth = false;
  config.proxyAuthHeader = '';
});

// H-05 修复：TRUST_PROXY_AUTH 配置可信网段后，即便带注入头，真实连接源（套接字地址，不可伪造）
// 不在可信网段即 403；且必须使用 req.socket.remoteAddress 而非可被伪造的 X-Forwarded-For。
test('H-05：配置可信网段后，非可信来源（带注入头+伪造 XFF）被 403 拒绝', async () => {
  config.openMode = false;
  config.trustProxyAuth = true;
  config.proxyAuthHeader = 'x-proxy-auth';
  config.proxyTrustedIps = '10.0.0.0/8'; // 测试请求来自 127.0.0.1/::1，不在该网段
  const r = await j('POST', '/api/auth/login', { username: 'proxy' }, {
    'x-proxy-auth': 'user@corp',
    'x-forwarded-for': '10.0.0.5' // 伪造为可信网段，仍应以真实套接字源为准
  });
  assert.equal(r.status, 403, '来源 IP 不在可信代理网段应被拒（H-05）');
  assert.equal(r.data.error, 'proxy_source_forbidden');
  config.trustProxyAuth = false;
  config.proxyAuthHeader = '';
  config.proxyTrustedIps = '';
});

// Phase 2 代理认证加固：trustProxyAuth=true 但未配 proxyAuthHeader 属致命误配，运行期也应拒绝签发（启动期已 process.exit）
test('TRUST_PROXY_AUTH=true 但未配 PROXY_AUTH_HEADER → /login 拒绝签发（503）', async () => {
  config.openMode = false;
  config.trustProxyAuth = true;
  config.proxyAuthHeader = ''; // 致命误配
  config.proxyTrustedIps = '';
  try {
    const r = await j('POST', '/api/auth/login', { username: 'proxy' });
    assert.equal(r.status, 503, '误配应拒绝签发 Token');
    assert.equal(r.data.error, 'proxy_auth_misconfigured');
  } finally {
    config.trustProxyAuth = false;
    config.proxyAuthHeader = '';
    config.proxyTrustedIps = '';
  }
});

// #190：登录下发 HttpOnly 会话 Cookie，且该 Cookie 能被鉴权中间件接受（不依赖 Bearer / localStorage）。
test('#190 登录下发 HttpOnly Cookie 且可被 authRequired 接受', async () => {
  config.openMode = false;
  config.trustProxyAuth = false;
  config.requireAuth = true;
  const loginRes = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: config.adminUsername, password: config.adminPassword })
  });
  const setCookie = loginRes.headers.get('set-cookie') || '';
  assert.ok(/zb_token=/.test(setCookie), '应下发 zb_token Cookie');
  assert.ok(/HttpOnly/i.test(setCookie), 'Cookie 应为 HttpOnly（防 XSS 读取）');
  const cookie = setCookie.split(';')[0];
  // 不带 Cookie 访问受保护接口 → 401
  const noCookie = await j('GET', '/api/users');
  assert.equal(noCookie.status, 401, '无 Cookie 应被拒');
  // 带 Cookie → 200（Cookie 被 authRequired 接受）
  const withCookie = await j('GET', '/api/users', undefined, { Cookie: cookie });
  assert.equal(withCookie.status, 200, 'HttpOnly Cookie 应通过鉴权');
  // /config 由 Cookie 推导 loggedIn
  const cfg = await j('GET', '/api/auth/config', undefined, { Cookie: cookie });
  assert.equal(cfg.data.loggedIn, true, '/config 应由 Cookie 推导 loggedIn');
  config.requireAuth = false;
});

// #190：登出清除 HttpOnly 会话 Cookie。
test('#190 登出清除会话 Cookie', async () => {
  config.openMode = false;
  config.trustProxyAuth = false;
  config.requireAuth = false;
  const loginRes = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: config.adminUsername, password: config.adminPassword })
  });
  const cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
  const outRes = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
  const outSc = outRes.headers.get('set-cookie') || '';
  assert.ok(/zb_token=/i.test(outSc) && /(max-age=0|expires=)/i.test(outSc), '登出应清除 zb_token（置空或过期）');
});

test('关闭测试服务器', () => { server.close(); });
