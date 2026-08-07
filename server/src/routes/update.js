import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import * as realSelf from '../selfUpdate.js';

// 自动更新接口（管理级，需独立管理员鉴权，永远不匿名放行）。依赖以参数注入，便于测试替换。
// - GET  /status ：本地仓库状态（分支/提交/是否脏/通道/是否支持更新）
// - POST /check  ：git fetch 并比较，返回落后/领先提交数
// - POST /apply  ：ff-only 拉取 + 按需重建 + 自重启
export function createUpdateRouter(self = realSelf) {
  const router = Router();
  let lastCheck = null; // 缓存最近一次检查结果，供 status 直接回显

  router.get('/status', requireAdmin, async (req, res) => {
    try {
      const state = await self.getRepoState();
      res.json({
        ...state,
        supported: self.updateSupported(state),
        lastCheck
      });
    } catch (e) {
      res.status(500).json({ error: '获取仓库状态失败：' + e.message });
    }
  });

  router.post('/check', requireAdmin, async (req, res) => {
    try {
      const state = await self.getRepoState();
      if (!state.isRepo || !state.hasRemote) {
        return res.json({ ok: false, error: '不支持更新（非 Git 仓库或未配置 origin 远程）' });
      }
      const r = await self.checkUpdate(state);
      lastCheck = { ...r, at: Date.now() };
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: '检查更新失败：' + e.message });
    }
  });

  router.post('/apply', requireAdmin, async (req, res) => {
    try {
      const result = await self.runUpdate({ restart: true });
      if (result.ok && result.restarting) {
        // 先响应（携带日志），稍后由 scheduleRestart 重启，给前端时间刷新/提示。
        res.json({ ...result, willRestart: true });
        self.scheduleRestart(900);
      } else {
        res.json(result);
      }
    } catch (e) {
      res.status(500).json({ error: '更新失败：' + e.message });
    }
  });

  return router;
}

export default createUpdateRouter();
