import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import * as realSelf from '../selfUpdate.js';
import { sendError } from '../httpError.js';

// 自动更新接口（管理级，需独立管理员鉴权，永远不匿名放行）。依赖以参数注入，便于测试替换。
// - GET  /status ：本地仓库状态（分支/提交/是否脏/通道/是否支持更新）+ 后台更新任务进度
// - POST /check  ：git fetch 并比较，返回落后/领先提交数
// - POST /apply  ：立即返回 202（已受理），更新在后台异步执行；前端轮询 /status 取实时日志
//                  与最终结果（修复 M1：不再同步阻塞到构建完成，避免客户端超时误报失败）。
export function createUpdateRouter(self = realSelf) {
  const router = Router();
  let lastCheck = null; // 缓存最近一次检查结果，供 status 直接回显
  let applyJob = null; // 后台更新任务：{ startedAt, status:'running'|'done'|'failed', log[], result }

  // 后台执行更新；同时只允许一个任务运行（并发防护）。返回 null 表示已有任务在跑。
  function startApply() {
    if (applyJob && applyJob.status === 'running') return null;
    const job = { startedAt: Date.now(), status: 'running', log: [], result: null };
    applyJob = job;
    (async () => {
      try {
        const result = await self.runUpdate({
          restart: true,
          onLog: (line) => job.log.push(line)
        });
        job.result = result;
        job.status = result.ok ? 'done' : 'failed';
        if (result.ok && result.restarting) {
          // 给前端一点时间轮询到最终状态（约 3s，前端每 1.5s 轮询一次），再重启。
          self.scheduleRestart(3000);
        }
      } catch (e) {
        job.status = 'failed';
        job.result = { ok: false, error: e.message };
        job.log.push('更新过程异常：' + e.message);
      }
    })();
    return job;
  }

  router.get('/status', requireAdmin, async (req, res) => {
    try {
      const state = await self.getRepoState();
      res.json({
        ...state,
        supported: self.updateSupported(state),
        lastCheck,
        apply: applyJob
          ? {
              status: applyJob.status,
              startedAt: applyJob.startedAt,
              log: applyJob.log,
              result: applyJob.result
            }
          : null
      });
    } catch (e) {
      sendError(res, { status: 500, error: 'repo_status_failed', message: '获取仓库状态失败：' + e.message });
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
      sendError(res, { status: 500, error: 'check_update_failed', message: '检查更新失败：' + e.message });
    }
  });

  router.post('/apply', requireAdmin, async (req, res) => {
    if (applyJob && applyJob.status === 'running') {
      return res.status(409).json({ error: 'busy', message: '已有更新任务进行中，请稍候' });
    }
    startApply();
    res.status(202).json({ accepted: true, startedAt: applyJob.startedAt });
  });

  return router;
}

export default createUpdateRouter();
