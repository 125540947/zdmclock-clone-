// 部署溯源（AUDIT 2026-09-04 中优先级）：进程启动即采集「运行版本」快照，
// 供 /api/deploy 在 HTTP 层直接核验「线上到底跑的是哪个 commit」，
// 避免再次出现「代码已改、VPS 却仍跑旧版」的排查盲区。
// 设计要点：
//  - 仅含非密钥信息（commit / buildTime / 配置布尔开关），绝不回显 Token / Cookie / 密码；
//  - commit 优先取部署时注入的 GIT_COMMIT 环境变量（CI/部署脚本可显式传入），
//    否则现场 `git rev-parse HEAD` 探测，再不行标 'unknown'——全程 best-effort，绝不阻断启动；
//  - 在模块加载（即进程启动）时采集一次为单例，避免每次请求都跑 git 子进程。
import { execFileSync } from 'node:child_process';
import { config } from './config.js';

function detectCommit() {
  if (process.env.GIT_COMMIT) {
    return String(process.env.GIT_COMMIT).trim().slice(0, 40);
  }
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000
    });
    const c = out.toString().trim();
    if (/^[0-9a-f]{40}$/.test(c)) return c;
  } catch {
    // git 不可用 / 不在仓库内 / 超时：降级为 unknown，不致命
  }
  return 'unknown';
}

export const deployMeta = {
  // 进程启动时刻（ISO8601），即「构建/部署生效时间」的可信近似
  buildTime: new Date().toISOString(),
  // 运行版本 commit（40 位 hex 或 'unknown'）
  commit: detectCommit(),
  // 非密钥配置摘要：只暴露开关与绑定信息，不泄露任何凭据/数据
  config: {
    nodeEnv: config.nodeEnv,
    adapter: config.smzdmAdapter,
    requireAuth: config.requireAuth,
    openMode: config.openMode,
    trustProxy: config.trustProxy ? (config.proxyTrustedSubnet || 'loopback') : false,
    bindAddress: config.bindAddress,
    port: config.port,
    tz: config.tz,
    smzdmDebug: process.env.SMZDM_DEBUG === '1',
    apiTokenSet: !config.apiTokenIsDefault,
    adminTokenSet: !!config.adminToken,
    gptEnabled: config.gptEnabled
  }
};

export function getDeployMeta() {
  return deployMeta;
}
