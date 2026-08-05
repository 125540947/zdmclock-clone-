import { load, persist, todayStr } from './store.js';
import { runTask } from './taskRunner.js';

// 轻量定时调度器（零依赖）：
// - 内置一个最小 cron 求值器，支持 * / */n / a-b / a,b
// - 每 30s 轮询一次，命中 cron 且本分钟尚未执行的已启用任务会被自动运行
// - 执行结果回写任务的 lastRun / lastResult / status
// 适合个人单机部署；如需高可用/多实例，请改用外部调度（如系统 cron / k8s CronJob）。

let timer = null;
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

function tick() {
  const db = load();
  const now = new Date();
  const minuteKey = Math.floor(now.getTime() / 60000);
  const today = todayStr();
  for (const t of db.tasks) {
    if (!t.enabled || !t.cron) continue;
    if (!cronMatch(t.cron, now)) continue;
    if (lastFiredMinute[t.id] === minuteKey) continue; // 本分钟已触发，跳过
    lastFiredMinute[t.id] = minuteKey;
    runTask(t, db)
      .then((r) => {
        if (r.ok) {
          t.lastRun = today;
          t.lastResult = r.result.message;
          t.status = 'done';
        } else {
          t.lastResult = r.message;
          t.status = 'error';
        }
        persist();
      })
      .catch((e) => {
        t.lastResult = e.message;
        t.status = 'error';
        persist();
      });
  }
}

export function startScheduler() {
  stopScheduler();
  timer = setInterval(tick, 30_000);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
