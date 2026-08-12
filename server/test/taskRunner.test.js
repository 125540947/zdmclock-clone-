// P0/P2：任务执行核心测试（collectArticleIds / resolveUsers 纯函数，runEngagement 无文章、
// runGptBatch 多分支、runFetch 去重、runTask 多账号聚合）。默认 mock 适配器，无真实网络。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-task-' + process.pid + '-' + Date.now());
process.env.GPT_API_KEY = 'test-key'; // 使 config.gptEnabled=true，runGptBatch 真实路径可达
process.env.CLOCK_STAGGER_MS = '0'; // 测试关闭错峰，保证批量用例快速且确定
process.env.CLOCK_STAGGER_JITTER_MS = '0';
const { runTask, collectArticleIds, resolveUsers, runClockForUser, sampleArticleIds, computeSampleSize } = await import('../src/taskRunner.js');
const { load } = await import('../src/store.js');
const { config } = await import('../src/config.js');
const { smzdm } = await import('../src/smzdm/adapter.js');
const { resolvedCheckInTime } = await import('../src/clockSchedule.js');

// 本文件不涉及风控断言：关闭"人类化随机等待"以保持用例快速且确定性
config.riskEnabled = false;

const realFetch = globalThis.fetch;
function mockFetchOnce(body) {
  globalThis.fetch = async () => ({ ok: true, json: async () => body });
}

test('collectArticleIds baoliao 来源提取并去重，携带条目 channelId', () => {
  const db = { baoliao: [
    { smzdmUrl: 'https://x/p/111', channelId: '10' },
    { url: 'https://x/p/222' },
    { smzdmUrl: 'https://x/p/111', channelId: '10' }
  ] };
  assert.deepEqual(collectArticleIds({ type: 'comment' }, db, 'baoliao', ''), [
    { id: '111', channelId: '10' },
    { id: '222', channelId: '' }
  ]);
});

test('collectArticleIds manual 来源：overrideId 优先于 task.articleId，透传 task.channelId', () => {
  assert.deepEqual(collectArticleIds({ articleId: '888', channelId: '7' }, {}, 'manual', '999'), [{ id: '999', channelId: '' }]);
  assert.deepEqual(collectArticleIds({ articleId: '888', channelId: '7' }, {}, 'manual', ''), [{ id: '888', channelId: '7' }]);
  assert.deepEqual(collectArticleIds({ articleId: '' }, {}, 'manual', ''), []);
});

test('resolveUsers 指定 userId / 全部 / 未找到', () => {
  const db = { users: [{ id: 'u1' }, { id: 'u2' }] };
  assert.deepEqual(resolveUsers(db, { userId: 'u2' }).map((u) => u.id), ['u2']);
  assert.deepEqual(resolveUsers(db, {}).map((u) => u.id), ['u1', 'u2']);
  assert.deepEqual(resolveUsers(db, { userId: 'nope' }), []);
});

test('runEngagement 无目标文章时返回 no_article（manual）', async () => {
  const db = { users: [{ id: 'u1', cookie: 'c' }], baoliao: [] };
  const r = await runTask({ type: 'comment', articleSource: 'manual', articleId: '', name: '评论' }, db, {});
  // 注意：comment/favorite/point 经 runTask 聚合后不向外暴露 error 字段，
  // 由 r.ok=false 与 r.message 体现失败原因。
  assert.equal(r.ok, false);
  assert.match(r.message, /no_article|目标文章/);
});

test('runGptBatch gpt_disabled 时直接失败', async () => {
  const db = { users: [], baoliao: [], settings: { gpt: { enabled: false, tone: 'friendly', prompt: '' } }, gptDrafts: [] };
  const r = await runTask({ type: 'gpt', limit: 3, name: 'GPT' }, db, {});
  assert.equal(r.ok, false);
  assert.equal(r.error, 'gpt_disabled');
});

test('runGptBatch 好价为空时返回 no_source', async () => {
  const db = { users: [], baoliao: [], settings: { gpt: { enabled: true, tone: 'friendly', prompt: '' } }, gptDrafts: [] };
  const r = await runTask({ type: 'gpt', limit: 3, name: 'GPT' }, db, {});
  assert.equal(r.ok, false);
  assert.equal(r.error, 'no_source');
});

test('runGptBatch 成功生成 + 自动发布 + 草稿上限 200 截断', async () => {
  const db = {
    users: [{ id: 'u1', cookie: 'c' }],
    baoliao: [{ id: 'b1', smzdmUrl: 'https://x/p/1', title: 't', content: 'c' }],
    settings: { gpt: { enabled: true, tone: 'friendly', prompt: '' } },
    gptDrafts: Array.from({ length: 250 }, (_, i) => ({ id: 'd' + i, content: 'x' })) // 预置超限
  };
  mockFetchOnce({ choices: [{ message: { content: '生成的评论' } }] });
  const r = await runTask({ type: 'gpt', limit: 3, autoPost: true, name: 'GPT' }, db, {});
  assert.equal(r.ok, true);
  assert.ok(r.result.count >= 1);
  assert.equal(db.gptDrafts.length, 200); // 超出截断（R5）
  assert.ok(db.gptDrafts.some((d) => d.status === 'posted'));
  globalThis.fetch = realFetch;
});

test('runFetch 经 mergeBaoliao 去重合并（mock 返回 3 条）', async () => {
  // runFetch 内部 mergeBaoliao 使用模块级 cache，需先 load() 初始化
  const db = load();
  db.baoliao = [];
  const r = await runTask({ type: 'fetch', limit: 5, name: '抓取' }, db, {});
  assert.equal(r.ok, true);
  assert.equal(r.result.count, 3); // mock 适配器固定返回 3 条
  assert.equal(db.baoliao.length, 3); // db === cache，mergeBaoliao 已写入
});

test('runTask 多账号签到全成功：ok=true 且聚合两人', async () => {
  const db = { users: [{ id: 'u1', cookie: 'c' }, { id: 'u2', cookie: 'c' }], clockRecords: [] };
  const r = await runTask({ type: 'clock', name: '签到' }, db, {});
  assert.equal(r.ok, true);
  assert.equal(r.partial, false);
  assert.match(r.message, /2 个账号/);
  assert.match(r.message, /2 成功/);
});

test('runClockForUser 瞬时失败按指数退避重试后成功', async () => {
  const orig = smzdm.doClockIn;
  let calls = 0;
  smzdm.doClockIn = async () => {
    calls += 1;
    if (calls < 3) throw new Error('频率限制'); // 前两次瞬时失败
    return { success: true, points: 7 };
  };
  const prevRetry = config.clockRetry;
  const prevBase = config.clockRetryBaseMs;
  config.clockRetry = 2; // 最多重试 2 次（共 3 次尝试）
  config.clockRetryBaseMs = 0; // 测试不去等退避
  try {
    const db = { users: [{ id: 'u1', cookie: 'c' }], clockRecords: [] };
    const r = await runClockForUser(db, db.users[0], { risk: { enabled: false } });
    assert.equal(r.ok, true);
    assert.equal(calls, 3); // 重试补齐到成功
    assert.match(r.message, /签到成功/);
  } finally {
    config.clockRetry = prevRetry;
    config.clockRetryBaseMs = prevBase;
    smzdm.doClockIn = orig;
  }
});

test('runClockForUser 全部重试失败则 ok=false', async () => {
  const orig = smzdm.doClockIn;
  let calls = 0;
  smzdm.doClockIn = async () => {
    calls += 1;
    throw new Error('网络超时');
  };
  const prevRetry = config.clockRetry;
  const prevBase = config.clockRetryBaseMs;
  config.clockRetry = 2;
  config.clockRetryBaseMs = 0;
  try {
    const db = { users: [{ id: 'u1', cookie: 'c' }], clockRecords: [] };
    const r = await runClockForUser(db, db.users[0], { risk: { enabled: false } });
    assert.equal(r.ok, false);
    assert.equal(calls, 3); // 1 次 + 2 次重试
    assert.match(r.message, /网络超时/);
  } finally {
    config.clockRetry = prevRetry;
    config.clockRetryBaseMs = prevBase;
    smzdm.doClockIn = orig;
  }
});

test('runTask 多账号签到按错峰间隔分散执行', async () => {
  // 临时开启错峰，验证相邻账号之间存在等待（避免同秒扎堆）
  const prevStagger = config.clockStaggerMs;
  const prevJitter = config.clockStaggerJitterMs;
  config.clockStaggerMs = 150;
  config.clockStaggerJitterMs = 0;
  const db = { users: [{ id: 'u1', cookie: 'c' }, { id: 'u2', cookie: 'c' }, { id: 'u3', cookie: 'c' }], clockRecords: [] };
  try {
    const start = Date.now();
    const r = await runTask({ type: 'clock', name: '签到' }, db, {});
    const elapsed = Date.now() - start;
    assert.equal(r.ok, true);
    // 2 个间隔 × 150ms = 至少 300ms（取保守阈值 260ms 防抖动）
    assert.ok(elapsed >= 260, `expected stagger delay, got ${elapsed}ms`);
  } finally {
    config.clockStaggerMs = prevStagger;
    config.clockStaggerJitterMs = prevJitter;
  }
});

test('runTask 定时(scheduled)模式：已过个人时间(宽限窗内)补签，未来时间不签', async () => {
  // 固定当前时间为 09:30；过去且未超宽限窗的用户应补签，未来时间不签
  const RealDate = Date;
  const fixed = new RealDate(2026, 7, 6, 9, 30, 0);
  const FakeDate = class extends RealDate {
    constructor(...a) { if (a.length) return new RealDate(...a); return new RealDate(fixed); }
    static now() { return fixed.getTime(); }
  };
  globalThis.Date = FakeDate;
  const prevStagger = config.clockStaggerMs;
  const prevJitter = config.clockStaggerJitterMs;
  config.clockStaggerMs = 0;
  config.clockStaggerJitterMs = 0;
  config.tz = 'local'; // 用进程本地时区，避免机器时区影响"今天/当前分钟"断言
  try {
    const db = {
      users: [
        { id: 'hit', cookie: 'c', schedMode: 'manual', checkInTime: '09:30' }, // 恰好到达 → 签
        { id: 'past', cookie: 'c', schedMode: 'manual', checkInTime: '08:00' }, // 已过且在窗内 → 补签
        { id: 'def', cookie: 'c', schedMode: 'manual', checkInTime: '09:00' }, // 手动 09:00 已过且在窗内 → 补签
        { id: 'future', cookie: 'c', schedMode: 'manual', checkInTime: '11:00' } // 未来 → 不签
      ],
      clockRecords: []
    };
    const r = await runTask({ type: 'clock', name: '签到' }, db, { scheduled: true });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, undefined);
    assert.equal(db.clockRecords.length, 3); // hit/past/def 签，future 不签
    const signed = new Set(db.clockRecords.map((x) => x.userId));
    assert.ok(signed.has('hit') && signed.has('past') && signed.has('def'));
    assert.ok(!signed.has('future'));
  } finally {
    globalThis.Date = RealDate;
    config.clockStaggerMs = prevStagger;
    config.clockStaggerJitterMs = prevJitter;
    config.tz = 'local';
  }
});

test('runTask 定时(scheduled)模式：超出补签宽限窗的过期账号不签', async () => {
  // 固定 12:00；某账号时间 09:00，距现在 180 分钟，超过默认宽限窗(180)即不补签
  const RealDate = Date;
  const fixed = new RealDate(2026, 7, 6, 12, 0, 0);
  const FakeDate = class extends RealDate {
    constructor(...a) { if (a.length) return new RealDate(...a); return new RealDate(fixed); }
    static now() { return fixed.getTime(); }
  };
  globalThis.Date = FakeDate;
  const prevStagger = config.clockStaggerMs;
  config.clockStaggerMs = 0;
  config.clockStaggerJitterMs = 0;
  config.tz = 'local';
  const prevGrace = config.catchupGraceMin;
  config.catchupGraceMin = 120; // 12:00 - 09:00 = 180 分钟，远超 120 宽限窗 → 不补签
  try {
    const db = {
      users: [{ id: 'old', cookie: 'c', schedMode: 'manual', checkInTime: '09:00' }],
      clockRecords: []
    };
    const r = await runTask({ type: 'clock', name: '签到' }, db, { scheduled: true });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true); // 过期超窗，当天不再补签
    assert.equal(db.clockRecords.length, 0);
  } finally {
    globalThis.Date = RealDate;
    config.clockStaggerMs = prevStagger;
    config.clockStaggerJitterMs = 0;
    config.tz = 'local';
    config.catchupGraceMin = prevGrace;
  }
});

test('runTask 定时(scheduled)模式无账号命中返回 skipped', async () => {
  const RealDate = Date;
  const fixed = new RealDate(2026, 7, 6, 3, 0, 0); // 凌晨 3 点，无人设定此时段
  const FakeDate = class extends RealDate {
    constructor(...a) { if (a.length) return new RealDate(...a); return new RealDate(fixed); }
    static now() { return fixed.getTime(); }
  };
  globalThis.Date = FakeDate;
  try {
    const db = {
      users: [
        { id: 'a', cookie: 'c', schedMode: 'manual', checkInTime: '09:30' },
        { id: 'b', cookie: 'c', schedMode: 'auto', checkInTime: '08:10' }
      ],
      clockRecords: []
    };
    const r = await runTask({ type: 'clock', name: '签到' }, db, { scheduled: true });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true);
    assert.equal(db.clockRecords.length, 0);
  } finally {
    globalThis.Date = RealDate;
  }
});

test('runTask 定时(scheduled)模式跳过今日已签账号', async () => {
  const RealDate = Date;
  const fixed = new RealDate(2026, 7, 6, 9, 30, 0);
  const FakeDate = class extends RealDate {
    constructor(...a) { if (a.length) return new RealDate(...a); return new RealDate(fixed); }
    static now() { return fixed.getTime(); }
  };
  globalThis.Date = FakeDate;
  const prevStagger = config.clockStaggerMs;
  config.clockStaggerMs = 0;
  config.clockStaggerJitterMs = 0;
  try {
    const db = {
      users: [{ id: 'hit', cookie: 'c', schedMode: 'manual', checkInTime: '09:30' }],
      // 今日（2026-08-06）已签到 → 应被定时过滤排除
      clockRecords: [{ userId: 'hit', date: '2026-08-06', points: 5, id: 'c1' }]
    };
    const r = await runTask({ type: 'clock', name: '签到' }, db, { scheduled: true });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, true);
    assert.equal(db.clockRecords.length, 1); // 未新增
  } finally {
    globalThis.Date = RealDate;
    config.clockStaggerMs = prevStagger;
    config.clockStaggerJitterMs = 0;
  }
});

test('resolvedCheckInTime 与 runTask 过滤一致（手动时间映射）', () => {
  const u = { id: 'x', schedMode: 'manual', checkInTime: '13:45' };
  assert.equal(resolvedCheckInTime(u), '13:45');
});

test('runClockForUser 检测到登录失效：标记 cookieExpired 并跳过后续请求', async () => {
  const orig = smzdm.doClockIn;
  let calls = 0;
  smzdm.doClockIn = async () => {
    calls += 1;
    throw new Error('用户未登录，请先登录');
  };
  const prevRetry = config.clockRetry;
  const prevBase = config.clockRetryBaseMs;
  config.clockRetry = 0; // 关闭重试，加速并精确断言单次尝试
  config.clockRetryBaseMs = 0;
  const db = { users: [{ id: 'u1', cookie: 'c', cookieExpired: false }], clockRecords: [] };
  try {
    const r = await runClockForUser(db, db.users[0], { risk: { enabled: false } });
    assert.equal(r.ok, false);
    assert.equal(r.authExpired, true);
    assert.equal(calls, 1);
    assert.equal(db.users[0].cookieExpired, true); // 已标记，避免盲目重试
    // 再次调用：应直接跳过，不再请求适配器
    const r2 = await runClockForUser(db, db.users[0], { risk: { enabled: false } });
    assert.equal(r2.authExpired, true);
    assert.equal(r2.ok, false);
    assert.equal(calls, 1); // 未再次调用
  } finally {
    config.clockRetry = prevRetry;
    config.clockRetryBaseMs = prevBase;
    smzdm.doClockIn = orig;
  }
});

test('sampleArticleIds 返回不重复子集且全部来自原池（不修改原数组）', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const sampled = sampleArticleIds(ids, 3, () => 0.99); // rng=0.99 决定洗牌顺序，取前 3
  assert.equal(sampled.length, 3);
  assert.equal(new Set(sampled).size, 3); // 不重复
  assert.ok(sampled.every((x) => ids.includes(x)));
  assert.equal(ids.length, 5); // 原数组未被改动
});

test('computeSampleSize：limit 受控、默认随机、空池封顶', () => {
  assert.equal(computeSampleSize(10, 2), 2); // limit 优先生效
  assert.equal(computeSampleSize(3, 50), 3); // limit 超过池大小 → 封顶池大小
  assert.equal(computeSampleSize(0, 5), 0); // 空池 → 0
  // 默认随机（无 limit）：落在 [3,12] 区间（config 默认）且不超过池大小
  const r = computeSampleSize(100, undefined, () => 0.5);
  assert.ok(r >= 3 && r <= 12);
  // 池很小（2 条）时即便默认上限 12 也只取 2
  assert.equal(computeSampleSize(2, undefined, () => 0), 2);
});

test('runEngagement baoliao 来源随机取样（不遍历全量）+ 拟人化延迟可关闭', async () => {
  // 关闭延迟，保证用例快速且确定性（避免 2~15s 真实等待）
  const prevMin = config.engagementDelayMinMs;
  const prevMax = config.engagementDelayMaxMs;
  const prevProb = config.engagementDelayLongProbability;
  config.engagementDelayMinMs = 0;
  config.engagementDelayMaxMs = 0;
  config.engagementDelayLongProbability = 0;
  const db = {
    users: [{ id: 'u1', cookie: 'c' }],
    baoliao: Array.from({ length: 8 }, (_, i) => ({ smzdmUrl: 'https://x/p/' + (100 + i) }))
  };
  const pool = ['100', '101', '102', '103', '104', '105', '106', '107'];
  const called = [];
  const orig = smzdm.doComment;
  smzdm.doComment = async (cookie, opts) => {
    called.push(opts.articleId);
    return { count: 1, message: '评论成功' };
  };
  try {
    // 任务 limit=3 → 从 8 篇中随机取样 3 篇（而非全量 8 篇）
    const r = await runTask({ type: 'comment', articleSource: 'baoliao', limit: 3, name: '评论' }, db, {});
    assert.equal(r.ok, true);
    assert.equal(called.length, 3); // 仅 3 篇被操作
    assert.equal(new Set(called).size, 3); // 不重复
    assert.ok(called.every((x) => pool.includes(x))); // 取样全部来自池
    assert.match(r.message, /从 8 篇中随机选取 3 篇/); // 结果标明抽样
  } finally {
    smzdm.doComment = orig;
    config.engagementDelayMinMs = prevMin;
    config.engagementDelayMaxMs = prevMax;
    config.engagementDelayLongProbability = prevProb;
  }
});

test('还原全局 fetch', () => {
  globalThis.fetch = realFetch;
  assert.ok(true);
});
