// 资产账本（模块 A 落账、模块 B 读取的共享数据层）
//
// 这是 A 与 B 协同的"数据中转站"：
//  - 模块 A（任务执行：签到/评论/收藏/点赞/抽奖/关注…）每次资产相关动作都经 applyAssetEffect
//    写入一条账本事件，并刷新 user.assets 与每日快照；
//  - 模块 B（资产仪表盘）直接聚合本账本，渲染日收益曲线、任务贡献、当前资产，无需各自维护数据源。
//
// 数据来源说明：增量优先取 smzdm 权威接口 getUserInfo 刷新后的"前后差额"；
// 签到等明确返回增量的动作使用显式增量；其余任务靠刷新差额，保证不造假、可追溯。

import { genId, todayStr, localDateStr, todayStrTZ } from './store.js';
import { config } from './config.js';

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
// tz：窗口终点所用的时区（M-09），默认取 config.tz；传 null/'local'/'UTC' 时退回进程本地日期。
export function dailyAssetSeries(db, days = 30, visibleIds = null, tz = config.tz) {
  const ledger = db.assetLedger || [];
  const snaps = db.assetSnapshots || [];
  // M-09 修复：窗口以「配置时区」墙钟今天为终点，与签到/任务 lastRun 时区口径统一，
  // 避免容器 UTC 下资产日报归属与"今天"错位（跨日统计冲突）。
  // 注意 zonedWallClock 返回的是带 getter 的普通对象而非 Date，故这里用 todayStrTZ 取 tz 日历日，
  // 再以 UTC 日历日回推 days 天（日历日运算与时区无关），保证跨时区一致。
  const tzToday = tz && tz !== 'local' && tz !== 'UTC' ? todayStrTZ(tz) : localDateStr(new Date());
  const baseUTC = new Date(tzToday + 'T00:00:00Z');
  const ymd = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(baseUTC);
    dt.setUTCDate(baseUTC.getUTCDate() - i);
    dates.push(ymd(dt));
  }
  // 每账号每日起增量：deltaByUserDate[date][userId] = {gold,silver,exp}
  const deltaByUserDate = {};
  // 每账号每日快照：snapByUserDate[date][userId] = {gold,silver,exp|null}
  const snapByUserDate = {};
  const allUserIds = new Set();
  for (const e of ledger) {
    if (visibleIds && !visibleIds.has(e.userId)) continue;
    allUserIds.add(e.userId);
    if (!deltaByUserDate[e.date]) deltaByUserDate[e.date] = {};
    if (!deltaByUserDate[e.date][e.userId]) deltaByUserDate[e.date][e.userId] = { gold: 0, silver: 0, exp: 0 };
    deltaByUserDate[e.date][e.userId].gold += e.goldDelta || 0;
    deltaByUserDate[e.date][e.userId].silver += e.silverDelta || 0;
    deltaByUserDate[e.date][e.userId].exp += e.expDelta || 0;
  }
  for (const s of snaps) {
    if (visibleIds && !visibleIds.has(s.userId)) continue;
    allUserIds.add(s.userId);
    if (!snapByUserDate[s.date]) snapByUserDate[s.date] = {};
    snapByUserDate[s.date][s.userId] = {
      gold: s.gold != null ? s.gold : null,
      silver: s.silver != null ? s.silver : null,
      exp: s.exp != null ? s.exp : null
    };
  }
  const series = [];
  // 每账号累计余额（per-user run）：解决「部分账号快照重置总量」问题（M-02 修复）。
  //  - 有快照的账号：以快照值为权威当日总额（已含当日增量，不再 +delta，避免双算），
  //    同时不覆盖无快照账号的历史余额。
  //  - 无快照但有当日账本的账号：在上一日余额基础上累加当日 delta（carry forward）。
  //  - 无快照且无当日账本的账号：余额保持不变（carry forward）。
  // 每日 total = 所有 perUserRun 之和，确保部分账号快照不会令其他账号从历史曲线消失。
  // M-08 修复：用「窗口之前最后一个快照」作为期初余额，避免曲线首日从 0 起算。
  // 否则仅窗口内有快照/账本的账号才正确；窗口前已有余额（如 31 天前 100/50/20）、窗口内无活动的账号，
  // 首日与末日总额都会错误返回 0。窗口内的快照仍按 M-02 逻辑逐日锚定，不与此处冲突。
  const windowStart = dates[0]; // dates 按从旧到新排列，dates[0] 即窗口起点
  const openingByUser = {}; // userId -> {date,gold,silver,exp}，取窗口前最新一条快照
  for (const s of snaps) {
    if (visibleIds && !visibleIds.has(s.userId)) continue;
    if (s.date >= windowStart) continue; // 仅取窗口之前的快照作为期初
    const prev = openingByUser[s.userId];
    if (!prev || s.date > prev.date) {
      openingByUser[s.userId] = {
        date: s.date,
        // 快照某字段为 null（未知）时按 0 计入，避免 carry forward 时出现 NaN；
        // 窗口内若有该字段快照/账本会再修正。
        gold: s.gold != null ? s.gold : 0,
        silver: s.silver != null ? s.silver : 0,
        exp: s.exp != null ? s.exp : 0
      };
    }
  }
  const perUserRun = {};
  for (const userId of allUserIds) {
    const op = openingByUser[userId];
    perUserRun[userId] = op
      ? { gold: round2(op.gold), silver: round2(op.silver), exp: round2(op.exp) }
      : { gold: 0, silver: 0, exp: 0 };
  }
  for (const date of dates) {
    const snapsForDate = snapByUserDate[date] || {};
    const deltasForDate = deltaByUserDate[date] || {};
    for (const userId of allUserIds) {
      const prev = perUserRun[userId];
      const snap = snapsForDate[userId];
      if (snap) {
        // 快照为权威当日总额（已含当日增量）：直接锚定，不重复累加 delta
        perUserRun[userId] = {
          gold: snap.gold != null ? snap.gold : prev.gold,
          silver: snap.silver != null ? snap.silver : prev.silver,
          exp: snap.exp != null ? snap.exp : prev.exp
        };
      } else if (deltasForDate[userId]) {
        const ud = deltasForDate[userId];
        perUserRun[userId] = {
          gold: prev.gold + ud.gold,
          silver: prev.silver + ud.silver,
          exp: prev.exp + ud.exp
        };
      }
      // 否则保持 prev（carry forward）
    }
    let goldTotal = 0;
    let silverTotal = 0;
    let expTotal = 0;
    for (const userId of allUserIds) {
      goldTotal += perUserRun[userId].gold;
      silverTotal += perUserRun[userId].silver;
      expTotal += perUserRun[userId].exp;
    }
    let dg = 0;
    let ds = 0;
    let de = 0;
    for (const userId of Object.keys(deltasForDate)) {
      dg += deltasForDate[userId].gold;
      ds += deltasForDate[userId].silver;
      de += deltasForDate[userId].exp;
    }
    series.push({
      date,
      goldDelta: round2(dg),
      silverDelta: round2(ds),
      expDelta: round2(de),
      goldTotal: round2(goldTotal),
      silverTotal: round2(silverTotal),
      expTotal: round2(expTotal)
    });
  }
  return series;
}

// 任务贡献统计：最近 days 天内，各任务类型累计的增量与执行次数
// visibleIds：可选 Set<userId>；传入时仅统计该集合内账号（OPEN_MODE 按 /24 网段隔离），null/省略=全部。
// tz：窗口起点所用的时区（M-09），默认取 config.tz，与 dailyAssetSeries 同源。
export function assetByTask(db, days = 30, visibleIds = null, tz = config.tz) {
  const ledger = db.assetLedger || [];
  // M-09 修复：与 dailyAssetSeries 同源，按配置时区墙钟计算窗口起点
  const tzToday = tz && tz !== 'local' && tz !== 'UTC' ? todayStrTZ(tz) : localDateStr(new Date());
  const cutoffUTC = new Date(tzToday + 'T00:00:00Z');
  cutoffUTC.setUTCDate(cutoffUTC.getUTCDate() - (days - 1));
  const cutoffStr = `${cutoffUTC.getUTCFullYear()}-${String(cutoffUTC.getUTCMonth() + 1).padStart(2, '0')}-${String(cutoffUTC.getUTCDate()).padStart(2, '0')}`;
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
