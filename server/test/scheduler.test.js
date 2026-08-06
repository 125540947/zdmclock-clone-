// P0：调度求值测试（cronMatch 真实求值 + validateCron 语法校验，覆盖 * / */n / a-b / a,b,c 各分支）
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { cronMatch, validateCron } = await import('../src/scheduler.js');
const { zonedWallClock } = await import('../src/clockSchedule.js');

// 固定锚点：2026-08-06 是星期四（getDay() === 4）
const ANCHOR = new Date(2026, 7, 6, 9, 30, 0); // 本地时区 2026-08-06 09:30

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
