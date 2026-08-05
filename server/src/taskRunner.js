import { smzdm } from './smzdm/adapter.js';
import { applyClock } from './clockCore.js';
import { withWriteLock, persist } from './store.js';

// 统一的任务执行逻辑：手动触发（POST /api/tasks/:id/run）与定时调度（scheduler）共用，
// 避免逻辑重复。只负责「调用适配器执行动作」，不负责写库——
// 由调用方根据返回结果更新 lastRun / lastResult / status。

const COUNT_MAX = 5; // 防滥用：单次任务动作次数上限

export async function runTask(task, db, opts = {}) {
  const { userId, count } = opts;
  const safeCount = Math.min(COUNT_MAX, Math.max(1, Number(count) || 1));
  const user = userId ? db.users.find((u) => u.id === userId) : db.users[0];
  if (!user) {
    return { ok: false, error: 'no_user', message: '请先添加 smzdm 账号' };
  }
  let result;
  if (task.type === 'comment') result = await smzdm.doComment(user.cookie, { count: safeCount });
  else if (task.type === 'favorite') result = await smzdm.doFavorite(user.cookie, { count: safeCount });
  else if (task.type === 'point') result = await smzdm.doPoint(user.cookie, { count: safeCount });
  else {
    // 签到类型：真正落库（N1），与手动签到共用 applyClock
    result = await smzdm.doClockIn(user.cookie);
    if (!result.success) return { ok: false, error: 'clock_failed', message: result.message };
    const clock = await withWriteLock(() => {
      const c = applyClock(user, result, db);
      if (!c.duplicate) persist();
      return c;
    });
    return { ok: true, result, user, clock };
  }
  return { ok: true, result, user };
}
