// 任务执行明细持久化 + 查询 / 汇总。
// 这是「每天哪些任务做了、哪些失败、失败原因是什么」能力的核心：
//   - recordTaskRun：每次 runTask 结束时（写锁内）追加一条结构化记录到 db.taskRuns 并落盘；
//   - filterTaskRuns / summarizeTaskRuns：纯函数，按日期 / 任务 / 账号过滤并聚合，
//     供 tools/taskReport.mjs CLI 与（未来）前端状态页共用，零 IO 依赖。
import { withWriteLock, persist } from './store.js';

// 滚动保留上限：约 3000 条 ≈ 每日数十条运行记录可保留 2~3 个月，
// 既满足「回看失败原因」需求，又避免 db.json 无限膨胀。
const MAX_TASK_RUNS = 3000;

// 单条运行记录形态（persist 到 db.taskRuns）：
//   id / taskId / taskName / type / userId('all'|具体id|null)
//   date(配置时区 YYYY-MM-DD) / startedAt / finishedAt
//   ok / partial / skipped
//   message(完整文本，同 lastResult) / perUser[](各账号一行文本)
//   reasons[]: { action, articleId, error_msg, user }  ← 结构化失败原因
//   details[]: { articleId, title, action, comment, ok, message }  ← 评论等互动逐篇明细（"显示回复详情"）
export function buildTaskRunRecord({
  taskId,
  taskName,
  type,
  userId,
  date,
  startedAt,
  ok,
  partial,
  skipped,
  message,
  perUser,
  reasons,
  details
}) {
  return {
    id: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    taskId,
    taskName,
    type,
    userId: userId ?? null,
    date: date || null,
    startedAt: startedAt || new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    ok: !!ok,
    partial: !!partial,
    skipped: !!skipped,
    message: message || '',
    perUser: Array.isArray(perUser) ? perUser : [],
    reasons: Array.isArray(reasons) ? reasons : [],
    details: Array.isArray(details) ? details : []
  };
}

// 写锁内追加一条运行记录并落盘（调用方无需再次 persist）。
// 失败不影响主流程（调用方已 .catch 吞掉），避免日志写入异常阻断任务本身。
export async function recordTaskRun(db, raw) {
  const record = buildTaskRunRecord(raw);
  await withWriteLock(() => {
    if (!Array.isArray(db.taskRuns)) db.taskRuns = [];
    db.taskRuns.push(record);
    if (db.taskRuns.length > MAX_TASK_RUNS) {
      db.taskRuns = db.taskRuns.slice(-MAX_TASK_RUNS);
    }
    persist();
  });
  return record;
}

// 纯函数：按条件过滤运行记录（不依赖 db / 不触发 IO）。
// opts: { date, taskId, userId, onlyFailed }
export function filterTaskRuns(taskRuns, { date, taskId, userId, onlyFailed } = {}) {
  let list = Array.isArray(taskRuns) ? taskRuns.slice() : [];
  if (date) list = list.filter((r) => r.date === date);
  if (taskId) list = list.filter((r) => r.taskId === taskId);
  if (userId) list = list.filter((r) => r.userId === userId || r.userId === 'all');
  if (onlyFailed) list = list.filter((r) => !r.ok && !r.skipped);
  // 按 finishedAt 升序，便于「时间线」展示
  list.sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));
  return list;
}

// 纯函数：按日期（可空=全部）聚合为可读摘要，供 CLI / 状态页使用。
// 返回 { date, total, ok, failed, skipped, partial, byTask[], allReasons[] }
export function summarizeTaskRuns(taskRuns, date) {
  const list = filterTaskRuns(taskRuns, { date, onlyFailed: false });
  const byTask = new Map();
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let partial = 0;
  for (const r of list) {
    if (r.skipped) skipped += 1;
    else if (!r.ok) failed += 1;
    else if (r.partial) {
      partial += 1;
      ok += 1;
    } else ok += 1;

    if (!byTask.has(r.taskId)) {
      byTask.set(r.taskId, {
        taskId: r.taskId,
        taskName: r.taskName,
        type: r.type,
        runs: 0,
        ok: 0,
        failed: 0,
        skipped: 0,
        reasons: []
      });
    }
    const agg = byTask.get(r.taskId);
    agg.runs += 1;
    if (r.skipped) agg.skipped += 1;
    else if (!r.ok) agg.failed += 1;
    else agg.ok += 1;
    for (const reason of r.reasons || []) {
      agg.reasons.push({
        ...reason,
        date: r.date,
        finishedAt: r.finishedAt,
        taskName: r.taskName
      });
    }
  }
  return {
    date: date || '(全部)',
    total: list.length,
    ok,
    failed,
    skipped,
    partial,
    byTask: [...byTask.values()],
    allReasons: list.flatMap((r) =>
      (r.reasons || []).map((x) => ({ ...x, date: r.date, taskName: r.taskName }))
    )
  };
}
