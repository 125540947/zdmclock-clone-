// extremeLazy 编排层测试
//
// 策略：仅 mock 两个"驱动源"模块——store（load 返回可控 db）与 taskRunner（runTask 行为可控），
// 其余纯函数/无副作用模块（assetLedger / articleId / parse / notifier / smzdm / gpt）真实加载，
// 既贴近真实又避免实验性模块 mock 对大量模块的干扰。零网络（runTask 由 mock 接管）。
//
// 覆盖：无可用账号短路、happy path 全阶段、签到失败、好价失败、互动无文章、
//       GPT 未启用跳过、step5 未启用跳过、step5 任务失败。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = path.resolve(import.meta.dirname, '../src');
const p = (rel) => pathToFileURL(path.resolve(SRC, rel)).href;

// 可被各 test 动态改写的可变状态（mock factory 闭包引用）
let TEST_DB = {};
let TASK_BEHAVIOR = () => ({ ok: true, message: 'ok', result: { count: 1 } });
const TASK_CALLS = [];

mock.module(p('store.js'), {
  namedExports: {
    load: () => TEST_DB,
    persist: () => {},
    persistNow: () => {},
    persistSoon: () => {},
    flushPersist: () => {},
    withWriteLock: (fn) => Promise.resolve(fn()),
    mergeBaoliao: () => {},
    genId: () => 'id1',
    localDateStr: () => '2026-08-10',
    todayStr: () => '2026-08-10',
    todayStrTZ: () => '2026-08-10',
    yesterdayStrTZ: () => '2026-08-09'
  }
});
mock.module(p('taskRunner.js'), {
  namedExports: {
    runTask: async (taskCfg, db, ctx) => {
      TASK_CALLS.push({ type: taskCfg.type, cfg: taskCfg, ctx });
      return TASK_BEHAVIOR(taskCfg, db, ctx);
    }
  }
});

const { runExtremeLazy } = await import(p('extremeLazy.js'));

function makeHappyDb() {
  return {
    users: [
      { id: 'u1', nickname: 'A', cookie: 'c1', autoRun: true },
      { id: 'u2', cookie: 'c2', autoRun: true }
    ],
    baoliao: [{ smzdmUrl: 'https://www.smzdm.com/p/999' }],
    tasks: [
      { id: 't_comment', type: 'comment', enabled: true, articleSource: 'baoliao' },
      { id: 't_favorite', type: 'favorite', enabled: true },
      { id: 't_point', type: 'point', enabled: true },
      { id: 'lottery', type: 'lottery', enabled: true },
      { id: 'turntable', type: 'turntable', enabled: true },
      { id: 'crowdtest', type: 'crowdtest', enabled: true },
      { id: 'dailyTasks', type: 'dailyTasks', enabled: true },
      { id: 'follow', type: 'follow', enabled: true },
      { id: 'share', type: 'share', enabled: true }
    ],
    settings: { gpt: { enabled: true, autoPost: false } },
    gptDrafts: []
  };
}

function reset(behavior) {
  TASK_CALLS.length = 0;
  TASK_BEHAVIOR = behavior || (() => ({ ok: true, message: 'ok', result: { count: 1 } }));
}

test('无可用账号 → ok:false 且提示添加账号，不调用 runTask', async (t) => {
  t.mock.timeout?.(60000);
  TEST_DB = { users: [], baoliao: [], tasks: [], settings: { gpt: { enabled: false } }, gptDrafts: [] };
  reset();
  const r = await runExtremeLazy();
  assert.equal(r.ok, false);
  assert.match(r.message, /请先添加 smzdm 账号/);
  assert.ok(r.logs.some((l) => l.includes('没有可用账号')));
  assert.equal(TASK_CALLS.length, 0);
}, 60000);

test('happy path：全步成功，totalOk 计数覆盖所有阶段', async (t) => {
  t.mock.timeout?.(60000);
  TEST_DB = makeHappyDb();
  reset(() => ({ ok: true, message: 'done', result: { count: 2 } }));
  const r = await runExtremeLazy();
  assert.equal(r.ok, true);
  const steps = r.results.steps.map((s) => s.name);
  for (const name of [
    '签到', '刷新好价', 'GPT生成', '自动评论', '自动收藏', '自动点赞',
    '每日抽奖', '转盘抽奖', '全民众测', '每日任务', '自动关注', '自动分享'
  ]) {
    assert.ok(steps.includes(name), `缺少步骤：${name}`);
  }
  assert.ok(r.results.totalOk >= 12);
}, 60000);

test('签到部分失败 → 该步记 false 且汇总失败', async (t) => {
  t.mock.timeout?.(60000);
  TEST_DB = makeHappyDb();
  reset((cfg) => (cfg.type === 'clock' ? { ok: false, message: 'Cookie失效' } : { ok: true, result: { count: 1 } }));
  const r = await runExtremeLazy();
  const sign = r.results.steps.find((s) => s.name === '签到');
  assert.equal(sign.ok, false);
  assert.match(sign.detail, /失败/);
  assert.equal(r.ok, false);
}, 60000);

test('刷新好价失败（且历史为空）→ 步记失败，detail 反映爆料箱为空', async (t) => {
  t.mock.timeout?.(60000);
  TEST_DB = makeHappyDb();
  TEST_DB.baoliao = []; // 历史也为空：step 成败取决于"是否有好价数据"，为空则失败
  reset((cfg) => (cfg.type === 'fetch' ? { ok: false, message: '抓取失败' } : { ok: true, result: { count: 1 } }));
  const r = await runExtremeLazy();
  const fetchStep = r.results.steps.find((s) => s.name === '刷新好价');
  assert.equal(fetchStep.ok, false);
  assert.match(fetchStep.detail, /爆料箱/);
  assert.ok(r.logs.some((l) => l.includes('抓取失败')), '应记录抓取失败日志');
}, 60000);

test('GPT 未启用 → 跳过且不调用 gpt 任务', async (t) => {
  t.mock.timeout?.(60000);
  TEST_DB = makeHappyDb();
  TEST_DB.settings.gpt.enabled = false;
  reset();
  const r = await runExtremeLazy();
  const gpt = r.results.steps.find((s) => s.name === 'GPT生成');
  assert.equal(gpt.ok, true, 'gptGen>=0 视为该步成功');
  assert.ok(!TASK_CALLS.some((c) => c.type === 'gpt'), '不应调用 gpt 任务');
}, 60000);

test('无文章 ID → 三个互动步记失败（无可用文章）', async (t) => {
  t.mock.timeout?.(60000);
  TEST_DB = makeHappyDb();
  TEST_DB.baoliao = [];
  reset();
  const r = await runExtremeLazy();
  for (const name of ['自动评论', '自动收藏', '自动点赞']) {
    const s = r.results.steps.find((x) => x.name === name);
    assert.equal(s.ok, false);
    assert.match(s.detail, /无可用文章/);
  }
}, 60000);

test('step5 任务未启用 → 记"未启用，跳过"', async (t) => {
  t.mock.timeout?.(60000);
  TEST_DB = makeHappyDb();
  TEST_DB.tasks = TEST_DB.tasks.filter((x) => x.type !== 'lottery');
  reset();
  const r = await runExtremeLazy();
  const lot = r.results.steps.find((s) => s.name === '每日抽奖');
  assert.equal(lot.ok, true);
  assert.match(lot.detail, /未启用，跳过/);
}, 60000);

test('step5 启用的任务失败 → 该步记 false', async (t) => {
  t.mock.timeout?.(60000);
  TEST_DB = makeHappyDb();
  reset((cfg) => (cfg.type === 'lottery' ? { ok: false, message: '抽奖失败' } : { ok: true, result: { count: 1 } }));
  const r = await runExtremeLazy();
  const lot = r.results.steps.find((s) => s.name === '每日抽奖');
  assert.equal(lot.ok, false);
}, 60000);
