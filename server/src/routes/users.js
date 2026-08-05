import { Router } from 'express';
import { load, persist, genId } from '../store.js';
import { smzdm } from '../smzdm/adapter.js';
import { authRequired, maskCookie } from '../auth.js';

const router = Router();

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
    points: info.points || 0,
    level: info.level || '',
    vip: !!info.vip,
    streak: 0,
    totalClockIn: 0,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  persist();
  res.json({ ...user, cookie: maskCookie(user.cookie) });
});

// 账号详情
router.get('/:id', authRequired, (req, res) => {
  const db = load();
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  res.json({ ...u, cookie: maskCookie(u.cookie) });
});

// 更新账号（含换 cookie 时刷新资料）
router.put('/:id', authRequired, async (req, res) => {
  const db = load();
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  const { nickname, cookie, smzdmId } = req.body || {};
  if (nickname !== undefined) u.nickname = nickname;
  if (smzdmId !== undefined) u.smzdmId = smzdmId;
  if (cookie) {
    u.cookie = cookie;
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
  persist();
  res.json({ ...u, cookie: maskCookie(u.cookie) });
});

// 删除账号
router.delete('/:id', authRequired, (req, res) => {
  const db = load();
  const i = db.users.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'not_found' });
  db.users.splice(i, 1);
  persist();
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
    persist();
    res.json({ ok: true, info });
  } catch (e) {
    res.status(502).json({ error: 'adapter_error', message: e.message });
  }
});

export default router;
