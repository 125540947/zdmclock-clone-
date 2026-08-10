import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, persist, genId, withWriteLock } from '../store.js';
import { smzdm } from '../smzdm/adapter.js';
import { config } from '../config.js';
import { authRequired, authRequiredOrInstall, maskCookie, getClientIp, sameSegment, isAdminRequest, mutationGuard } from '../auth.js';
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

// 开放模式下：账号有 recordedIp 且与当前访客不同网段、且非管理员 → 视为不可见（返回 404）。
// 集中处理 GET /:id、GET /:id/smzdm、POST /:id/refresh 的可见性判定，避免跨网段枚举读他人资料。
function rejectHiddenAccount(res, req, u) {
  if (
    config.openMode &&
    !isAdminRequest(req) &&
    u.recordedIp &&
    !sameSegment(getClientIp(req), u.recordedIp, 24)
  ) {
    res.status(404).json({ error: 'not_found', message: '无权查看该账号' });
    return true;
  }
  return false;
}

// 账号列表（cookie 遮罩）。开放模式下：匿名访客仅可见「同 /24 网段」录入的账号（含无 recordedIp 的遗留账号）；
// 提供有效 ADMIN_TOKEN 的请求（管理员）可绕过，查看全部。
router.get('/', authRequired, (req, res) => {
  const db = load();
  let users = db.users;
  if (config.openMode && !isAdminRequest(req)) {
    const viewerIp = getClientIp(req);
    users = users.filter((u) => !u.recordedIp || sameSegment(viewerIp, u.recordedIp, 24));
  }
  const list = users.map((u) => ({ ...u, cookie: maskCookie(u.cookie) }));
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
    // 开放录入：记录录入者真实 IP（用于同网段可见）+ 是否参与自动任务（录入时勾选，默认开启）
    recordedIp: getClientIp(req),
    autoRun: (req.body && req.body.autoRun) !== false,
    createdAt: new Date().toISOString()
  };
  // auto 模式：固化系统分配的分散时间（便于展示与统计）
  if (user.schedMode === 'auto') {
    user.checkInTime = resolvedCheckInTime(user);
  }
  // P1-1 容量防护：录入账号总数硬上限，防止 OPEN_MODE 匿名刷量或异常撑爆 db.json
  if (db.users.length >= config.maxUsers) {
    return res.status(429).json({
      error: 'user_limit_reached',
      message: `账号数已达上限（${config.maxUsers}），无法继续录入`
    });
  }
  db.users.push(user);
  await withWriteLock(() => persist());
  res.json({ ...user, cookie: maskCookie(user.cookie) });
});

// 自动抓取导入（油猴脚本等自动工具调用）：按 smzdmId upsert。
// 与 POST / 的区别：同名账号（同一 smzdmId）只更新 cookie，不重复建号。
router.post('/import', authRequiredOrInstall, async (req, res) => {
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
    // P1-1 容量防护：同上，仅在真正新增账号时拦截（已存在仅更新 cookie 不计数）
    if (db.users.length >= config.maxUsers) {
      return res.status(429).json({
        error: 'user_limit_reached',
        message: `账号数已达上限（${config.maxUsers}），无法继续录入`
      });
    }
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
      // 油猴自动导入：记录录入者 IP（同网段可见）+ 默认参与自动任务
      recordedIp: getClientIp(req),
      autoRun: true,
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

// 返回油猴抓取脚本「模板」源码（__SERVER__ / __TOKEN__ 占位符由服务端注入）。
// 公开可读（与下方 .user.js 一致），但注入的 __TOKEN__ 仅为窄权限 INSTALL_TOKEN（非会话 token，见 P1-2 修复）。
router.get('/import-script', (req, res) => {
  try {
    const code = fs.readFileSync(SCRIPT_PATH, 'utf8');
    const server = String(req.protocol + '://' + (req.headers.host || ''));
    const baked = code
      .replace(/__SERVER__/g, JSON.stringify(server))
      .replace(/__TOKEN__/g, JSON.stringify(config.installToken || ''));
    res.type('text/javascript').send(baked);
  } catch {
    res.status(404).json({ error: 'not_found', message: '脚本文件不存在（请确认 tools/cookie-grabber.user.js）' });
  }
});

// 一键安装版脚本：把服务地址 + 窄权限 INSTALL_TOKEN 注入模板，用户无需在油猴菜单里手动填写。
// URL 以 .user.js 结尾且返回 text/javascript，浏览器导航到此链接时油猴会自动弹出安装对话框。
// 安全（P1-2 修复）：① 本接口公开可读，但注入的 __TOKEN__ 仅为窄权限 INSTALL_TOKEN（scope 仅 POST /users/import），
//    绝不写入用户会话 token；② 链接不再携带 ?token= 查询参数，消除浏览器历史/Referer/访问日志泄露面。
// - server：优先取前端通过 ?server= 传入的真实访问地址（穿透反代/HTTPS 也正确）；缺省回退 Host 头拼接。
// - token ：注入 config.installToken（窄权限；REQUIRE_AUTH 下未配置则为空，脚本自动推送会 401——此时请改用「录入账号」页手动录入）。
router.get('/import-script.user.js', (req, res) => {
  try {
    const code = fs.readFileSync(SCRIPT_PATH, 'utf8');
    const server = String(
      req.query.server || `${req.protocol}://${req.headers.host || ''}`
    );
    const token = config.installToken || '';
    const baked = code
      .replace(/__SERVER__/g, JSON.stringify(server))
      .replace(/__TOKEN__/g, JSON.stringify(token));
    res.type('text/javascript').send(baked);
  } catch {
    res.status(404).json({ error: 'not_found', message: '脚本文件不存在（请确认 tools/cookie-grabber.user.js）' });
  }
});

// 账号详情。开放模式下：匿名访客无权查看「非同网段」且已记录 IP 的账号。
router.get('/:id', authRequired, (req, res) => {
  const db = load();
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  if (
    config.openMode &&
    !isAdminRequest(req) &&
    u.recordedIp &&
    !sameSegment(getClientIp(req), u.recordedIp, 24)
  ) {
    return res.status(404).json({ error: 'not_found', message: '无权查看该账号' });
  }
  res.json({ ...u, cookie: maskCookie(u.cookie) });
});

// 更新账号（含换 cookie 时刷新资料、设置签到时间）。开放模式下匿名不可改，须管理员 Token。
router.put('/:id', mutationGuard, async (req, res) => {
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

// 删除账号。开放模式下匿名不可删，须管理员 Token。
router.delete('/:id', mutationGuard, async (req, res) => {
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
  if (rejectHiddenAccount(res, req, u)) return;
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
  if (rejectHiddenAccount(res, req, u)) return;
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
