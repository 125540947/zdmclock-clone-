// realAdapter 真实网络分支测试（mock 全局 fetch，零依赖）
//
// 这些分支此前未覆盖：doClockIn / robotCheckIn / webCheckIn / getRobotToken /
// resolveChannelId / getUserInfo / submitBaoliao。它们最终都走全局 fetch，
// 通过在测试内替换 globalThis.fetch 并校验请求 URL/方法，可完全脱离真实 smzdm 网络覆盖。

import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

// M-09：realAdapter 真实网络分支经 dnsGuard.pinnedFetch 出口。测试用 mock.module 把 pinnedFetch
// 替换为受控实现，从而在不触网前提下覆盖 doClockIn / robotCheckIn / resolveChannelId 等分支。
const dnsGuardReal = await import('../src/dnsGuard.js?realcopy');
let fetchImpl = null;
mock.module('../src/dnsGuard.js', {
  namedExports: { ...dnsGuardReal, pinnedFetch: (url, init) => fetchImpl(url, init) }
});
const { realAdapter, resolveChannelId } = await import('../src/smzdm/realAdapter.js');

function installFetch(impl) {
  fetchImpl = impl;
}
function uninstallFetch() {
  fetchImpl = null;
}

// 构造 fetch 的 Response 替身
function jsonResp(obj, { ok = true, status = 200 } = {}) {
  // 同时提供 arrayBuffer 以兼容 realAdapter 改用 readBodyCapped 的流式读取（无 body 流时走 arrayBuffer 兜底）
  const buf = Buffer.from(JSON.stringify(obj));
  return { ok, status, text: async () => JSON.stringify(obj), arrayBuffer: async () => buf };
}
function rawResp(text, { ok = true, status = 200 } = {}) {
  // 同时提供 arrayBuffer 以兼容 realAdapter 改用 readBodyCapped 的流式读取（无 body 流时走 arrayBuffer 兜底）
  return { ok, status, text: async () => text, arrayBuffer: async () => Buffer.from(String(text)) };
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

test('resolveChannelId：article-api 与 www 都失败 → 返回 null（不再静默退化 1，避免假成功）', async () => {
  installFetch((url) => {
    const u = String(url);
    if (u.includes('/article_detail/')) return { ok: false, status: 500, text: async () => '', arrayBuffer: async () => Buffer.alloc(0) };
    if (u.includes('/p/')) return { ok: false, status: 500, text: async () => '', arrayBuffer: async () => Buffer.alloc(0) };
    throw new Error('非预期: ' + url);
  });
  const cid = await resolveChannelId('777777', 'sess=abc');
  assert.equal(cid, null);
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

// ---------- 防御分支：额外奖励接口失败 → 静默跳过，不阻断主签到 ----------
test('robotCheckIn：额外奖励接口失败 → 主签到仍成功', async () => {
  installFetch(
    routerFetch(
      ['/robot/token', () => jsonResp({ error_code: 0, data: { token: 'T' } })],
      ['/checkin/all_reward', () => ({ ok: false, status: 500, text: async () => '', arrayBuffer: async () => Buffer.alloc(0) })], // 触发 robotCheckinExtras 内部 catch（须放在 /checkin 之前，避免子串误匹配）
      ['/checkin', () => jsonResp({ error_code: 0, data: { cgold: 2, daily_num: 1 } })]
    )
  );
  const r = await realAdapter.doClockIn('sess=abc');
  assert.equal(r.success, true, '额外奖励失败不应阻断签到');
  assert.ok(!r.message.includes('额外'), '额外奖励失败时不拼接额外信息');
});

test('webCheckIn：额外奖励接口全失败 → 主签到仍成功', async () => {
  installFetch(
    routerFetch(
      ['/user/checkin/jsonp_checkin', () => rawResp(jsonp({ error_code: 0, data: { cgold: 1 } }))],
      ['/checkin/all_reward', () => ({ ok: false, status: 500, text: async () => '', arrayBuffer: async () => Buffer.alloc(0) })],
      ['/checkin/extra_reward', () => ({ ok: false, status: 500, text: async () => '', arrayBuffer: async () => Buffer.alloc(0) })]
    )
  );
  const r = await realAdapter.webCheckIn('sess=abc');
  assert.equal(r.success, true, '额外奖励失败不应阻断网页签到');
  assert.ok(!r.message.includes('额外'), '额外奖励失败时不拼接额外信息');
});

// ---------- 防御分支：fetchBaoliao 网络异常兜底（非反爬挑战页 202/40x/5xx） ----------
test('fetchBaoliao：fetch 抛网络异常 → 抛「网络错误」文案', async () => {
  installFetch(() => { throw new Error('socket hang up'); });
  await assert.rejects(() => realAdapter.fetchBaoliao({ cookie: 'ck' }), /抓取好价网络错误/);
});

// ---------- 防御分支：channelIdCache LRU 淘汰最旧条目（CHANNEL_CACHE_MAX=1000） ----------
test('resolveChannelId：缓存达上限后淘汰最旧条目', async () => {
  let calls = 0;
  installFetch((url) => {
    const m = String(url).match(/\/article_detail\/(\d+)/);
    if (m) { calls++; return jsonResp({ error_code: 0, data: { data: { article_channel_id: m[1] } } }); }
    throw new Error('非预期: ' + url);
  });
  // 填满 0..1000（共 1001 条）；插入第 1000 条时 size 达上限，淘汰最旧的 '0'
  for (let i = 0; i <= 1000; i++) {
    const cid = await resolveChannelId(String(i), 'sess');
    assert.equal(cid, String(i));
  }
  const afterFill = calls;
  // '0' 已被淘汰 → 再次请求会重新拉取（+1）
  const c0 = await resolveChannelId('0', 'sess');
  assert.equal(c0, '0');
  // '1000' 是最近写入 → 命中缓存（不再请求）
  const c1000 = await resolveChannelId('1000', 'sess');
  assert.equal(c1000, '1000');
  assert.equal(calls, afterFill + 1, '仅被淘汰的 id 0 重新请求一次');
});

// ---------- doCheckinExtras（网页端点额外奖励，best-effort） ----------
test('doCheckinExtras：成功端点计入奖励，失败端点静默跳过', async () => {
  installFetch(
    routerFetch(
      ['/checkin/all_reward', () => rawResp(jsonp({ error_code: 0, data: { reward_msg: '获得<strong>5</strong>金币' } }))],
      ['/checkin/extra_reward', () => ({ ok: false, status: 500, text: async () => '', arrayBuffer: async () => Buffer.alloc(0) })]
    )
  );
  const r = await realAdapter.doCheckinExtras('sess=abc');
  assert.deepEqual(r.rewards, ['获得 5 金币']);
});

// ---------- webCheckIn：error_code!=0 但提示已签到 → 软成功（435-436） ----------
test('webCheckIn：error_code!=0 但提示已签到 → 软成功', async () => {
  installFetch(routerFetch(
    ['/user/checkin/jsonp_checkin', () => rawResp(jsonp({ error_code: 1, error_msg: '今日已签过' }))]
  ));
  const r = await realAdapter.webCheckIn('sess=abc');
  assert.equal(r.success, true);
  assert.match(r.message, /已签到|重复/);
});
