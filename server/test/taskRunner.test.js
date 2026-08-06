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
const { runTask, collectArticleIds, resolveUsers, runClockForUser } = await import('../src/taskRunner.js');
const { load } = await import('../src/store.js');
const { config } = await import('../src/config.js');
const { smzdm } = await import('../src/smzdm/adapter.js');

const realFetch = globalThis.fetch;
function mockFetchOnce(body) {
  globalThis.fetch = async () => ({ ok: true, json: async () => body });
}

test('collectArticleIds baoliao 来源提取并去重', () => {
  const db = { baoliao: [
    { smzdmUrl: 'https://x/p/111' },
    { url: 'https://x/p/222' },
    { smzdmUrl: 'https://x/p/111' }
  ] };
  assert.deepEqual(collectArticleIds({ type: 'comment' }, db, 'baoliao', ''), ['111', '222']);
});

test('collectArticleIds manual 来源：overrideId 优先于 task.articleId', () => {
  assert.deepEqual(collectArticleIds({ articleId: '888' }, {}, 'manual', '999'), ['999']);
  assert.deepEqual(collectArticleIds({ articleId: '888' }, {}, 'manual', ''), ['888']);
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
    const r = await runClockForUser(db, db.users[0]);
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
    const r = await runClockForUser(db, db.users[0]);
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

test('还原全局 fetch', () => {
  globalThis.fetch = realFetch;
  assert.ok(true);
});
