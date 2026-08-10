// realAdapter 真实网络分支测试（mock 全局 fetch，零依赖）
//
// 这些分支此前未覆盖：doClockIn / robotCheckIn / webCheckIn / getRobotToken /
// resolveChannelId / getUserInfo / submitBaoliao。它们最终都走全局 fetch，
// 通过在测试内替换 globalThis.fetch 并校验请求 URL/方法，可完全脱离真实 smzdm 网络覆盖。

import assert from 'node:assert/strict';
import test from 'node:test';
import { realAdapter, resolveChannelId } from '../src/smzdm/realAdapter.js';

const realFetch = globalThis.fetch;
let fetchImpl = null;

function installFetch(impl) {
  fetchImpl = impl;
  globalThis.fetch = (url, init) => impl(url, init);
}
function uninstallFetch() {
  globalThis.fetch = realFetch;
  fetchImpl = null;
}

// 构造 fetch 的 Response 替身
function jsonResp(obj, { ok = true, status = 200 } = {}) {
  return { ok, status, text: async () => JSON.stringify(obj) };
}
function rawResp(text, { ok = true, status = 200 } = {}) {
  return { ok, status, text: async () => text };
}
// JSONP 外壳（与 parseJsonp 兼容）
function jsonp(obj) {
  return 'jsonp_' + Date.now() + '(' + JSON.stringify(obj) + ');';
}

// 基于 URL 子串路由的响应式 fetch：routers 为 [子串, 处理函数] 列表，末项可为默认
function routerFetch(...routes) {
  return (url) => {
    for (const [sub, fn] of routes) {
      if (sub === '*' || String(url).includes(sub)) return fn(url);
    }
    throw new Error('未预期的 fetch 请求: ' + url);
  };
}

test('teardown 恢复全局 fetch', () => {
  // sanity：保证 afterEach 能恢复
  assert.equal(typeof globalThis.fetch, 'function');
});

test.afterEach(() => uninstallFetch());

// ---------- getRobotToken ----------
test('getRobotToken：error_code=0 → 返回 token', async () => {
  installFetch(routerFetch(['/robot/token', () => jsonResp({ error_code: 0, data: { token: 'TKN123' } })]));
  const t = await realAdapter.getRobotToken('sess=abc');
  assert.equal(t, 'TKN123');
});

test('getRobotToken：error_code!=0 → 抛错', async () => {
  installFetch(routerFetch(['/robot/token', () => jsonResp({ error_code: 1, error_msg: '签名错误' })]));
  await assert.rejects(() => realAdapter.getRobotToken('sess=abc'), /获取 token 失败/);
});

// ---------- robotCheckIn ----------
test('robotCheckIn：成功 → success + 余额 + 额外奖励', async () => {
  installFetch(
    routerFetch(
      ['/robot/token', () => jsonResp({ error_code: 0, data: { token: 'T' } })],
      ['/checkin', () => jsonResp({ error_code: 0, data: { cgold: 2, pre_re_silver: 45, cexperience: 5, rank: 'LV6', daily_num: 181 } })],
      ['/checkin/all_reward', () => jsonResp({ error_code: 0, data: { reward_msg: '获得<strong>5</strong>金币' } })]
    )
  );
  const r = await realAdapter.doClockIn('sess=abc');
  assert.equal(r.success, true);
  assert.equal(r.balances.gold, 2);
  assert.equal(r.balances.silver, 45);
  assert.equal(r.continuity, 181);
  assert.match(r.message, /额外/);
});

test('robotCheckIn：今日已签到 → 软成功', async () => {
  installFetch(
    routerFetch(
      ['/robot/token', () => jsonResp({ error_code: 0, data: { token: 'T' } })],
      ['/checkin', () => jsonResp({ error_code: 1, error_msg: '今天已经签到' })]
    )
  );
  const r = await realAdapter.doClockIn('sess=abc');
  assert.equal(r.success, true);
  assert.match(r.message, /已签到|重复/);
});

test('robotCheckIn：真失败 → 抛错', async () => {
  installFetch(
    routerFetch(
      ['/robot/token', () => jsonResp({ error_code: 0, data: { token: 'T' } })],
      ['/checkin', () => jsonResp({ error_code: 999, error_msg: '系统繁忙' })]
    )
  );
  await assert.rejects(() => realAdapter.doClockIn('sess=abc'), /签到失败/);
});

// ---------- webCheckIn（兜底） ----------
test('webCheckIn：JSONP 成功 → success', async () => {
  installFetch(
    routerFetch(
      ['/user/checkin/jsonp_checkin', () => rawResp(jsonp({ error_code: 0, data: { cgold: 1, add_point: 3 } }))],
      ['/checkin/all_reward', () => rawResp(jsonp({ error_code: 0, data: { reward_msg: 'ok' } }))],
      ['/checkin/extra_reward', () => rawResp(jsonp({ error_code: 0, data: { reward_msg: 'ok' } }))]
    )
  );
  const r = await realAdapter.webCheckIn('sess=abc');
  assert.equal(r.success, true);
  assert.equal(r.balances.gold, 1);
  assert.equal(r.points, 3);
});

test('webCheckIn：已签到 → 软成功', async () => {
  installFetch(routerFetch(['/user/checkin/jsonp_checkin', () => rawResp(jsonp({ error_code: 0, error_msg: '今日已签过' }))]));
  const r = await realAdapter.webCheckIn('sess=abc');
  assert.equal(r.success, true);
});

test('webCheckIn：失败 → 抛错', async () => {
  installFetch(routerFetch(['/user/checkin/jsonp_checkin', () => rawResp(jsonp({ error_code: 110202, error_msg: '验证码' }))]));
  await assert.rejects(() => realAdapter.webCheckIn('sess=abc'), /签到失败/);
});

// ---------- doClockIn 路由：robot 优先，失败才 web 兜底 ----------
test('doClockIn：robot 主路径成功（不触 web）', async () => {
  let webCalled = false;
  installFetch((url) => {
    if (String(url).includes('jsonp_checkin')) { webCalled = true; }
    return routerFetch(
      ['/robot/token', () => jsonResp({ error_code: 0, data: { token: 'T' } })],
      ['/checkin', () => jsonResp({ error_code: 0, data: { cgold: 2 } })]
    )(url);
  });
  const r = await realAdapter.doClockIn('sess=abc');
  assert.equal(r.success, true);
  assert.equal(webCalled, false, 'robot 成功不应触发 web 兜底');
});

test('doClockIn：robot 失败 → web 兜底成功', async () => {
  installFetch(
    routerFetch(
      ['/robot/token', () => jsonResp({ error_code: 1, error_msg: 'token 失效' })],
      ['/user/checkin/jsonp_checkin', () => rawResp(jsonp({ error_code: 0, data: { cgold: 1 } }))],
      ['/checkin/all_reward', () => rawResp(jsonp({ error_code: 0, data: {} }))],
      ['/checkin/extra_reward', () => rawResp(jsonp({ error_code: 0, data: {} }))]
    )
  );
  const r = await realAdapter.doClockIn('sess=abc');
  assert.equal(r.success, true);
});

test('doClockIn：robot 与 web 都失败 → 抛 robot 原始错误', async () => {
  installFetch(
    routerFetch(
      ['/robot/token', () => jsonResp({ error_code: 1, error_msg: 'robot 根因' })],
      ['/user/checkin/jsonp_checkin', () => rawResp(jsonp({ error_code: 999, error_msg: 'web 失败' }))]
    )
  );
  await assert.rejects(() => realAdapter.doClockIn('sess=abc'), /robot 根因/);
});

// ---------- resolveChannelId ----------
test('resolveChannelId：article-api 返回 article_channel_id → 解析并缓存', async () => {
  let calls = 0;
  installFetch((url) => {
    if (String(url).includes('/article_detail/')) { calls++; return jsonResp({ error_code: 0, data: { data: { article_channel_id: 42 } } }); }
    throw new Error('非预期: ' + url);
  });
  const cid = await resolveChannelId('123456', 'sess=abc');
  assert.equal(cid, '42');
  // 第二次命中缓存，不再发请求
  const cid2 = await resolveChannelId('123456', 'sess=abc');
  assert.equal(cid2, '42');
  assert.equal(calls, 1, '应仅请求一次（缓存命中）');
});

test('resolveChannelId：article-api 失败 → www 正则兜底', async () => {
  installFetch((url) => {
    const u = String(url);
    if (u.includes('/article_detail/')) return jsonResp({ error_code: 104, error_msg: '文章不存在' });
    if (u.includes('/p/')) return rawResp('<html><meta channel_id: 88>');
    throw new Error('非预期: ' + url);
  });
  const cid = await resolveChannelId('999888', 'sess=abc');
  assert.equal(cid, '88');
});

test('resolveChannelId：article-api 与 www 都失败 → 退化为 1', async () => {
  installFetch((url) => {
    const u = String(url);
    if (u.includes('/article_detail/')) return { ok: false, status: 500, text: async () => '' };
    if (u.includes('/p/')) return { ok: false, status: 500, text: async () => '' };
    throw new Error('非预期: ' + url);
  });
  const cid = await resolveChannelId('777777', 'sess=abc');
  assert.equal(cid, '1');
});

// ---------- getUserInfo ----------
test('getUserInfo：解析字段', async () => {
  installFetch(routerFetch(['/user/', () => jsonResp({ error_code: 0, data: { userId: '466320', nickName: '小王', point: 120, rank: 'LV8', is_vip: true, avatar: 'http://a.png' } })]));
  const u = await realAdapter.getUserInfo('sess=abc');
  assert.equal(u.smzdmId, '466320');
  assert.equal(u.nickname, '小王');
  assert.equal(u.points, 120);
  assert.equal(u.level, 'LV8');
  assert.equal(u.vip, true);
});

// ---------- submitBaoliao ----------
test('submitBaoliao：成功 → 返回文章 url', async () => {
  installFetch(routerFetch(['/publish/articles/ajax_create', () => jsonResp({ error_code: 0, data: { url: 'https://www.smzdm.com/p/555', article_url: 'https://www.smzdm.com/p/555' } })]));
  const r = await realAdapter.submitBaoliao('sess=abc', { title: '好价', url: 'https://x.com' });
  assert.equal(r.success, true);
  assert.match(r.url, /smzdm\.com\/p\/555/);
});

test('submitBaoliao：失败 → 抛错', async () => {
  installFetch(routerFetch(['/publish/articles/ajax_create', () => jsonResp({ error_code: 1, error_msg: '标题违规' })]));
  await assert.rejects(() => realAdapter.submitBaoliao('sess=abc', { title: 'x' }), /爆料失败/);
});
