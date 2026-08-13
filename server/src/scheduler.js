import { load, persist, withWriteLock, todayStr, todayStrTZ } from './store.js';
import { runTask } from './taskRunner.js';
import { notify } from './notifier.js';
import { config } from './config.js';
import { zonedWallClock, ACCOUNT_PIPELINE_TYPES } from './clockSchedule.js';
import { smzdm } from './smzdm/adapter.js';
import { checkAccounts } from './health.js';
import { getRepoState, checkUpdate, runUpdate, scheduleRestart, updateSupported } from './selfUpdate.js';

// 轻量定时调度器（零依赖）：
// - 内置一个最小 cron 求值器，支持 * / */n / a-b / a,b
// - 每 30s 轮询一次，命中 cron 且本分钟尚未执行的已启用任务会被自动运行
// - 执行结果回写任务的 lastRun / lastResult / status
// 适合个人单机部署；如需高可用/多实例，请改用外部调度（如系统 cron / k8s CronJob）。

let timer = null;
let schedulerRunning = false;
const lastFiredMinute = {}; // taskId -> 分钟时间戳，用于同一分钟内去重
let lastHealthMinute = 0; // 上次 Cookie 健康检测的"分钟"时间戳，用于节流
let lastUpdateCheckMinute = 0; // 上次仓库更新检查的"分钟"时间戳，用于节流

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
  const domMatch = fieldMatch(domF, date.getDate(), 1, 31);
  const dowMatch = fieldMatch(dowF, date.getDay(), 0, 6);
  // M-14 修复：POSIX cron 语义——当日（dom）与星期（dow）同时受限（均非 *）时取「任一匹配」，
  // 任一为 * 时仍按常规 AND。避免按通用 cron 习惯配置的表达式（如「每月 1 日与每周一」）少执行。
  const dayMatch = domF === '*' || dowF === '*' ? domMatch && dowMatch : domMatch || dowMatch;
  return (
    fieldMatch(mF, date.getMinutes(), 0, 59) &&
    fieldMatch(hF, date.getHours(), 0, 23) &&
    dayMatch &&
    fieldMatch(monF, date.getMonth() + 1, 1, 12)
  );
}

// 定时 Cookie 健康检测（仅 real 模式，按 cookieHealthIntervalMin 节流）：
// 检测所有账号 Cookie，失效即推送告警并标记 cookieExpired（best-effort，失败不影响调度）。
export async function runHealthCheck() {
  try {
    if (config.smzdmAdapter !== 'real') return; // mock 永远有效，探活无意义
    const db = load();
    if (!db.users.length) return;
    const minute = Math.floor(zonedWallClock(new Date(), config.tz).getTime() / 60000);
    if (minute - lastHealthMinute < (config.cookieHealthIntervalMin || 360)) return;
    lastHealthMinute = minute;
    const results = await checkAccounts(db, smzdm, {
      concurrency: config.healthConcurrency,
      onExpired: (u, reason) =>
        notify(db, {
          title: '🍪 Cookie 失效告警',
          message: `账号「${u.nickname || u.smzdmId || u.id}」Cookie 可能已失效：${reason}`
        })
    });
    await withWriteLock(() => persist());
    const bad = results.filter((r) => !r.valid).length;
    if (bad) {
      // eslint-disable-next-line no-console
      console.warn(`[health] ${bad}/${results.length} 个账号 Cookie 失效`);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[health] 检测异常:', e);
  }
}

// 定时仓库更新检查（仅 production，按 updateCheckIntervalMin 节流）：
// 检查本地是否落后于 origin；落后时若 AUTO_UPDATE_APPLY=true 则自动拉取+重建+重启，
// 否则仅推送"有可用更新"通知，由用户在「系统更新」页手动升级。非生产环境直接跳过（开发态无意义）。
export async function runUpdateCheck() {
  try {
    if (process.env.NODE_ENV !== 'production') return;
    if (config.updateCheckIntervalMin <= 0) return;
    const minute = Math.floor(zonedWallClock(new Date(), config.tz).getTime() / 60000);
    if (minute - lastUpdateCheckMinute < config.updateCheckIntervalMin) return;
    lastUpdateCheckMinute = minute;

    const state = await getRepoState();
    if (!updateSupported(state)) return;

    const r = await checkUpdate(state);
    if (!r.ok || r.behind === 0) return;

    const db = load();
    if (config.autoUpdateApply) {
      const res = await runUpdate({ restart: false });
      if (res.ok) {
        await notify(db, {
          title: '⬆️ 已自动更新',
          message: `已拉取 ${r.behind} 个新提交（${res.commitShort}），服务即将重启加载新版本。`
        }).catch(() => {});
        scheduleRestart(1500);
      } else {
        await notify(db, {
          title: '⚠️ 自动更新失败',
          message: res.error || '请到「系统更新」手动处理'
        }).catch(() => {});
      }
    } else {
      await notify(db, {
        title: '⬆️ 有可用更新',
        message: `检测到 ${r.behind} 个新提交（${r.remoteCommit.slice(0, 7)}），请到「系统更新」手动升级。`
      }).catch(() => {});
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[update] 检查异常:', e);
  }
}

export function tick() {
  try {
    // 定时 Cookie 健康检测（仅 real 模式，内部已按 cookieHealthIntervalMin 节流）。
    // 非阻塞：fire-and-forget，异常已被 runHealthCheck 内部捕获，不影响调度主流程。
    runHealthCheck().catch(() => {});
    // 定时仓库更新检查（仅 production，按 updateCheckIntervalMin 节流）。
    runUpdateCheck().catch(() => {});

    const db = load();
    const now = new Date();
    const minuteKey = Math.floor(now.getTime() / 60000);
    // M-09 修复：任务 lastRun 使用「配置时区」日期，与 cron 求值的 zonedWallClock 口径一致，
    // 避免容器 UTC 下任务执行日期落在 tz 前一天，导致状态页"今天"与任务日期跨日不一致。
    const today = todayStrTZ(config.tz);
    // 按配置时区折算"墙上时间"用于 cron 求值，避免容器 UTC 导致任务在错误时刻触发
    const z = zonedWallClock(now, config.tz);
    // 智能启动调度（t_startup）启用时，账号级每日流水线改由其按账号错峰统一跑，
    // 主调度不再对 clock/comment/favorite/point/... 这些类型按固定 cron 全员同刻触发，避免重复执行。
    const startupEnabled = (db.tasks || []).some((t) => t.type === 'startup' && t.enabled);
    const jobs = [];
    for (const t of db.tasks) {
      if (!t.enabled || !t.cron) continue;
      // 账号级流水线任务：智能启动调度接管时跳过（仍可手动在「自动任务」页单跑）
      if (startupEnabled && ACCOUNT_PIPELINE_TYPES.has(t.type)) continue;
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
