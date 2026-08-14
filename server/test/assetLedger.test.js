import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAssetEffect, summarizeAssets, dailyAssetSeries, assetByTask, recentLedger } from '../src/assetLedger.js';
import { localDateStr, todayStrTZ } from '../src/store.js';
import { config } from '../src/config.js';

function freshDb() {
  return { users: [], assetLedger: [], assetSnapshots: [] };
}

// M-12：assetSnapshots 按「账号 × 日期」增长，必须受上限裁剪，避免 db.json 无限膨胀
test('M-12：assetSnapshots 超出上限时被裁剪到 5000', () => {
  const db = freshDb();
  // 预置 5001 条历史快照（不同 userId），触发下一次写入时的裁剪
  for (let i = 0; i < 5001; i++) {
    db.assetSnapshots.push({ userId: 'hist' + i, date: '2020-01-01', gold: 1, silver: 1, exp: 1, level: 1 });
  }
  const user = { id: 'u_new', assets: { gold: 0, silver: 0, exp: 0, level: null } };
  applyAssetEffect(db, user, 'clock', '每日签到', { explicit: { gold: 10 }, success: true });
  assert.ok(db.assetSnapshots.length <= 5000, '快照数应被裁到上限 5000，实际 ' + db.assetSnapshots.length);
  assert.ok(db.assetSnapshots.some((s) => s.userId === 'u_new'), '最新快照应保留');
});

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

test('assetLedger 快照 exp 字段名修正：snap.exp 存储且 dailyAssetSeries 读取（非恒为 0，不双算）', () => {
  const db = freshDb();
  const user = { id: 'u1', assets: { gold: 0, silver: 0, exp: 0, level: null } };
  db.users.push(user);
  applyAssetEffect(db, user, 'clock', '每日签到', { explicit: { gold: 10, silver: 5, exp: 7 }, success: true });
  const snap = db.assetSnapshots[0];
  assert.equal(typeof snap.exp, 'number', '快照应以 exp 字段存储经验值');
  assert.equal(snap.expAfter, undefined, '不应再以 expAfter 字段存储（与 gold/silver 命名一致）');
  const series = dailyAssetSeries(db, 1);
  assert.ok(series[0].expTotal > 0, 'expTotal 不应因字段名错配而恒为 0');
  // 快照已含当日增量（snap.gold=10 / snap.exp=7），goldTotal/expTotal 应直接等于快照累计值，
  // 不得再 +当日 delta（旧实现会双算成 20/14 并向前累积放大）。
  assert.equal(series[0].goldTotal, snap.gold, 'goldTotal = 快照累计(10)，不含双算');
  assert.equal(series[0].expTotal, snap.exp, 'expTotal = 快照累计(7)，不含双算');
  assert.equal(series[0].goldDelta, 10, 'goldDelta 仍为当日增量');
  assert.equal(series[0].expDelta, 7, 'expDelta 仍为当日增量');
});

test('dailyAssetSeries 跨日：快照日不双算且误差不向后传播', () => {
  const db = freshDb();
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  const d1 = localDateStr(y); // 昨天（快照日）
  const d2 = localDateStr(today); // 今天（无快照，靠累加）
  // 第 1 天（d1）：两条账本（增量 10+20=30）+ 该日快照（累计 30）
  db.assetLedger.push({ id: 'a1', ts: d1 + 'T08:00:00Z', date: d1, userId: 'u1', taskType: 'clock', taskName: '签到', goldDelta: 10, silverDelta: 0, expDelta: 0, goldAfter: 10, silverAfter: 0, expAfter: 0, levelAfter: null, success: true, message: '' });
  db.assetLedger.push({ id: 'a2', ts: d1 + 'T09:00:00Z', date: d1, userId: 'u1', taskType: 'point', taskName: '点赞', goldDelta: 20, silverDelta: 0, expDelta: 0, goldAfter: 30, silverAfter: 0, expAfter: 0, levelAfter: null, success: true, message: '' });
  db.assetSnapshots.push({ userId: 'u1', date: d1, gold: 30, silver: 0, exp: 0, level: null });
  // 第 2 天（d2）：一条账本 +5（无快照，靠累加）
  db.assetLedger.push({ id: 'a3', ts: d2 + 'T08:00:00Z', date: d2, userId: 'u1', taskType: 'clock', taskName: '签到', goldDelta: 5, silverDelta: 0, expDelta: 0, goldAfter: 35, silverAfter: 0, expAfter: 0, levelAfter: null, success: true, message: '' });
  const series = dailyAssetSeries(db, 7);
  const s1 = series.find((x) => x.date === d1);
  const s2 = series.find((x) => x.date === d2);
  assert.ok(s1, '应含昨天（快照日）');
  assert.ok(s2, '应含今天');
  assert.equal(s1.goldDelta, 30, '第1天增量=10+20=30');
  assert.equal(s1.goldTotal, 30, '第1天累计=快照30（旧实现会双算成60）');
  assert.equal(s2.goldDelta, 5, '第2天增量=5');
  assert.equal(s2.goldTotal, 35, '第2天累计=30+5=35（误差不向后传播）');
});

test('M-02 多账号部分快照：不把"部分账号快照"误当"全体总量"而丢失其他账号', () => {
  const db = freshDb();
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  const d1 = localDateStr(y); // 昨天：u2 入账 +50，无快照
  const d2 = localDateStr(today); // 今天：仅 u1 有快照（gold=100），u2 无快照、无当日账本
  db.assetLedger.push({ id: 'b1', ts: d1 + 'T08:00:00Z', date: d1, userId: 'u2', taskType: 'clock', taskName: '签到', goldDelta: 50, silverDelta: 0, expDelta: 0, goldAfter: 50, silverAfter: 0, expAfter: 0, levelAfter: null, success: true, message: '' });
  db.assetSnapshots.push({ userId: 'u1', date: d2, gold: 100, silver: 0, exp: 0, level: null });
  const series = dailyAssetSeries(db, 7);
  const s2 = series.find((x) => x.date === d2);
  assert.ok(s2, '应含今天');
  // 修复前：snap.has 因 u1 有快照而为真，run 被重置为 u1 的 100，u2 的 50 从历史曲线消失 → 总 100。
  // 修复后：u2 无快照则 carry forward，total = u1 快照(100) + u2 余额(50) = 150。
  assert.equal(s2.goldTotal, 150, '部分快照不得丢失其他账号的历史余额');
  const s1 = series.find((x) => x.date === d1);
  assert.equal(s1.goldTotal, 50, '昨天仅 u2 的 50 入账');
});

test('M-02 多账号：既有快照账号不双算、无快照账号正常累加', () => {
  const db = freshDb();
  const today = new Date();
  const d2 = localDateStr(today);
  // u1：当日账本 +10 且有快照 110（快照为权威总额，不得 +10 双算）
  db.assetLedger.push({ id: 'c1', ts: d2 + 'T08:00:00Z', date: d2, userId: 'u1', taskType: 'clock', taskName: '签到', goldDelta: 10, silverDelta: 0, expDelta: 0, goldAfter: 110, silverAfter: 0, expAfter: 0, levelAfter: null, success: true, message: '' });
  db.assetSnapshots.push({ userId: 'u1', date: d2, gold: 110, silver: 0, exp: 0, level: null });
  // u2：仅当日账本 +20，无快照（正常累加）
  db.assetLedger.push({ id: 'c2', ts: d2 + 'T09:00:00Z', date: d2, userId: 'u2', taskType: 'point', taskName: '点赞', goldDelta: 20, silverDelta: 0, expDelta: 0, goldAfter: 20, silverAfter: 0, expAfter: 0, levelAfter: null, success: true, message: '' });
  const series = dailyAssetSeries(db, 1);
  assert.equal(series[0].goldTotal, 130, 'u1 快照(110) + u2 累加(20) = 130，u1 不双算');
});

// M-08 修复：窗口前最后一个快照应作为曲线首日期初余额，而非从 0 起算。
// 审计复现：31 天前余额 100/50/20，请求 30 天曲线（窗口内无任何活动）时，
// 首日与末日总额此前均错误返回 0。
test('M-08 期初余额：窗口前最后快照作为首日余额，而非从 0 起算', () => {
  const db = freshDb();
  const today = new Date();
  const dPrev = new Date(today);
  dPrev.setDate(today.getDate() - 31); // 落在 30 天窗口之前
  db.users.push({ id: 'u1', nickname: '甲', assets: { gold: 100, silver: 50, exp: 20, level: null } });
  db.assetSnapshots.push({ userId: 'u1', date: localDateStr(dPrev), gold: 100, silver: 50, exp: 20, level: null });
  const series = dailyAssetSeries(db, 30);
  assert.equal(series.length, 30);
  const first = series[0];
  const last = series[series.length - 1];
  // 窗口内无活动 → 余额应 carry forward 窗口前快照值，首日/末日均等于 100/50/20
  assert.equal(first.goldTotal, 100, '首日 goldTotal 应为窗口前余额 100');
  assert.equal(first.silverTotal, 50, '首日 silverTotal 应为窗口前余额 50');
  assert.equal(first.expTotal, 20, '首日 expTotal 应为窗口前余额 20');
  assert.equal(last.goldTotal, 100, '末日 goldTotal 仍为 100');
  assert.equal(last.silverTotal, 50, '末日 silverTotal 仍为 50');
  assert.equal(last.expTotal, 20, '末日 expTotal 仍为 20');
});

// M-08 补充：期初余额之上叠加窗口内增量，累计应正确累加而非被期初吞没/重置。
test('M-08 期初余额 + 窗口内增量在上沿正确累加', () => {
  const db = freshDb();
  const today = new Date();
  const dPrev = new Date(today);
  dPrev.setDate(today.getDate() - 31);
  const dMid = new Date(today);
  dMid.setDate(today.getDate() - 15); // 落在窗口内
  db.users.push({ id: 'u1', nickname: '甲', assets: { gold: 100, silver: 0, exp: 0, level: null } });
  db.assetSnapshots.push({ userId: 'u1', date: localDateStr(dPrev), gold: 100, silver: 0, exp: 0, level: null });
  // 窗口内第 15 天入账 +30（无快照，靠累加）
  db.assetLedger.push({
    id: 'a1', ts: localDateStr(dMid) + 'T08:00:00Z', date: localDateStr(dMid), userId: 'u1',
    taskType: 'clock', taskName: '签到', goldDelta: 30, silverDelta: 0, expDelta: 0,
    goldAfter: 130, silverAfter: 0, expAfter: 0, levelAfter: null, success: true, message: ''
  });
  const series = dailyAssetSeries(db, 30);
  const first = series[0];
  const mid = series.find((x) => x.date === localDateStr(dMid));
  const last = series[series.length - 1];
  assert.equal(first.goldTotal, 100, '首日仍为期初 100');
  assert.equal(mid.goldTotal, 130, '窗口内增量后累计 130');
  assert.equal(last.goldTotal, 130, '末日累计保持 130');
});

// M-09 修复：资产曲线窗口按「配置时区(ZDM_TZ)」折算，末日应为 tz 的今天而非进程本地今天，
// 避免 UTC 容器与 Asia/Shanghai 并存时资产日报归属与状态页"今天"跨日冲突。
test('M-09 资产曲线窗口末日对齐到配置时区当天', () => {
  const db = freshDb();
  const series = dailyAssetSeries(db, 7, null, 'Asia/Shanghai');
  assert.equal(series.length, 7);
  assert.equal(series[series.length - 1].date, todayStrTZ('Asia/Shanghai'));
});

test('M-09 资产曲线包含 tz 当天数据（而非仅进程本地当天）', () => {
  const db = freshDb();
  const tz = 'Asia/Shanghai';
  const tzToday = todayStrTZ(tz);
  db.users.push({ id: 'u1', nickname: '甲', assets: { gold: 50, silver: 0, exp: 0, level: null } });
  db.assetSnapshots.push({ userId: 'u1', date: tzToday, gold: 50, silver: 0, exp: 0, level: null });
  const series = dailyAssetSeries(db, 7, null, tz);
  const point = series.find((x) => x.date === tzToday);
  assert.ok(point, 'tz 当天应出现在曲线窗口内');
  assert.equal(point.goldTotal, 50);
});
