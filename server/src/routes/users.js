import { Router } from 'express';
import { load, persist, genId, withWriteLock } from '../store.js';
import { smzdm } from '../smzdm/adapter.js';
import { authRequired, maskCookie } from '../auth.js';
import { resolvedCheckInTime } from '../clockSchedule.js';
import { resetRisk } from '../riskControl.js';

const router = Router();

// 校验并归一化 schedMode / checkInTime（manual 必须提供合法 HH:MM）。
// 返回 { schedMode, checkInTime } 或 { error, message }（HTTP 400 用）。
function normalizeSchedule(body) {
  const schedMode = body && body.schedMode;
  if (schedMode !== undefined && !['auto', 'manual', 'default'].includes(schedMode)) {
    return { error: 'invalid_sched_mode', message: 'schedMode 仅支持 auto / manual / default' };
  }
  const mode = schedMode || 'auto';
  let checkInTime = body && typeof body.checkInTime === 'string' ? body.checkInTime.trim() : '';
  if (mode === 'manual') {
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(checkInTime)) {
      return { error: 'invalid_time', message: '手动模式必须提供合法时间（HH:MM，24 小时制）' };
    }
  }
  // auto / default 下 checkInTime 由系统决定，不强校验；透传（可能为空）
  return { schedMode: mode, checkInTime };
}

// 账号列表（cookie 遮罩）
router.get('/', authRequired, (req, res) => {
  const db = load();
  const list = db.users.map((u) => ({ ...u, cookie: maskCookie(u.cookie) }));
  res.json({ total: list.length, list });
});

// 新增 smzdm 账号（录入 cookie）
router.post('/', authRequired, async (req, res) => {
  const { smzdmId, nickname, cookie } = req.body || {};
  if (typeof cookie !== 'string' || !cookie.trim()) {
    return res.status(400).json({ error: 'missing_cookie', message: 'cookie 必填且为字符串' });
  }
  const sched = normalizeSchedule(req.body);
  if (sched.error) return res.status(400).json(sched);
  const clean = (v, max = 64) => (typeof v === 'string' ? v.slice(0, max) : ''); // S9：类型/长度约束
  const db = load();
  let info = {};
  try {
    info = await smzdm.getUserInfo(cookie);
  } catch {
    /* mock 不会抛错；real 未实现时忽略，仍允许录入 */
  }
  const user = {
    id: genId('u'),
    smzdmId: clean(smzdmId) || info.smzdmId || '',
    nickname: clean(nickname) || info.nickname || '未命名账号',
    cookie,
    cookieExpired: false, // 新录入账号默认有效
    points: info.points || 0,
    level: info.level || '',
    vip: !!info.vip,
    streak: 0,
    totalClockIn: 0,
    schedMode: sched.schedMode,
    checkInTime: sched.checkInTime,
    createdAt: new Date().toISOString()
  };
  // auto 模式：固化系统分配的分散时间（便于展示与统计）
  if (user.schedMode === 'auto') {
    user.checkInTime = resolvedCheckInTime(user);
  }
  db.users.push(user);
  await withWriteLock(() => persist());
  res.json({ ...user, cookie: maskCookie(user.cookie) });
});

// 账号详情
router.get('/:id', authRequired, (req, res) => {
  const db = load();
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  res.json({ ...u, cookie: maskCookie(u.cookie) });
});

// 更新账号（含换 cookie 时刷新资料、设置签到时间）
router.put('/:id', authRequired, async (req, res) => {
  const db = load();
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  const { nickname, cookie, smzdmId, schedMode, checkInTime } = req.body || {};
  if (nickname !== undefined) u.nickname = nickname;
  if (smzdmId !== undefined) u.smzdmId = smzdmId;
  // 仅当显式传入 schedMode（或同时传了 checkInTime）时才更新签到时间配置
  if (schedMode !== undefined || checkInTime !== undefined) {
    const sched = normalizeSchedule({
      schedMode: schedMode !== undefined ? schedMode : u.schedMode,
      checkInTime: checkInTime !== undefined ? checkInTime : u.checkInTime
    });
    if (sched.error) return res.status(400).json(sched);
    u.schedMode = sched.schedMode;
    u.checkInTime = sched.checkInTime;
    // auto 模式：固化系统分配的分散时间（便于展示与统计）
    if (u.schedMode === 'auto') u.checkInTime = resolvedCheckInTime(u);
  }
  if (cookie) {
    u.cookie = cookie;
    u.cookieExpired = false; // 重新录入 Cookie：解除失效标记并重置该账号风控状态
    resetRisk(u.id);
    try {
      const info = await smzdm.getUserInfo(cookie);
      u.points = info.points || u.points;
      u.level = info.level || u.level;
      u.vip = !!info.vip;
      u.smzdmId = u.smzdmId || info.smzdmId || '';
    } catch {
      /* ignore */
    }
  }
  await withWriteLock(() => persist());
  res.json({ ...u, cookie: maskCookie(u.cookie) });
});

// 删除账号
router.delete('/:id', authRequired, async (req, res) => {
  const db = load();
  const i = db.users.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'not_found' });
  await withWriteLock(() => {
    db.users.splice(i, 1);
    persist();
  });
  res.json({ ok: true });
});

// 拉取该账号在 smzdm 的真实资料（调用适配器 getUserInfo）
router.get('/:id/smzdm', authRequired, async (req, res) => {
  const db = load();
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  try {
    const info = await smzdm.getUserInfo(u.cookie);
    res.json(info);
  } catch (e) {
    res.status(502).json({ error: 'adapter_error', message: e.message });
  }
});

// 主动刷新账号资料（调用适配器 getUserInfo）
router.post('/:id/refresh', authRequired, async (req, res) => {
  const db = load();
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  try {
    const info = await smzdm.getUserInfo(u.cookie);
    u.points = info.points || u.points;
    u.level = info.level || u.level;
    u.vip = !!info.vip;
    u.smzdmId = u.smzdmId || info.smzdmId || '';
    await withWriteLock(() => persist());
    res.json({ ok: true, info });
  } catch (e) {
    res.status(502).json({ error: 'adapter_error', message: e.message });
  }
});

export default router;
