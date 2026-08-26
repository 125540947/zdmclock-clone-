// P1：安全响应头集成测（index.js 的 CSP 中间件，P2-11 修复）。
// 通过 createApp() 启动真实 Express 实例，验证所有响应携带 Content-Security-Policy，
// 且策略满足「默认/脚本同源、禁止被 iframe 嵌套、连接同源」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-csp-' + process.pid + '-' + Date.now());
// M-08 验证场景：模拟「前端在独立域名」的分域部署，后端 CORS 必须返回
// Access-Control-Allow-Credentials: true，否则浏览器不会在跨域请求中携带 HttpOnly 会话 Cookie。
process.env.CORS_ORIGIN = 'https://example.com';
const { createApp } = await import('../src/index.js');

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = 'http://localhost:' + server.address().port;

test('所有响应携带 Content-Security-Policy 且满足关键约束', async () => {
  for (const p of ['/api/health', '/api/auth/config']) {
    const res = await fetch(base + p);
    const csp = res.headers.get('content-security-policy') || '';
    assert.ok(csp, `${p} 应携带 CSP 头`);
    assert.ok(csp.includes("default-src 'self'"), 'default-src 应为 self');
    assert.ok(csp.includes("script-src 'self'"), 'script-src 应为 self');
    assert.ok(csp.includes("frame-ancestors 'none'"), '应禁止被 iframe 嵌套');
    assert.ok(csp.includes("connect-src 'self'"), 'connect-src 应为 self');
  }
});

test('CSP 收紧：不再放行被墙的 Google Fonts', async () => {
  const res = await fetch(base + '/api/health');
  const csp = res.headers.get('content-security-policy') || '';
  assert.ok(!csp.includes('fonts.googleapis.com'), 'style-src 不应放行 Google Fonts');
  assert.ok(!csp.includes('fonts.gstatic.com'), 'font-src 不应放行 Google Fonts');
});

test('M-08：分域部署时 CORS 返回 Access-Control-Allow-Credentials: true', async () => {
  const res = await fetch(base + '/api/auth/config', {
    headers: { Origin: 'https://example.com' }
  });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://example.com');
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
});

test('纵深加固：响应不泄露 X-Powered-By: Express 技术栈标识', async () => {
  for (const p of ['/api/health', '/api/auth/config']) {
    const res = await fetch(base + p);
    assert.equal(res.headers.get('x-powered-by'), null, `${p} 不应携带 X-Powered-By 头`);
  }
});

test('未知 /api 路由返回 JSON 404（而非被 SPA 兜底吞成 200 HTML）', async () => {
  const res = await fetch(base + '/api/__nonexistent__');
  assert.equal(res.status, 404);
  const ct = res.headers.get('content-type') || '';
  assert.ok(ct.includes('application/json'), '应返回 JSON 而非 HTML');
  const body = await res.json();
  assert.equal(body.error, 'not_found');
});

test('关闭测试服务器', () => {
  server.close();
  assert.ok(true);
});
