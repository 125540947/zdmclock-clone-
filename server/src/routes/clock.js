import { Router } from 'express';
import { load, todayStr, todayStrTZ, localDateStr, flushPersist } from '../store.js';
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
import { wrapAsync } from '../wrapAsync.js';
import { withAccountLock } from '../taskRunner.js';

// H-09：签到状态/记录的"今天"按配置时区（ZDM_TZ）折算，与调度 cron 一致，避免跨日边界把
// "已执行"误显示为"未执行"或重复执行判断不一致。
const tzToday = () => (config.tz && config.tz !== 'local' ? todayStrTZ(config.tz) : todayStr());

const router = Router();

// 计算当前请求者「可访问的账号 id 集合」。返回 null 表示全部（管理员或非开放模式）；
// 返回 Set 表示仅同 /24 网段（开放模式非管理员）。用于 P0-3 修复：列表/状态接口默认只返回当前用户数据。
function scopeUserIds(db, req) {
  if (isAdminRequest(req)) return null;
  if (config.openMode) {
    const viewerIp = getClientIp(req);
    // M-10 修复：移除 `!u.recordedIp` 特例——无 recordedIp 的遗留账号归属不明，对匿名不可见，
    // 仅同网段录入的账号或管理员可见，杜绝匿名跨网段读取遗留数据（水平越权）。
    return new Set(
      db.users.filter((u) => sameSegment(viewerIp, u.recordedIp, 24)).map((u) => u.id)
    );
  }
  return null;
}

// 生成最近 days 天的签到日历
function buildCalendar(records, days = 30, tz) {
  const map = {};
  records.forEach((r) => {
    map[r.date] = r;
  });
  const arr = [];
  // M-09 修复：日历窗口以「配置时区」的墙钟今天为终点，与状态接口的 today 字段（tzToday）口径一致，
  // 避免跨日边界上日历最后一天与"今天"错位（如容器 UTC 与 Asia/Shanghai 并存时状态页自相矛盾）。
  // zonedWallClock 返回的是带 getter 的普通对象而非 Date，故用 todayStrTZ 取 tz 日历日，
  // 再以 UTC 日历日回推 days 天（日历日运算与时区无关），保证跨时区一致。
  const tzToday = todayStrTZ(tz);
  const baseUTC = new Date(tzToday + 'T00:00:00Z');
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(baseUTC);
    d.setUTCDate(baseUTC.getUTCDate() - i);
    const ds = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
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
    const today = tzToday();
    res.json({
      today,
      todayChecked: records.some((r) => r.date === today),
      streak: user.streak,
      total: user.totalClockIn,
      points: user.points,
      calendar: buildCalendar(records, 30, config.tz)
    });
    return;
  }
  // 无 userId：返回作用域内账号的聚合状态
  // M-13 修复：用 Set 做成员判定，将 O(记录数 × 可见账号数) 降为 O(记录数)
  const ids = scope ? new Set(scope) : null;
  const records = ids ? db.clockRecords.filter((r) => ids.has(r.userId)) : db.clockRecords;
  const today = tzToday();
  res.json({
    today,
    todayChecked: records.some((r) => r.date === today),
    streak: 0,
    total: records.length,
    points: 0,
    calendar: buildCalendar(records, 30, config.tz)
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
// wrapAsync：runClockForUser 内部异常若不捕获会使请求永久挂起（M-15），统一转交错误中间件。
router.post('/do', mutationGuard, wrapAsync(async (req, res) => {
  const { userId } = req.body || {};
  const db = load();
  const user = userId ? db.users.find((u) => u.id === userId) : db.users[0];
  if (!user) return res.status(400).json({ error: 'no_user', message: '请先添加 smzdm 账号' });

  const who = user.nickname || '账号';
  // H-07 修复：直接签到（手动 /do）也纳入同账号互斥锁，避免与定时调度/启动任务并发打 smzdm
  // 造成重复签到/限流（此前 runClockForUser 直接调用绕过了账号锁）。
  const result = await withAccountLock(user.id, () => runClockForUser(db, user));
  if (result.duplicate) {
    notify(db, { title: 'ℹ️ 今日已签到', message: who }).catch(() => {});
    return res.status(409).json({ error: 'already', message: '今日已签到' });
  }
  if (!result.ok) {
    notify(db, { title: '❌ 签到失败', message: `${who}：${result.message}` }).catch(() => {});
    return res.status(502).json({ error: 'clock_failed', message: result.message });
  }
  notify(db, { title: '✅ 签到成功', message: `${who} ${result.message}` }).catch(() => {});
  // M-04：手动签到属用户触发的关键写操作，落盘后才向调用方确认成功（避免 debounce 窗口内进程
  // 被杀导致"已签到成功"的记录丢失）。runClockForUser 内部走合并写（debounce），此处强制 flush。
  await flushPersist();
  res.json({
    ok: true,
    record: result.record,
    user: { id: user.id, streak: user.streak, points: user.points, total: user.totalClockIn }
  });
}));

export default router;
