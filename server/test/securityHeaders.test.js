// P1：安全响应头集成测（index.js 的 CSP 中间件，P2-11 修复）。
// 通过 createApp() 启动真实 Express 实例，验证所有响应携带 Content-Security-Policy，
// 且策略满足「默认/脚本同源、禁止被 iframe 嵌套、连接同源」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-csp-' + process.pid + '-' + Date.now());
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

test('关闭测试服务器', () => {
  server.close();
  assert.ok(true);
});
