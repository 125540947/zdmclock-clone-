// 资产账本（模块 A 落账、模块 B 读取的共享数据层）
//
// 这是 A 与 B 协同的"数据中转站"：
//  - 模块 A（任务执行：签到/评论/收藏/点赞/抽奖/关注…）每次资产相关动作都经 applyAssetEffect
//    写入一条账本事件，并刷新 user.assets 与每日快照；
//  - 模块 B（资产仪表盘）直接聚合本账本，渲染日收益曲线、任务贡献、当前资产，无需各自维护数据源。
//
// 数据来源说明：增量优先取 smzdm 权威接口 getUserInfo 刷新后的"前后差额"；
// 签到等明确返回增量的动作使用显式增量；其余任务靠刷新差额，保证不造假、可追溯。

import { genId, todayStr, localDateStr } from './store.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// 任务类型 → 友好名称（仪表盘与账本展示用）
const TASK_NAMES = {
  clock: '每日签到',
  comment: '自动评论',
  favorite: '自动收藏',
  point: '自动点赞',
  baoliao: '好价爆料',
  lottery: '每日抽奖',
  turntable: '转盘抽奖',
  crowdtest: '众测申请',
  follow: '自动关注',
  share: '自动分享'
};
export function taskNameOf(type) {
  return TASK_NAMES[type] || type;
}

// 写入一条账本事件 + 更新每日快照（不负责 user.assets，交由 applyAssetEffect 统一处理）
function recordAssetEvent(db, ev) {
  if (!db.assetLedger) db.assetLedger = [];
  const entry = {
    id: genId('a'),
    ts: new Date().toISOString(),
    date: todayStr(),
    userId: ev.userId,
    taskType: ev.taskType,
    taskName: ev.taskName || taskNameOf(ev.taskType),
    goldDelta: round2(ev.goldDelta),
    silverDelta: round2(ev.silverDelta),
    expDelta: round2(ev.expDelta),
    goldAfter: ev.goldAfter != null ? round2(ev.goldAfter) : null,
    silverAfter: ev.silverAfter != null ? round2(ev.silverAfter) : null,
    expAfter: ev.expAfter != null ? round2(ev.expAfter) : null,
    levelAfter: ev.levelAfter != null ? ev.levelAfter : null,
    success: !!ev.success,
    message: ev.message || ''
  };
  db.assetLedger.push(entry);
  // R5：限制账本上限，避免长期运行后 db.json 无限膨胀
  if (db.assetLedger.length > 5000) db.assetLedger.splice(0, db.assetLedger.length - 5000);

  // 每日快照：每用户每天保留最新总额（用于日收益曲线锚定历史总量）
  if (!db.assetSnapshots) db.assetSnapshots = [];
  const today = entry.date;
  let snap = db.assetSnapshots.find((s) => s.userId === ev.userId && s.date === today);
  if (!snap) {
    snap = { userId: ev.userId, date: today, gold: null, silver: null, exp: null, level: null };
    db.assetSnapshots.push(snap);
  }
  if (ev.goldAfter != null) snap.gold = round2(ev.goldAfter);
  if (ev.silverAfter != null) snap.silver = round2(ev.silverAfter);
  if (ev.expAfter != null) snap.exp = round2(ev.expAfter);
  if (ev.levelAfter != null) snap.level = ev.levelAfter;
  return entry;
}

// 统一落账（A→B 核心）：计算前后资产差额、刷新 user.assets、写账本与快照。
// opts:
//   explicit: { gold, silver, exp, level } —— 动作明确返回的增量（如签到 +N 金币），优先使用；
//             任一键存在则以它为增量，避免依赖刷新差额（mock 演示与真实都准确）。
//   after:    { gold, silver, exp, level } —— 来自 getUserInfo 的权威"之后"总额；
//             仅当对应键无 explicit 时，用其前后差额作为增量。缺失则视为无变化。
//   success / message
// 返回计算后的 { goldDelta, silverDelta, expDelta, goldAfter, silverAfter, expAfter, levelAfter }
export function applyAssetEffect(db, user, taskType, taskName, opts = {}) {
  const { explicit, after, success = true, message = '' } = opts;
  const before = user.assets || { gold: 0, silver: 0, exp: 0, level: null };
  const goldBefore = Number(before.gold) || 0;
  const silverBefore = Number(before.silver) || 0;
  const expBefore = Number(before.exp) || 0;
  const levelBefore = before.level != null ? before.level : null;

  const exGold = explicit && explicit.gold != null ? Number(explicit.gold) : null;
  const exSilver = explicit && explicit.silver != null ? Number(explicit.silver) : null;
  const exExp = explicit && explicit.exp != null ? Number(explicit.exp) : null;

  // 增量：优先用显式值；缺失时退回"刷新前后差额"；再缺失则为 0（不造假）
  const goldDelta = exGold != null ? exGold : after && after.gold != null ? round2(after.gold - goldBefore) : 0;
  const silverDelta = exSilver != null ? exSilver : after && after.silver != null ? round2(after.silver - silverBefore) : 0;
  const expDelta = exExp != null ? exExp : after && after.exp != null ? round2(after.exp - expBefore) : 0;

  const goldAfter = goldBefore + goldDelta;
  const silverAfter = silverBefore + silverDelta;
  const expAfter = expBefore + expDelta;
  const levelAfter = explicit && explicit.level != null ? explicit.level : after && after.level != null ? after.level : levelBefore;

  // 刷新 user.assets（与旧字段 user.points 保持一致：签到 gold 即 points）
  user.assets = {
    gold: goldAfter,
    silver: silverAfter,
    exp: expAfter,
    level: levelAfter,
    updatedAt: new Date().toISOString()
  };
  if (taskType === 'clock') user.points = goldAfter;

  recordAssetEvent(db, {
    userId: user.id,
    taskType,
    taskName,
    goldDelta,
    silverDelta,
    expDelta,
    goldAfter,
    silverAfter,
    expAfter,
    levelAfter,
    success,
    message
  });
  return { goldDelta, silverDelta, expDelta, goldAfter, silverAfter, expAfter, levelAfter };
}

// 资产总览：每用户当前资产 + 今日增量 + 连击/累计；含全局合计
// visibleIds：可选 Set<userId>；传入时仅统计该集合内账号（OPEN_MODE 按 /24 网段隔离），null/省略=全部。
export function summarizeAssets(db, visibleIds = null) {
  const users = (db.users || []).filter((u) => !visibleIds || visibleIds.has(u.id));
  const ledger = db.assetLedger || [];
  const today = todayStr();
  const perUser = users.map((u) => {
    const todayEntries = ledger.filter((e) => e.userId === u.id && e.date === today);
    const td = todayEntries.reduce(
      (a, e) => ({
        gold: a.gold + (e.goldDelta || 0),
        silver: a.silver + (e.silverDelta || 0),
        exp: a.exp + (e.expDelta || 0)
      }),
      { gold: 0, silver: 0, exp: 0 }
    );
    return {
      id: u.id,
      nickname: u.nickname || u.smzdmId || '未命名',
      assets: u.assets || { gold: 0, silver: 0, exp: 0, level: null },
      today: { gold: round2(td.gold), silver: round2(td.silver), exp: round2(td.exp) },
      streak: u.streak || 0,
      totalClockIn: u.totalClockIn || 0,
      cookieExpired: !!u.cookieExpired
    };
  });
  const totals = perUser.reduce(
    (a, u) => ({
      gold: a.gold + (u.assets.gold || 0),
      silver: a.silver + (u.assets.silver || 0),
      exp: a.exp + (u.assets.exp || 0)
    }),
    { gold: 0, silver: 0, exp: 0 }
  );
  return {
    users: perUser,
    totals: {
      gold: round2(totals.gold),
      silver: round2(totals.silver),
      exp: round2(totals.exp),
      users: perUser.length
    },
    generatedAt: new Date().toISOString()
  };
}

// 日收益序列（含累计总量）：返回最近 days 天，每天 { date, 各增量, 各累计 }
// visibleIds：可选 Set<userId>；传入时仅统计该集合内账号（OPEN_MODE 按 /24 网段隔离），null/省略=全部。
export function dailyAssetSeries(db, days = 30, visibleIds = null) {
  const ledger = db.assetLedger || [];
  const snaps = db.assetSnapshots || [];
  const base = new Date();
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(base);
    dt.setDate(base.getDate() - i);
    dates.push(localDateStr(dt));
  }
  const deltaByDate = {};
  for (const e of ledger) {
    if (visibleIds && !visibleIds.has(e.userId)) continue;
    if (!deltaByDate[e.date]) deltaByDate[e.date] = { gold: 0, silver: 0, exp: 0 };
    deltaByDate[e.date].gold += e.goldDelta || 0;
    deltaByDate[e.date].silver += e.silverDelta || 0;
    deltaByDate[e.date].exp += e.expDelta || 0;
  }
  // 每日快照（跨用户求和），用于锚定累计总量、修正漂移
  const snapByDate = {};
  for (const s of snaps) {
    if (visibleIds && !visibleIds.has(s.userId)) continue;
    if (!snapByDate[s.date]) snapByDate[s.date] = { gold: 0, silver: 0, exp: 0, has: false };
    snapByDate[s.date].gold += s.gold || 0;
    snapByDate[s.date].silver += s.silver || 0;
    snapByDate[s.date].exp += s.exp || 0;
    snapByDate[s.date].has = true;
  }
  const series = [];
  let run = { gold: 0, silver: 0, exp: 0 };
  for (const date of dates) {
    if (snapByDate[date] && snapByDate[date].has) {
      run = {
        gold: snapByDate[date].gold,
        silver: snapByDate[date].silver,
        exp: snapByDate[date].exp
      };
    }
    const d = deltaByDate[date] || { gold: 0, silver: 0, exp: 0 };
    series.push({
      date,
      goldDelta: round2(d.gold),
      silverDelta: round2(d.silver),
      expDelta: round2(d.exp),
      goldTotal: round2(run.gold + d.gold),
      silverTotal: round2(run.silver + d.silver),
      expTotal: round2(run.exp + d.exp)
    });
    run = { gold: run.gold + d.gold, silver: run.silver + d.silver, exp: run.exp + d.exp };
  }
  return series;
}

// 任务贡献统计：最近 days 天内，各任务类型累计的增量与执行次数
// visibleIds：可选 Set<userId>；传入时仅统计该集合内账号（OPEN_MODE 按 /24 网段隔离），null/省略=全部。
export function assetByTask(db, days = 30, visibleIds = null) {
  const ledger = db.assetLedger || [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffStr = localDateStr(cutoff);
  const map = {};
  for (const e of ledger) {
    if (visibleIds && !visibleIds.has(e.userId)) continue;
    if (e.date < cutoffStr) continue;
    if (!map[e.taskType]) {
      map[e.taskType] = { taskType: e.taskType, taskName: taskNameOf(e.taskType), count: 0, goldDelta: 0, silverDelta: 0, expDelta: 0 };
    }
    const m = map[e.taskType];
    m.count += 1;
    m.goldDelta += e.goldDelta || 0;
    m.silverDelta += e.silverDelta || 0;
    m.expDelta += e.expDelta || 0;
  }
  return Object.values(map)
    .map((m) => ({
      ...m,
      goldDelta: round2(m.goldDelta),
      silverDelta: round2(m.silverDelta),
      expDelta: round2(m.expDelta)
    }))
    .sort((a, b) => b.goldDelta + b.expDelta - (a.goldDelta + a.expDelta));
}

// 最近账本明细（带昵称）
// visibleIds：可选 Set<userId>；传入时仅统计该集合内账号（OPEN_MODE 按 /24 网段隔离），null/省略=全部。
export function recentLedger(db, limit = 50, visibleIds = null) {
  const ledger = db.assetLedger || [];
  const userMap = Object.fromEntries((db.users || []).map((u) => [u.id, u.nickname || u.smzdmId || '未知']));
  return [...ledger]
    .filter((e) => !visibleIds || visibleIds.has(e.userId))
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, limit)
    .map((e) => ({ ...e, nickname: userMap[e.userId] || '未知' }));
}

export { recordAssetEvent };
