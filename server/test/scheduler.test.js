// P0：调度求值测试（cronMatch 真实求值 + validateCron 语法校验，覆盖 * / */n / a-b / a,b,c 各分支）
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { cronMatch, validateCron, healthCheckDue, generateRandomPlanTimes } = await import('../src/scheduler.js');
const { zonedWallClock } = await import('../src/clockSchedule.js');

// 固定锚点：2026-08-06 是星期四（getDay() === 4）
const ANCHOR = new Date(2026, 7, 6, 9, 30, 0); // 本地时区 2026-08-06 09:30

test('Cookie 健康检测间隔为 0 时关闭自动检测', () => {
  assert.equal(healthCheckDue(1000, 0, 0), false);
  assert.equal(healthCheckDue(1000, 900, 360), false);
  assert.equal(healthCheckDue(1260, 900, 360), true);
});

test('validateCron 合法 5 段', () => {
  assert.equal(validateCron('0 9 * * *'), true);
  assert.equal(validateCron('*/5 * * * *'), true);
  assert.equal(validateCron('0 0 1-15 * 1-5'), true);
  assert.equal(validateCron('5,10,20 8-9 * * *'), true);
});

test('validateCron 非法表达式被拒绝', () => {
  assert.equal(validateCron('0 9 * *'), false); // 4 段
  assert.equal(validateCron('* * * * * *'), false); // 6 段
  assert.equal(validateCron(''), false); // 空
  assert.equal(validateCron('99 9 * * *'), false); // 分超范围
  assert.equal(validateCron('10-5 * * * *'), false); // 逆序区间
  assert.equal(validateCron('a 9 * * *'), false); // 非数字
  assert.equal(validateCron('60 0 * * *'), false); // 分 60
  assert.equal(validateCron('0 0 32 1 *'), false); // 日 32
  assert.equal(validateCron('0 0 1 13 *'), false); // 月 13
  assert.equal(validateCron('0 0 * * 7'), false); // 周 7
});

test('cronMatch 精确命中（分 时 日 月 周）', () => {
  assert.equal(cronMatch('30 9 6 8 4', ANCHOR), true);
});

test('cronMatch 分钟不符则整体不命中', () => {
  assert.equal(cronMatch('31 9 6 8 4', ANCHOR), false);
  assert.equal(cronMatch('0 9 6 8 4', ANCHOR), false); // 分 0 ≠ 30
});

test('cronMatch 支持 */n 步进', () => {
  assert.equal(cronMatch('*/10 9 6 8 4', ANCHOR), true); // 30 是 10 的倍数
  assert.equal(cronMatch('*/7 9 6 8 4', ANCHOR), false); // 30 不是 7 的倍数
});

test('cronMatch 支持 a-b 区间', () => {
  assert.equal(cronMatch('0-59 9 6 8 4', ANCHOR), true); // 分钟落在 [0,59]
  assert.equal(cronMatch('10-20 9 6 8 4', ANCHOR), false); // 30 不在 [10,20]
});

test('cronMatch 支持 a,b,c 列表', () => {
  assert.equal(cronMatch('29,30,31 9 6 8 4', ANCHOR), true); // 含 30
  assert.equal(cronMatch('1,2,3 9 6 8 4', ANCHOR), false);
});

test('cronMatch 全 * 永远命中', () => {
  assert.equal(cronMatch('* * * * *', ANCHOR), true);
});

test('cronMatch 周几维度独立判定（Thursday=4）', () => {
  assert.equal(cronMatch('* * * * 4', ANCHOR), true);
  assert.equal(cronMatch('* * * * 5', ANCHOR), false);
});

test('cronMatch 月末/跨月维度（非 2 月 31 日）', () => {
  assert.equal(cronMatch('* * 31 2 *', ANCHOR), false); // 锚点为 8 月 6 日
  assert.equal(cronMatch('* * 6 8 *', ANCHOR), true);
});

// M-14 修复：日（dom）与星期（dow）同时受限时取「任一匹配」的 POSIX 语义。
// 锚点 = 周四（getDay()===4）、6 日。
test('cronMatch 日与星期同时受限取 OR 语义（M-14）', () => {
  // dom=5（不中 6）但 dow=4（中周四）→ OR 命中
  assert.equal(cronMatch('* * 5 * 4', ANCHOR), true, 'dom 不中但 dow 中 → 命中');
  // dom=6（中）但 dow=2（不中）→ OR 命中
  assert.equal(cronMatch('* * 6 * 2', ANCHOR), true, 'dow 不中但 dom 中 → 命中');
  // dom=5 且 dow=2（都不中）→ 不命中
  assert.equal(cronMatch('* * 5 * 2', ANCHOR), false, '两者都不中 → 不命中');
  // dom=6 且 dow=4（都中）→ 命中
  assert.equal(cronMatch('* * 6 * 4', ANCHOR), true, '两者都中 → 命中');
  // 任一为 * 时仍按 AND：dom 受限不中、dow=*
  assert.equal(cronMatch('* * 5 * *', ANCHOR), false, 'dom 受限不中、dow=* → 整体不中（AND）');
  // dow 受限中、dom=* → 命中（AND，dow 中）
  assert.equal(cronMatch('* * * * 4', ANCHOR), true, 'dow 受限中、dom=* → 命中（AND）');
});

test('cronMatch 段数错误直接不命中', () => {
  assert.equal(cronMatch('* * *', ANCHOR), false);
  assert.equal(cronMatch('', ANCHOR), false);
});

test('zonedWallClock 将 UTC 瞬间折算为指定时区墙钟', () => {
  // 2026-08-06T01:30:00Z 在 Asia/Shanghai(UTC+8) 应为当天 09:30 周四
  const inst = new Date(Date.UTC(2026, 7, 6, 1, 30, 0));
  const z = zonedWallClock(inst, 'Asia/Shanghai');
  assert.equal(z.getHours(), 9);
  assert.equal(z.getMinutes(), 30);
  assert.equal(z.date, '2026-08-06');
  assert.equal(z.getDay(), 4);
  // 'local' 时退化为传入 Date 的原生取值（保持历史行为）
  const zl = zonedWallClock(inst, 'local');
  assert.equal(typeof zl.getHours(), 'number');
  assert.equal(zl.date, '2026-08-06');
});

test('cronMatch 接受 zonedWallClock 对象按墙钟求值', () => {
  const inst = new Date(Date.UTC(2026, 7, 6, 1, 30, 0));
  const z = zonedWallClock(inst, 'Asia/Shanghai'); // 09:30 周四
  assert.equal(cronMatch('30 9 * * *', z), true);
  assert.equal(cronMatch('0 10 * * *', z), false);
});

// ===================== 批次 38：分时段随机执行计划生成 =====================
test('generateRandomPlanTimes：窗口内不重复、升序、数量受控', () => {
  // 固定 rng 保证可复现：在 [480,1380]（08:00–23:00）内取 6 个不重复随机分钟
  let i = 0;
  const seq = [0.1, 0.5, 0.9, 0.3, 0.7, 0.2, 0.99, 0.4]; // 循环取用
  const rng = () => seq[i++ % seq.length];
  const times = generateRandomPlanTimes(480, 1380, 6, rng);
  assert.equal(times.length, 6, '返回 slots 个时刻');
  assert.equal(new Set(times).size, 6, '不重复');
  assert.ok(times.every((m) => m >= 480 && m <= 1380), '全部落在窗口内');
  // 升序
  for (let k = 1; k < times.length; k++) assert.ok(times[k] > times[k - 1], '升序排列');
});

test('generateRandomPlanTimes：slots 上限封顶 48、空窗口退化为单点', () => {
  // slots 超 48 应被钳制
  const big = generateRandomPlanTimes(600, 605, 100, () => 0.5);
  assert.ok(big.length <= 48, 'slots 不超过 48');
  // 窗口极小（相邻分钟）也只能产出 1 个不重复点
  const tiny = generateRandomPlanTimes(600, 600, 5, () => 0);
  assert.equal(tiny.length, 1);
  assert.equal(tiny[0], 600);
});

test('generateRandomPlanTimes：lo>hi 时自动交换区间', () => {
  // 故意反序传参（1380,480），函数内部应取 min/max 归一化；用变化 rng 保证 3 个不重复值可生成
  let i = 0;
  const seq = [0.1, 0.5, 0.9, 0.3, 0.7, 0.2, 0.99, 0.4];
  const rng = () => seq[i++ % seq.length];
  const t = generateRandomPlanTimes(1380, 480, 3, rng);
  assert.equal(t.length, 3);
  assert.ok(t.every((m) => m >= 480 && m <= 1380), '交换后结果仍落在原窗口内');
  assert.equal(new Set(t).size, 3, '反序参数下仍不重复');
  for (let k = 1; k < t.length; k++) assert.ok(t[k] > t[k - 1], '升序排列');
});
