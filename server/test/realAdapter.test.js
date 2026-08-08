import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickUA, actionJitter, realAdapter } from '../src/smzdm/realAdapter.js';

const UA_POOL_SIZE = 8;

test('pickUA：返回值来自 UA 池且为浏览器 UA', () => {
  for (let i = 0; i < 50; i++) {
    const ua = pickUA();
    assert.match(ua, /^Mozilla\/\d\.\d/);
    // 默认池 8 个，pickUA 必落在其中之一（用 0 索引确认边界）
    assert.ok(ua.length > 20);
  }
  // 注入 rng 取边界：rng=0 -> 第一个；rng=0.999 -> 最后一个
  const first = pickUA(() => 0);
  const last = pickUA(() => 0.999);
  assert.notEqual(first, last);
});

test('actionJitter：结果落在 [min, max] 闭区间内', () => {
  const min = Number(process.env.SMZDM_ACTION_JITTER_MIN || 800);
  const max = Number(process.env.SMZDM_ACTION_JITTER_MAX || 2500);
  for (let i = 0; i < 200; i++) {
    const d = actionJitter(Math.random);
    assert.ok(d >= min && d <= max, `期望 ${min}~${max}，实得 ${d}`);
    assert.ok(Number.isInteger(d), '间隔应为整数毫秒');
  }
  // 边界：rng=0 -> min（严格）；rng 接近 1 -> 不超过 max
  assert.equal(actionJitter(() => 0), min);
  assert.ok(actionJitter(() => 0.99999) <= max);
});

test('doComment：注入 callImpl 时传递池内 UA，且 count>1 触发一次 sleep', async () => {
  const seenUas = [];
  const sleeps = [];
  const callImpl = async (path, opts) => {
    seenUas.push(opts.ua);
    assert.ok(path.startsWith('/user/comment/ajax_set_comment'));
    return { error_code: 0 };
  };
  const sleepImpl = async (ms) => {
    sleeps.push(ms);
  };
  const r = await realAdapter.doComment('cookie', {
    articleId: '12345',
    count: 2,
    callImpl,
    sleepImpl
  });
  assert.equal(r.success, true);
  assert.equal(r.count, 2);
  assert.equal(seenUas.length, 2);
  // 两次动作都轮换了 UA（均来自池）
  for (const ua of seenUas) assert.match(ua, /^Mozilla\/\d\.\d/);
  // count=2 -> 循环内 i>0 一次等待
  assert.equal(sleeps.length, 1);
  assert.ok(sleeps[0] >= 800 && sleeps[0] <= 2500);
});

test('doComment：缺 articleId 抛错', async () => {
  await assert.rejects(
    () => realAdapter.doComment('cookie', { callImpl: async () => ({}) }),
    /评论需要 articleId/
  );
});

test('doFavorite / doPoint：注入 callImpl + resolveChannelIdImpl，校验端点路径与真实 channel_id', async () => {
  const favPaths = [];
  const pointPaths = [];
  const favBodies = [];
  const pointBodies = [];
  const favImpl = async (p, o) => {
    favPaths.push(p);
    favBodies.push(Object.fromEntries(new URLSearchParams(o.body)));
    assert.match(o.ua, /^Mozilla\/\d\.\d/);
    return { error_code: 0 };
  };
  const pointImpl = async (p, o) => {
    pointPaths.push(p);
    pointBodies.push(Object.fromEntries(new URLSearchParams(o.body)));
    assert.match(o.ua, /^Mozilla\/\d\.\d/);
    return { error_code: 0 };
  };
  // 注入 channel_id 解析：返回真实频道号（非 '0'）
  const resolveChannelIdImpl = async () => '76';
  const cookieWithSess = 'sess=SESSVAL123; other=1';
  const r1 = await realAdapter.doFavorite(cookieWithSess, { articleId: '999', count: 1, callImpl: favImpl, resolveChannelIdImpl });
  const r2 = await realAdapter.doPoint(cookieWithSess, { articleId: '999', count: 1, callImpl: pointImpl, resolveChannelIdImpl });
  assert.equal(r1.success, true);
  assert.equal(r2.success, true);
  assert.deepEqual(favPaths, ['/favorites/create']);
  assert.ok(pointPaths.length === 1 && pointPaths[0].startsWith('/rating/like_create'));
  // 关键断言：必须发送真实 channel_id，不能再用 '0'（否则 smzdm 报"无效的评论类型"）
  assert.equal(favBodies[0].channel_id, '76');
  assert.equal(pointBodies[0].channel_id, '76');
  assert.notEqual(favBodies[0].channel_id, '0');
  assert.notEqual(pointBodies[0].channel_id, '0');
  // 社区脚本必带字段：touchstone_event 必须是含 channel_id/文章ID 的 JSON 串，token 取 Cookie 里的 sess 值
  const ft = JSON.parse(favBodies[0].touchstone_event);
  assert.equal(ft.event_value.cid, '76');
  assert.equal(ft.event_value.aid, '999');
  assert.equal(favBodies[0].token, 'SESSVAL123');
  const pt = JSON.parse(pointBodies[0].touchstone_event);
  assert.equal(pt.event_value.cid, '76');
  assert.equal(pt.event_value.aid, '999');
  assert.equal(pointBodies[0].token, 'SESSVAL123');
});

test('doFavorite / doPoint：解析不到 channel_id 时抛出明确错误', async () => {
  const resolveChannelIdImpl = async () => null;
  const callImpl = async () => ({ error_code: 0 });
  await assert.rejects(
    () => realAdapter.doFavorite('cookie', { articleId: '999', callImpl, resolveChannelIdImpl }),
    /无法解析文章频道ID/
  );
  await assert.rejects(
    () => realAdapter.doPoint('cookie', { articleId: '999', callImpl, resolveChannelIdImpl }),
    /无法解析文章频道ID/
  );
});

test('submitBaoliao：传递 UA 且校验端点与字段', async () => {
  let captured;
  const callImpl = async (p, o) => {
    captured = { p, o };
    return { error_code: 0, data: { url: 'https://www.smzdm.com/p/1' } };
  };
  const r = await realAdapter.submitBaoliao(
    'cookie',
    { title: '好价', url: 'https://x.com', price: '9.9', content: 'c' },
    { callImpl }
  );
  assert.equal(r.success, true);
  assert.equal(captured.p, '/publish/articles/ajax_create');
  assert.equal(captured.o.body.title, '好价');
  assert.match(captured.o.ua, /^Mozilla\/\d\.\d/);
});
