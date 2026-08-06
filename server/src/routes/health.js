import { Router } from 'express';
import { load, persist, withWriteLock } from '../store.js';
import { smzdm } from '../smzdm/adapter.js';
import { authRequired } from '../auth.js';
import { checkAccounts } from '../health.js';
import { notify } from '../notifier.js';

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

export default router;
