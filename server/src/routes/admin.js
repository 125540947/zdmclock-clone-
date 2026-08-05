import { Router } from 'express';
import { load, todayStr } from '../store.js';
import { config } from '../config.js';

const router = Router();

// 管理后台概览数据
router.get('/stats', (req, res) => {
  const db = load();
  const today = todayStr();
  const todayClocks = db.clockRecords.filter((r) => r.date === today).length;
  const recent = [...db.clockRecords]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);
  res.json({
    users: db.users.length,
    tasks: db.tasks.length,
    enabledTasks: db.tasks.filter((t) => t.enabled).length,
    totalClocks: db.clockRecords.length,
    todayClocks,
    adapter: config.smzdmAdapter,
    recent
  });
});

export default router;
