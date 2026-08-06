import { load, persist, withWriteLock, todayStr } from './store.js';
import { runTask } from './taskRunner.js';
import { notify } from './notifier.js';
import { config } from './config.js';
import { zonedWallClock } from './clockSchedule.js';

// 轻量定时调度器（零依赖）：
// - 内置一个最小 cron 求值器，支持 * / */n / a-b / a,b
// - 每 30s 轮询一次，命中 cron 且本分钟尚未执行的已启用任务会被自动运行
// - 执行结果回写任务的 lastRun / lastResult / status
// 适合个人单机部署；如需高可用/多实例，请改用外部调度（如系统 cron / k8s CronJob）。

let timer = null;
let schedulerRunning = false;
const lastFiredMinute = {}; // taskId -> 分钟时间戳，用于同一分钟内去重

// 单字段匹配：支持 * 、*/n 、a-b 、a,b,c
function fieldMatch(field, val, min, max) {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    if (!(step > 0)) return false;
    return val >= min && (val - min) % step === 0;
  }
  return String(field)
    .split(',')
    .some((p) => {
      if (p.includes('-')) {
        const [a, b] = p.split('-').map((x) => parseInt(x, 10));
        return val >= a && val <= b;
      }
      return parseInt(p, 10) === val;
    });
}

// 校验单个 cron 字段语法是否合法（严格，含取值范围）
function validateField(field, min, max) {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return Number.isInteger(step) && step > 0;
  }
  return String(field)
    .split(',')
    .every((p) => {
      if (p === '') return false;
      if (p.includes('-')) {
        const parts = p.split('-');
        if (parts.length !== 2) return false;
        const a = parseInt(parts[0], 10);
        const b = parseInt(parts[1], 10);
        return (
          Number.isInteger(a) &&
          Number.isInteger(b) &&
          a >= min &&
          a <= max &&
          b >= min &&
          b <= max &&
          a <= b
        );
      }
      const n = parseInt(p, 10);
      return Number.isInteger(n) && n >= min && n <= max;
    });
}

// 校验整条 cron 表达式（5 段）语法是否合法。
// 用于接口入参校验：非法 cron 会被 cronMatch 永远判为不命中（静默永不触发），
// 因此在写入前就必须拒绝（b3）。
export function validateCron(expr) {
  const f = String(expr || '').trim().split(/\s+/);
  if (f.length !== 5) return false;
  const ranges = [
    [0, 59], // 分
    [0, 23], // 时
    [1, 31], // 日
    [1, 12], // 月
    [0, 6], // 周
  ];
  return f.every(
    (field, i) => field !== '' && validateField(field, ranges[i][0], ranges[i][1])
  );
}

// 标准 5 段 cron 求值：分 时 日 月 周
export function cronMatch(expr, date = new Date()) {
  const f = String(expr || '').trim().split(/\s+/);
  if (f.length !== 5) return false;
  const [mF, hF, domF, monF, dowF] = f;
  return (
    fieldMatch(mF, date.getMinutes(), 0, 59) &&
    fieldMatch(hF, date.getHours(), 0, 23) &&
    fieldMatch(domF, date.getDate(), 1, 31) &&
    fieldMatch(monF, date.getMonth() + 1, 1, 12) &&
    fieldMatch(dowF, date.getDay(), 0, 6)
  );
}

export function tick() {
  try {
    const db = load();
    const now = new Date();
    const minuteKey = Math.floor(now.getTime() / 60000);
    const today = todayStr();
    // 按配置时区折算"墙上时间"用于 cron 求值，避免容器 UTC 导致任务在错误时刻触发
    const z = zonedWallClock(now, config.tz);
    const jobs = [];
    for (const t of db.tasks) {
      if (!t.enabled || !t.cron) continue;
      if (!cronMatch(t.cron, z)) continue;
      if (lastFiredMinute[t.id] === minuteKey) continue; // 本分钟已触发，跳过
      lastFiredMinute[t.id] = minuteKey;
      const job = runTask(t, db, { scheduled: true })
        .then((r) => {
          // 多账号部分成功（partial）视为完成（绿色），仅全部失败才标 error（红色）
          const ok = r.ok || r.partial;
          // 写锁内更新任务状态并落盘，避免与其他写请求互相覆盖（R2）
          return withWriteLock(() => {
            t.lastRun = today;
            t.lastResult = r.result ? r.result.message : r.message;
            t.status = ok ? 'done' : 'error';
            persist();
          }).then(() => {
            // 推送通知（best-effort，失败不影响主流程）
            const title = r.ok
              ? `✅ 任务完成 · ${t.name}`
              : r.partial
              ? `⚠️ 任务部分完成 · ${t.name}`
              : `❌ 任务失败 · ${t.name}`;
            return notify(db, {
              title,
              message: r.result ? r.result.message : r.message
            }).catch(() => {});
          });
        })
        .catch((e) => {
          return withWriteLock(() => {
            t.lastResult = e.message;
            t.status = 'error';
            persist();
          }).then(() => {
            return notify(db, { title: `❌ 任务异常 · ${t.name}`, message: e.message }).catch(() => {});
          });
        });
      jobs.push(job);
    }
    // 返回所有任务完成后的 Promise（allSettled 不拒绝），便于测试 await 与调用方感知结束
    return Promise.allSettled(jobs);
  } catch (e) {
    // b6：tick 内同步异常不应中断调度循环
    // eslint-disable-next-line no-console
    console.error('[scheduler] tick 异常:', e);
    return Promise.resolve();
  }
}

export function startScheduler() {
  stopScheduler();
  timer = setInterval(tick, 30_000);
  schedulerRunning = true;
  // 启动即补签一次：覆盖"服务宕机/休眠/刚部署"期间错过的签到（within 宽限窗）
  // best-effort，异常已被 tick 内部捕获，不影响主流程。
  tick().catch(() => {});
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  schedulerRunning = false;
}

export function isSchedulerRunning() {
  return schedulerRunning;
}
