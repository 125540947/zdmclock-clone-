import { smzdm } from './smzdm/adapter.js';
import { applyClock } from './clockCore.js';
import { withWriteLock, persist, genId } from './store.js';
import { normalizeArticleId } from './smzdm/articleId.js';
import { generateReply } from './gptAdapter.js';

// 统一的任务执行逻辑：手动触发（POST /api/tasks/:id/run）与定时调度（scheduler）共用，
// 避免逻辑重复。只负责「调用适配器执行动作」，不负责写库——
// 由调用方根据返回结果更新 lastRun / lastResult / status。

const COUNT_MAX = 5; // 防滥用：单次任务动作次数上限
const GPT_BATCH_MAX = 10; // GPT 批量生成单次最多处理的好价条数

// 采集目标文章 ID 列表：
// - baoliao 来源：遍历 db.baoliao，从 smzdmUrl/url 提取文章 ID（去重）
// - manual 来源：用本次运行传入的 articleId 或任务里保存的 articleId
function collectArticleIds(task, db, articleSource, overrideId) {
  if (articleSource === 'baoliao') {
    const ids = [];
    for (const item of db.baoliao || []) {
      const raw = item.smzdmUrl || item.url || '';
      if (!raw) continue;
      const aid = normalizeArticleId(raw);
      if (aid && !ids.includes(aid)) ids.push(aid);
    }
    return ids;
  }
  const id = (overrideId && String(overrideId).trim()) || (task.articleId && String(task.articleId).trim()) || '';
  return id ? [id] : [];
}

// 评论 / 收藏 / 点赞：支持单篇（manual）或多篇（baoliao）批量执行
async function runEngagement(task, db, user, opts) {
  const action = task.type; // 'comment' | 'favorite' | 'point'
  const articleSource = opts.articleSource || task.articleSource || 'manual';
  const safeCount = Math.min(COUNT_MAX, Math.max(1, Number(opts.count) || 1));
  const articleIds = collectArticleIds(task, db, articleSource, opts.articleId);
  if (!articleIds.length) {
    return {
      ok: false,
      error: 'no_article',
      message:
        articleSource === 'baoliao'
          ? '好价列表中没有可用文章ID（请先添加带链接的好价，或改用手动指定）'
          : '请先填写目标文章ID或链接'
    };
  }
  // baoliao 来源：每篇各执行 1 次（一篇一动作，避免刷量）；manual 可用 count 重复多次
  const perArticleCount = articleSource === 'baoliao' ? 1 : safeCount;
  let done = 0;
  let failed = 0;
  const errors = [];
  const results = [];
  for (const aid of articleIds) {
    try {
      const r =
        action === 'comment'
          ? await smzdm.doComment(user.cookie, { count: perArticleCount, articleId: aid })
          : action === 'favorite'
          ? await smzdm.doFavorite(user.cookie, { count: perArticleCount, articleId: aid })
          : await smzdm.doPoint(user.cookie, { count: perArticleCount, articleId: aid });
      done += r.count || 1;
      results.push(r.message);
    } catch (e) {
      failed += 1;
      errors.push(`文章 ${aid}: ${e.message}`);
    }
  }
  const total = articleIds.length;
  const message =
    `共 ${total} 篇：成功 ${total - failed} 篇（${done} 次动作）` +
    (failed ? `，失败 ${failed} 篇：${errors.join('；')}` : '');
  const ok = failed === 0;
  return {
    ok,
    // scheduler / run 接口取 r.result.message 作为 lastResult
    result: { success: ok, message, count: done, articleIds, partial: failed > 0 },
    message
  };
}

// GPT 定时批量生成：从好价列表取内容 → 大模型生成评论草稿（可选自动发布为评论）
async function runGptBatch(task, db, user) {
  if (!db.settings.gpt.enabled) {
    return { ok: false, error: 'gpt_disabled', message: '请先在 GPT 自动回复页启用自动回复' };
  }
  const limit = Math.min(GPT_BATCH_MAX, Math.max(1, Number(task.limit) || 3));
  const items = (db.baoliao || [])
    .filter((it) => (it.title || it.content || '').trim())
    .slice(0, limit);
  if (!items.length) {
    return { ok: false, error: 'no_source', message: '好价列表为空，没有可用于生成回复的内容' };
  }
  let gen = 0;
  let posted = 0;
  let failed = 0;
  const errors = [];
  const drafts = [];
  await withWriteLock(async () => {
    for (const item of items) {
      const text = `标题：${item.title || ''}\n内容：${item.content || ''}`;
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
        if (task.autoPost && aid) {
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
        db.gptDrafts.unshift(draft);
        drafts.push(draft);
        gen += 1;
      } catch (e) {
        failed += 1;
        errors.push(`「${item.title || item.id}」生成失败：${e.message}`);
      }
    }
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

export async function runTask(task, db, opts = {}) {
  const { userId, count, articleId } = opts;
  const user = userId ? db.users.find((u) => u.id === userId) : db.users[0];
  if (!user) {
    return { ok: false, error: 'no_user', message: '请先添加 smzdm 账号' };
  }
  // 签到类型：真正落库（N1），与手动签到共用 applyClock
  if (task.type === 'clock') {
    const result = await smzdm.doClockIn(user.cookie);
    if (!result.success) return { ok: false, error: 'clock_failed', message: result.message };
    const clock = await withWriteLock(() => {
      const c = applyClock(user, result, db);
      if (!c.duplicate) persist();
      return c;
    });
    return { ok: true, result, user, clock };
  }
  if (task.type === 'gpt') {
    return runGptBatch(task, db, user);
  }
  // 评论 / 收藏 / 点赞
  return runEngagement(task, db, user, opts);
}
