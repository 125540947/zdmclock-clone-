import { Router } from 'express';
import { load, persist, withWriteLock } from '../store.js';
import { smzdm } from '../smzdm/adapter.js';
import { authRequired } from '../auth.js';
import { checkAccounts } from '../health.js';
import { notify } from '../notifier.js';
import { runVerification } from '../verifyRealMode.js';

const router = Router();

// 手动触发全部账号 Cookie 健康检测：检测 + 标记 cookieExpired + 失效推送告警
// （定时检测由 scheduler 自动执行，此接口用于随时手动复核）
router.get('/cookies', authRequired, async (req, res) => {
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
router.post('/verify', authRequired, async (req, res) => {
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
    res.status(500).json({ error: '自检执行异常：' + (e?.message || String(e)) });
  }
});

export default router;
