import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, persist, genId, withWriteLock } from '../store.js';
import { smzdm } from '../smzdm/adapter.js';
import { config } from '../config.js';
import { authRequired, maskCookie } from '../auth.js';
import { resolvedCheckInTime } from '../clockSchedule.js';
import { resetRisk } from '../riskControl.js';

// 油猴抓取脚本在仓库 tools/ 下，供前端「复制/下载」用。
const SCRIPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tools/cookie-grabber.user.js'
);

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

// 自动抓取导入（油猴脚本等自动工具调用）：按 smzdmId upsert。
// 与 POST / 的区别：同名账号（同一 smzdmId）只更新 cookie，不重复建号。
router.post('/import', authRequired, async (req, res) => {
  const { cookie, nickname } = req.body || {};
  if (typeof cookie !== 'string' || !cookie.trim()) {
    return res.status(400).json({ error: 'missing_cookie', message: 'cookie 必填且为字符串' });
  }
  const db = load();
  let info = {};
  try {
    info = await smzdm.getUserInfo(cookie);
  } catch {
    /* mock 不抛；real 未连通时忽略，仍允许导入 */
  }
  const smzdmId = (info && info.smzdmId) || '';
  const existed = smzdmId ? !!db.users.find((x) => x.smzdmId === smzdmId) : false;
  const clean = (v, max = 64) => (typeof v === 'string' ? v.slice(0, max) : '');
  let user;
  if (!existed) {
    user = {
      id: genId('u'),
      smzdmId,
      nickname: clean(nickname) || info.nickname || '未命名账号',
      cookie,
      cookieExpired: false,
      points: info.points || 0,
      level: info.level || '',
      vip: !!info.vip,
      streak: 0,
      totalClockIn: 0,
      schedMode: 'auto',
      checkInTime: '',
      createdAt: new Date().toISOString()
    };
    user.checkInTime = resolvedCheckInTime(user);
    db.users.push(user);
  } else {
    user = db.users.find((x) => x.smzdmId === smzdmId);
    user.cookie = cookie;
    user.cookieExpired = false;
    user.nickname = clean(nickname) || user.nickname || info.nickname || '未命名账号';
    resetRisk(user.id);
    user.points = info.points || user.points;
    user.level = info.level || user.level;
    user.vip = !!info.vip;
    user.smzdmId = user.smzdmId || smzdmId;
  }
  await withWriteLock(() => persist());
  res.json({ ...user, cookie: maskCookie(user.cookie), imported: true, upserted: existed });
});

// 返回油猴抓取脚本「模板」源码（含 __SERVER__ / __TOKEN__ 占位符，前端「复制 / 查看」降级用）。
// 该模板不含任何服务端密钥，且本接口本身就不带鉴权依赖，故设为公开可读，
// 以便前端用纯 <a download> 直链 / 文本复制——HTTP（非 HTTPS/localhost）下也能稳定触发。
// 真正免去手动配置的是下方的 /import-script.user.js 一键安装版。
router.get('/import-script', (req, res) => {
  try {
    const code = fs.readFileSync(SCRIPT_PATH, 'utf8');
    res.type('text/javascript').send(code);
  } catch {
    res.status(404).json({ error: 'not_found', message: '脚本文件不存在（请确认 tools/cookie-grabber.user.js）' });
  }
});

// 一键安装版脚本：把服务地址 + Token 直接注入模板，用户无需在油猴菜单里手动填写。
// URL 以 .user.js 结尾且返回 text/javascript，浏览器导航到此链接时油猴会自动弹出安装对话框。
// - server：优先取前端通过 ?server= 传入的真实访问地址（穿透反代/HTTPS 也正确）；缺省回退 Host 头拼接。
// - token ：缺省回退服务端 config.apiToken（默认部署 REQUIRE_AUTH=false 时 import 本就不校验，无实质风险）。
// 鉴权：开启 REQUIRE_AUTH 时本接口仍需 Bearer（直接导航无法带头，建议用前端「复制脚本」降级，
//       那里会从已登录会话的 localStorage 取 token 注入，同样无需手动配置）。
router.get('/import-script.user.js', authRequired, (req, res) => {
  try {
    const code = fs.readFileSync(SCRIPT_PATH, 'utf8');
    const server = String(
      req.query.server || `${req.protocol}://${req.headers.host || ''}`
    );
    const token = String(req.query.token || config.apiToken || '');
    const baked = code
      .replace(/__SERVER__/g, JSON.stringify(server))
      .replace(/__TOKEN__/g, JSON.stringify(token));
    res.type('text/javascript').send(baked);
  } catch {
    res.status(404).json({ error: 'not_found', message: '脚本文件不存在（请确认 tools/cookie-grabber.user.js）' });
  }
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
