// notify 路由层测试：覆盖 /api/notify 的 config 读取（凭据遮罩，P1-1）/ 保存（channel 校验 + webhook SSRF 守卫）
//   与 test 发送（none 渠道 / 未配置 / 成功 / 失败分支）。
// 策略：在 import index 之前 mock notifier.sendPush（可切换 SEND 结果，避免真实联网推送），
//       但保留真实的 resolvePushSettings 与 isSafePushUrl（webhook SSRF 校验需在 HTTP 层验证）。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-notify-' + process.pid + '-' + Date.now());
const SRC = path.resolve(import.meta.dirname, '../src');
const p = (rel) => pathToFileURL(path.resolve(SRC, rel)).href;

import * as realNotifier from '../src/notifier.js';
let SEND = { ok: true };
mock.module(p('notifier.js'), {
  namedExports: {
    sendPush: async () => SEND,
    notify: realNotifier.notify,
    resolvePushSettings: realNotifier.resolvePushSettings,
    isSafePushUrl: realNotifier.isSafePushUrl,
    // Phase 1：routes/tasks.js 现也依赖 isSafeSmzdmUrl（Cookie 出口白名单），mock 需透传真实实现
    isSafeSmzdmUrl: realNotifier.isSafeSmzdmUrl,
    // M-07：realAdapter.call 现依赖 readBodyCapped / BodyTooLargeError（流式限流读取），mock 透传真实实现
    readBodyCapped: realNotifier.readBodyCapped,
    BodyTooLargeError: realNotifier.BodyTooLargeError
  }
});

const { createApp } = await import('../src/index.js');
const { config } = await import('../src/config.js');
const { load } = await import('../src/store.js');

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

function resetPush(overrides = {}) {
  const db = load();
  db.settings.push = { enabled: false, channel: 'none', token: '', chatId: '', webhook: '', ...overrides };
}

test('GET /api/notify/config 凭据遮罩（绝不回显明文 token/webhook）', async () => {
  resetPush({ token: 'supersecret123', webhook: 'https://hooks.example.com/x' });
  const r = await j('GET', '/api/notify/config');
  assert.equal(r.status, 200);
  assert.match(r.data.token, /^已配置\(\d+字符\)$/);
  assert.match(r.data.webhook, /^已配置\(\d+字符\)$/);
  assert.ok(!r.data.token.includes('supersecret123'), '不应暴露明文 token');
  assert.ok(!r.data.webhook.includes('hooks.example.com'), '不应暴露明文 webhook');
  // 默认无配置时为空字符串
  resetPush();
  const r2 = await j('GET', '/api/notify/config');
  assert.equal(r2.data.token, '');
  assert.equal(r2.data.webhook, '');
});

test('PUT /api/notify/config 非法 channel → 400', async () => {
  resetPush();
  const r = await j('PUT', '/api/notify/config', { channel: 'bogus' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'invalid_channel');
});

test('PUT /api/notify/config webhook 内网/回环地址 → 400（SSRF 守卫）', async () => {
  resetPush();
  for (const url of ['http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data/', 'http://localhost/y', 'http://192.168.1.1/z']) {
    const r = await j('PUT', '/api/notify/config', { webhook: url });
    assert.equal(r.status, 400, `应拒绝 ${url}`);
    assert.equal(r.data.error, 'unsafe_webhook');
  }
});

test('PUT /api/notify/config 合法（none 渠道）→ 200 且持久化', async () => {
  resetPush();
  const r = await j('PUT', '/api/notify/config', { enabled: true, channel: 'none' });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(load().settings.push.channel, 'none');
  assert.equal(load().settings.push.enabled, true);
});

test('POST /api/notify/test 渠道为 none → 400 no_channel', async () => {
  resetPush({ channel: 'none' });
  const r = await j('POST', '/api/notify/test');
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'no_channel');
});

test('POST /api/notify/test 已选渠道但无令牌 → 400 not_configured', async () => {
  resetPush({ channel: 'serverchan' }); // 无 token/webhook/chatId
  const r = await j('POST', '/api/notify/test');
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'not_configured');
});

test('POST /api/notify/test 发送成功 → 200', async () => {
  resetPush({ channel: 'serverchan', token: 'sctoken', enabled: true });
  SEND = { ok: true };
  const r = await j('POST', '/api/notify/test');
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
});

test('POST /api/notify/test 发送失败 → 502 push_failed', async () => {
  resetPush({ channel: 'serverchan', token: 'sctoken', enabled: true });
  SEND = { ok: false, error: 'down' };
  const r = await j('POST', '/api/notify/test');
  assert.equal(r.status, 502);
  assert.equal(r.data.error, 'push_failed');
  SEND = { ok: true };
});

test('关闭测试服务器', () => { server.close(); });
