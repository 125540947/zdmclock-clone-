import { Router } from 'express';
import { load, persist, todayStr } from '../store.js';
import { runTask } from '../taskRunner.js';
import { authRequired } from '../auth.js';

const router = Router();

// 任务列表
router.get('/', (req, res) => {
  const db = load();
  res.json({ list: db.tasks });
});

// 更新任务（启用/停用/名称/cron）
router.put('/:id', authRequired, (req, res) => {
  const db = load();
  const t = db.tasks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  const { enabled, cron, name } = req.body || {};
  if (enabled !== undefined) t.enabled = enabled;
  if (cron !== undefined) t.cron = cron;
  if (name !== undefined) t.name = name;
  persist();
  res.json(t);
});

// 手动执行任务（调用适配器；mock 直接返回成功）
router.post('/:id/run', authRequired, async (req, res) => {
  const db = load();
  const t = db.tasks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  const { userId, count } = req.body || {};
  try {
    const r = await runTask(t, db, { userId, count });
    if (!r.ok) return res.status(400).json({ error: r.error, message: r.message });
    t.lastRun = todayStr();
    t.lastResult = r.result.message;
    t.status = 'done';
    persist();
    res.json({ ok: true, result: r.result });
  } catch (e) {
    t.lastResult = e.message;
    t.status = 'error';
    persist();
    res.status(502).json({ error: 'adapter_error', message: e.message });
  }
});

export default router;
