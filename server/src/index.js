import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import clockRoutes from './routes/clock.js';
import taskRoutes from './routes/tasks.js';
import adminRoutes from './routes/admin.js';
import baoliaoRoutes from './routes/baoliao.js';
import gptRoutes from './routes/gpt.js';
import notifyRoutes from './routes/notify.js';
import assetsRoutes from './routes/assets.js';
import healthRoutes from './routes/health.js';
import updateRoutes from './routes/update.js';
import extremeLazyRoutes from './routes/extremeLazy.js';
import { startScheduler, isSchedulerRunning } from './scheduler.js';

// 构建并配置 Express 应用（不在此处监听端口，便于测试复用同一份中间件装配）
export function createApp() {
  const app = express();
  // CORS：默认仅同源（生产由本服务托管前端、开发由 Vite 代理，正常情况下无需跨域）。
  // 如需跨域部署（前端在独立域名），设置环境变量 CORS_ORIGIN="https://your.domain"
  // 或逗号分隔的多个域名；未设置时 origin:false 不返回 Access-Control-Allow-Origin，杜绝任意域调用。
  const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : false;
  app.use(cors({ origin: corsOrigins }));
  app.use(express.json());

  // 健康检查
  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      env: config.nodeEnv,
      adapter: config.smzdmAdapter,
      scheduler: isSchedulerRunning() ? 'on' : 'off', // b8：如实反映调度状态
      port: config.port
    });
  });

  // API 路由
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/clock', clockRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/baoliao', baoliaoRoutes);
  app.use('/api/gpt', gptRoutes);
  app.use('/api/notify', notifyRoutes);
  app.use('/api/assets', assetsRoutes);
  app.use('/api/health', healthRoutes);
  app.use('/api/update', updateRoutes);
  app.use('/api/extreme-lazy', extremeLazyRoutes);

  // 生产环境：托管前端构建产物（单进程对外）
  if (config.nodeEnv === 'production' && fs.existsSync(config.webDist)) {
    app.use(express.static(config.webDist));
    app.get('*', (req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  }

  // 兜底错误处理
  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-console
    console.error('[error]', err);
    // S10：生产环境不向外暴露内部错误细节（可能含路径），返回泛化消息
    const message = config.nodeEnv === 'production' ? '服务器内部错误' : err.message;
    res.status(500).json({ error: 'server_error', message });
  });

  return app;
}

const app = createApp();

const __filename = fileURLToPath(import.meta.url);
// 仅当以入口模块方式运行（node src/index.js / npm start）才真正监听，
// 被测试动态 import 时不触发，避免测试进程绑定端口 / 启动真实调度。
const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMain) {
  app.listen(config.port, () => {
    // R4：仅在 production 启动定时调度，避免开发态意外触发真实签到
    if (config.nodeEnv === 'production') {
      startScheduler();
    } else {
      // eslint-disable-next-line no-console
      console.warn('[zdmclock] 非 production 环境，定时调度已禁用（开发态不会自动真实签到）。');
    }
    // eslint-disable-next-line no-console
    console.log(
      `[zdmclock] server listening on http://localhost:${config.port} ` +
        `(env=${config.nodeEnv}, adapter=${config.smzdmAdapter}, auth=${config.requireAuth}, scheduler=${isSchedulerRunning() ? 'on' : 'off'})`
    );
    // 安全告警：默认配置偏向「开箱即跑」，但公网暴露前必须收紧
    if (!config.requireAuth) {
      // eslint-disable-next-line no-console
      console.warn(
        '[zdmclock][安全] REQUIRE_AUTH=false —— 所有写接口与管理接口免鉴权。' +
          '公网部署前务必设为 true 并修改 ADMIN_PASSWORD / API_TOKEN。'
      );
    }
    if (config.apiTokenIsDefault) {
      // eslint-disable-next-line no-console
      console.warn(
        '[zdmclock][安全] 未设置 API_TOKEN，本次已生成随机 Token（重启后变更）。' +
          '如需固定 Token 或启用鉴权，请在 .env 显式设置 API_TOKEN。'
      );
    }
    if (config.adminPasswordIsDefault && config.requireAuth) {
      // eslint-disable-next-line no-console
      console.warn('[zdmclock][安全] 仍在使用默认管理员密码 admin123，请尽快设置强 ADMIN_PASSWORD。');
    }
  });
}

export { app };
