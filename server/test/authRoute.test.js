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

const app = createApp();
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

test('POST /api/auth/login 正确凭据签发 token', async () => {
  config.openMode = false;
  config.trustProxyAuth = false;
  const r = await j('POST', '/api/auth/login', { username: config.adminUsername, password: config.adminPassword });
  assert.equal(r.status, 200);
  assert.ok(r.data.token);
  assert.equal(r.data.username, config.adminUsername);
});

test('POST /api/auth/login 错误凭据返回 401', async () => {
  config.openMode = false;
  config.trustProxyAuth = false;
  const r = await j('POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
  assert.equal(r.status, 401);
  assert.equal(r.data.error, 'invalid_credentials');
});

test('OPEN_MODE：匿名登录仅发普通 token（adminToken 空），提交正确 ADMIN_TOKEN 才签发管理员令牌', async () => {
  config.openMode = true;
  config.adminToken = 'adminsecret';
  const anon = await j('POST', '/api/auth/login', { username: 'open' });
  assert.equal(anon.status, 200);
  assert.equal(anon.data.token, config.apiToken);
  assert.ok(!anon.data.adminToken, '匿名不应拿到管理员令牌');
  const admin = await j('POST', '/api/auth/login', { username: 'open', adminToken: 'adminsecret' });
  assert.equal(admin.data.adminToken, 'adminsecret');
  assert.equal(admin.data.username, config.adminUsername || 'admin');
  config.openMode = false;
  config.adminToken = null;
});

test('TRUST_PROXY_AUTH：缺注入头 401，带注入头放行', async () => {
  config.openMode = false;
  config.trustProxyAuth = true;
  config.proxyAuthHeader = 'x-proxy-auth';
  const noHeader = await j('POST', '/api/auth/login', { username: 'proxy' });
  assert.equal(noHeader.status, 401);
  assert.equal(noHeader.data.error, 'proxy_unauthenticated');
  const withHeader = await j('POST', '/api/auth/login', { username: 'proxy' }, { 'x-proxy-auth': 'user@corp' });
  assert.equal(withHeader.status, 200);
  assert.ok(withHeader.data.token);
  config.trustProxyAuth = false;
  config.proxyAuthHeader = '';
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
