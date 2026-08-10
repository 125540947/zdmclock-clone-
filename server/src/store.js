import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { resolvedCheckInTime, assignAutoCheckInTime } from './clockSchedule.js';

const DB_FILE = path.join(config.dataDir, 'db.json');

function defaultData() {
  return {
    users: [],
    clockRecords: [],
    baoliao: [],
    gptDrafts: [],
    tasks: [
      { id: 't_clock', type: 'clock', name: '每日签到', icon: '📅', enabled: true, cron: '* * * * *', lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_comment', type: 'comment', name: '自动评论', icon: '💬', enabled: false, cron: '0 10 * * *', articleId: '', articleSource: 'manual', lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_favorite', type: 'favorite', name: '自动收藏', icon: '⭐', enabled: false, cron: '0 11 * * *', articleId: '', articleSource: 'manual', lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_point', type: 'point', name: '自动点赞', icon: '👍', enabled: false, cron: '0 12 * * *', articleId: '', articleSource: 'manual', lastRun: null, lastResult: null, status: 'idle' },
      // GPT 定时批量生成：从好价列表取内容 → 大模型生成评论草稿（可选自动发布）
      { id: 't_gpt', type: 'gpt', name: 'GPT 批量生成', icon: '🤖', enabled: false, cron: '30 21 * * *', source: 'baoliao', autoPost: false, limit: 3, lastRun: null, lastResult: null, status: 'idle' },
      // 好价真实抓取：定时从 smzdm 公开好价列表抓取并写入 db.baoliao（best-effort，自动去重）
      { id: 't_fetch', type: 'fetch', name: '刷新好价', icon: '📥', enabled: false, cron: '0 8 * * *', limit: 20, lastRun: null, lastResult: null, status: 'idle' },
      // 任务矩阵补全（需抓包/其他接口来源）：抽奖/转盘/众测/关注/分享。
      // 这些端点 smzdm 未公开，需你从 App 抓包取得真实 URL/参数后，在「自动任务」页配置，
      // 系统对未配置的接口明确标记"待抓包"，绝不伪造成功（详见 taskMatrix.js）。
      { id: 't_lottery', type: 'lottery', name: '每日抽奖', icon: '🎰', enabled: false, cron: '0 9 * * *', needsEndpoint: true, lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_turntable', type: 'turntable', name: '转盘抽奖', icon: '🎡', enabled: false, cron: '5 9 * * *', needsEndpoint: true, lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_crowdtest', type: 'crowdtest', name: '众测申请', icon: '🧪', enabled: false, cron: '10 9 * * *', needsEndpoint: true, lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_follow', type: 'follow', name: '自动关注', icon: '➕', enabled: false, cron: '15 9 * * *', needsEndpoint: true, lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_share', type: 'share', name: '自动分享', icon: '🔗', enabled: false, cron: '20 9 * * *', needsEndpoint: true, lastRun: null, lastResult: null, status: 'idle' },
      // 每日任务（内置青龙社区逆向端点：list_v2 → activity_task_receive 批量领奖），无需抓包
      { id: 't_dailytasks', type: 'dailyTasks', name: '每日任务', icon: '📋', enabled: false, cron: '30 9 * * *', builtin: true, lastRun: null, lastResult: null, status: 'idle' }
    ],
    // 资产账本：模块 A（任务执行）落账，模块 B（资产仪表盘）读取。
    // 每次资产相关动作记录一条 {goldDelta,silverDelta,expDelta,...} 事件，供日收益曲线/任务贡献统计。
    assetLedger: [],
    // 每日资产快照（每用户每天保留最新总额），用于补齐历史日期的总量（避免只靠增量反推）
    assetSnapshots: [],
    // 任务接口配置（抓包结果）：taskType -> { endpoint, method, body, assetFields, note }
    // 仅自定义端点任务（needsEndpoint=true）需要；配置缺失时该任务标"待抓包"。
    settings: {
      // GPT 自动回复配置（前端开关与提示词存这里，后端据此是否真正调用大模型）
      gpt: { enabled: false, target: 'comment', tone: 'friendly', prompt: '' },
      // 推送通知配置（渠道 + 令牌）。env 的 PUSH_* 作为初始默认值，UI 可覆盖并持久化到 db
      push: {
        enabled: !!(config.pushChannel && config.pushChannel !== 'none' && (config.pushToken || config.pushWebhook || config.pushChatId)),
        channel: config.pushChannel || 'serverchan',
        token: config.pushToken || '',
        chatId: config.pushChatId || '',
        webhook: config.pushWebhook || ''
      },
      // 任务接口配置（抓包结果）：taskType -> { endpoint, method, body, assetFields, note }
      taskEndpoints: {}
    },
    meta: { version: 1 }
  };
}

let cache = null;

// 写串行化：所有"改内存 + persist()"通过同一 Promise 链，避免并发请求
// 在 await 边界互相穿插导致 lost-update（含真实双重签到竞态）。
let writeChain = Promise.resolve();
export function withWriteLock(fn) {
  const run = writeChain.then(fn, fn);
  // 无论成功失败都继续链条，避免单个写失败卡死后续写
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function ensureDir() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

export function load() {
  if (cache) return cache;
  ensureDir();
  if (!fs.existsSync(DB_FILE)) {
    cache = defaultData();
    persistNow();
    return cache;
  }
  try {
    cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch {
    // R3：解析失败时先备份损坏文件，再重置为空库，避免静默清空无法恢复
    try {
      const backup = DB_FILE + '.corrupt-' + Date.now();
      fs.copyFileSync(DB_FILE, backup);
      // eslint-disable-next-line no-console
      console.error('[store] db.json 解析失败，已备份为', backup);
    } catch {
      /* 备份失败不影响重置 */
    }
    cache = defaultData();
  }
  const d = defaultData();
  cache.users = cache.users || [];
  cache.clockRecords = cache.clockRecords || [];
  cache.baoliao = cache.baoliao || [];
  cache.gptDrafts = Array.isArray(cache.gptDrafts) ? cache.gptDrafts : [];
  cache.assetLedger = Array.isArray(cache.assetLedger) ? cache.assetLedger : [];
  cache.assetSnapshots = Array.isArray(cache.assetSnapshots) ? cache.assetSnapshots : [];
  cache.tasks = cache.tasks && cache.tasks.length ? cache.tasks : d.tasks;
  // 兼容旧库：补齐非签到任务的字段（articleSource / articleId），并补上新增的默认任务（如 t_gpt）
  cache.tasks.forEach((t) => {
    if (t.type !== 'clock') {
      if (!('articleId' in t)) t.articleId = '';
      if (!('articleSource' in t)) t.articleSource = 'manual';
    }
  });
  for (const dt of d.tasks) {
    if (!cache.tasks.some((t) => t.id === dt.id)) cache.tasks.push(dt);
  }
  // 规范化 t_gpt 批量生成相关字段，避免旧库配置异常
  const gptTask = cache.tasks.find((t) => t.id === 't_gpt');
  if (gptTask) {
    gptTask.source = gptTask.source === 'manual' ? 'manual' : 'baoliao';
    gptTask.autoPost = !!gptTask.autoPost;
    const lim = Number(gptTask.limit);
    gptTask.limit = Number.isFinite(lim) && lim >= 1 ? Math.min(10, Math.floor(lim)) : 3;
  }
  // 规范化 t_fetch 抓取条数，避免旧库配置异常（1~50）
  const fetchTask = cache.tasks.find((t) => t.id === 't_fetch');
  if (fetchTask) {
    const fl = Number(fetchTask.limit);
    fetchTask.limit = Number.isFinite(fl) && fl >= 1 ? Math.min(50, Math.floor(fl)) : 20;
  }
  // settings.gpt 合并：保留已有配置，缺省补齐，避免旧库无 settings 字段时报错
  cache.settings = cache.settings && typeof cache.settings === 'object' ? cache.settings : {};
  cache.settings.gpt =
    cache.settings.gpt && typeof cache.settings.gpt === 'object'
      ? { ...d.settings.gpt, ...cache.settings.gpt }
      : { ...d.settings.gpt };
  // settings.push 合并：保留已有配置，缺省补齐，避免旧库无 push 字段时报错
  cache.settings.push =
    cache.settings.push && typeof cache.settings.push === 'object'
      ? { ...d.settings.push, ...cache.settings.push }
      : { ...d.settings.push };
  // settings.taskEndpoints 合并：保留已有抓包配置，缺省补空对象
  cache.settings.taskEndpoints =
    cache.settings.taskEndpoints && typeof cache.settings.taskEndpoints === 'object'
      ? cache.settings.taskEndpoints
      : {};
  // 用户签到时间字段迁移：新增 schedMode / checkInTime。
  // 旧账号（无 schedMode）默认设为 'auto'，并由系统在其窗口内确定性分配一个分散的固定时间，
  // 直接解决"多账号同一秒扎堆签到"触发限流/漏签的问题。新账号在录入时即写入这两个字段。
  let migrated = false;
  cache.users.forEach((u) => {
    if (!u.schedMode) {
      u.schedMode = 'auto';
      migrated = true;
    }
    if (u.schedMode === 'auto') {
      // 固化系统分配的时间（确定性、稳定），便于后台展示与统计；缺省时按 userId 哈希重算
      u.checkInTime = resolvedCheckInTime(u);
    }
    // 登录失效标记：旧库缺省补 false（风控包会按需置 true 并持久化）
    if (u.cookieExpired === undefined) u.cookieExpired = false;
    // 资产快照：旧库缺省初始化（gold 以既有 points 为准，silver/exp 留空待真实接口刷新）
    if (!u.assets) {
      u.assets = {
        gold: Number(u.points || 0),
        silver: 0,
        exp: 0,
        level: u.level || null,
        updatedAt: null
      };
    }
  });
  // t_clock 任务 cron 迁移：旧版 '0 9 * * *'（全员 09:00 一次性签到）改为每分钟轮询，
  // 由调度器按各账号个人时间过滤执行，从而实现错峰。仅当仍是旧默认值时迁移，避免覆盖用户自定义。
  const clockTask = cache.tasks.find((t) => t.id === 't_clock');
  if (clockTask && clockTask.cron === '0 9 * * *') {
    clockTask.cron = config.clockTaskCron;
    migrated = true;
  }
  // 启动期清理旧库超出的签到记录（内存截断），仅在实际发生迁移或截断时落盘一次
  const capped = enforceClockCap();
  if (migrated || capped) persistNow();
  return cache;
}

// 滚动上限（P1-4）：每个 userId 保留最近 N 条签到记录（按日期降序截断），防止 db.json 无限膨胀。
// 返回是否发生截断（供 load 决定是否需启动期落盘一次）。
function enforceClockCap() {
  const cap = config.clockRecordsMaxPerUser;
  const recs = cache && cache.clockRecords;
  if (!Array.isArray(recs) || recs.length === 0 || !cap || cap <= 0) return false;
  // 快速跳过：账号数 * cap 内基本不可能超限，避免无谓的分组/排序开销
  const guard = (cache.users ? cache.users.length : 0) * cap + 64;
  if (recs.length <= guard) return false;
  const groups = new Map();
  for (const r of recs) {
    const k = r && r.userId != null ? String(r.userId) : '__null__';
    let arr = groups.get(k);
    if (!arr) {
      arr = [];
      groups.set(k, arr);
    }
    arr.push(r);
  }
  let total = 0;
  for (const arr of groups.values()) {
    if (arr.length > cap) {
      arr.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      arr.length = cap;
    }
    total += arr.length;
  }
  if (total < recs.length) {
    cache.clockRecords = [].concat(...groups.values());
    return true;
  }
  return false;
}

// 同步立即写（原子 tmp+rename）：用于启动初始化、数据迁移、关键配置落盘（需立即生效）。
export function persistNow() {
  if (!cache) return; // 防御：load 之前调用不写空文件
  enforceClockCap();
  ensureDir();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function writeDbAsync() {
  if (!cache) return Promise.resolve();
  enforceClockCap();
  ensureDir();
  const tmp = DB_FILE + '.tmp';
  return fs.promises
    .writeFile(tmp, JSON.stringify(cache, null, 2))
    .then(() => fs.promises.rename(tmp, DB_FILE));
}

let persistTimer = null;
// 合并写（P1-4）：高频业务成功落账走这里，windowMs 内多次调用合并为一次异步写，
// 减少 IO 次数、避免同步写大文件阻塞事件循环。
export function persistSoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    writeDbAsync().catch((e) => console.error('[store] persistSoon 写失败', e && e.message));
  }, 1200);
}

// 进程退出兜底：同步立即落盘（SIGTERM/SIGINT 调用），确保 debounce 窗口内的修改不丢失。
export function flushPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistNow();
}

// 兼容入口：默认走合并写（高频业务无需等待落盘）；关键路径请用 persistNow。
export function persist() {
  persistSoon();
}

export function genId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// 合并抓取到的好价：按 smzdmUrl 去重，新增返回条数。
// 边界处理：① cache 未初始化直接返回 0；② 仅接受合法 http(s) 链接；
// ③ 已存在的同链接跳过；④ 字段长度钳制，避免异常数据撑爆库。
// 调用方需在 withWriteLock 内调用，确保与 persist() 原子。
export function mergeBaoliao(items = []) {
  if (!cache) return 0;
  if (!Array.isArray(items)) return 0;
  let added = 0;
  const now = new Date().toISOString();
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const url = String(it.smzdmUrl || it.url || '').trim();
    if (!/^https?:\/\//i.test(url)) continue; // 只接受合法 http(s) 链接
    if (cache.baoliao.some((x) => (x.smzdmUrl || x.url || '') === url)) continue;
    cache.baoliao.unshift({
      id: genId('bl'),
      userId: null,
      title: String(it.title || '').slice(0, 200),
      url: String(it.url || '').slice(0, 2000),
      price: String(it.price || '').slice(0, 50),
      cat: '',
      content: String(it.content || '').slice(0, 2000),
      status: 'fetched',
      smzdmUrl: url,
      lastResult: '',
      createdAt: now,
      updatedAt: now
    });
    added += 1;
  }
  // R5：限制好价库上限，避免长期运行后 db.json 无限膨胀（超出部分丢弃最旧）
  if (cache.baoliao.length > config.maxBaoliaoItems) cache.baoliao.length = config.maxBaoliaoItems;
  return added;
}

// 统一使用「本地时区」日期，避免 UTC 与本地混用导致重复签到 / 连续天数错乱
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr(d = new Date()) {
  return localDateStr(d);
}

// 时区感知的"今天"：按指定 IANA 时区折算墙钟日期，解决容器 UTC 导致签到日期/时间整体偏移。
export function todayStrTZ(tz, d = new Date()) {
  if (!tz || tz === 'local' || tz === 'UTC') return localDateStr(d);
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const p = {};
  for (const part of dtf.formatToParts(d)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

// 时区感知"昨天"：在指定时区下，today 的前一天（用于连续签到天数判定）。
export function yesterdayStrTZ(tz, d = new Date()) {
  // 取该时区 today 的"正午"瞬间，回退 1 天后再折算，规避 DST/跨日边界误差
  const noon = new Date(d);
  noon.setHours(12, 0, 0, 0);
  const today = todayStrTZ(tz, noon);
  const [y, m, day] = today.split('-').map(Number);
  const dt = new Date(y, m - 1, day);
  dt.setDate(dt.getDate() - 1);
  return localDateStr(dt);
}
