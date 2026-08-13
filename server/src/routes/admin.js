import { Router } from 'express';
import { load, todayStr, withWriteLock, persist } from '../store.js';
import { config } from '../config.js';
import { adminOrAuthRequired } from '../auth.js';
import { resolvedCheckInTime, parseHM, fmtHM, windowMinutes } from '../clockSchedule.js';
import { resolveRisk } from '../riskControl.js';

const router = Router();

// 管理后台概览数据（OPEN_MODE 下强制管理员，避免匿名读全量运营统计）
router.get('/stats', adminOrAuthRequired, (req, res) => {
  const db = load();
  const today = todayStr();
  const todayClocks = db.clockRecords.filter((r) => r.date === today).length;
  const recent = [...db.clockRecords]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);
  res.json({
    users: db.users.length,
    tasks: db.tasks.length,
    enabledTasks: db.tasks.filter((t) => t.enabled).length,
    totalClocks: db.clockRecords.length,
    todayClocks,
    adapter: config.smzdmAdapter,
    recent
  });
});

// 签到时间分布统计：按时间段（按小时或自定义区间）聚合各时段待签到账号数、
// 已签到数与账号清单，便于运营掌握签到分布与活跃情况。
// 查询参数：mode=hour|custom，bucketMinutes（custom 模式间隔，默认 60），
//           start/end（HH:MM，限定统计窗口；缺省为全天 00:00~23:59）。
router.get('/clock-distribution', adminOrAuthRequired, (req, res) => {
  const db = load();
  const today = todayStr();
  const mode = req.query.mode === 'custom' ? 'custom' : 'hour';

  // 统计窗口（分钟）
  let startMin = 0;
  let endMin = 24 * 60 - 1;
  const qs = parseHM(req.query.start);
  const qe = parseHM(req.query.end);
  if (qs) startMin = qs.h * 60 + qs.mi;
  if (qe) endMin = qe.h * 60 + qe.mi;
  if (endMin < startMin) endMin = startMin;

  let bucketMinutes = 60;
  if (mode === 'custom') {
    const bm = Number(req.query.bucketMinutes);
    if (Number.isFinite(bm) && bm >= 1 && bm <= 1440) bucketMinutes = Math.floor(bm);
  }

  // 已签到（今日）账号集合
  const doneToday = new Set(
    db.clockRecords.filter((r) => r.date === today).map((r) => r.userId)
  );

  // 构建时段桶
  const buckets = [];
  for (let s = startMin; s <= endMin; s += bucketMinutes) {
    const e = Math.min(s + bucketMinutes, endMin + 1);
    buckets.push({
      slot: fmtHM(Math.floor(s / 60) % 24, s % 60),
      slotEnd: fmtHM(Math.floor((e - 1) / 60) % 24, (e - 1) % 60),
      scheduledCount: 0,
      checkedInCount: 0,
      accounts: []
    });
  }
  const slotOf = (hm) => {
    const p = parseHM(hm);
    if (!p) return -1;
    const m = p.h * 60 + p.mi;
    if (m < startMin || m > endMin) return -1;
    return Math.floor((m - startMin) / bucketMinutes);
  };

  let totalScheduled = 0;
  let totalCheckedIn = 0;
  for (const u of db.users) {
    const hm = resolvedCheckInTime(u);
    const idx = slotOf(hm);
    if (idx < 0 || idx >= buckets.length) {
      // 超出窗口的账号仍计入总数，但不放进某个时段桶
      totalScheduled += 1;
      if (doneToday.has(u.id)) totalCheckedIn += 1;
      continue;
    }
    const b = buckets[idx];
    const checkedIn = doneToday.has(u.id);
    b.scheduledCount += 1;
    if (checkedIn) b.checkedInCount += 1;
    b.accounts.push({
      id: u.id,
      nickname: u.nickname || '未命名账号',
      schedMode: u.schedMode || 'auto',
      checkInTime: hm,
      todayChecked: checkedIn,
      streak: u.streak || 0,
      points: u.points || 0
    });
    totalScheduled += 1;
    if (checkedIn) totalCheckedIn += 1;
  }
  // 时段桶按时间排序（构建即有序），账号按签到时间再按昵称排序
  for (const b of buckets) {
    b.accounts.sort((a, c) => (a.checkInTime + a.nickname).localeCompare(c.checkInTime + c.nickname));
  }

  res.json({
    mode,
    bucketMinutes,
    windowStart: fmtHM(Math.floor(startMin / 60) % 24, startMin % 60),
    windowEnd: fmtHM(Math.floor(endMin / 60) % 24, endMin % 60),
    totalUsers: db.users.length,
    totalScheduled,
    totalCheckedIn,
    autoWindowStart: config.autoWindowStart,
    autoWindowEnd: config.autoWindowEnd,
    defaultCheckInTime: config.defaultCheckInTime,
    buckets
  });
});

// 风控（反检测 / 反封号）生效配置：env 默认值被 db.settings.risk 持久化覆盖
router.get('/risk-settings', adminOrAuthRequired, (req, res) => {
  const db = load();
  res.json({ settings: resolveRisk(db), tz: config.tz, catchupGraceMin: config.catchupGraceMin });
});

// 更新风控配置（持久化到 db.settings.risk）。仅接受已知数值字段，非法值回退默认。
router.put('/risk-settings', adminOrAuthRequired, async (req, res) => {
  const db = load();
  const b = (req.body && req.body.settings) || {};
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  const cur = db.settings.risk || {};
  const next = {
    enabled: b.enabled !== undefined ? !!b.enabled : !!cur.enabled,
    preDelayMinMs: num(b.preDelayMinMs, cur.preDelayMinMs ?? config.riskPreDelayMinMs),
    preDelayMaxMs: num(b.preDelayMaxMs, cur.preDelayMaxMs ?? config.riskPreDelayMaxMs),
    circuitFailures: num(b.circuitFailures, cur.circuitFailures ?? config.riskCircuitFailures),
    circuitCooldownMs: num(b.circuitCooldownMs, cur.circuitCooldownMs ?? config.riskCircuitCooldownMs),
    adaptiveStepMs: num(b.adaptiveStepMs, cur.adaptiveStepMs ?? config.riskAdaptiveStepMs),
    maxExtraMs: num(b.maxExtraMs, cur.maxExtraMs ?? config.riskMaxExtraMs)
  };
  // 防御：最小等待窗口不能大于最大等待窗口
  if (next.preDelayMinMs > next.preDelayMaxMs) next.preDelayMinMs = next.preDelayMaxMs;
  db.settings.risk = next;
  await withWriteLock(() => persist());
  res.json({ ok: true, settings: resolveRisk(db) });
});

export default router;
