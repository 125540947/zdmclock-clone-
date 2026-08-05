import { genId, todayStr, localDateStr } from './store.js';

// 签到落库的单一事实来源：手动签到（routes/clock.js）与定时调度（scheduler/taskRunner）
// 都通过本函数写库，保证"自动每日签到"也会真正生成记录并更新用户金币/连续天数。
//
// 返回：{ duplicate: true } 表示今日已签到（幂等，不重复计）；
//       { duplicate: false, record } 表示本次新签到已写入。

// b1 修复：用本地日历计算"昨天"，避免 Date.now()-86400000 在 DST/跨月边界偏移
export function localYesterdayStr() {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return localDateStr(y);
}

export function applyClock(user, result, db) {
  const today = todayStr();
  if (db.clockRecords.some((r) => r.userId === user.id && r.date === today)) {
    return { duplicate: true };
  }
  const record = {
    id: genId('c'),
    userId: user.id,
    date: today,
    points: result.points || 0,
    createdAt: new Date().toISOString()
  };
  db.clockRecords.push(record);
  const ys = localYesterdayStr();
  user.streak = db.clockRecords.some((x) => x.userId === user.id && x.date === ys)
    ? (user.streak || 0) + 1
    : 1;
  user.totalClockIn = (user.totalClockIn || 0) + 1;
  user.points = (user.points || 0) + (result.points || 0);
  return { duplicate: false, record };
}
