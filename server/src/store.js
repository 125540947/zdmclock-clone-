import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { resolvedCheckInTime } from './clockSchedule.js';

const DB_FILE = path.join(config.dataDir, 'db.json');

function defaultData() {
  return {
    users: [],
    clockRecords: [],
    baoliao: [],
    gptDrafts: [],
    tasks: [
      { id: 't_clock', type: 'clock', name: '每日签到', icon: '📅', enabled: true, cron: '* * * * *', lastRun: null, lastResult: null, status: 'idle' },
      // 智能启动调度：每个账号在各自错峰的启动时间自动跑完
      // 完整日常流水线（签到+互动+抽奖等）。启用后，主调度不再对账号级任务按固定 cron 全员同刻触发，
      // 改由本任务按账号错峰统一跑（第一定律：避免多账号同时启动把 VPS 打爆）。
      { id: 't_startup', type: 'startup', name: '智能启动调度', icon: '🚀', enabled: true, cron: '* * * * *', lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_comment', type: 'comment', name: '自动评论', icon: '💬', enabled: false, cron: '0 9,12,15,18,21 * * *', articleId: '', articleSource: 'manual', commentQueue: [], commentCampaignDate: null, commentCampaignTotal: 0, lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_favorite', type: 'favorite', name: '自动收藏', icon: '⭐', enabled: false, cron: '0 11 * * *', articleId: '', articleSource: 'manual', lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_point', type: 'point', name: '自动点赞', icon: '👍', enabled: false, cron: '0 12 * * *', articleId: '', articleSource: 'manual', lastRun: null, lastResult: null, status: 'idle' },
      // GPT 定时批量生成：从好价列表取内容 → 大模型生成评论草稿（可选自动发布）
      { id: 't_gpt', type: 'gpt', name: 'GPT 批量生成', icon: '🤖', enabled: false, cron: '30 21 * * *', source: 'baoliao', autoPost: false, limit: 3, lastRun: null, lastResult: null, status: 'idle' },
      // 官方 RSS 好价抓取：每天定时写入 db.baoliao（无需 Cookie，自动去重）
      { id: 't_fetch', type: 'fetch', name: '刷新好价', icon: '📥', enabled: true, cron: '0 8 * * *', limit: 20, lastRun: null, lastResult: null, status: 'idle' },
      // 任务矩阵补全（需抓包/其他接口来源）：抽奖/转盘/众测/关注/分享。
      // 这些端点 smzdm 未公开，需你从 App 抓包取得真实 URL/参数后，在「自动任务」页配置，
      // 系统对未配置的接口明确标记"待抓包"，绝不伪造成功（详见 taskMatrix.js）。
      { id: 't_lottery', type: 'lottery', name: '每日抽奖', icon: '🎰', enabled: false, cron: '0 9 * * *', needsEndpoint: true, lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_turntable', type: 'turntable', name: '转盘抽奖', icon: '🎡', enabled: false, cron: '5 9 * * *', needsEndpoint: true, lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_crowdtest', type: 'crowdtest', name: '众测申请', icon: '🧪', enabled: false, cron: '10 9 * * *', needsEndpoint: true, lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_follow', type: 'follow', name: '自动关注', icon: '➕', enabled: false, cron: '15 9 * * *', needsEndpoint: true, lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_share', type: 'share', name: '自动分享', icon: '🔗', enabled: false, cron: '20 9 * * *', needsEndpoint: true, lastRun: null, lastResult: null, status: 'idle' },
      // 每日任务（动态读取 list_v2 → 完成支持的活动任务 → 刷新并领取奖励），无需抓包
      { id: 't_dailytasks', type: 'dailyTasks', name: '每日任务', icon: '📋', enabled: true, cron: '30 9 * * *', builtin: true, lastRun: null, lastResult: null, status: 'idle' }
    ],
    // 任务执行明细（"每天哪些任务做了/失败/原因"）：每次 runTask 追加一条结构化记录，
    // 由 taskRunLog.js 维护，tools/taskReport.mjs 与状态页读取。滚动保留（见 MAX_TASK_RUNS）。
    taskRuns: [],
    // 资产账本：模块 A（任务执行）落账，模块 B（资产仪表盘）读取。
    // 每次资产相关动作记录一条 {goldDelta,silverDelta,expDelta,...} 事件，供日收益曲线/任务贡献统计。
    assetLedger: [],
    // 每日资产快照（每用户每天保留最新总额），用于补齐历史日期的总量（避免只靠增量反推）
    assetSnapshots: [],
    // 任务接口配置（抓包结果）：taskType -> { endpoint, method, body, assetFields, note }
    // 仅自定义端点任务（needsEndpoint=true）需要；配置缺失时该任务标"待抓包"。
    settings: {
      // GPT 自动回复配置（前端开关与提示词存这里，后端据此是否真正调用大模型）
      // apiKey 仅持久化在服务端数据文件中；任何 API 响应都不得回传明文（见 routes/gpt.js）。
      // apiBase / model 留空时继续使用 .env 中的 GPT_API_BASE / GPT_MODEL，保持旧部署兼容。
      gpt: { enabled: false, target: 'comment', tone: 'friendly', prompt: '', apiKey: '', apiBase: '', model: '' },
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
  cache.taskRuns = Array.isArray(cache.taskRuns) ? cache.taskRuns : [];
  cache.tasks = cache.tasks && cache.tasks.length ? cache.tasks : d.tasks;
  // 兼容旧库：补齐非签到任务的字段（articleSource / articleId），并补上新增的默认任务（如 t_gpt）
  cache.tasks.forEach((t) => {
    if (t.type !== 'clock') {
      if (!('articleId' in t)) t.articleId = '';
      if (!('articleSource' in t)) t.articleSource = 'manual';
      // 批次 37：分时段评论队列字段迁移（旧库缺省补空，避免 runEngagement 读 undefined 报错）
      if (!('commentQueue' in t)) t.commentQueue = [];
      if (!('commentCampaignDate' in t)) t.commentCampaignDate = null;
      if (!('commentCampaignTotal' in t)) t.commentCampaignTotal = 0;
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
    // 智能启动调度第一定律：不再允许"系统默认=全员同刻 09:00"的碰撞模式，
    // 旧 'default' 账号统一转为 'auto'（系统错峰分配），避免多账号同时启动造成 VPS 卡顿。
    if (u.schedMode === 'default') {
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
  // 自动评论任务 cron 迁移：旧版 '0 10 * * *'（每天 10:00 一次性评完 ~12 篇）改为多时段轮询
  // '0 9,12,15,18,21 * * *'，配合 commentQueue 把 12 篇拆成多个时间片（每片约 3 篇）逐步消化，
  // 实现"分时间段拟人回复"。仅当仍是旧默认值时迁移，避免覆盖用户自定义 cron。
  const commentTask = cache.tasks.find((t) => t.id === 't_comment');
  if (commentTask && commentTask.cron === '0 10 * * *') {
    commentTask.cron = '0 9,12,15,18,21 * * *';
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
  // 快速跳过：单账号记录数不可能超过总记录数；若总记录数 <= 每账号上限，则任一口径下都不可能
  // 有账号超限，可安全跳过分组/截断（M-11 修复：原 guard = 账号数*cap+64 过于宽松，单账号可远超
  // cap 却仍被跳过，导致 db.json 长期不截断）。
  if (recs.length <= cap) return false;
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

// #183 单写者：所有异步落盘串入同一条 Promise 链，避免并发 persistSoon / 多次触发时
// 对同一个 .tmp 文件产生交错的写操作（rename 原子但 writeFile 非原子，且无序并发可能写坏文件）。
// 注意：此处的 persistChain 与上方 withWriteLock 的 writeChain 是两回事——前者串行化磁盘写，
// 后者串行化内存变更；二者正交。
let persistChain = Promise.resolve();
function doWrite() {
  if (!cache) return undefined;
  enforceClockCap();
  ensureDir();
  const tmp = DB_FILE + '.tmp';
  return fs.promises
    .writeFile(tmp, JSON.stringify(cache, null, 2))
    .then(() => fs.promises.rename(tmp, DB_FILE));
}
function scheduleWrite() {
  const run = persistChain.then(doWrite, doWrite);
  // 无论成功失败都继续链条，避免单次写失败卡死后续写
  persistChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

let persistTimer = null;
// 合并写（P1-4）：高频业务成功落账走这里，windowMs 内多次调用合并为一次异步写，
// 减少 IO 次数、避免同步写大文件阻塞事件循环。
export function persistSoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    scheduleWrite().catch((e) => console.error('[store] persistSoon 写失败', e && e.message));
  }, 1200);
}

// 进程退出兜底：先等待任何在途异步写（单写者）完成，再做一次同步立即落盘，
// 确保 debounce 窗口内的修改与尚未完成的异步写都不丢失（SIGTERM/SIGINT 调用）。
export async function flushPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    await persistChain;
  } catch {
    /* 在途写失败不影响最终同步落盘 */
  }
  persistNow();
}

// 兼容入口：默认走合并写（高频业务无需等待落盘）；关键路径请用 persistNow。
export function persist() {
  persistSoon();
}

// M-04 修复：关键写接口（录入/改删账号、签到、系统配置）应在数据真正落盘后才向调用方确认成功，
// 避免 debounce 窗口（1.2s）内进程被杀（SIGKILL / 崩溃 / 断电）导致"已确认成功"的数据丢失。
// 此变体跳过合并写的定时器，立即串行化到写链并 await 真实磁盘写（tmp+rename）完成后再 resolve；
// 同时清掉待执行的 debounce 定时器，避免重复写。调用方应 `await withWriteLock(() => persistAwait())`，
// 使响应在磁盘写完成前不返回成功。
export function persistAwait() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  return scheduleWrite();
}

// A-10：统一「改内存 + 落盘」语义，消除各写路由重复 withWriteLock(() => { ...; return persistAwait(); }) 样板，
// 并降低新增路由时漏写 persistAwait 的概率（历史曾因 health.js 漏写导致 POST /api/health/cookies 有账号时 500）。
// fn(db) 在写锁内执行其返回值（如 notFound 标记）经 mutateDb 透传给调用方；落盘在锁内 await 完成后才 resolve。
// 用法：const notFound = await mutateDb((db) => { const i = db.x.findIndex(...); if (i<0) return true; db.x.splice(i,1); return false; });
//       if (notFound) return res.status(404).json({ error: 'not_found' });
// 仅含纯内存变更的写路由可用；含网络 I/O 的写路由须把网络调用放在锁外、仅把内存改写+落盘移入 mutateDb。
export function mutateDb(fn) {
  return withWriteLock(() => {
    const db = load();
    const result = fn(db);
    return persistAwait().then(() => result);
  });
}

export function genId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// 合并抓取到的好价：按 smzdmUrl 去重，新增返回条数。
// 边界处理：① cache 未初始化直接返回 0；② 仅接受合法 http(s) 链接；
// ③ 已存在的同链接跳过；④ 字段长度钳制，避免异常数据撑爆库。
// 调用方需在 withWriteLock 内调用，确保与 persist() 原子。
// recordedIp：可选，录入者来源 IP（开放模式批量导入时由路由传入 viewer IP），
// 使录入者随后在 /24 网段隔离下仍可见自己导入的好价（M-02 修复）。系统抓取（/refresh、taskRunner）不传，置 null。
export function mergeBaoliao(items = [], recordedIp) {
  if (!cache) return 0;
  if (!Array.isArray(items)) return 0;
  let added = 0;
  const now = new Date().toISOString();
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const url = String(it.smzdmUrl || it.url || '').trim();
    if (!/^https?:\/\//i.test(url)) continue; // 只接受合法 http(s) 链接
    const existing = cache.baoliao.find((x) => (x.smzdmUrl || x.url || '') === url);
    if (existing) {
      // 幂等：重导相同链接时补齐元数据。RSS 可为浏览器仅导入链接的旧条目补上标题/价格，
      // 但不覆盖浏览器已经取得的长正文。
      const previousTitle = String(existing.title || '');
      const canUpdateTitle = !previousTitle || /^文章 \d+$/.test(previousTitle) || existing.source === 'smzdm-rss';
      const canUpdateContent =
        !existing.content || existing.content === previousTitle || existing.source === 'smzdm-rss';
      if (it.channelId) existing.channelId = String(it.channelId).slice(0, 20);
      if (it.title && canUpdateTitle) {
        existing.title = String(it.title).slice(0, 200);
      }
      if (it.price) existing.price = String(it.price).slice(0, 50);
      let contentUpdated = false;
      if (it.content && canUpdateContent) {
        existing.content = String(it.content).slice(0, 2000);
        contentUpdated = true;
      }
      if (it.source && (!existing.source || existing.source === 'smzdm-rss' || contentUpdated)) {
        existing.source = String(it.source).slice(0, 50);
      }
      if (it.publishedAt) existing.publishedAt = String(it.publishedAt).slice(0, 50);
      existing.updatedAt = now;
      continue;
    }
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
      channelId: String(it.channelId || '').slice(0, 20),
      source: String(it.source || '').slice(0, 50),
      publishedAt: String(it.publishedAt || '').slice(0, 50),
      recordedIp: recordedIp || null, // M-02：记录批量导入来源 IP，使开放模式录入者随后可见自己导入的好价
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

// 时区感知的"今天"：按指定时区折算墙钟日期，解决容器 UTC 导致签到日期/时间整体偏移。
// tz='local' 走进程本地日期；tz='UTC' 走真实 UTC 日期（不再与 local 等价，M-04 修复）；
// 其余按 IANA 时区（如 'Asia/Shanghai'）折算墙钟。
export function todayStrTZ(tz, d = new Date()) {
  if (!tz || tz === 'local') return localDateStr(d);
  if (tz === 'UTC') {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
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
