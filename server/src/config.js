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

// M-14 修复：数值型环境变量统一做「有限值 + 上下界」校验，拒绝 NaN / 负数 / 极大值 / 上下界倒置。
// 错误配置（如把超时设成负数、把容量设成极大值）会导致 AbortSignal 抛异常、任务永不触发、
// 睡眠异常或资源被放大，故钳制到 [min,max] 并以 fallback 兜底。
export const boundedNum = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
};

// 默认凭据治理：API_TOKEN 未显式设置时生成随机值，避免静态可猜测 token 被滥用。
// 随机 token 每次启动都会变化（仅本地/测试场景），生产请显式设置固定 API_TOKEN。
const apiTokenFromEnv = process.env.API_TOKEN || null;
// 独立的管理员 Token：用于「系统更新」等高危操作，与通用 API_TOKEN 隔离（H2 修复）。
// 未显式设置时为空（走兜底：要求通用 API_TOKEN 且 REQUIRE_AUTH 开启，绝不匿名放行）。
const adminTokenFromEnv = process.env.ADMIN_TOKEN || null;
// 窄权限「安装令牌」：仅用于油猴脚本自动推送 Cookie（POST /users/import），
// 与通用 API_TOKEN / 独立 ADMIN_TOKEN 完全隔离。泄露后仅能新增/更新被录入的 smzdm 账号，
// 无法读取或删除已有数据；改 .env 的 INSTALL_TOKEN 即可立即吊销。默认空。
const installTokenFromEnv = process.env.INSTALL_TOKEN || null;

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  // 调试开关：仅当显式 ZDM_DEBUG=1 时，错误响应才向客户端回显 err.message 内部细节。
  // 默认关闭（即使 NODE_ENV 未设为 production），确保所有环境错误响应均泛化，杜绝内部路径/查询泄露（S10 纵深加固）。
  debug: process.env.ZDM_DEBUG === '1',
  requireAuth: parseBool(process.env.REQUIRE_AUTH, true),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  // 弱口令清单：显式使用这些值时即便非空也视为弱密码，启动时告警（避免 admin123 等"看似已设其实很弱"）。
  // 空值 → 回落到内置 'admin123' 兜底（adminPasswordIsDefault=true，同样告警）。
  adminPassword: process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length ? process.env.ADMIN_PASSWORD : 'admin123',
  // 标记是否仍在使用内置默认密码（未显式设置 ADMIN_PASSWORD），便于启动时给出安全告警
  adminPasswordIsDefault: !process.env.ADMIN_PASSWORD,
  // 弱密码标记：未设置 或 命中常见弱口令清单 → 鉴权开启时启动告警（纵深加固，堵住 .env.example 的 admin123 字面量）
  adminPasswordIsWeak:
    !process.env.ADMIN_PASSWORD ||
    new Set(['admin123', 'admin', 'password', '123456', 'root', 'changeme', 'qwerty', 'letmein']).has(
      String(process.env.ADMIN_PASSWORD).toLowerCase()
    ),
  // 前置代理已认证模式：当前置（Cloudflare Access / 宝塔 / nginx 密码等）已完成身份验证时，
  // 应用层不再校验 ADMIN_PASSWORD，login 自动放行并返回 token（写接口仍带 token）。
  // 仅当前置有可靠保护时开启，否则等同于把后台裸奔到公网。
  trustProxyAuth: parseBool(process.env.TRUST_PROXY_AUTH, false),
  // 可选：前置代理注入的「已认证用户」请求头（如 Cloudflare Access: Cf-Access-Authenticated-User-Email；
  // nginx auth_request: X-Forwarded-User）。配置后 login 会校验该头存在才放行；留空则只要 trustProxyAuth=true 即放行。
  proxyAuthHeader: process.env.PROXY_AUTH_HEADER || '',
  // 可选：前置代理来源 IP 白名单（逗号分隔，支持单 IP 或 CIDR，如 10.0.0.0/8,192.168.1.10,127.0.0.1）。
  // trustProxyAuth 模式下 login 代理分支仅当来源 IP 命中白名单才签发 Token；留空则不限制来源
  // （仅靠 proxyAuthHeader 存在性兜底 —— 直连暴露时攻击者可自带头绕过，故强烈建议同时配置本项与私有绑定）。
  proxyTrustedIps: process.env.PROXY_TRUSTED_IPS || '',
  // 开放模式（OPEN_MODE）：彻底移除所有身份验证与登录流程——所有业务/数据接口对匿名访客直接放行，
  // 无需 Token、无需登录、无需前置代理。用于「开放式录入系统」等受信任或隔离网络场景。
  // ⚠️ 高危操作（系统更新 requireAdmin，会执行 git pull + 重启）仍受 ADMIN_TOKEN 保护，不会被匿名放开。
  openMode: parseBool(process.env.OPEN_MODE, false),
  // 信任代理（开启后 req.ip 取 X-Forwarded-For 真实访客 IP）：开放录入的「同IP段可见」依赖真实访客 IP。
  // ⚠️ 安全（P0-2）：不再因 OPEN_MODE 自动开启——否则匿名可伪造 X-Forwarded-For 命中同 /24 网段判定，
  // 越权读取他人账号数据。仅在确有多层可信反代（Cloudflare/宝塔/nginx 已剥离客户端伪造的 XFF）时才显式设 TRUST_PROXY=true；
  // 直连暴露保持默认 false，此时 req.ip 为真实套接字对端、不可伪造。
  trustProxy: parseBool(process.env.TRUST_PROXY, false),
  // 公开服务基址（H-04 修复）：油猴安装脚本的「回传地址」改用此配置值，而非信任不可靠的 Host 头
  // （反代未严格限制 Host 时，攻击者可让脚本指向攻击者域名从而窃取 Cookie）。
  // 未设置时回退到 req.headers.host（仅开发态），生产部署请在 .env 显式设置 PUBLIC_BASE_URL。
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  apiToken: apiTokenFromEnv || crypto.randomBytes(24).toString('hex'),
  apiTokenIsDefault: !apiTokenFromEnv,
  // 独立管理员 Token（高危操作鉴权）。未配置时为空，由 requireAdmin 走兜底策略。
  adminToken: adminTokenFromEnv,
  adminTokenIsDefault: !adminTokenFromEnv,
  // 窄权限安装令牌（见 installTokenFromEnv）。默认空：OPEN_MODE 下 /users/import 本就匿名可调用；
  // REQUIRE_AUTH 下若未显式配置，油猴脚本将无法自动推送（避免把全权限 API_TOKEN 写进可分发脚本）。
  installToken: installTokenFromEnv,
  installTokenIsDefault: !installTokenFromEnv,
  smzdmAdapter: process.env.SMZDM_ADAPTER || 'mock',
  // real 适配器对外请求超时（毫秒），避免 smzdm 挂起时 Promise 永久 pending
  smzdmRequestTimeout: boundedNum(process.env.SMZDM_REQUEST_TIMEOUT, 1000, 60000, 10000),
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
  clockStaggerMs: boundedNum(process.env.CLOCK_STAGGER_MS, 0, 60000, 800),
  clockStaggerJitterMs: boundedNum(process.env.CLOCK_STAGGER_JITTER_MS, 0, 60000, 2000),
  // 单次签到失败重试：应对频率限制 / 网络抖动等瞬时错误（指数退避）。
  clockRetry: boundedNum(process.env.CLOCK_RETRY, 0, 10, 2),
  clockRetryBaseMs: boundedNum(process.env.CLOCK_RETRY_BASE_MS, 0, 60000, 2000),
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
  catchupGraceMin: boundedNum(process.env.CATCHUP_GRACE_MIN, 0, 1440, 180),
  // 智能启动调度宽限：账号启动时间已过、但距现在不超过该分钟数时，仍补跑一次（覆盖服务宕机/休眠），
  // 超过则跳过今天，避免"补签风暴"把 VPS 打爆。设 0 关闭补跑。默认 180（与 catchupGraceMin 一致）。
  startupGraceMin: boundedNum(process.env.STARTUP_GRACE_MIN, 0, 1440, 180),
  // Cookie 健康检测节流：每隔多少分钟对所有账号做一次 Cookie 探活（仅 real 模式）。
  // 防止高频无效请求；设 0 表示每轮 tick 都检测（不推荐）。默认 360（6 小时）。
  cookieHealthIntervalMin: boundedNum(process.env.COOKIE_HEALTH_INTERVAL_MIN, 0, 10080, 360),
  // 自动更新（从 Git 仓库拉取最新代码并重建/重启）：仅在 production 环境由调度器节流执行。
  // - updateCheckIntervalMin：定时检查更新的节流间隔（分钟），默认 1440（每天检查一次）；设 0 关闭自动检查。
  // - autoUpdateApply：检查到落后时是否自动拉取+重建+重启；默认 false（仅推送"有更新"通知，需手动点更新）。
  updateCheckIntervalMin: boundedNum(process.env.UPDATE_CHECK_INTERVAL_MIN, 0, 10080, 1440),
  autoUpdateApply: parseBool(process.env.AUTO_UPDATE_APPLY, false),
  // 风控（反检测/反封号）保守模式：默认开启，降低被 smzdm 风控识别/限流/封号概率。
  riskEnabled: parseBool(process.env.RISK_ENABLED, true),
  // 每次签到尝试前的"人类化随机等待"窗口（毫秒）：打破固定周期，避免请求过于机械。
  riskPreDelayMinMs: boundedNum(process.env.RISK_PRE_DELAY_MIN_MS, 0, 60000, 200),
  riskPreDelayMaxMs: boundedNum(process.env.RISK_PRE_DELAY_MAX_MS, 0, 60000, 1500),
  // 同一账号连续失败达到阈值后"熔断"冷却，期间跳过其自动签到，避免反复撞限流/风控被封。
  riskCircuitFailures: boundedNum(process.env.RISK_CIRCUIT_FAILURES, 0, 100, 5),
  riskCircuitCooldownMs: boundedNum(process.env.RISK_CIRCUIT_COOLDOWN_MIN, 0, 1440, 30) * 60000,
  // 自适应降频：连续失败越多，下次额外等待越长（温和降频），封顶 maxExtraMs。
  riskAdaptiveStepMs: boundedNum(process.env.RISK_ADAPTIVE_STEP_MS, 0, 600000, 2000),
  riskMaxExtraMs: boundedNum(process.env.RISK_MAX_EXTRA_MS, 0, 600000, 60000),
  // 互动（评论/点赞/收藏）拟人化随机延迟（毫秒）：每条操作之间等待不规则时长，
  // 打破固定频率，使行为更接近真人浏览，降低被 smzdm 风控识别为批量脚本的概率。
  engagementDelayMinMs: boundedNum(process.env.ENGAGEMENT_DELAY_MIN_MS, 0, 600000, 2000),
  engagementDelayMaxMs: boundedNum(process.env.ENGAGEMENT_DELAY_MAX_MS, 0, 600000, 15000),
  // 偶发"长思考"停顿：以该概率在基础延迟后再叠加一次更长随机等待（拟人不规律节奏）。设 0 关闭。
  engagementDelayLongProbability: boundedNum(process.env.ENGAGEMENT_DELAY_LONG_PROB, 0, 1, 0.15),
  engagementDelayLongMaxMs: boundedNum(process.env.ENGAGEMENT_DELAY_LONG_MAX_MS, 0, 600000, 30000),
  // 未配置 limit（随机挑选条数上限）时，baoliao 来源的默认随机取样区间（含端点）；
  // 实际取样数 = [min,max] 间随机整数（封顶为池大小），模拟真人"只挑部分好价互动"，而非全量遍历。
  engagementSampleDefaultMin: boundedNum(process.env.ENGAGEMENT_SAMPLE_MIN, 0, 100, 3),
  engagementSampleDefaultMax: boundedNum(process.env.ENGAGEMENT_SAMPLE_MAX, 0, 100, 12),
  // 持久化与容量上限（P1-4）：
  // - clockRecordsMaxPerUser：每个账号保留最近 N 条签到记录（按日期降序截断），防止 db.json 无限膨胀。
  //   设为 0 可关闭截断（不推荐，仅调试用）。
  clockRecordsMaxPerUser: boundedNum(process.env.CLOCK_RECORDS_MAX_PER_USER, 0, 100000, 365),
  // - maxUsers：录入账号总数硬上限，防止 OPEN_MODE 匿名录入或恶意刷量撑爆 db（P1-1 容量防护）。
  maxUsers: boundedNum(process.env.MAX_USERS, 1, 100000, 500),
  // 容量/截断上限（P2-8：收敛散落的魔法常量，集中可配、消除重复字面量）：
  // - maxBaoliaoItems：好价库保留 / 账本返回条数上限
  // - maxNoteLen：抓包备注 / referer 字符串截断上限（防超大字段撑爆 db）
  // - maxPageSize：签到记录等分页每页上限
  // - countMax/gptBatchMax/fetchMax：任务动作次数 / GPT 批量条数 / 抓取条数上限（原 taskRunner 局部常量）
  maxBaoliaoItems: boundedNum(process.env.MAX_BAOLIAO_ITEMS, 0, 100000, 500),
  maxNoteLen: boundedNum(process.env.MAX_NOTE_LEN, 0, 100000, 500),
  maxPageSize: boundedNum(process.env.MAX_PAGE_SIZE, 1, 10000, 200),
  countMax: boundedNum(process.env.COUNT_MAX, 0, 100, 5),
  gptBatchMax: boundedNum(process.env.GPT_BATCH_MAX, 0, 100, 10),
  fetchMax: boundedNum(process.env.FETCH_MAX, 0, 1000, 50),
};
