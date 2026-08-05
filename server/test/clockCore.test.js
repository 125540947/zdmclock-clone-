// 最小单元验证：覆盖签到落库幂等/统计、写锁串行化、cron 校验（b9 / N1 / R2 / b3）。
// 仅测试纯内存逻辑，不触发 store.load/persist，故无文件写入副作用。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyClock, localYesterdayStr } from '../src/clockCore.js';
import { withWriteLock } from '../src/store.js';
import { validateCron } from '../src/scheduler.js';
import { normalizeArticleId } from '../src/smzdm/realAdapter.js';

function makeDb() {
  return {
    users: [{ id: 'u1', nickname: 't', points: 0, totalClockIn: 0, streak: 0 }],
    clockRecords: [],
  };
}

test('applyClock 首次签到写入记录并更新统计', () => {
  const db = makeDb();
  const r = applyClock(db.users[0], { points: 5 }, db);
  assert.equal(r.duplicate, false);
  assert.equal(db.clockRecords.length, 1);
  assert.equal(db.users[0].points, 5);
  assert.equal(db.users[0].totalClockIn, 1);
  assert.equal(db.users[0].streak, 1);
});

test('applyClock 同日重复签到幂等（不重复计）', () => {
  const db = makeDb();
  applyClock(db.users[0], { points: 5 }, db);
  const r2 = applyClock(db.users[0], { points: 5 }, db);
  assert.equal(r2.duplicate, true);
  assert.equal(db.clockRecords.length, 1);
  assert.equal(db.users[0].points, 5); // 未重复累加
  assert.equal(db.users[0].streak, 1);
});

test('applyClock 昨日有记录时 streak 递增', () => {
  const db = makeDb();
  db.clockRecords.push({ id: 'x', userId: 'u1', date: localYesterdayStr(), points: 0, createdAt: '' });
  const r = applyClock(db.users[0], { points: 5 }, db);
  assert.equal(r.duplicate, false);
  assert.equal(db.users[0].streak, 1); // 初始 0 → +1
});

test('withWriteLock 串行执行（后调用等待先调用完成）', async () => {
  const order = [];
  const slow = withWriteLock(async () => {
    await new Promise((res) => setTimeout(res, 20));
    order.push('a');
    return 'a';
  });
  const fast = withWriteLock(async () => {
    order.push('b'); // 若未串行化，会先于 a 执行
    return 'b';
  });
  const [ra, rb] = await Promise.all([slow, fast]);
  assert.equal(ra, 'a');
  assert.equal(rb, 'b');
  assert.deepEqual(order, ['a', 'b']);
});

test('withWriteLock 返回值的决议值透传', async () => {
  const v = await withWriteLock(() => 42);
  assert.equal(v, 42);
});

test('validateCron 合法表达式', () => {
  assert.equal(validateCron('0 9 * * *'), true);
  assert.equal(validateCron('*/5 * * * *'), true);
  assert.equal(validateCron('0 0 1-15 * 1-5'), true);
  assert.equal(validateCron('5,10,20 8-9 * * *'), true);
});

test('validateCron 非法表达式被拒绝（b3）', () => {
  assert.equal(validateCron('0 9 * *'), false); // 4 段
  assert.equal(validateCron('* * * * * *'), false); // 6 段
  assert.equal(validateCron(''), false); // 空
  assert.equal(validateCron('99 9 * * *'), false); // 分超范围
  assert.equal(validateCron('10-5 * * * *'), false); // 逆序区间
  assert.equal(validateCron('a 9 * * *'), false); // 非数字
  assert.equal(validateCron('* * * *'), false); // 缺失段
});

test('normalizeArticleId 提取文章 ID（评论/收藏/点赞需此参数）', () => {
  assert.equal(normalizeArticleId('123456'), '123456');
  assert.equal(normalizeArticleId('https://www.smzdm.com/p/123456'), '123456');
  assert.equal(normalizeArticleId('https://www.smzdm.com/articles/987654'), '987654');
  assert.equal(normalizeArticleId('  '), '');
  assert.equal(normalizeArticleId(''), '');
  assert.equal(normalizeArticleId('不是链接'), '');
});
