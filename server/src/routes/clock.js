import { Router } from 'express';
import { load, todayStr, localDateStr } from '../store.js';
import { runClockForUser } from '../taskRunner.js';
import { config } from '../config.js';
import {
  authRequired,
  mutationGuard,
  canAccessUser,
  getClientIp,
  sameSegment,
  isAdminRequest
} from '../auth.js';
import { notify } from '../notifier.js';

const router = Router();

// 计算当前请求者「可访问的账号 id 集合」。返回 null 表示全部（管理员或非开放模式）；
// 返回 Set 表示仅同 /24 网段（开放模式非管理员）。用于 P0-3 修复：列表/状态接口默认只返回当前用户数据。
function scopeUserIds(db, req) {
  if (isAdminRequest(req)) return null;
  if (config.openMode) {
    const viewerIp = getClientIp(req);
    return new Set(
      db.users.filter((u) => !u.recordedIp || sameSegment(viewerIp, u.recordedIp, 24)).map((u) => u.id)
    );
  }
  return null;
}

// 生成最近 days 天的签到日历
function buildCalendar(records, days = 30) {
  const map = {};
  records.forEach((r) => {
    map[r.date] = r;
  });
  const arr = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const ds = localDateStr(d);
    arr.push({ date: ds, checked: !!map[ds], points: map[ds] ? map[ds].points : 0 });
  }
  return arr;
}

// 签到状态（打卡页核心数据）
// P0-3 修复：开放模式非管理员只能读「同 /24 网段」账号；传了他人 userId 直接 403。
// 不传 userId 时，聚合结果仅限同段账号（与 baoliao 列表一致）。
router.get('/status', authRequired, (req, res) => {
  const db = load();
  const userId = req.query.userId;
  const scope = scopeUserIds(db, req); // null=全部；Set=仅同段
  if (userId) {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return res.status(404).json({ error: 'not_found', message: '账号不存在' });
    if (!canAccessUser(req, user)) {
      return res.status(403).json({ error: 'forbidden', message: '无权访问该账号数据' });
    }
    const records = db.clockRecords.filter((r) => r.userId === userId);
    const today = todayStr();
    res.json({
      today,
      todayChecked: records.some((r) => r.date === today),
      streak: user.streak,
      total: user.totalClockIn,
      points: user.points,
      calendar: buildCalendar(records)
    });
    return;
  }
  // 无 userId：返回作用域内账号的聚合状态
  const ids = scope ? [...scope] : null;
  const records = ids ? db.clockRecords.filter((r) => ids.includes(r.userId)) : db.clockRecords;
  const today = todayStr();
  res.json({
    today,
    todayChecked: records.some((r) => r.date === today),
    streak: 0,
    total: records.length,
    points: 0,
    calendar: buildCalendar(records)
  });
});

// 签到记录列表（按时间倒序，可选 userId / 分页）
// P0-3 修复：开放模式非管理员只能读「同 /24 网段」账号；传了他人 userId 直接 403。
router.get('/history', authRequired, (req, res) => {
  const db = load();
  const { userId, page = 1, pageSize = 30 } = req.query;
  const scope = scopeUserIds(db, req);
  let recs = db.clockRecords;
  if (userId) {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return res.status(404).json({ error: 'not_found', message: '账号不存在' });
    if (!canAccessUser(req, user)) {
      return res.status(403).json({ error: 'forbidden', message: '无权访问该账号数据' });
    }
    recs = recs.filter((r) => r.userId === userId);
  } else if (scope) {
    recs = recs.filter((r) => scope.has(r.userId));
  }
  recs = [...recs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = recs.length;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(config.maxPageSize, Math.max(1, Number(pageSize) || 30)); // b2：钳制分页上限，防放大
  const list = recs.slice((p - 1) * ps, p * ps);
  // 附带昵称
  const userMap = Object.fromEntries(db.users.map((u) => [u.id, u.nickname]));
  const enriched = list.map((r) => ({ ...r, nickname: userMap[r.userId] || '未知' }));
  res.json({ total, page: p, pageSize: ps, list: enriched });
});

// 执行签到（真实动作）：开放模式下强制管理员（mutationGuard），避免匿名用任意 userId 签到（IDOR）。
router.post('/do', mutationGuard, async (req, res) => {
  const { userId } = req.body || {};
  const db = load();
  const user = userId ? db.users.find((u) => u.id === userId) : db.users[0];
  if (!user) return res.status(400).json({ error: 'no_user', message: '请先添加 smzdm 账号' });

  const who = user.nickname || '账号';
  // 统一走 runClockForUser：含幂等落库 + 失败重试（复用定时签到的同一套逻辑）
  const result = await runClockForUser(db, user);
  if (result.duplicate) {
    notify(db, { title: 'ℹ️ 今日已签到', message: who }).catch(() => {});
    return res.status(409).json({ error: 'already', message: '今日已签到' });
  }
  if (!result.ok) {
    notify(db, { title: '❌ 签到失败', message: `${who}：${result.message}` }).catch(() => {});
    return res.status(502).json({ error: 'clock_failed', message: result.message });
  }
  notify(db, { title: '✅ 签到成功', message: `${who} ${result.message}` }).catch(() => {});
  res.json({
    ok: true,
    record: result.record,
    user: { id: user.id, streak: user.streak, points: user.points, total: user.totalClockIn }
  });
});

export default router;
