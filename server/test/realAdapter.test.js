// realAdapter 单元测试（零依赖，脱离真实网络）
//
// 覆盖策略：
//  1. 纯函数（确定性、可注入 rng）—— pickUA / actionJitter / signFormData / extractSess
//  2. call() 统一出口 —— SSRF 纵深防御、JSON / )]}' 前缀解析、超大响应拒绝、HTTP 非 2xx、超时、raw 模式
//  3. 互动方法（评论/收藏/点赞/爆料）—— 通过注入 callImpl / sleepImpl / resolveChannelIdImpl 完全脱离网络
//  4. fetchBaoliao —— 通过 mock globalThis.fetch 覆盖挑战页/验证页/正常解析三分支
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  realAdapter,
  signFormData,
  pickUA,
  actionJitter,
  extractSess,
  resolveChannelId
} from '../src/smzdm/realAdapter.js';

// ---- call() 依赖全局 fetch，统一 mock ----
let savedFetch = null;
before(() => {
  savedFetch = globalThis.fetch;
});
after(() => {
  globalThis.fetch = savedFetch;
});

function mockFetch(impl) {
  globalThis.fetch = impl;
}
function fakeResp({ ok = true, status = 200, body = '' } = {}) {
  return {
    ok,
    status,
    text: async () => body
  };
}

// ===================== 纯函数 =====================

test('pickUA：rng=0 取首个 UA，rng=0.999 取末个 UA', () => {
  const first = pickUA(() => 0);
  const last = pickUA(() => 0.999);
  assert.ok(first.startsWith('Mozilla/5.0'));
  assert.ok(last.startsWith('Mozilla/5.0'));
  assert.notEqual(first, last, '不同 rng 应取不同 UA');
  assert.ok(first.length > 10 && last.length > 10);
});

test('actionJitter：rng=0 → 下限，rng=0.999 落在 [下限, 上限] 区间内', () => {
  const lo = actionJitter(() => 0);
  const hi = actionJitter(() => 0.999);
  assert.equal(lo, 800);
  assert.ok(hi >= 800 && hi <= 2500, `hi=${hi} 应在 [800, 2500] 内`);
});

test('signFormData：注入公共参数 + 空值过滤（不影响签名）+ 含 32 位大写 MD5 sign', () => {
  const r = signFormData({ a: 1, b: '' });
  assert.equal(r.weixin, 1);
  assert.equal(r.basic_v, 0);
  assert.equal(r.f, 'android');
  assert.ok(typeof r.v === 'string' && r.v.length > 0);
  assert.ok(typeof r.time === 'string' && /^\d+$/.test(r.time));
  assert.equal(r.a, 1, '非空字段保留');
  assert.match(r.sign, /^[0-9A-F]{32}$/, 'sign 应为 32 位大写十六进制 MD5');
  // 空值过滤：含空串的签名应与不含该空串一致（空字段不进入签名计算）
  const s2 = signFormData({ a: 1 }).sign;
  assert.equal(r.sign, s2, '空值字段不应进入签名计算');
});

test('signFormData：相同内容不同 key 顺序 → 相同 sign（排序无关性）', () => {
  const s1 = signFormData({ z: 1, a: 2 }).sign;
  const s2 = signFormData({ a: 2, z: 1 }).sign;
  assert.equal(s1, s2, '签名应与入参 key 顺序无关');
});

test('extractSess：从 Cookie 提取 sess；无 sess 返回空串', () => {
  assert.equal(extractSess('sess=abc123; foo=bar'), 'abc123');
  assert.equal(extractSess('foo=bar; baz=qux'), '');
  assert.equal(extractSess(''), '');
});

// ===================== call() 统一出口 =====================

test('call：SSRF 纵深防御 —— 拒绝云元数据地址且不发起请求', async () => {
  let called = false;
  mockFetch(async () => {
    called = true;
    return fakeResp();
  });
  await assert.rejects(
    () => realAdapter.requestRaw('http://169.254.169.254/latest/meta-data/', {}),
    /拒绝请求非公网地址/
  );
  assert.equal(called, false, '内网地址不应发起任何请求');
});

test('call：SSRF 拒绝 localhost / 127.0.0.1', async () => {
  for (const u of ['http://localhost/x', 'http://127.0.0.1/y', 'http://[::1]/z']) {
    await assert.rejects(() => realAdapter.requestRaw(u, {}), /拒绝请求非公网地址/);
  }
});

test('call：合法公网地址正常解析 JSON', async () => {
  mockFetch(async () => fakeResp({ body: '{"error_code":0,"data":{"a":1}}' }));
  const json = await realAdapter.requestRaw('https://example.com/api', {});
  assert.equal(json.error_code, 0);
  assert.equal(json.data.a, 1);
});

test('call：兼容 Angular )]}\' 安全前缀', async () => {
  mockFetch(async () => fakeResp({ body: ')]}\'\n{"ok":true,"x":42}' }));
  const json = await realAdapter.requestRaw('https://example.com/p', {});
  assert.equal(json.x, 42);
});

test('call：响应体过大（>2MB）被拒绝', async () => {
  mockFetch(async () => fakeResp({ body: 'x'.repeat(2_000_001) }));
  await assert.rejects(() => realAdapter.requestRaw('https://example.com/big', {}), /响应体过大/);
});

test('call：HTTP 非 2xx 抛出状态错误', async () => {
  mockFetch(async () => fakeResp({ ok: false, status: 404, body: 'nf' }));
  await assert.rejects(() => realAdapter.requestRaw('https://example.com/missing', {}), /HTTP 404/);
});

test('call：超时（TimeoutError）转友好错误', async () => {
  mockFetch(async () => {
    throw Object.assign(new Error('boom'), { name: 'TimeoutError' });
  });
  await assert.rejects(() => realAdapter.requestRaw('https://example.com/slow', {}), /请求超时/);
});

test('call：raw 模式返回原始文本', async () => {
  mockFetch(async () => fakeResp({ body: 'callback({"raw":1})' }));
  const text = await realAdapter.requestRaw('https://example.com/jp', { raw: true });
  assert.equal(text, 'callback({"raw":1})');
});

// ===================== 互动方法（注入 callImpl） =====================

test('doComment：缺 articleId 抛错', async () => {
  await assert.rejects(() => realAdapter.doComment('ck', {}), /评论需要 articleId/);
});

test('doComment：成功（JSONP 文本经 parseJsonp 解析）', async () => {
  const callImpl = async () => '{"error_code":0,"data":{"msg":"评论成功"}}';
  const r = await realAdapter.doComment('ck', { articleId: '123', callImpl, sleepImpl: async () => {} });
  assert.equal(r.success, true);
  assert.match(r.message, /评论成功 ×1/);
  assert.equal(r.articleId, '123');
});

test('doComment：count=3 循环 3 次且 message 体现次数', async () => {
  let n = 0;
  const callImpl = async () => {
    n++;
    return '{"error_code":0}';
  };
  const r = await realAdapter.doComment('ck', { articleId: '123', count: 3, callImpl, sleepImpl: async () => {} });
  assert.equal(n, 3);
  assert.match(r.message, /×3/);
});

test('doComment：已评论软成功不抛错', async () => {
  const callImpl = async () => '{"error_msg":"请勿重复提交"}';
  const r = await realAdapter.doComment('ck', { articleId: '123', callImpl, sleepImpl: async () => {} });
  assert.equal(r.success, true);
});

test('doFavorite：需 articleId 且走 resolveChannelId + 签名 body', async () => {
  let gotBody = null;
  const callImpl = async (path, opts) => {
    gotBody = opts.body;
    return { error_code: 0 };
  };
  const r = await realAdapter.doFavorite('sess=abc', {
    articleId: '555',
    callImpl,
    sleepImpl: async () => {},
    resolveChannelIdImpl: async () => '7'
  });
  assert.equal(r.success, true);
  assert.equal(gotBody.channel_id, '7');
  assert.ok(gotBody.sign, '收藏请求应带签名');
  assert.equal(gotBody.token, 'abc');
});

test('doFavorite：已收藏软成功', async () => {
  const callImpl = async () => ({ error_msg: '已经收藏' });
  const r = await realAdapter.doFavorite('sess=x', {
    articleId: '555',
    callImpl,
    sleepImpl: async () => {},
    resolveChannelIdImpl: async () => '1'
  });
  assert.equal(r.success, true);
});

test('doPoint：点赞成功（data.msg 提示，error_code=0 即成功）', async () => {
  let gotBody = null;
  const callImpl = async (path, opts) => {
    gotBody = opts.body;
    return { error_code: 0, data: { msg: '点赞成功' } };
  };
  const r = await realAdapter.doPoint('sess=y', {
    articleId: '777',
    callImpl,
    sleepImpl: async () => {},
    resolveChannelIdImpl: async () => '3'
  });
  assert.equal(r.success, true);
  assert.equal(gotBody.channel_id, '3');
  assert.ok(gotBody.sign);
});

test('resolveChannelId：preferredChannelId 直接复用，不发起网络请求', async () => {
  // 不注入 fetch；preferred 命中即短路返回，绝不走到 article-api/www 解析
  const cid = await resolveChannelId('999', 'sess=x', '42');
  assert.equal(cid, '42');
});

test('doFavorite：传入 channelId 透传给真实 resolveChannelId 并短路复用', async () => {
  let gotBody = null;
  const callImpl = async (path, opts) => {
    gotBody = opts.body;
    return { error_code: 0 };
  };
  // 不注入 resolveChannelIdImpl → 走真实 resolveChannelId，preferredChannelId 命中即短路，不发起网络解析
  const r = await realAdapter.doFavorite('sess=abc', {
    articleId: '555',
    channelId: '42',
    callImpl,
    sleepImpl: async () => {}
  });
  assert.equal(r.success, true);
  assert.equal(gotBody.channel_id, '42', '应直接使用传入的 channelId，不重新解析');
});

test('submitBaoliao：成功返回链接', async () => {
  const callImpl = async () => ({ error_code: 0, data: { url: 'https://www.smzdm.com/p/888' } });
  const r = await realAdapter.submitBaoliao('ck', { title: '好价', url: 'https://x.com' }, { callImpl });
  assert.equal(r.success, true);
  assert.equal(r.url, 'https://www.smzdm.com/p/888');
});

// ===================== fetchBaoliao（mock 真实 fetch） =====================

test('fetchBaoliao：反爬挑战页（HTTP 202）转友好错误', async () => {
  mockFetch(async () => fakeResp({ ok: false, status: 202, body: 'challenge' }));
  await assert.rejects(
    () => realAdapter.fetchBaoliao({ cookie: 'ck', limit: 20 }),
    /改用浏览器导入/
  );
});

test('fetchBaoliao：验证页（短/含"验证"）转友好错误', async () => {
  mockFetch(async () => fakeResp({ ok: true, body: '<html><title>验证</title></html>' }));
  await assert.rejects(() => realAdapter.fetchBaoliao({ cookie: 'ck' }), /改用浏览器导入/);
});

test('fetchBaoliao：正常页面解析出文章卡片', async () => {
  const padding = 'x'.repeat(700); // 满足 >600 字节反爬门槛（真实页面远大于此）
  const html =
    padding +
    '<a href="/p/111">标题A</a>' +
    '<a href="/p/222">标题B</a>' +
    '<a href="/p/111">重复</a>';
  mockFetch(async () => fakeResp({ ok: true, body: html }));
  const r = await realAdapter.fetchBaoliao({ cookie: 'ck', limit: 20 });
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 2, '去重后应为 2 条');
  assert.equal(r.items[0].smzdmUrl, 'https://www.smzdm.com/p/111');
  assert.equal(r.items[0].title, '标题A');
});

test('fetchBaoliao：解析到 0 条抛错（页面结构变更）', async () => {
  const padding = 'x'.repeat(700); // >600 字节且不含验证词，确保走"解析 0 条"分支而非反爬判定
  mockFetch(async () => fakeResp({ ok: true, body: padding + '<div>no links here</div>' }));
  await assert.rejects(() => realAdapter.fetchBaoliao({ cookie: 'ck' }), /未能从页面解析到好价文章/);
});
