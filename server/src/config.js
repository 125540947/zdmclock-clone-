import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .env 位于 monorepo 根目录（server/src -> ../../.env）
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// 解析布尔型环境变量（导出便于单测，语义不变）
export const parseBool = (v, d = false) => {
  if (v === undefined) return d;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

// 默认凭据治理：API_TOKEN 未显式设置时生成随机值，避免静态可猜测 token 被滥用。
// 随机 token 每次启动都会变化（仅本地/测试场景），生产请显式设置固定 API_TOKEN。
const apiTokenFromEnv = process.env.API_TOKEN || null;

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  requireAuth: parseBool(process.env.REQUIRE_AUTH, false),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  // 标记是否仍在使用内置默认密码，便于启动时给出安全告警
  adminPasswordIsDefault: !process.env.ADMIN_PASSWORD,
  apiToken: apiTokenFromEnv || crypto.randomBytes(24).toString('hex'),
  apiTokenIsDefault: !apiTokenFromEnv,
  smzdmAdapter: process.env.SMZDM_ADAPTER || 'mock',
  // real 适配器对外请求超时（毫秒），避免 smzdm 挂起时 Promise 永久 pending
  smzdmRequestTimeout: Number(process.env.SMZDM_REQUEST_TIMEOUT || 10000),
  // GPT 自动回复（OpenAI 兼容接口）。未设置 GPT_API_KEY 时视为未配置，/api/gpt/reply 拒绝调用
  gptApiKey: process.env.GPT_API_KEY || '',
  gptApiBase: (process.env.GPT_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, ''),
  gptModel: process.env.GPT_MODEL || 'gpt-4o-mini',
  gptEnabled: !!process.env.GPT_API_KEY,
  // 推送通知（可选）：渠道 + 凭据，作为初始默认；UI 配置会持久化覆盖（见 db.settings.push）
  // channel: serverchan | bark | telegram | webhook；留空表示未配置
  pushChannel: process.env.PUSH_CHANNEL || '',
  pushToken: process.env.PUSH_TOKEN || '',
  pushChatId: process.env.PUSH_CHAT_ID || '',
  pushWebhook: process.env.PUSH_WEBHOOK || '',
  dataDir: path.resolve(__dirname, '..', process.env.DATA_DIR || './data'),
  webDist: path.resolve(__dirname, '..', process.env.WEB_DIST || '../web/dist'),
  // 多账号签到错峰：第 2 个起每个账号额外等待「固定间隔 + 随机抖动」毫秒，
  // 避免同一秒扎堆请求 smzdm 触发限流/风控导致漏签。设为 0 可关闭错峰。
  clockStaggerMs: Number(process.env.CLOCK_STAGGER_MS || 800),
  clockStaggerJitterMs: Number(process.env.CLOCK_STAGGER_JITTER_MS || 2000),
  // 单次签到失败重试：应对频率限制 / 网络抖动等瞬时错误（指数退避）。
  clockRetry: Number(process.env.CLOCK_RETRY || 2),
  clockRetryBaseMs: Number(process.env.CLOCK_RETRY_BASE_MS || 2000),
  // 签到时间调度：
  // - defaultCheckInTime：schedMode='default' 账号（沿用旧版"统一 09:00"）的签到时间
  // - autoWindowStart/End：schedMode='auto' 账号由系统在该窗口内确定性分散分配一个固定时间
  // - clockTaskCron：每日签到任务的触发 cron；设为每分钟轮询 '* * * * *'，
  //   由调度器按各账号个人时间过滤执行（而非一次性全员签到）
  defaultCheckInTime: process.env.DEFAULT_CHECKIN_TIME || '09:00',
  autoWindowStart: process.env.AUTO_WINDOW_START || '08:00',
  autoWindowEnd: process.env.AUTO_WINDOW_END || '10:59',
  clockTaskCron: process.env.CLOCK_TASK_CRON || '* * * * *',
  // 时区：调度"今天/当前分钟"以此判定，解决容器 UTC 导致签到时间整体偏移的问题。
  // 默认 'local' 沿用进程本地时区（与历史行为一致）；生产部署请设 ZDM_TZ=Asia/Shanghai。
  tz: process.env.ZDM_TZ || 'local',
  // 补签宽限：个人签到时间已过、但距现在不超过该分钟数时，仍补签一次，
  // 覆盖"服务宕机/休眠/刚部署"期间错过的签到（避免永久漏签）。设 0 关闭补签。
  catchupGraceMin: Number(process.env.CATCHUP_GRACE_MIN || 180),
  // 风控（反检测/反封号）保守模式：默认开启，降低被 smzdm 风控识别/限流/封号概率。
  riskEnabled: parseBool(process.env.RISK_ENABLED, true),
  // 每次签到尝试前的"人类化随机等待"窗口（毫秒）：打破固定周期，避免请求过于机械。
  riskPreDelayMinMs: Number(process.env.RISK_PRE_DELAY_MIN_MS || 200),
  riskPreDelayMaxMs: Number(process.env.RISK_PRE_DELAY_MAX_MS || 1500),
  // 同一账号连续失败达到阈值后"熔断"冷却，期间跳过其自动签到，避免反复撞限流/风控被封。
  riskCircuitFailures: Number(process.env.RISK_CIRCUIT_FAILURES || 5),
  riskCircuitCooldownMs: Number(process.env.RISK_CIRCUIT_COOLDOWN_MIN || 30) * 60000,
  // 自适应降频：连续失败越多，下次额外等待越长（温和降频），封顶 maxExtraMs。
  riskAdaptiveStepMs: Number(process.env.RISK_ADAPTIVE_STEP_MS || 2000),
  riskMaxExtraMs: Number(process.env.RISK_MAX_EXTRA_MS || 60000),
};
