import { Router } from 'express';
import { load, persist, withWriteLock } from '../store.js';
import { smzdm } from '../smzdm/adapter.js';
import { authRequired, mutationGuard } from '../auth.js';
import { checkAccounts } from '../health.js';
import { notify } from '../notifier.js';
import { runVerification } from '../verifyRealMode.js';

const router = Router();

// 手动触发全部账号 Cookie 健康检测：检测 + 标记 cookieExpired + 失效推送告警
// （定时检测由 scheduler 自动执行，此接口用于随时手动复核）。暴露全部账号身份：
// 开放模式下强制管理员（mutationGuard）。
router.get('/cookies', mutationGuard, async (req, res) => {
  const db = load();
  if (!db.users.length) return res.json({ total: 0, results: [], message: '暂无账号' });
  const results = await checkAccounts(db, smzdm, {
    onExpired: (u, reason) =>
      notify(db, {
        title: '🍪 Cookie 失效告警',
        message: `账号「${u.nickname || u.smzdmId || u.id}」Cookie 可能已失效：${reason}`
      })
  });
  await withWriteLock(() => persist());
  const bad = results.filter((r) => !r.valid);
  res.json({
    total: results.length,
    results,
    expired: bad.map((r) => ({ id: r.id, nickname: r.nickname, reason: r.reason })),
    message: bad.length ? `${bad.length} 个账号 Cookie 失效` : '全部账号 Cookie 有效'
  });
});

// 真机端点自检（前端「一键自检」按钮调用）：用指定账号的 Cookie 跑 runVerification，
// 返回每个端点的 PASS/FAIL/SKIP 明细。仅在 real 模式有意义；mock 模式下端点不会真连通，
// 但仍可校验离线签名等逻辑。withCheckin=true 会实签一次（谨慎）。
// 真机端点自检：用指定账号的 Cookie 跑 runVerification，返回每个端点的 PASS/FAIL/SKIP 明细。
// withCheckin=true 会实签一次（真实动作），开放模式下强制管理员（mutationGuard），避免匿名用任意 userId 实签（IDOR）。
router.post('/verify', mutationGuard, async (req, res) => {
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
});

export default router;
