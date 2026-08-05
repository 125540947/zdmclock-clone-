import { smzdm } from './smzdm/adapter.js';

// 统一的任务执行逻辑：手动触发（POST /api/tasks/:id/run）与定时调度（scheduler）共用，
// 避免逻辑重复。只负责「调用适配器执行动作」，不负责写库——
// 由调用方根据返回结果更新 lastRun / lastResult / status。

export async function runTask(task, db, opts = {}) {
  const { userId, count } = opts;
  const user = userId ? db.users.find((u) => u.id === userId) : db.users[0];
  if (!user) {
    return { ok: false, error: 'no_user', message: '请先添加 smzdm 账号' };
  }
  let result;
  if (task.type === 'comment') result = await smzdm.doComment(user.cookie, { count });
  else if (task.type === 'favorite') result = await smzdm.doFavorite(user.cookie, { count });
  else if (task.type === 'point') result = await smzdm.doPoint(user.cookie, { count });
  else result = await smzdm.doClockIn(user.cookie);
  return { ok: true, result, user };
}
