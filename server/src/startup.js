// 智能启动调度
//
// 设计目标：每个账号每天由系统在各自错峰的「启动时间」自动跑完其完整日常流水线
// （签到 → 已启用的互动/抽奖/转盘/众测/每日任务/关注/分享），用户也可手动指定启动时间。
//
// 第一定律：多个账号绝不在同一时刻并发启动，避免把 VPS / smzdm 打爆导致卡顿或限流。
// 实现：① 系统自动模式用 assignAutoCheckInTime 把各账号哈希散列到窗口内不同分钟（天然错峰）；
//       ② 账号之间再用固定间隔 + 随机抖动串行启动；③ 每个账号每天仅启动一次（lastStartupDate 去重）。
//
// 幂等：签到本身幂等（applyClock 查今日记录），流水线单任务失败不阻断其余任务。

import { persist, withWriteLock, todayStr } from './store.js';
import { runTask } from './taskRunner.js';
import { resolvedCheckInTime, parseHM, ACCOUNT_PIPELINE_TYPES } from './clockSchedule.js';
import { config } from './config.js';
import { notify } from './notifier.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 运行「智能启动调度」：遍历全部参与账号，对在「今日启动时间窗口内」且「尚未跑过」的账号，
// 启动其完整日常流水线。由调度器每分钟触发一次，但绝大多数 tick 因「未到时间/已跑过」直接跳过。
export async function runStartupForAccounts(db) {
  const today = todayStr();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const grace = config.startupGraceMin != null ? config.startupGraceMin : config.catchupGraceMin || 30;

  const accounts = (db.users || []).filter(
    (u) => u.cookie && u.autoRun !== false && !u.cookieExpired
  );
  if (!accounts.length) {
    return { ok: true, ran: 0, message: '没有参与智能启动调度的账号' };
  }

  let ran = 0;
  const errors = [];
  for (let i = 0; i < accounts.length; i++) {
    const u = accounts[i];
    const who = u.nickname || u.smzdmId || u.id;

    // 今日已启动过 → 跳过（幂等，避免每个 tick 反复重试）
    if (u.lastStartupDate === today) continue;

    // 解析该账号启动时间（auto=系统错峰分配；manual=自定义）
    const hm = resolvedCheckInTime(u);
    const p = parseHM(hm);
    if (!p) continue;
    const umin = p.h * 60 + p.mi;

    // 未到启动时间 → 跳过；已过宽限窗（服务宕机/休眠太久）→ 跳过今天，避免补签风暴
    if (umin > nowMin) continue;
    if (nowMin - umin > grace) continue;

    // 第一定律：账号间错峰。从第 2 个账号起加固定间隔 + 随机抖动，避免同秒并发。
    if (i > 0) {
      const jitter = Math.floor(Math.random() * (config.clockStaggerJitterMs + 1));
      await sleep(config.clockStaggerMs + jitter);
    }

    try {
      await runAccountPipeline(u, db);
      u.lastStartupDate = today; // 先标记已尝试，失败也记，避免死循环重试
      await withWriteLock(() => persist());
      ran++;
    } catch (e) {
      u.lastStartupDate = today;
      await withWriteLock(() => persist());
      errors.push(`${who}: ${e.message}`);
    }
  }

  const ok = errors.length === 0;
  const message =
    `智能启动调度：${ran}/${accounts.length} 个账号已启动` +
    (errors.length ? `，${errors.length} 个异常` : '');
  if (ran > 0 || errors.length) {
    notify(db, {
      title: ok ? '🚀 智能启动调度完成' : '⚠️ 智能启动调度完成（有异常）',
      message
    }).catch(() => {});
  }
  return { ok, ran, message, errors };
}

// 单个账号的完整日常流水线：按 db.tasks 中「已启用且属于账号级流水线」的任务依次执行。
// 任务间加小抖动进一步平滑请求节奏；单任务失败不阻断该账号其余任务。
async function runAccountPipeline(u, db) {
  const enabled = (db.tasks || []).filter(
    (t) => t.enabled && ACCOUNT_PIPELINE_TYPES.has(t.type)
  );
  for (const t of enabled) {
    try {
      await runTask(t, db, { userId: u.id, scheduled: true });
    } catch {
      // 单任务异常由各自 runTask 内部已处理/记录，这里仅防止阻断后续任务
    }
    const jitter = Math.floor(Math.random() * 800);
    await sleep(400 + jitter);
  }
}
