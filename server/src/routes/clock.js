import { Router } from 'express';
import { load, persist, todayStr, localDateStr, withWriteLock } from '../store.js';
import { applyClock } from '../clockCore.js';
import { smzdm } from '../smzdm/adapter.js';
import { authRequired } from '../auth.js';

const router = Router();

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
router.get('/status', authRequired, (req, res) => {
  const db = load();
  const userId = req.query.userId;
  const records = userId ? db.clockRecords.filter((r) => r.userId === userId) : db.clockRecords;
  const user = userId ? db.users.find((u) => u.id === userId) : null;
  const today = todayStr();
  res.json({
    today,
    todayChecked: records.some((r) => r.date === today),
    streak: user ? user.streak : 0,
    total: user ? user.totalClockIn : records.length,
    points: user ? user.points : 0,
    calendar: buildCalendar(records)
  });
});

// 签到记录列表（按时间倒序，可选 userId / 分页）
router.get('/history', authRequired, (req, res) => {
  const db = load();
  const { userId, page = 1, pageSize = 30 } = req.query;
  let recs = db.clockRecords;
  if (userId) recs = recs.filter((r) => r.userId === userId);
  recs = [...recs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = recs.length;
  const p = Math.max(1, Number(page) || 1);
  const ps = Math.min(200, Math.max(1, Number(pageSize) || 30)); // b2：钳制分页上限，防放大
  const list = recs.slice((p - 1) * ps, p * ps);
  // 附带昵称
  const userMap = Object.fromEntries(db.users.map((u) => [u.id, u.nickname]));
  const enriched = list.map((r) => ({ ...r, nickname: userMap[r.userId] || '未知' }));
  res.json({ total, page: p, pageSize: ps, list: enriched });
});

// 执行签到
router.post('/do', authRequired, async (req, res) => {
  const { userId } = req.body || {};
  const db = load();
  const user = userId ? db.users.find((u) => u.id === userId) : db.users[0];
  if (!user) return res.status(400).json({ error: 'no_user', message: '请先添加 smzdm 账号' });

  try {
    const r = await smzdm.doClockIn(user.cookie);
    if (!r.success) return res.status(502).json({ error: 'clock_failed', message: r.message });
    // 写锁内完成"幂等检查 + 落库 + 更新用户"，避免并发双重签到（N1 + R2）
    const result = await withWriteLock(() => {
      const res = applyClock(user, r, db);
      if (res.duplicate) return res;
      persist();
      return res;
    });
    if (result.duplicate) return res.status(409).json({ error: 'already', message: '今日已签到' });
    res.json({
      ok: true,
      record: result.record,
      user: { id: user.id, streak: user.streak, points: user.points, total: user.totalClockIn }
    });
  } catch (e) {
    res.status(502).json({ error: 'adapter_error', message: e.message });
  }
});

export default router;
