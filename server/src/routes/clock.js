import { Router } from 'express';
import { load, persist, genId, todayStr, localDateStr } from '../store.js';
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
router.get('/status', (req, res) => {
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
router.get('/history', (req, res) => {
  const db = load();
  const { userId, page = 1, pageSize = 30 } = req.query;
  let recs = db.clockRecords;
  if (userId) recs = recs.filter((r) => r.userId === userId);
  recs = [...recs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = recs.length;
  const p = Math.max(1, Number(page));
  const ps = Math.max(1, Number(pageSize));
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

  const today = todayStr();
  if (db.clockRecords.some((r) => r.userId === user.id && r.date === today)) {
    return res.status(409).json({ error: 'already', message: '今日已签到' });
  }
  try {
    const r = await smzdm.doClockIn(user.cookie);
    if (!r.success) return res.status(502).json({ error: 'clock_failed', message: r.message });
    const rec = { id: genId('c'), userId: user.id, date: today, points: r.points || 0, createdAt: new Date().toISOString() };
    db.clockRecords.push(rec);
    const ys = localDateStr(new Date(Date.now() - 86400000));
    user.streak = db.clockRecords.some((x) => x.userId === user.id && x.date === ys) ? (user.streak || 0) + 1 : 1;
    user.totalClockIn = (user.totalClockIn || 0) + 1;
    user.points = (user.points || 0) + (r.points || 0);
    persist();
    res.json({
      ok: true,
      record: rec,
      user: { id: user.id, streak: user.streak, points: user.points, total: user.totalClockIn }
    });
  } catch (e) {
    res.status(502).json({ error: 'adapter_error', message: e.message });
  }
});

export default router;
