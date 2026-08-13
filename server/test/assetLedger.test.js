import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAssetEffect, summarizeAssets, dailyAssetSeries, assetByTask, recentLedger } from '../src/assetLedger.js';

function freshDb() {
  return { users: [], assetLedger: [], assetSnapshots: [] };
}

test('applyAssetEffect 用显式增量落账并更新 user.assets', () => {
  const db = freshDb();
  const user = { id: 'u1', nickname: '甲', assets: { gold: 100, silver: 0, exp: 50, level: 'Lv.2' } };
  db.users.push(user);
  const r = applyAssetEffect(db, user, 'clock', '每日签到', { explicit: { gold: 10 }, success: true, message: '签到+10' });
  assert.equal(r.goldDelta, 10);
  assert.equal(user.assets.gold, 110);
  assert.equal(user.points, 110); // 签到 gold 同步旧字段
  assert.equal(db.assetLedger.length, 1);
  assert.equal(db.assetLedger[0].goldAfter, 110);
});

test('applyAssetEffect 用刷新差额（after）作增量', () => {
  const db = freshDb();
  const user = { id: 'u2', nickname: '乙', assets: { gold: 0, silver: 0, exp: 0, level: null } };
  db.users.push(user);
  const r = applyAssetEffect(db, user, 'point', '自动点赞', { after: { gold: 5, silver: 0, exp: 2, level: 'Lv.1' } });
  assert.equal(r.goldDelta, 5);
  assert.equal(r.expDelta, 2);
  assert.equal(user.assets.gold, 5);
  assert.equal(user.assets.level, 'Lv.1');
});

test('summarizeAssets 聚合每用户与全局合计', () => {
  const db = freshDb();
  const u1 = { id: 'u1', nickname: '甲', assets: { gold: 110, silver: 0, exp: 50, level: 'Lv.2' }, streak: 3, totalClockIn: 10 };
  const u2 = { id: 'u2', nickname: '乙', assets: { gold: 5, silver: 0, exp: 2, level: 'Lv.1' }, streak: 1, totalClockIn: 2 };
  db.users.push(u1, u2);
  // 给 u1 写一条今日账本（今日增量）
  const today = new Date();
  const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  db.assetLedger.push({ id: 'a1', ts: new Date().toISOString(), date: ds, userId: 'u1', taskType: 'clock', taskName: '每日签到', goldDelta: 10, silverDelta: 0, expDelta: 0, goldAfter: 110, silverAfter: 0, expAfter: 50, levelAfter: 'Lv.2', success: true, message: '' });
  const s = summarizeAssets(db);
  assert.equal(s.totals.gold, 115);
  assert.equal(s.users.length, 2);
  const u1sum = s.users.find((x) => x.id === 'u1');
  assert.equal(u1sum.today.gold, 10);
});

test('dailyAssetSeries 返回 days 天且含增量/累计', () => {
  const db = freshDb();
  const today = new Date();
  const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  db.assetLedger.push({ id: 'a1', ts: new Date().toISOString(), date: ds, userId: 'u1', taskType: 'clock', taskName: '每日签到', goldDelta: 10, silverDelta: 0, expDelta: 5, goldAfter: 110, silverAfter: 0, expAfter: 55, levelAfter: null, success: true, message: '' });
  const series = dailyAssetSeries(db, 7);
  assert.equal(series.length, 7);
  const last = series[series.length - 1];
  assert.equal(last.date, ds);
  assert.equal(last.goldDelta, 10);
  assert.equal(last.expDelta, 5);
});

test('assetByTask 统计任务贡献', () => {
  const db = freshDb();
  const today = new Date();
  const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  db.assetLedger.push({ id: 'a1', ts: new Date().toISOString(), date: ds, userId: 'u1', taskType: 'clock', taskName: '每日签到', goldDelta: 10, silverDelta: 0, expDelta: 0, goldAfter: 110, silverAfter: 0, expAfter: 50, levelAfter: null, success: true, message: '' });
  db.assetLedger.push({ id: 'a2', ts: new Date().toISOString(), date: ds, userId: 'u1', taskType: 'clock', taskName: '每日签到', goldDelta: 8, silverDelta: 0, expDelta: 0, goldAfter: 118, silverAfter: 0, expAfter: 50, levelAfter: null, success: true, message: '' });
  const items = assetByTask(db, 30);
  const clock = items.find((x) => x.taskType === 'clock');
  assert.equal(clock.count, 2);
  assert.equal(clock.goldDelta, 18);
});

test('recentLedger 按时间倒序并带昵称', () => {
  const db = freshDb();
  const u1 = { id: 'u1', nickname: '甲' };
  db.users.push(u1);
  db.assetLedger.push({ id: 'a1', ts: '2026-01-01T00:00:00Z', date: '2026-01-01', userId: 'u1', taskType: 'clock', taskName: '每日签到', goldDelta: 10, silverDelta: 0, expDelta: 0, goldAfter: 110, silverAfter: 0, expAfter: 50, levelAfter: null, success: true, message: '' });
  db.assetLedger.push({ id: 'a2', ts: '2026-02-01T00:00:00Z', date: '2026-02-01', userId: 'u1', taskType: 'lottery', taskName: '每日抽奖', goldDelta: 0, silverDelta: 0, expDelta: 0, goldAfter: 110, silverAfter: 0, expAfter: 50, levelAfter: null, success: true, message: '' });
  const list = recentLedger(db, 50);
  assert.equal(list[0].id, 'a2'); // 倒序
  assert.equal(list[0].nickname, '甲');
});

// Phase 2：visibleIds 过滤（OPEN_MODE 按 /24 网段隔离，仅统计集合内账号）
test('visibleIds 过滤：summarize/daily/by-task/ledger 仅统计集合内账号', () => {
  const db = freshDb();
  const u1 = { id: 'u1', nickname: '甲', assets: { gold: 110, silver: 0, exp: 50, level: 'Lv.2' }, streak: 3, totalClockIn: 10 };
  const u2 = { id: 'u2', nickname: '乙', assets: { gold: 5, silver: 0, exp: 2, level: 'Lv.1' }, streak: 1, totalClockIn: 2 };
  db.users.push(u1, u2);
  const today = new Date();
  const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  db.assetLedger.push({ id: 'a1', ts: new Date().toISOString(), date: ds, userId: 'u1', taskType: 'clock', taskName: '每日签到', goldDelta: 10, silverDelta: 0, expDelta: 0, goldAfter: 110, silverAfter: 0, expAfter: 50, levelAfter: 'Lv.2', success: true, message: '' });
  db.assetLedger.push({ id: 'a2', ts: new Date().toISOString(), date: ds, userId: 'u2', taskType: 'comment', taskName: '自动评论', goldDelta: 3, silverDelta: 0, expDelta: 0, goldAfter: 5, silverAfter: 0, expAfter: 0, levelAfter: null, success: true, message: '' });
  db.assetSnapshots.push({ userId: 'u1', date: ds, gold: 110, silver: 0, exp: 50, level: 'Lv.2' });
  db.assetSnapshots.push({ userId: 'u2', date: ds, gold: 5, silver: 0, exp: 0, level: 'Lv.1' });

  const onlyU1 = new Set(['u1']);
  const s = summarizeAssets(db, onlyU1);
  assert.equal(s.users.length, 1);
  assert.equal(s.users[0].id, 'u1');
  assert.equal(s.totals.gold, 110);
  assert.equal(s.totals.users, 1);

  const series = dailyAssetSeries(db, 7, onlyU1);
  assert.equal(series[series.length - 1].goldDelta, 10, '仅 u1 的增量');

  const items = assetByTask(db, 30, onlyU1);
  assert.ok(items.every((i) => i.taskType === 'clock'));
  assert.ok(!items.some((i) => i.taskType === 'comment'));

  const list = recentLedger(db, 50, onlyU1);
  assert.ok(list.every((e) => e.userId === 'u1'));
  assert.equal(list.length, 1);
});

test('assetLedger 快照 exp 字段名修正：snap.exp 存储且 dailyAssetSeries 读取（非恒为 0）', () => {
  const db = freshDb();
  const user = { id: 'u1', assets: { gold: 0, silver: 0, exp: 0, level: null } };
  db.users.push(user);
  applyAssetEffect(db, user, 'clock', '每日签到', { explicit: { gold: 10, silver: 5, exp: 7 }, success: true });
  const snap = db.assetSnapshots[0];
  assert.equal(typeof snap.exp, 'number', '快照应以 exp 字段存储经验值');
  assert.equal(snap.expAfter, undefined, '不应再以 expAfter 字段存储（与 gold/silver 命名一致）');
  const series = dailyAssetSeries(db, 1);
  assert.ok(series[0].expTotal > 0, 'expTotal 不应因字段名错配而恒为 0');
  assert.equal(series[0].expTotal, snap.exp + 7, 'expTotal = 快照(7) + 当日 delta(7)（与 gold 口径一致）');
});
