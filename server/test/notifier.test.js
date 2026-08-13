// P2：通知模块测试（resolvePushSettings env 回退、sendPush 各渠道缺失令牌分支、notify 跳过）
// 仅覆盖不发起网络请求的契约分支；成功路径以 mock fetch 验证一次。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { resolvePushSettings, sendPush, notify, isSafeSmzdmUrl, safePushFetch, readJsonCapped } = await import('../src/notifier.js');
const { setDnsResolver, getDnsResolver } = await import('../src/dnsGuard.js');
const realFetch = globalThis.fetch;
const realResolver = getDnsResolver();
// 测试期间默认把解析器置为"返回公开 IP"，个别用例再覆盖为私有/失败，避免触发真实网络。
setDnsResolver(async () => [{ address: '93.184.216.34' }]);
const restoreResolver = () => setDnsResolver(realResolver);

// ===================== Phase 1：Cookie 出口白名单 =====================

test('isSafeSmzdmUrl：放行 smzdm.com 及其子域（https）', () => {
  for (const u of [
    'https://www.smzdm.com/',
    'https://user-api.smzdm.com/checkin',
    'https://zhiyou.smzdm.com/x',
    'https://article-api.smzdm.com/a'
  ]) {
    assert.equal(isSafeSmzdmUrl(u), true, u);
  }
});

// H-02 修复：Cookie 只应经 HTTPS 发送，明文 http 一并拒绝（否则 smzdm 凭据在网络中明文传输）
test('isSafeSmzdmUrl：拒绝明文 http（含 smzdm 子域）', () => {
  for (const u of [
    'http://www.smzdm.com/x',
    'http://zhiyou.smzdm.com/x',
    'http://user-api.smzdm.com/checkin'
  ]) {
    assert.equal(isSafeSmzdmUrl(u), false, u);
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
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ code: 0 })).buffer,
    json: async () => ({ code: 0 })
  });
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

// ===================== #182：推送 webhook/Bark SSRF + DNS 重绑定防护 =====================

test('safePushFetch：拒绝内网/非公网 URL（不发起请求）', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const r = await safePushFetch('http://169.254.169.254/latest/meta-data/', {});
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unsafe_url');
  assert.equal(called, false, '内网地址不应发起任何请求');
  globalThis.fetch = realFetch;
});

test('safePushFetch：解析到私有 IP 拒绝（DNS 重绑定），不发起请求', async () => {
  setDnsResolver(async () => [{ address: '10.0.0.5' }]);
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const r = await safePushFetch('https://my-webhook.example.com/hook', {});
  assert.equal(r.ok, false);
  assert.equal(r.error, 'dns_rebind');
  assert.equal(called, false, '疑似 DNS 重绑定不应发起请求');
  globalThis.fetch = realFetch;
  restoreResolver();
});

test('safePushFetch：公开地址 + 解析公开 IP 正常发送', async () => {
  setDnsResolver(async () => [{ address: '93.184.216.34' }]);
  let urlSeen;
  globalThis.fetch = async (url, init) => {
    urlSeen = url;
    return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('{}').buffer };
  };
  const r = await safePushFetch('https://my-webhook.example.com/hook', { method: 'POST', body: '{}' });
  assert.equal(r.ok, true);
  assert.equal(urlSeen, 'https://my-webhook.example.com/hook');
  globalThis.fetch = realFetch;
});

test('sendPush webhook：解析到私有 IP 被拒（dns_rebind）', async () => {
  setDnsResolver(async () => [{ address: '192.168.1.1' }]);
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
  const r = await sendPush({ channel: 'webhook', webhook: 'https://hook.example.com/x' }, { title: 't', message: 'm' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'dns_rebind');
  assert.equal(called, false);
  globalThis.fetch = realFetch;
  restoreResolver();
});

test('sendPush webhook：合法公网地址正常发送成功', async () => {
  setDnsResolver(async () => [{ address: '93.184.216.34' }]);
  globalThis.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('{}').buffer });
  const r = await sendPush({ channel: 'webhook', webhook: 'https://hook.example.com/x' }, { title: 't', message: 'm' });
  assert.equal(r.ok, true);
  globalThis.fetch = realFetch;
});

test('sendPush bark：自定义 base 解析到私有 IP 被拒（dns_rebind）', async () => {
  setDnsResolver(async () => [{ address: '10.0.0.9' }]);
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({ code: 200 }) }; };
  const r = await sendPush({ channel: 'bark', token: 'k', webhook: 'https://bark.example.com' }, { title: 't', message: 'm' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'dns_rebind');
  assert.equal(called, false);
  globalThis.fetch = realFetch;
  restoreResolver();
});

test('还原 DNS 解析器', () => {
  restoreResolver();
  assert.equal(getDnsResolver(), realResolver);
});

// ===================== M-03 修复：推送响应体大小限制 =====================

test('readJsonCapped：正常响应体解析为 JSON', async () => {
  const r = new Response(JSON.stringify({ ok: true }), { status: 200 });
  const j = await readJsonCapped(r);
  assert.deepEqual(j, { ok: true });
});

test('readJsonCapped：超大响应体（>2MB）抛错并拒绝', async () => {
  const huge = 'x'.repeat(2_000_001);
  const r = new Response(huge, { status: 200 });
  await assert.rejects(() => readJsonCapped(r), /响应体过大/);
});

test('readJsonCapped：无效 JSON 透传解析错误', async () => {
  const r = new Response('not json', { status: 200 });
  await assert.rejects(() => readJsonCapped(r));
});
