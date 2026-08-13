// P2：通知模块测试（resolvePushSettings env 回退、sendPush 各渠道缺失令牌分支、notify 跳过）
// 仅覆盖不发起网络请求的契约分支；成功路径以 mock fetch 验证一次。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { resolvePushSettings, sendPush, notify, isSafeSmzdmUrl } = await import('../src/notifier.js');
const realFetch = globalThis.fetch;

// ===================== Phase 1：Cookie 出口白名单 =====================

test('isSafeSmzdmUrl：放行 smzdm.com 及其子域', () => {
  for (const u of [
    'https://www.smzdm.com/',
    'https://user-api.smzdm.com/checkin',
    'http://zhiyou.smzdm.com/x',
    'https://article-api.smzdm.com/a'
  ]) {
    assert.equal(isSafeSmzdmUrl(u), true, u);
  }
});

test('isSafeSmzdmUrl：拒绝其他公网域名（防 Cookie 外泄）', () => {
  for (const u of [
    'https://attacker.com/steal',
    'https://evil.example.org/x',
    'https://smzdm.com.evil.com/x' // 非 .smzdm.com 子域（前缀陷阱）
  ]) {
    assert.equal(isSafeSmzdmUrl(u), false, u);
  }
});

test('isSafeSmzdmUrl：拒绝 IP / localhost / 非 http', () => {
  for (const u of [
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1/x',
    'http://localhost/x',
    'http://[::1]/x',
    'ftp://www.smzdm.com/x',
    'not-a-url',
    ''
  ]) {
    assert.equal(isSafeSmzdmUrl(u), false, u);
  }
});

test('isSafeSmzdmUrl：allowedExact 放行自定义基址', () => {
  assert.equal(isSafeSmzdmUrl('https://my-proxy.example.com/x', ['my-proxy.example.com']), true);
  assert.equal(isSafeSmzdmUrl('https://my-proxy.example.com/x', ['other.com']), false);
});

test('resolvePushSettings 优先采用 db 显式配置', () => {
  const s = resolvePushSettings({ settings: { push: { channel: 'serverchan', token: 't', enabled: true } } });
  assert.equal(s.channel, 'serverchan');
  assert.equal(s.token, 't');
  assert.equal(s.enabled, true);
});

test('resolvePushSettings 缺省回退到 config 且默认 none/未启用', () => {
  const s = resolvePushSettings({ settings: {} });
  assert.equal(s.channel, 'none'); // config.pushChannel 默认空 → none
  assert.equal(s.enabled, false);
});

test('sendPush channel_none 直接返回', async () => {
  const r = await sendPush({ channel: 'none' }, { title: 'x', message: 'y' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'channel_none');
});

test('sendPush serverchan 缺 token 返回 missing_token', async () => {
  const r = await sendPush({ channel: 'serverchan', token: '' }, { title: 'a', message: 'b' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'missing_token');
});

test('sendPush bark 缺 token 返回 missing_token', async () => {
  const r = await sendPush({ channel: 'bark', token: '' }, { title: 'a', message: 'b' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'missing_token');
});

test('sendPush telegram 缺 token/chat 返回 missing_token_or_chat', async () => {
  const r = await sendPush({ channel: 'telegram', token: '', chatId: '' }, { title: 'a', message: 'b' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'missing_token_or_chat');
});

test('sendPush webhook 缺 webhook 返回 missing_webhook', async () => {
  const r = await sendPush({ channel: 'webhook', webhook: '' }, { title: 'a', message: 'b' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'missing_webhook');
});

test('sendPush serverchan 成功路径（mock fetch 返回 code:0）', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ code: 0 }) });
  const r = await sendPush({ channel: 'serverchan', token: 'sendkey' }, { title: 't', message: 'm' });
  assert.equal(r.ok, true);
  globalThis.fetch = realFetch;
});

test('notify 未启用/未配置时跳过（返回 skipped）', async () => {
  const r = await notify({ settings: { push: { enabled: false } } }, { title: 'x', message: 'y' });
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
});

test('还原全局 fetch', () => {
  globalThis.fetch = realFetch;
  assert.ok(true);
});
