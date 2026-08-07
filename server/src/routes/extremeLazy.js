import { Router } from 'express';
import { load, withWriteLock } from '../store.js';
import { runExtremeLazy } from '../extremeLazy.js';
import { authRequired } from '../auth.js';

const router = Router();

// 运行极端偷懒流水线（异步执行，立即返回 taskId）
router.post('/run', authRequired, async (req, res) => {
  const db = load();
  const taskId = 'xl_' + Date.now();

  // 存储运行记录
  if (!db.settings.extremeLazyRuns) db.settings.extremeLazyRuns = [];
  const runRecord = {
    id: taskId,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    logs: []
  };
  db.settings.extremeLazyRuns.unshift(runRecord);
  if (db.settings.extremeLazyRuns.length > 50) db.settings.extremeLazyRuns.length = 50;
  await withWriteLock(() => {
    persist();
  });

  // 后台异步执行（不阻塞 HTTP 响应）
  runExtremeLazy()
    .then((result) => {
      const rec = db.settings.extremeLazyRuns.find((r) => r.id === taskId);
      if (rec) {
        rec.status = result.ok ? 'done' : 'partial';
        rec.finishedAt = new Date().toISOString();
        rec.result = {
          ok: result.ok,
          message: result.message,
          totalOk: result.results?.totalOk || 0,
          totalFail: result.results?.totalFail || 0,
          steps: result.results?.steps || []
        };
        rec.logs = result.logs || [];
        withWriteLock(() => persist());
      }
    })
    .catch((e) => {
      const rec = db.settings.extremeLazyRuns.find((r) => r.id === taskId);
      if (rec) {
        rec.status = 'error';
        rec.finishedAt = new Date().toISOString();
        rec.result = { ok: false, message: '执行异常：' + e.message };
        rec.logs = ['异常：' + e.message];
        withWriteLock(() => persist());
      }
    });

  res.json({ ok: true, taskId, message: '极端偷懒已启动，后台自动执行中…' });
});

// 查询最近运行记录
router.get('/runs', authRequired, (req, res) => {
  const db = load();
  const runs = (db.settings && db.settings.extremeLazyRuns) || [];
  res.json({ runs: runs.slice(0, 20) });
});

export default router;
