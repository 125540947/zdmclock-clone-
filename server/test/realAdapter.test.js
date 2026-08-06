// P2：real 适配器离线测试（mock 全局 fetch，验证解析/签名/错误码/超时/b5 超大响应）
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 全局将请求超时压到 1ms，便于超时分支测试（仅当 fetch 真正挂起时触发）
process.env.SMZDM_REQUEST_TIMEOUT = '1';
const { realAdapter } = await import('../src/smzdm/realAdapter.js');
const realFetch = globalThis.fetch;

// 通用 mock：返回带 .ok/.status/.text()/.json() 的响应
// call() 统一读取 resp.text() 再解析 JSON（兼容 )]}' 前缀），因此 mock 必须提供 text；
// 这里若只传 json 则自动序列化为 text，便于测试只关心返回数据时使用。
function mockFetch(opts) {
  const body = opts.text !== undefined ? opts.text : JSON.stringify(opts.json);
  globalThis.fetch = async () => ({
    ok: opts.ok !== false,
    status: opts.status || 200,
    text: async () => body,
    json: async () => opts.json
  });
}

test('getUserInfo 映射 userId/nickName/point/rank/is_vip', async () => {
  mockFetch({ json: { data: { userId: '123', nickName: 'Bob', point: 50, rank: 'Lv.3', is_vip: true, avatar: 'a' } } });
  const info = await realAdapter.getUserInfo('cookie');
  assert.equal(info.smzdmId, '123');
  assert.equal(info.nickname, 'Bob');
  assert.equal(info.points, 50);
  assert.equal(info.level, 'Lv.3');
  assert.equal(info.vip, true);
  globalThis.fetch = realFetch;
});

test('call 兼容 smzdm 前缀垃圾字符的 JSON 响应', async () => {
  mockFetch({ text: ")]}'," + JSON.stringify({ data: { userId: '9' } }) });
  const info = await realAdapter.getUserInfo('cookie');
  assert.equal(info.smzdmId, '9');
  globalThis.fetch = realFetch;
});

test('doComment 成功返回 message 含次数与 articleId', async () => {
  mockFetch({ json: { error_code: 0 } });
  const r = await realAdapter.doComment('cookie', { articleId: '123', count: 2 });
  assert.equal(r.success, true);
  assert.match(r.message, /评论成功 ×2/);
  assert.equal(r.articleId, '123');
  globalThis.fetch = realFetch;
});

test('doComment 缺失 articleId 直接抛错（不发请求）', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  await assert.rejects(() => realAdapter.doComment('cookie', {}), /articleId/);
  assert.equal(called, false);
  globalThis.fetch = realFetch;
});

test('doComment 业务错误码触发 assertOk 抛错', async () => {
  mockFetch({ json: { error_code: 1, error_msg: '频率限制' } });
  await assert.rejects(() => realAdapter.doComment('cookie', { articleId: '1' }), /评论失败：频率限制/);
  globalThis.fetch = realFetch;
});

test('fetchBaoliao 从 HTML 抽取文章卡片', async () => {
  const html = `
    <a href="/p/111" class="title">好价一</a>
    <a href="/p/222" class="title">好价二</a>
    <a href="/p/111" class="title">重复</a>`;
  mockFetch({ text: html });
  const r = await realAdapter.fetchBaoliao({ limit: 10 });
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 2); // 去重后 2 条
  assert.equal(r.items[0].smzdmUrl, 'https://www.smzdm.com/p/111');
  assert.equal(r.items[1].smzdmUrl, 'https://www.smzdm.com/p/222');
  globalThis.fetch = realFetch;
});

test('fetchBaoliao 页面无卡片时抛错（不静默成功）', async () => {
  mockFetch({ text: '<html><body>无内容</body></html>' });
  await assert.rejects(() => realAdapter.fetchBaoliao({}), /未能从页面解析到好价文章/);
  globalThis.fetch = realFetch;
});

test('fetchBaoliao 超大响应触发 b5 拒绝', async () => {
  mockFetch({ text: 'x'.repeat(6_000_000) });
  await assert.rejects(() => realAdapter.fetchBaoliao({}), /响应过大|过大/);
  globalThis.fetch = realFetch;
});

test('fetchBaoliao 请求挂起触发超时抛错', async () => {
  // 模拟底层 fetch 因 AbortSignal 超时直接以 AbortError 拒绝（与 AbortSignal.timeout 触发等价），
  // 验证 fetchBaoliao 的 catch 将其翻译为「超时」错误，而非静默挂起或误报其他错误。
  globalThis.fetch = async (url, init) => {
    if (init?.signal) {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    }
    return { ok: true, text: async () => '' };
  };
  await assert.rejects(() => realAdapter.fetchBaoliao({}), /超时/);
  globalThis.fetch = realFetch;
});

test('还原全局 fetch', () => {
  globalThis.fetch = realFetch;
  assert.ok(true);
});
