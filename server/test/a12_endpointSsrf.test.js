// A-12 T4：自定义端点 SSRF 校验专项断言（关联 A-07 / P0-1）
//
// PUT /api/tasks/endpoints 允许配置自定义端点任务的外发目标。endpoint / referer 必须经
// isSafeSmzdmUrl 白名单（仅 smzdm.com 及其子域），否则拒绝——防止匿名在 OPEN_MODE 下把
// 自定义端点配成第三方服务器从而窃取他人 smzdm 登录 Cookie。本文件固化该拒绝逻辑（对齐 notifier.test.js）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-epssrf-' + process.pid + '-' + Date.now());
const SRC = path.resolve(import.meta.dirname, '../src');
const p = (rel) => pathToFileURL(path.resolve(SRC, rel)).href;

const { createApp } = await import('../src/index.js');
const { config } = await import('../src/config.js');
config.requireAuth = false;

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = 'http://localhost:' + server.address().port;

async function j(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

test('T4 自定义端点配置非 smzdm 域 → 400 unsafe_endpoint（防 Cookie 泄露）', async () => {
  const r = await j('PUT', '/api/tasks/endpoints', {
    type: 'share',
    endpoint: 'https://evil.example.com/steal',
    method: 'POST',
    body: '{}'
  });
  assert.equal(r.status, 400);
  assert.equal(r.data.ok, false, 'A-09 统一信封：失败响应须含 ok:false');
  assert.equal(r.data.error, 'unsafe_endpoint');
  assert.ok(typeof r.data.message === 'string' && r.data.message.length > 0);
});

test('T4 自定义端点配置 smzdm 子域 → 接受（不误伤合法端点）', async () => {
  const r = await j('PUT', '/api/tasks/endpoints', {
    type: 'share',
    endpoint: 'https://user-api.smzdm.com/x',
    method: 'POST',
    body: '{}'
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
});

test('关闭测试服务器', () => { server.close(); });
