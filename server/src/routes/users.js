import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, persistAwait, genId, withWriteLock } from '../store.js';
import { wrapAsync } from '../wrapAsync.js';
import { smzdm } from '../smzdm/adapter.js';
import { config } from '../config.js';
import { authRequired, authRequiredOrInstall, maskCookie, getClientIp, isAdminRequest, mutationGuard, isRecordedIpVisibleToViewer } from '../auth.js';
import { dbgLog } from '../log.js';
import { resolvedCheckInTime } from '../clockSchedule.js';
import { resetRisk } from '../riskControl.js';
import { requireStr, limitStr, MAX_COOKIE_LEN } from '../validation.js';

// 油猴抓取脚本在仓库 tools/ 下，供前端「复制/下载」用。
const SCRIPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../tools/cookie-grabber.user.js'
);

const router = Router();

// 校验并归一化 schedMode / checkInTime（智能启动调度）。
// schedMode 仅支持 auto（系统按账号错峰分配启动时间）/ manual（用户自定义），
// 不再提供"系统默认=全员同刻"的碰撞模式（违反第一定律）。
// 返回 { schedMode, checkInTime } 或 { error, message }（HTTP 400 用）。
function normalizeSchedule(body) {
  const schedMode = body && body.schedMode;
  if (schedMode !== undefined && !['auto', 'manual'].includes(schedMode)) {
    return { error: 'invalid_sched_mode', message: 'schedMode 仅支持 auto / manual' };
  }
  const mode = schedMode || 'auto';
  let checkInTime = body && typeof body.checkInTime === 'string' ? body.checkInTime.trim() : '';
  if (mode === 'manual') {
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(checkInTime)) {
      return { error: 'invalid_time', message: '手动模式必须提供合法时间（HH:MM，24 小时制）' };
    }
  }
  // auto 下 checkInTime 由系统决定，不强校验；透传（可能为空）
  return { schedMode: mode, checkInTime };
}

// 开放模式下：账号与当前访客不同网段、且非管理员 → 视为不可见（返回 404）。
// 集中处理 GET /:id、GET /:id/smzdm、POST /:id/refresh 的可见性判定，避免跨网段枚举读他人资料。
// M-10 修复：无 recordedIp 的遗留账号（升级前数据/手工数据）同样按「不可见」处理——此前 `u.recordedIp &&`
// 短路导致无 recordedIp 的账号永不隐藏，匿名访客可跨网段读取其元数据/统计（水平越权）。遗留数据归属不明，
// 不应对任意匿名访客可见；仅管理员可查看全部。
function rejectHiddenAccount(res, req, u) {
  if (config.openMode && !isAdminRequest(req) && !isRecordedIpVisibleToViewer(req, u.recordedIp)) {
    res.status(404).json({ error: 'not_found', message: '无权查看该账号' });
    return true;
  }
  return false;
}

// 账号列表（cookie 遮罩）。开放模式下：匿名访客仅可见「同 /24 网段」录入的账号；
// 无 recordedIp 的遗留账号（归属不明）对匿名不可见，仅管理员（有效 ADMIN_TOKEN）可查看全部。
// M-10 修复：移除原先 `!u.recordedIp` 的「遗留账号全可见」特例，杜绝匿名跨网段读取遗留数据。
router.get('/', authRequired, (req, res) => {
  const db = load();
  let users = db.users;
  if (config.openMode && !isAdminRequest(req)) {
    users = users.filter((u) => isRecordedIpVisibleToViewer(req, u.recordedIp));
  }
  const list = users.map((u) => ({ ...u, cookie: maskCookie(u.cookie) }));
  res.json({ total: list.length, list });
});

// 新增 smzdm 账号（录入 cookie）
router.post('/', authRequired, wrapAsync(async (req, res) => {
  const { smzdmId, nickname } = req.body || {};
  let cookie;
  try {
    cookie = requireStr(req.body && req.body.cookie, MAX_COOKIE_LEN, 'cookie');
  } catch (e) {
    return res.status(400).json({ error: e.code || 'invalid_cookie', message: e.message });
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
  await withWriteLock(() => persistAwait());
  res.json({ ...user, cookie: maskCookie(user.cookie) });
}));

// 自动抓取导入（油猴脚本等自动工具调用）：按 smzdmId upsert。
// 与 POST / 的区别：同名账号（同一 smzdmId）只更新 cookie，不重复建号。
router.post('/import', authRequiredOrInstall, wrapAsync(async (req, res) => {
  const { nickname } = req.body || {};
  let cookie;
  try {
    cookie = requireStr(req.body && req.body.cookie, MAX_COOKIE_LEN, 'cookie');
  } catch (e) {
    return res.status(400).json({ error: e.code || 'invalid_cookie', message: e.message });
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
  await withWriteLock(() => persistAwait());
  res.json({ ...user, cookie: maskCookie(user.cookie), imported: true });
}));

// 返回油猴抓取脚本「模板」源码（__SERVER__ / __TOKEN__ / __CONNECT__ 占位符由服务端注入）。
// 公开可读（与下方 .user.js 一致），但注入的 __TOKEN__ 仅为窄权限 INSTALL_TOKEN（非会话 token，见 P1-2 修复）。
// Phase 1 严重#2 修复：① 不再接受 ?server= 任意参数（此前可把推送目标指向任意第三方域名，
//   配合脚本把 Cookie 推到攻击者服务器）；② 响应加 Cache-Control: no-store（防代理/浏览器缓存含 Token 的脚本）；
//   ③ @connect 占位符 __CONNECT__ 注入为本服务真实域名，收紧油猴跨域权限（不再 @connect *）。
// H-02 修复：校验 req.headers.host 是否落在可信白名单（仅当未配置 PUBLIC_BASE_URL 时生效）。
// 用于防止 Host 头注入把安装脚本的 Cookie 回传地址指向非预期主机。
function isHostAllowed(host) {
  const raw = (config.hostAllowlist || '').trim();
  if (!raw) return true; // 白名单未配置（开发态）：不校验
  const h = String(host || '').split(':')[0].toLowerCase();
  if (!h) return false;
  return raw
    .split(',')
    .map((s) => s.trim().split(':')[0].toLowerCase())
    .filter(Boolean)
    .some((a) => h === a || h.endsWith('.' + a));
}

function bakeImportScript(req) {
  // H-04/H-02 修复：回传地址优先用配置基址 PUBLIC_BASE_URL（生产部署应在 .env 显式设置，
  // 由 deploy.sh 写入），绝不盲信不可靠的 Host 头（反代未严格限制 Host 时攻击者可让脚本指向攻击者域名）。
  // 仅在「未配置 PUBLIC_BASE_URL」时回退到 req.headers.host，且需通过 hostAllowlist 校验，
  // 校验不通过则拒绝生成（返回 null，调用方回 400），杜绝 Host 注入窃取 Cookie。
  let server = null;
  if (config.publicBaseUrl) {
    server = config.publicBaseUrl;
  } else {
    const host = req.headers.host || '';
    if (isHostAllowed(host)) {
      server = String(req.protocol + '://' + host);
    }
  }
  if (!server) return null; // 不可信来源，拒绝生成含回传地址的脚本
  const token = config.installToken || '';
  // __CONNECT__ 注入为服务真实主机（host:port，不含 scheme/引号）——油猴 @connect 指令只接受裸域名，
  // 这样脚本仅对自家服务域放行 GM_xmlhttpRequest 跨域，收紧为「非 @connect *」。
  const connect = (() => {
    try { return new URL(server).host; } catch { return server.replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
  })();
  const code = fs.readFileSync(SCRIPT_PATH, 'utf8');
  return code
    .replace(/__SERVER__/g, JSON.stringify(server))
    .replace(/__TOKEN__/g, JSON.stringify(token))
    .replace(/__CONNECT__/g, connect);
}

router.get('/import-script', (req, res) => {
  try {
    const baked = bakeImportScript(req);
    if (!baked) {
      return res.status(400).json({ error: 'untrusted_host', message: '无法确定服务回传地址：请设置 PUBLIC_BASE_URL 或将当前 Host 加入 HOST_ALLOWLIST' });
    }
    res.set('Cache-Control', 'no-store');
    res.type('text/javascript').send(baked);
  } catch {
    res.status(404).json({ error: 'not_found', message: '脚本文件不存在（请确认 tools/cookie-grabber.user.js）' });
  }
});

// 一键安装版脚本：把服务地址 + 窄权限 INSTALL_TOKEN 注入模板，用户无需在油猴菜单里手动填写。
// URL 以 .user.js 结尾且返回 text/javascript，浏览器导航到此链接时油猴会自动弹出安装对话框。
// 安全（P1-2 修复）：① 本接口公开可读，但注入的 __TOKEN__ 仅为窄权限 INSTALL_TOKEN（scope 仅 POST /users/import），
//    绝不写入用户会话 token；② 链接不再携带 ?token= 查询参数，消除浏览器历史/Referer/访问日志泄露面。
// Phase 1 严重#2 修复：③ 移除 ?server= 任意参数（推送目标强制为本服务 Host，杜绝指向第三方）；
//    ④ 响应加 Cache-Control: no-store；⑤ @connect 收紧为服务真实域名（见 bakeImportScript）。
router.get('/import-script.user.js', (req, res) => {
  try {
    const baked = bakeImportScript(req);
    if (!baked) {
      return res.status(400).json({ error: 'untrusted_host', message: '无法确定服务回传地址：请设置 PUBLIC_BASE_URL 或将当前 Host 加入 HOST_ALLOWLIST' });
    }
    res.set('Cache-Control', 'no-store');
    res.type('text/javascript').send(baked);
  } catch {
    res.status(404).json({ error: 'not_found', message: '脚本文件不存在（请确认 tools/cookie-grabber.user.js）' });
  }
});

// 账号详情。开放模式下：匿名访客无权查看「非同网段」账号（含无 recordedIp 的遗留账号）。
// M-01 修复：复用 rejectHiddenAccount，移除遗留的 `u.recordedIp &&` 短路，
// 使无 recordedIp 的遗留账号同样对匿名不可见，杜绝跨网段读取其元数据（水平越权）。
router.get('/:id', authRequired, (req, res) => {
  const db = load();
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  if (rejectHiddenAccount(res, req, u)) return;
  res.json({ ...u, cookie: maskCookie(u.cookie) });
});

// 更新账号（含换 cookie 时刷新资料、设置签到时间）。开放模式下匿名不可改，须管理员 Token。
// M-04 修复：校验（sched 合法性 / cookie 长度 / 换 cookie 的资料刷新）全部在「改写内存」之前完成，
// 且所有内存修改与落盘都在 withWriteLock 内一次性进行；校验失败路径不会留下 partial state。
// M-02 修复：wrapAsync 兜住 withWriteLock/persistAwait 异常，避免请求挂起。
router.put('/:id', mutationGuard, wrapAsync(async (req, res) => {
  const { nickname, cookie, smzdmId, schedMode, checkInTime } = req.body || {};
  // 锁外预读：用于早失败（404）与 sched 默认值；网络 I/O（换 cookie 刷新资料）也必须在锁外。
  // 注意：锁外获得的引用不可用于「改写」，真正的目标定位在写锁内重新执行（M-10 竞态修复）。
  const dbPre = load();
  const ref = dbPre.users.find((x) => x.id === req.params.id);
  if (!ref) return res.status(404).json({ error: 'not_found' });
  // 先算 sched（校验），失败直接 400，此时尚未改动任何内存状态
  let sched = null;
  if (schedMode !== undefined || checkInTime !== undefined) {
    sched = normalizeSchedule({
      schedMode: schedMode !== undefined ? schedMode : ref.schedMode,
      checkInTime: checkInTime !== undefined ? checkInTime : ref.checkInTime
    });
    if (sched.error) return res.status(400).json(sched);
  }
  // cookie 长度校验（锁外计算，不赋值）
  let newCookie = null;
  if (cookie) {
    try {
      newCookie = limitStr(cookie, MAX_COOKIE_LEN, 'cookie');
    } catch (e) {
      return res.status(400).json({ error: e.code || 'invalid_cookie', message: e.message });
    }
  }
  // 换 cookie 时先刷新资料（锁外，避免持锁等待 I/O）
  let info = {};
  if (newCookie) {
    try {
      info = await smzdm.getUserInfo(newCookie);
    } catch {
      /* ignore：仍能更新 cookie，不依赖资料 */
    }
  }
  // M-10：写锁内重新定位目标并原子改写+落盘；若锁内已不存在则 404（杜绝修改孤儿对象 / 错误成功响应）
  let notFound = false;
  await withWriteLock(() => {
    const db = load();
    const u = db.users.find((x) => x.id === req.params.id);
    if (!u) { notFound = true; return; }
    if (nickname !== undefined) u.nickname = nickname;
    if (smzdmId !== undefined) u.smzdmId = smzdmId;
    if (sched) {
      u.schedMode = sched.schedMode;
      u.checkInTime = sched.checkInTime;
      // auto 模式：固化系统分配的分散时间（便于展示与统计）
      if (u.schedMode === 'auto') u.checkInTime = resolvedCheckInTime(u);
    }
    if (newCookie) {
      u.cookie = newCookie;
      u.cookieExpired = false; // 重新录入 Cookie：解除失效标记并重置该账号风控状态
      resetRisk(u.id);
      u.points = info.points || u.points;
      u.level = info.level || u.level;
      u.vip = !!info.vip;
      u.smzdmId = u.smzdmId || info.smzdmId || '';
    }
    return persistAwait();
  });
  if (notFound) return res.status(404).json({ error: 'not_found' });
  const db = load();
  const u = db.users.find((x) => x.id === req.params.id);
  res.json({ ...u, cookie: maskCookie(u.cookie) });
}));

// 删除账号。开放模式下匿名不可删，须管理员 Token。
router.delete('/:id', mutationGuard, wrapAsync(async (req, res) => {
  // M-10：索引计算移入写锁内，避免前序删除使索引失效而误删 / 漏删
  let notFound = false;
  let deletedId = null;
  await withWriteLock(() => {
    const db = load();
    const i = db.users.findIndex((x) => x.id === req.params.id);
    if (i < 0) { notFound = true; return; }
    deletedId = db.users[i].id;
    db.users.splice(i, 1);
    return persistAwait();
  });
  if (notFound) return res.status(404).json({ error: 'not_found' });
  // A-03：删除账号后清理其进程内风控状态（熔断 / 失败计数），避免僵尸状态残留误导后续调度
  if (deletedId) resetRisk(deletedId);
  res.json({ ok: true });
}));

// 拉取该账号在 smzdm 的真实资料（调用适配器 getUserInfo）
router.get('/:id/smzdm', authRequired, wrapAsync(async (req, res) => {
  const db = load();
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  if (rejectHiddenAccount(res, req, u)) return;
  try {
    const info = await smzdm.getUserInfo(u.cookie);
    res.json(info);
  } catch (e) {
    dbgLog('[users] 获取账号资料失败：', e.message);
    res.status(502).json({ error: 'adapter_error', message: '账号操作失败，请稍后重试' });
  }
}));

// 主动刷新账号资料（调用适配器 getUserInfo）
router.post('/:id/refresh', authRequired, wrapAsync(async (req, res) => {
  const dbPre = load();
  const ref = dbPre.users.find((x) => x.id === req.params.id);
  if (!ref) return res.status(404).json({ error: 'not_found' });
  if (rejectHiddenAccount(res, req, ref)) return;
  try {
    const info = await smzdm.getUserInfo(ref.cookie);
    // M-10：资料写入移入写锁内，锁内重新定位目标并原子落盘；已删除则 404
    let notFound = false;
    await withWriteLock(() => {
      const db = load();
      const u = db.users.find((x) => x.id === req.params.id);
      if (!u) { notFound = true; return; }
      u.points = info.points || u.points;
      u.level = info.level || u.level;
      u.vip = !!info.vip;
      u.smzdmId = u.smzdmId || info.smzdmId || '';
      return persistAwait();
    });
    if (notFound) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, info });
  } catch (e) {
    dbgLog('[users] 刷新账号资料失败：', e.message);
    res.status(502).json({ error: 'adapter_error', message: '账号操作失败，请稍后重试' });
  }
}));

export default router;
