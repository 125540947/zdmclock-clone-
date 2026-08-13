import { Router } from 'express';
import { load } from '../store.js';
import { summarizeAssets, dailyAssetSeries, assetByTask, recentLedger } from '../assetLedger.js';
import { authRequired, computeVisibleUserIds } from '../auth.js';
import { config } from '../config.js';

const router = Router();

// 资产总览：每用户当前资产 + 今日增量 + 连击/累计，含全局合计
router.get('/summary', authRequired, (req, res) => {
  const db = load();
  res.json(summarizeAssets(db, computeVisibleUserIds(db, req)));
});

// 日收益序列（含累计总量），默认最近 30 天，可 ?days= 指定
router.get('/daily', authRequired, (req, res) => {
  const db = load();
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  res.json({ days, series: dailyAssetSeries(db, days, computeVisibleUserIds(db, req)) });
});

// 任务贡献统计：最近 days 天内各任务类型的增量与执行次数
router.get('/by-task', authRequired, (req, res) => {
  const db = load();
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  res.json({ days, items: assetByTask(db, days, computeVisibleUserIds(db, req)) });
});

// 最近账本明细（含昵称）
router.get('/ledger', authRequired, (req, res) => {
  const db = load();
  const limit = Math.min(config.maxBaoliaoItems, Math.max(1, Number(req.query.limit) || 50));
  res.json({ list: recentLedger(db, limit, computeVisibleUserIds(db, req)) });
});

export default router;
