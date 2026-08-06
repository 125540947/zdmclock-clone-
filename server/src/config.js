import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .env 位于 monorepo 根目录（server/src -> ../../.env）
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const bool = (v, d = false) => {
  if (v === undefined) return d;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

// 默认凭据治理：API_TOKEN 未显式设置时生成随机值，避免静态可猜测 token 被滥用。
// 随机 token 每次启动都会变化（仅本地/测试场景），生产请显式设置固定 API_TOKEN。
const apiTokenFromEnv = process.env.API_TOKEN || null;

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  requireAuth: bool(process.env.REQUIRE_AUTH, false),
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
};
