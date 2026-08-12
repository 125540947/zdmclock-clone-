import { smzdm } from './smzdm/adapter.js';
import { applyClock, localYesterdayStr } from './clockCore.js';
import { withWriteLock, persist, genId, mergeBaoliao, todayStr, todayStrTZ, yesterdayStrTZ } from './store.js';
import { normalizeArticleId } from './smzdm/articleId.js';
import { generateReply } from './gptAdapter.js';
import { config } from './config.js';
import { resolvedCheckInTime, fmtHM, parseHM, zonedWallClock } from './clockSchedule.js';
import {
  resolveRisk,
  jitterDelay,
  recordSuccess,
  recordFailure,
  isCircuitOpen,
  isAuthExpiredError
} from './riskControl.js';
import { runCustomEndpointTask, CUSTOM_TYPES } from './taskMatrix.js';
import { applyAssetEffect, taskNameOf } from './assetLedger.js';
import { dbgLog } from './log.js';

const CUSTOM_SET = new Set(CUSTOM_TYPES);

// 安全刷新权威资产（smzdm 用户接口，即"其他接口来源"）：失败返回 null 而不抛错，
// 保证单账号资产接口异常不影响整体任务执行。
async function safeGetUserInfo(user) {
  try {
    const info = await smzdm.getUserInfo(user.cookie);
    return {
      gold: Number(info.points ?? info.gold ?? 0),
      silver: Number(info.silver ?? 0),
      exp: Number(info.exp ?? info.experience ?? 0),
      level: info.level ?? info.rank ?? null
    };
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 统一的任务执行逻辑：手动触发（POST /api/tasks/:id/run）与定时调度（scheduler）共用，
// 避免逻辑重复。只负责「调用适配器执行动作」，不负责写库——
// 由调用方根据返回结果更新 lastRun / lastResult / status。

// 单次任务动作次数 / GPT 批量条数 / 抓取条数上限现集中在 config（P2-8）：
// config.countMax / config.gptBatchMax / config.fetchMax（原为此处局部常量，已迁移便于统一配置）

// 采集目标文章 ID 列表：
// - baoliao 来源：遍历 db.baoliao，从 smzdmUrl/url 提取文章 ID（去重）
// - manual 来源：用本次运行传入的 articleId 或任务里保存的 articleId
export function collectArticleIds(task, db, articleSource, overrideId) {
  if (articleSource === 'baoliao') {
    const ids = [];
    for (const item of db.baoliao || []) {
      const raw = item.smzdmUrl || item.url || '';
      if (!raw) continue;
      const aid = normalizeArticleId(raw);
      if (aid && !ids.some((x) => x.id === aid)) {
        // 携带条目自身的 channelId（若浏览器导入时已解析），供点赞/收藏 APP 接口使用，
        // 避免服务端在反爬下取不到好价/Deal 贴真实频道而退化成 '1'。
        ids.push({ id: aid, channelId: item.channelId ? String(item.channelId) : '' });
      }
    }
    return ids;
  }
  const id = (overrideId && String(overrideId).trim()) || (task.articleId && String(task.articleId).trim()) || '';
  // manual 来源：仅当使用任务自身 articleId 时才透传 task.channelId（overrideId 为一次性指定，不应套用任务频道）
  const usingTaskArticle = !(overrideId && String(overrideId).trim());
  return id ? [{ id, channelId: usingTaskArticle && task.channelId ? String(task.channelId) : '' }] : [];
}

// 从数组中随机取 n 个不重复元素（Fisher-Yates 洗牌后取前 n），rng 可注入便于单测。
export function sampleArticleIds(ids, n, rng = Math.random) {
  const pool = ids.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, n));
}

// 计算 baoliao 来源的随机取样条数：
// - 任务配置了 limit（1~50）→ 取 min(limit, 池大小)（上限受控、可复现）；
// - 未配置 → 在 [engagementSampleDefaultMin, engagementSampleDefaultMax] 间随机取，封顶池大小；
// 这样"每次随机选取、而非遍历全部"，模拟真人只挑部分好价互动。
export function computeSampleSize(poolSize, limit, rng = Math.random) {
  if (poolSize <= 0) return 0;
  if (limit && Number.isFinite(Number(limit)) && Number(limit) > 0) {
    return Math.min(poolSize, Math.max(1, Math.min(50, Math.floor(Number(limit)))));
  }
  const lo = Math.max(1, config.engagementSampleDefaultMin);
  const hi = Math.max(lo, config.engagementSampleDefaultMax);
  const r = lo + Math.floor(rng() * (hi - lo + 1));
  return Math.min(poolSize, r);
}

// 评论 / 收藏 / 点赞：支持单篇（manual）或多篇（baoliao）批量执行
async function runEngagement(task, db, user, opts) {
  const action = task.type; // 'comment' | 'favorite' | 'point'
  const articleSource = opts.articleSource || task.articleSource || 'manual';
  const safeCount = Math.min(config.countMax, Math.max(1, Number(opts.count) || 1));
  const allIds = collectArticleIds(task, db, articleSource, opts.articleId);
  if (!allIds.length) {
    return {
      ok: false,
      error: 'no_article',
      message:
        articleSource === 'baoliao'
          ? '好价列表中没有可用文章ID（请先添加带链接的好价，或改用手动指定）'
          : '请先填写目标文章ID或链接'
    };
  }
  // baoliao 来源：不再全量遍历，改为从池中随机抽样若干条，模拟真人"只挑部分好价互动"。
  // 取样条数由任务 limit 控制上限；未配置则按 [engagementSampleDefaultMin,Max] 随机取。
  let articleIds = allIds;
  const poolSize = allIds.length;
  if (articleSource === 'baoliao') {
    articleIds = sampleArticleIds(allIds, computeSampleSize(poolSize, task.limit));
  }
  // baoliao 来源：每篇各执行 1 次（一篇一动作，避免刷量）；manual 可用 count 重复多次
  const perArticleCount = articleSource === 'baoliao' ? 1 : safeCount;
  let done = 0;
  let failed = 0;
  const errors = [];
  const results = [];
  for (let idx = 0; idx < articleIds.length; idx++) {
    const entry = articleIds[idx];
    const aid = entry.id;
    const chId = entry.channelId || null;
    // 拟人化不规则等待：每条操作之间随机延迟（首条不等待），偶发"长思考"停顿打破节奏，
    // 避免固定频率被 smzdm 风控识别为批量脚本。
    if (idx > 0) {
      const baseSpan = Math.max(0, config.engagementDelayMaxMs - config.engagementDelayMinMs);
      await sleep(jitterDelay(config.engagementDelayMinMs, baseSpan));
      if (config.engagementDelayLongProbability > 0 && Math.random() < config.engagementDelayLongProbability) {
        const longSpan = Math.max(0, config.engagementDelayLongMaxMs - config.engagementDelayMinMs);
        await sleep(jitterDelay(config.engagementDelayMinMs, longSpan));
      }
      dbgLog('[smzdm-debug] engagement 拟人化等待后继续：第', idx + 1, '/', articleIds.length, '篇，articleId=', aid);
    }
    // 评论被 smzdm 限流（"速度太快"）时针对性退避重试，提升成功率；收藏/点赞不受此限
    const maxCommentRetry = action === 'comment' ? 2 : 0;
    let attempt = 0;
    while (attempt <= maxCommentRetry) {
      try {
        const r =
          action === 'comment'
            ? await smzdm.doComment(user.cookie, { count: perArticleCount, articleId: aid })
            : action === 'favorite'
            ? await smzdm.doFavorite(user.cookie, { count: perArticleCount, articleId: aid, channelId: chId })
            : await smzdm.doPoint(user.cookie, { count: perArticleCount, articleId: aid, channelId: chId });
        done += r.count || 1;
        results.push(r.message);
        break;
      } catch (e) {
        const rateLimited = /速度太快|太快|频率|频繁|请稍后/.test(e.message);
        if (attempt < maxCommentRetry && rateLimited) {
          // 退避：在原有间隔基础上额外延长，逐渐拉开节奏避免再次被限
          attempt++;
          await sleep(config.engagementDelayMaxMs * attempt + jitterDelay(config.engagementDelayMinMs, config.engagementDelayMaxMs));
          dbgLog('[smzdm-debug] 评论被限流，退避重试：第', attempt, '次，articleId=', aid);
          continue;
        }
        failed += 1;
        errors.push(`文章 ${aid}: ${e.message}`);
        break;
      }
    }
  }
  const total = articleIds.length;
  // 抽样场景在结果里标明"从 N 篇中随机选取 M 篇"，便于核对（全量未抽样时不显示）
  const sampledFrom =
    articleSource === 'baoliao' && poolSize > total ? `（从 ${poolSize} 篇中随机选取 ${total} 篇）` : '';
  const message =
    `共 ${total} 篇${sampledFrom}：成功 ${total - failed} 篇（${done} 次动作）` +
    (failed ? `，失败 ${failed} 篇：${errors.join('；')}` : '');
  const ok = failed === 0;
  return {
    ok,
    // scheduler / run 接口取 r.result.message 作为 lastResult
    result: { success: ok, message, count: done, articleIds, poolSize, partial: failed > 0 },
    message
  };
}

// 单账号签到（含幂等落库）：返回 { ok, message, duplicate, record?, authExpired?, circuitOpen? }
// 带失败重试：网络抖动 / 频率限制等瞬时错误按指数退避重试，减少漏签。
// 集成风控对抗包：人类化随机等待、登录失效识别、失败熔断与自适应降频。
// opts.maxRetries / opts.retryBaseMs 可在测试或特殊场景覆盖 config 默认值；
// opts.risk 可整体覆盖生效风控配置（测试用）；opts.today/opts.yesterday 用于时区感知判定。
export async function runClockForUser(db, user, opts = {}) {
  const risk = opts.risk || resolveRisk(db);
  const maxRetries = opts.maxRetries ?? config.clockRetry;
  const retryBaseMs = opts.retryBaseMs ?? config.clockRetryBaseMs;

  // 登录已失效：直接跳过，不浪费请求也不冒险反复撞（需重新录入 Cookie 解除）
  if (user.cookieExpired) {
    return { ok: false, authExpired: true, message: '登录已失效，请重新录入 Cookie 后重试' };
  }
  // 风控熔断：连续失败冷却期内跳过自动签到，降低被风控 / 封号概率
  if (risk.enabled && isCircuitOpen(user.id)) {
    return { ok: false, circuitOpen: true, message: '已触发熔断冷却（连续失败），暂跳过自动签到' };
  }

  // 时区感知的"今天 / 昨天"，保证记录日期与连续天数判定都基于用户所在时区
  const useTZ = config.tz && config.tz !== 'local';
  const today = opts.today || (useTZ ? todayStrTZ(config.tz) : todayStr());
  const yesterday = opts.yesterday || (useTZ ? yesterdayStrTZ(config.tz) : localYesterdayStr());

  let lastMessage = '签到失败';
  let lastAuthExpired = false;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // 指数退避：1x, 2x, 4x ... 避免重试瞬间再次撞限流
      const backoff = retryBaseMs * Math.pow(2, attempt - 1);
      await sleep(backoff);
    }
    // 风控：每次尝试前的"人类化随机等待"，打破固定周期（仅 real 适配器真正有意义）
    if (risk.enabled && risk.preDelayMaxMs > risk.preDelayMinMs) {
      await sleep(jitterDelay(risk.preDelayMinMs, risk.preDelayMaxMs - risk.preDelayMinMs));
    }
    try {
      const r = await smzdm.doClockIn(user.cookie);
      if (!r.success) {
        lastMessage = `签到失败：${r.message}`;
        // 业务失败（未登录/已签/频率限制等）交由重试循环；最后一次仍失败则上报
        continue;
      }
      const res = await withWriteLock(() => {
        const c = applyClock(user, r, db, { today, yesterday });
        if (!c.duplicate) {
          user.cookieExpired = false; // 成功说明 Cookie 仍有效，清除失效标记
          persist();
        }
        return c;
      });
      if (risk.enabled) recordSuccess(user.id);
      if (res.duplicate) return { ok: true, duplicate: true, message: '今日已签到' };
      return { ok: true, message: `签到成功，+${r.points} 金币`, record: res.record, balances: r.balances };
    } catch (e) {
      lastMessage = `签到异常：${e.message}`;
      // 登录 / Cookie 失效异常单独标记，便于熔断外再做"停止盲目重试 + 告警"
      if (isAuthExpiredError(e)) lastAuthExpired = true;
    }
  }
  // 全部失败：记录失败用于自适应 / 熔断
  if (risk.enabled) recordFailure(user.id, risk);
  // 登录失效：标记 + 持久化，前端展示并停止后续盲目重试
  if (lastAuthExpired) {
    await withWriteLock(() => {
      user.cookieExpired = true;
      persist();
    });
    return { ok: false, authExpired: true, message: `登录失效，请重新录入 Cookie：${lastMessage}` };
  }
  // 熔断已触发：明确提示冷却信息
  if (risk.enabled && isCircuitOpen(user.id)) {
    return {
      ok: false,
      circuitOpen: true,
      message: `连续失败触发熔断冷却（约 ${Math.round(risk.circuitCooldownMs / 60000)} 分钟）：${lastMessage}`
    };
  }
  return { ok: false, message: lastMessage };
}

// GPT 定时批量生成：从好价列表取内容 → 大模型生成评论草稿（可选自动发布为评论）
// 接受「有标题/内容」或「有文章链接」的好价（兼容抓取到的无标题条目）
async function runGptBatch(task, db) {
  if (!db.settings.gpt.enabled) {
    return { ok: false, error: 'gpt_disabled', message: '请先在 GPT 自动回复页启用自动回复' };
  }
  const limit = Math.min(config.gptBatchMax, Math.max(1, Number(task.limit) || 3));
  const items = (db.baoliao || [])
    .filter((it) => (it.title || it.content || '').trim() || normalizeArticleId(it.smzdmUrl || it.url || ''))
    .slice(0, limit);
  if (!items.length) {
    return { ok: false, error: 'no_source', message: '好价列表为空，没有可用于生成回复的内容' };
  }
  const user = db.users[0]; // 仅自动发布时使用首个账号 Cookie；无账号时跳过发布
  let gen = 0;
  let posted = 0;
  let failed = 0;
  const errors = [];
  const drafts = [];
  // P1-3：LLM 生成与自动发布（网络 IO，最多 10 条 LLM 往返）在写锁外完成，
  // 避免独占全局写链、阻塞并发签到（runClockForUser → withWriteLock）。最后一次性持锁落账。
  for (const item of items) {
    const text =
      `文章：${item.smzdmUrl || item.url || ''}\n` +
      `标题：${item.title || ''}\n内容：${item.content || ''}`;
    try {
      const reply = await generateReply({
        text,
        tone: db.settings.gpt.tone,
        prompt: db.settings.gpt.prompt
      });
      const aid = normalizeArticleId(item.smzdmUrl || item.url || '');
      const draft = {
        id: genId('gd'),
        sourceItemId: item.id,
        articleId: aid,
        content: reply,
        status: 'generated',
        autoPost: false,
        createdAt: new Date().toISOString()
      };
      if (task.autoPost && aid && user) {
        try {
          await smzdm.doComment(user.cookie, { count: 1, articleId: aid, content: reply });
          draft.status = 'posted';
          draft.autoPost = true;
          posted += 1;
        } catch (e) {
          draft.status = 'post_failed';
          errors.push(`文章 ${aid} 自动发布失败：${e.message}`);
        }
      }
      drafts.push(draft);
      gen += 1;
    } catch (e) {
      failed += 1;
      errors.push(`「${item.title || item.id}」生成失败：${e.message}`);
    }
  }
  // 一次性持锁落账：仅此处的 db 写入与 persist 进入串行写链，
  // 保持与原行为一致（按生成顺序 unshift，最新草稿在头部）。
  await withWriteLock(() => {
    for (const d of drafts) db.gptDrafts.unshift(d);
    // R5：限制草稿上限，避免长期运行后 db.json 无限膨胀
    if (db.gptDrafts.length > 200) db.gptDrafts.length = 200;
    persist();
  });
  if (gen === 0) {
    return { ok: false, error: 'gpt_all_failed', message: '全部生成失败：' + errors.join('；') };
  }
  const message =
    `GPT 批量生成完成：生成 ${gen} 条` +
    (posted ? `，已自动发布 ${posted} 条` : '') +
    (failed ? `，失败 ${failed} 条：${errors.join('；')}` : '');
  return { ok: true, result: { success: true, message, count: gen, drafts }, message };
}

// 好价真实抓取：调用适配器抓取 smzdm 公开好价列表，去重合并进 db.baoliao
async function runFetch(task, db) {
  const limit = Math.min(config.fetchMax, Math.max(1, Number(task.limit) || 20));
  let fetched;
  try {
    fetched = await smzdm.fetchBaoliao({ limit });
  } catch (e) {
    return { ok: false, error: 'fetch_failed', message: '抓取好价失败：' + e.message };
  }
  const items = (fetched && fetched.items) || [];
  if (!items.length) {
    return { ok: false, error: 'no_items', message: '未抓取到好价（页面结构可能已变更或被风控拦截）' };
  }
  let added = 0;
  await withWriteLock(() => {
    added = mergeBaoliao(items);
    persist();
  });
  const message = `抓取好价完成：解析 ${items.length} 条，新增 ${added} 条（已去重）`;
  return { ok: true, result: { success: true, message, count: added }, message };
}

// 选定目标账号：
// - 指定 userId → 仅该账号（手动单账号签到 / 提交等场景，管理员手动触发不受 autoRun 限制）
// - 未指定 → 覆盖全部「已开启自动跑（autoRun!==false）」的账号（多账号自动化：定时任务与手动"运行"均如此）
//   录入时未勾选自动跑（autoRun===false）的账号不参与自动化，必须显式指定 userId 才会跑。
export function resolveUsers(db, opts) {
  const { userId } = opts || {};
  if (userId) {
    const u = db.users.find((x) => x.id === userId);
    return u ? [u] : [];
  }
  return db.users.filter((u) => u.autoRun !== false);
}

export async function runTask(task, db, opts = {}) {
  // gpt / fetch 不依赖账号 Cookie，无需账号即可运行（gpt 仅自动发布时用首个账号）
  if (task.type === 'gpt') return runGptBatch(task, db);
  if (task.type === 'fetch') return runFetch(task, db);

  let users = resolveUsers(db, opts);
  if (!users.length) {
    return { ok: false, error: 'no_user', message: '请先添加 smzdm 账号' };
  }

  // 定时调度（scheduled）场景下的「每日签到」：按用户所在时区，仅对"个人签到时间已过（含恰好到达）
  // 且仍在补签宽限窗内、今日尚未签到"的账号执行，实现账号级错峰 + 宕机/休眠后补签。
  // 手动"运行"不传该标志，仍对所有选中账号执行。
  let schedToday; // 定时模式下传给 runClockForUser 的时区"今天"
  let schedYesterday; // 定时模式下传给 runClockForUser 的时区"昨天"
  if (opts.scheduled && task.type === 'clock') {
    const z = zonedWallClock(new Date(), config.tz);
    const nowHM = fmtHM(z.getHours(), z.getMinutes());
    const nowMin = z.getHours() * 60 + z.getMinutes();
    // P1-5：schedToday 与 schedYesterday 统一走 todayStrTZ / yesterdayStrTZ 同族函数，
    // 保证"今天"与"昨天"由同一时区折算逻辑得出（yesterdayStrTZ 内部即对 today 回退一天），
    // 消除原 schedToday=z.date（zonedWallClock 路径）与 schedYesterday=yesterdayStrTZ（另一路径）
    // 在跨日边界可能差一天、导致连续天数偶发错 1 天的问题。分钟比较仍用 z 的墙钟，保持一致。
    const useTZ = config.tz && config.tz !== 'local';
    schedToday = useTZ ? todayStrTZ(config.tz) : todayStr();
    schedYesterday = useTZ ? yesterdayStrTZ(config.tz) : localYesterdayStr();
    const doneToday = new Set(
      db.clockRecords.filter((r) => r.date === schedToday).map((r) => r.userId)
    );
    const due = users.filter((u) => {
      if (doneToday.has(u.id)) return false; // 今日已签，跳过
      const hm = resolvedCheckInTime(u);
      const p = parseHM(hm);
      if (!p) return false;
      const umin = p.h * 60 + p.mi;
      // 已过个人时间：在补签宽限窗内则补签（diff=0 即恰好到达当前分钟，也走此分支统一处理）；
      // 未来时间不提前签。
      if (umin <= nowMin) return nowMin - umin <= config.catchupGraceMin;
      return false;
    });
    if (!due.length) {
      return {
        ok: true,
        skipped: true,
        message: `当前无账号需签到（时区 ${config.tz}，时段 ${nowHM}）`
      };
    }
    users = due;
  }

  // 逐账号执行并聚合（clock / comment / favorite / point / 自定义端点任务）
  const parts = [];
  let okCount = 0;
  const assetCache = new Map(); // P2-5：本轮内按账号缓存余额刷新结果，避免 N+1（同账号多任务只拉一次 smzdm）
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const who = user.nickname || user.smzdmId || user.id;
    // 错峰：从第 2 个账号起，加入固定间隔 + 随机抖动，避免多账号同秒集中请求
    // smzdm 触发限流/风控导致漏签。单账号场景（i===0）无等待。
    if (i > 0) {
      const jitter = Math.floor(Math.random() * (config.clockStaggerJitterMs + 1));
      await sleep(config.clockStaggerMs + jitter);
    }
    try {
      let r;
      let assetAfter = null; // 权威"之后"余额：签到用响应余额（最准），其他任务回退 getUserInfo
      if (task.type === 'clock') {
        r = await runClockForUser(db, user, opts.scheduled ? { today: schedToday, yesterday: schedYesterday } : {});
        if (r.ok && r.balances) assetAfter = r.balances;
      } else if (CUSTOM_SET.has(task.type)) {
        // 自定义端点任务（抽奖/转盘/众测/关注/分享）：未配置接口时 r.ok=false 且 pendingCapture
        r = await runCustomEndpointTask(task, db, user);
      } else {
        r = await runEngagement(task, db, user, opts);
      }
      // A → B 联动：任一账号动作成功，统一刷新权威资产并写入共享账本（供资产仪表盘读取）
      if (r && r.ok) {
        // P2-5：N+1 节流——同一账号在本轮内只从 smzdm 拉一次余额（per-run 缓存），
        // 避免「每账号每成功任务都打一次 getUserInfo」的放大。注意：不可改用本地 user.assets 替代，
        // 否则 after≈before 会导致账本增量恒为 0（余额不再随签到/互动更新）。
        let after = assetAfter;
        if (!after) {
          after = assetCache.get(user.id);
          if (!after) {
            after = await safeGetUserInfo(user);
            if (after) assetCache.set(user.id, after);
          }
        }
        await withWriteLock(() => {
          applyAssetEffect(db, user, task.type, task.name || taskNameOf(task.type), {
            // 有余额则以余额差落账（最准）；否则用动作显式增量（如抽奖返回的奖励）
            explicit: assetAfter ? undefined : (r.explicit || null),
            after,
            success: true,
            message: r.message || ''
          });
          persist();
        });
      }
      if (r && r.ok) okCount += 1;
      parts.push(`${who}：${r ? r.message : '未知结果'}`);
    } catch (e) {
      parts.push(`${who}：异常 ${e.message}`);
    }
  }
  const total = users.length;
  const allOk = okCount === total;
  const message =
    `共 ${total} 个账号：${okCount} 成功 / ${total - okCount} 失败\n` + parts.join('\n');
  // 全部成功才标 ok；部分失败标 partial（调度器据此仍记为完成，避免误报红色错误）
  return {
    ok: allOk,
    partial: !allOk && okCount > 0,
    result: { success: allOk, message, perUser: parts },
    message
  };
}
