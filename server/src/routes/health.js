import { Router } from 'express';
import { load, persist, withWriteLock } from '../store.js';
import { smzdm } from '../smzdm/adapter.js';
import { authRequired, mutationGuard } from '../auth.js';
import { checkAccounts } from '../health.js';
import { config } from '../config.js';
import { notify } from '../notifier.js';
import { runVerification } from '../verifyRealMode.js';
import { wrapAsync } from '../wrapAsync.js';

const router = Router();

// M-07 修复：显式拒绝 GET /cookies（原本用 GET 触发有副作用的状态改写 + 通知），
// 返回 405 让调用方明确区分；真正的检测走 POST。避免浏览器跨站导航（SameSite=Lax 顶层导航
// 可携带会话 Cookie）、预取或监控工具误触发批量外部检测与通知。
router.get('/cookies', (_req, res) => {
  res.status(405).json({
    error: 'method_not_allowed',
    message: 'Cookie 健康检测请用 POST /api/health/cookies（GET 不触发有副作用的检测）'
  });
});

// 手动触发全部账号 Cookie 健康检测：检测 + 标记 cookieExpired + 失效推送告警
// （定时检测由 scheduler 自动执行，此接口用于随时手动复核）。暴露全部账号身份：
// 开放模式下强制管理员（mutationGuard）。
// M-07 修复：由 GET 改为 POST——该接口会修改全部账号的 cookieExpired、持久化数据库并发送通知，
// 属有副作用的状态改写。GET 会被浏览器跨站导航（SameSite=Lax 顶层导航可携带会话 Cookie）、
// 预取或监控工具误触发；改为 POST 后仅显式提交才会执行，杜绝 CSRF / 意外副作用。
// wrapAsync：checkAccounts / persist 等异常若不捕获会使请求挂起（M-15）。
router.post('/cookies', mutationGuard, wrapAsync(async (req, res) => {
  const db = load();
  if (!db.users.length) return res.json({ total: 0, results: [], message: '暂无账号' });
  const results = await checkAccounts(db, smzdm, {
    concurrency: config.healthConcurrency,
    onExpired: (u, reason) =>
      notify(db, {
        title: '🍪 Cookie 失效告警',
        message: `账号「${u.nickname || u.smzdmId || u.id}」Cookie 可能已失效：${reason}`
      })
  });
  await withWriteLock(() => persistAwait());
  // H-08：仅「真实失效（非网络异常）」计入失效列表与告警文案；网络类异常（degraded）不计入，
  // 避免一次外部网络故障把全部账号误报告为失效。
  const bad = results.filter((r) => !r.valid && !r.degraded);
  const degradedCount = results.filter((r) => r.degraded).length;
  let message = bad.length ? `${bad.length} 个账号 Cookie 失效` : '全部账号 Cookie 有效';
  if (degradedCount) message += `（另有 ${degradedCount} 个账号因网络异常未判定，保留既有状态）`;
  res.json({
    total: results.length,
    results,
    expired: bad.map((r) => ({ id: r.id, nickname: r.nickname, reason: r.reason })),
    degradedCount,
    message
  });
}));

// 真机端点自检（前端「一键自检」按钮调用）：用指定账号的 Cookie 跑 runVerification，
// 返回每个端点的 PASS/FAIL/SKIP 明细。仅在 real 模式有意义；mock 模式下端点不会真连通，
// 但仍可校验离线签名等逻辑。withCheckin=true 会实签一次（谨慎）。
// 真机端点自检：用指定账号的 Cookie 跑 runVerification，返回每个端点的 PASS/FAIL/SKIP 明细。
// withCheckin=true 会实签一次（真实动作），开放模式下强制管理员（mutationGuard），避免匿名用任意 userId 实签（IDOR）。
router.post('/verify', mutationGuard, wrapAsync(async (req, res) => {
  const { userId, withCheckin = false } = req.body || {};
  const db = load();
  const u = db.users.find((x) => x.id === userId);
  if (!u) return res.status(404).json({ error: '账号不存在' });
  if (!u.cookie) return res.status(400).json({ error: '该账号未配置 Cookie' });
  try {
    const results = await runVerification({ cookie: u.cookie, withCheckin });
    const failed = results.filter((r) => r.status === 'FAIL');
    res.json({
      userId: u.id,
      nickname: u.nickname || u.smzdmId || u.id,
      ok: failed.length === 0,
      failedCount: failed.length,
      results
    });
  } catch (e) {
    // 生产环境不回显内部异常细节（P1-8），仅记录到服务端日志
    console.error('[health] verify 异常:', e);
    res.status(500).json({ error: 'verify_failed', message: '自检执行异常，请稍后重试或查看服务端日志' });
  }
}));

export default router;
