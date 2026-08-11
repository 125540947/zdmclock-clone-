// index 入口/中间件层测试：覆盖 createApp 装配的若干非路由中间件与静态托管行为。
//  - GET /baoliao-import 同源免构建导入页
//  - GET / 经 SPA 兜底并注入 ?v=<构建戳>（防旧资源缓存）
//  - GET /api/health 健康检查字段
//  - 未知路径 → 404
// 通过运行时改写 config.webDist 指向临时含 index.html 的目录，验证 SPA 兜底戳注入。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-index-' + process.pid + '-' + Date.now());

// 构造临时前端构建目录，含一个引用 /assets/* 的 index.html
const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), 'zdm-dist-'));
fs.writeFileSync(
  path.join(tmpDist, 'index.html'),
  '<!doctype html><html><head><link href="/assets/app.css" rel="stylesheet"></head>' +
    '<body><script src="/assets/app.js"></script></body></html>'
);

const { createApp } = await import('../src/index.js');
const { config } = await import('../src/config.js');
const { load } = await import('../src/store.js');

config.requireAuth = false;
config.webDist = tmpDist; // 必须在 createApp 之前设定，使其挂载静态 + SPA 兜底

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
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* 可能为非 JSON */ }
  return { status: res.status, text, data, headers: Object.fromEntries(res.headers) };
}

test('GET /baoliao-import 返回同源导入页（含标题）', async () => {
  const r = await j('GET', '/baoliao-import');
  assert.equal(r.status, 200);
  assert.match(r.text, /好价批量导入/);
});

test('GET /baoliao-import 注入 per-request nonce 放行内联脚本', async () => {
  const r = await j('GET', '/baoliao-import');
  const csp = r.headers['content-security-policy'] || r.headers['Content-Security-Policy'];
  assert.ok(csp, '应返回 CSP 头');
  const m = csp.match(/script-src 'self' 'nonce-([^']+)'/);
  assert.ok(m, 'script-src 应含 nonce');
  const nonce = m[1];
  assert.match(r.text, new RegExp('nonce="' + nonce.replace(/[+/=]/g, '\\$&') + '"'), '页面内联脚本应使用同一 nonce');
  assert.ok(!r.text.includes('__NONCE__'), '占位符应已被替换');
});

test('GET / 经 SPA 兜底并给 /assets/* 注入 ?v=<构建戳>', async () => {
  const r = await j('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.text, /\/assets\/app\.js\?v=\d+/, 'JS 资源应被注入构建戳');
  assert.match(r.text, /\/assets\/app\.css\?v=\d+/, 'CSS 资源应被注入构建戳');
});

test('GET /api/health 返回 ok 与 scheduler 字段', async () => {
  const r = await j('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.ok('scheduler' in r.data);
});

test('POST 未知路径 → 404', async () => {
  const r = await j('POST', '/api/definitely-not-a-route', {});
  assert.equal(r.status, 404);
});

test('关闭测试服务器', () => {
  server.close();
  try { fs.rmSync(tmpDist, { recursive: true, force: true }); } catch { /* ignore */ }
});
