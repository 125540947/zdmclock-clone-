// 任务矩阵 · 内置真实任务（移植自青龙社区 smzdm 脚本，端点与签名均为社区逆向验证值）
//
// 与"待抓包"占位任务的区别：这里的端点、签名、多步流程（如 列表→领奖、抓 active_id→抽奖）
// 都来自社区已验证的青龙脚本（hex-ci/smzdm_script、tanyong826/TG_Scripts 等），不是占位符。
// 动态参数也尽量"自动获取"：转盘/抽奖的 active_id 从内置稳定专题页运行时抽取 hashId；
// 众测默认自动跑全民众测能量值任务（用 activity_id 代替 crowd_id，无需手填）。仅在需要覆盖
// 时才填 active_id / crowd_id / topicUrl。
//
// 数据互通（A → B）：执行结果返回给 taskMatrix / taskRunner，统一写入资产账本供仪表盘读取。

import { call, appRequest, realAdapter } from './realAdapter.js';
import { parseJsonp, removeTags, extractReward } from './parse.js';
import { normalizeArticleId } from './articleId.js';
import { generateProductComment } from '../gptAdapter.js';

const ANDROID_XRW = { 'x-requested-with': 'com.smzdm.client.android' };
const M_REFERER = 'https://m.smzdm.com/';
const DINGYUE_BASE = 'https://dingyue-api.smzdm.com';

// removeTags / extractReward / parseJsonp 已抽到 ./parse.js（P1-6 共用，含 )]}' 前缀处理），
// 此处 re-export 保持对外 API 兼容（taskMatrix 等仍从本模块引用 extractReward）。
export { parseJsonp, extractReward, removeTags };

function randomCallback() {
  const n = Math.floor(100000000 + Math.random() * 900000000);
  return `jQuery${n}_${Date.now()}`;
}

// 从专题页 HTML 提取转盘活动 ID（hashId / lottery_activity_id），纯函数便于单测。
// 优先匹配社区逆向确认的形态：JSON 转义串 \"hashId\":\"xxx\"（smzdm 专题页内嵌 JSON 常用），
// 再退化为未转义 "hashId":"xxx"，最后兜底 name=lottery_activity_id 表单值。
export function extractHashId(html) {
  let m = html.match(/\\"hashId\\":\\"([^\\]+)\\"/i);
  if (m) return m[1];
  m = html.match(/"hashId"\s*:\s*"([^"]+)"/i);
  if (m) return m[1];
  m = html.match(/name\s*=\s*"?lottery_activity_id"?\s+value\s*=\s*"?([a-zA-Z0-9]+)"?/i);
  if (m) return m[1];
  return null;
}

// 社区 smzdm_lottery.js 内置的两个"稳定"转盘专题页（专题页 URL 长期不变，
// 但其内嵌的 hashId 即 active_id 每日会变化，故运行时动态抓取，而非写死 active_id）。
// 这样转盘/抽奖任务无需用户手填 active_id，开启即自动跑。
export const KNOWN_TURNTABLE_TOPICS = [
  'https://m.smzdm.com/topic/bwrzf5/516lft', // 会员中心转盘
  'https://m.smzdm.com/topic/zhyzhuanpan/cjzp/' // 值会员转盘
];

// 从专题页 HTML 提取转盘活动 ID（best-effort）；fetcher 可注入以便单测
async function fetchTurntableId(topicUrl, cookie, fetcher = call) {
  try {
    const html = await fetcher(topicUrl, {
      method: 'GET',
      cookie,
      raw: true,
      referer: M_REFERER,
      extraHeaders: ANDROID_XRW
    });
    return extractHashId(html);
  } catch {
    return null;
  }
}

// 自动发现当前可用的转盘/抽奖 active_id：遍历内置稳定专题页，抽取其 hashId。
// 返回去重后的 id 列表；全部失败则返回空数组（调用方据此友好报错，绝不伪造成功）。
export async function discoverActiveIds(cookie, fetcher = call) {
  const ids = [];
  for (const url of KNOWN_TURNTABLE_TOPICS) {
    const id = await fetchTurntableId(url, cookie, fetcher);
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

// 从众测专题页 HTML 提取 crowd_id，best-effort；fetcher 可注入以便单测
async function fetchCrowdId(topicUrl, cookie, fetcher = call) {
  try {
    const html = await fetcher(topicUrl, {
      method: 'GET',
      cookie,
      raw: true,
      referer: M_REFERER,
      extraHeaders: ANDROID_XRW
    });
    const m = html.match(/crowd[_-]?id\s*[=:]\s*"?(\d+)"?/i) || html.match(/data-crowd-id\s*=\s*"?(\d+)"?/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// 转盘 / 抽奖（共用 jsonp_draw，仅 active_id 不同）。web 接口，不加 app 签名。
// 自动获取 active_id：未提供 activeId/topicUrl 时，遍历内置稳定专题页抽取 hashId；
// 命中多个则逐个抽奖（如会员转盘 + 值会员转盘）。fetcher 可注入以便单测。
export async function doTurntable(cookie, { activeId, topicUrl, call: fetcher = call } = {}) {
  let ids = [];
  if (activeId) ids = [activeId];
  else if (topicUrl) {
    const x = await fetchTurntableId(topicUrl, cookie, fetcher);
    if (x) ids = [x];
  } else {
    ids = await discoverActiveIds(cookie, fetcher);
  }
  if (!ids.length) {
    throw new Error(
      '未能自动获取转盘/抽奖的 active_id（smzdm 专题页可能改版或网络不通）。可手动在任务参数填 active_id 或 topicUrl 兜底'
    );
  }
  const results = [];
  for (const id of ids) {
    const cb = randomCallback();
    const url = `https://zhiyou.smzdm.com/user/lottery/jsonp_draw?active_id=${encodeURIComponent(
      id
    )}&callback=${encodeURIComponent(cb)}`;
    const text = await fetcher(url, {
      method: 'GET',
      cookie,
      raw: true,
      referer: M_REFERER,
      extraHeaders: ANDROID_XRW
    });
    const json = parseJsonp(text);
    const code = Number(json?.error_code);
    // 0=成功 1=已抽过 4=无次数，均视为正常结束（不报错）
    if (![0, 1, 4].includes(code)) {
      throw new Error('转盘抽奖失败(' + id + ')：' + removeTags(json?.error_msg || '未知响应'));
    }
    results.push(removeTags(json?.error_msg || '抽奖完成'));
  }
  return { success: true, message: results.join('；'), result: { draws: results } };
}

export function parseDailyTaskList(list) {
  const rows = list?.data?.data?.rows || list?.data?.rows || [];
  const tasks = [];
  const activities = [];
  for (const row of rows) {
    const cell = row?.cell_data || {};
    const at = cell.activity_task;
    if (at?.default_list_v2 && Array.isArray(at.default_list_v2)) {
      for (const grp of at.default_list_v2) {
        if (Array.isArray(grp.task_list)) tasks.push(...grp.task_list);
      }
    }
    if (String(cell.activity_reward_status || '') === '1' && cell.activity_id) {
      activities.push({ id: String(cell.activity_id), name: String(cell.activity_name || '阶段奖励') });
    }
  }
  return { tasks, activities };
}

function activityArticle(item = {}) {
  const id = normalizeArticleId(item.article_id || item.smzdmUrl || item.url || '');
  if (!id) return null;
  return {
    id,
    channelId: String(item.article_channel_id || item.channel_id || item.channelId || ''),
    title: String(item.article_title || item.title || '').trim(),
    content: String(item.article_content || item.content || '').trim(),
    price: String(item.article_price || item.price || '').trim()
  };
}

async function getDailyTaskArticles(task, cookie, request, supplied = []) {
  const direct = activityArticle(task);
  if (direct && direct.id !== '0') return [direct];
  const known = supplied.map(activityArticle).filter(Boolean);
  if (known.length) return known;
  const result = await request('https://article-api.smzdm.com/ranking_list/articles', {
    cookie,
    method: 'GET',
    data: { offset: 0, channel_id: 76, tab: 2, order: 0, limit: 20, stream: 'a', ab_code: 'b' }
  });
  const rows = result?.data?.data?.rows || result?.data?.rows || [];
  return rows.map(activityArticle).filter(Boolean);
}

async function receiveDailyTaskReward(taskId, cookie, request, getToken) {
  const token = await getToken(cookie);
  const r = await request('/task/activity_task_receive', {
    cookie,
    method: 'POST',
    data: {
      robot_token: token,
      geetest_seccode: '',
      geetest_validate: '',
      geetest_challenge: '',
      captcha: '',
      task_id: taskId
    }
  });
  if (Number(r?.error_code) !== 0) throw new Error(removeTags(r?.error_msg || '领取失败'));
  return removeTags(r?.data?.reward_msg || r?.error_msg || '领取成功');
}

function remainingCount(task) {
  const total = Number(task?.task_even_num ?? task?.task_event_num ?? 1);
  const finished = Number(task?.task_finished_num ?? 0);
  if (!Number.isFinite(total) || total <= 0) return 1;
  return Math.min(5, Math.max(1, total - (Number.isFinite(finished) ? finished : 0)));
}

async function performDailyTask(task, cookie, options) {
  const { request, adapter, articles, gpt, generateComment } = options;
  const event = String(task?.task_event_type || '');
  const count = remainingCount(task);
  if (event === 'guide.crowd') {
    await doCrowdtest(cookie, { call: request });
    return '完成众测任务';
  }
  if (['interactive.follow.user', 'interactive.follow.tag', 'interactive.follow.brand'].includes(event)) {
    const redirect = task.task_redirect_url || {};
    const target = redirect.link_title || redirect.keyword || redirect.link_val;
    if (!target || String(target) === '0') throw new Error('任务未提供可关注对象');
    const type = event.endsWith('.tag') ? 'tag' : event.endsWith('.brand') ? 'brand' : 'user';
    await doFollow(cookie, { target: String(target), type, keywordId: String(redirect.link_val || '') }, request);
    return `完成关注${type === 'user' ? '用户' : type === 'tag' ? '栏目' : '品牌'}`;
  }
  const articleEvents = new Set([
    'interactive.view.article',
    'interactive.share',
    'interactive.favorite',
    'interactive.rating',
    'interactive.comment'
  ]);
  // 未支持的活动应直接归为“跳过”。若先拉取文章，文章源异常会把本应跳过的任务误报成失败。
  if (!articleEvents.has(event)) throw new Error(`暂不支持的活动类型：${event || '未知'}`);
  const candidates = await getDailyTaskArticles(task, cookie, request, articles);
  const picked = Array.from({ length: count }, (_, i) => candidates[i % candidates.length]).filter(Boolean);
  if (!picked.length) throw new Error('没有可用的任务文章');

  if (event === 'interactive.view.article') {
    for (const article of picked) {
      const r = await request('/task/event_view_article_sync', {
        cookie,
        method: 'POST',
        data: { article_id: article.id, channel_id: article.channelId, task_id: String(task.task_id || task.id) }
      });
      if (Number(r?.error_code) !== 0) throw new Error(removeTags(r?.error_msg || '浏览任务失败'));
    }
    return `浏览 ${picked.length} 篇`;
  }
  if (event === 'interactive.share') {
    for (const article of picked) await doShare(cookie, { articleId: article.id, channelId: article.channelId }, request);
    return `分享 ${picked.length} 篇`;
  }
  if (event === 'interactive.favorite') {
    for (const article of picked) await adapter.doFavorite(cookie, { articleId: article.id, channelId: article.channelId });
    return `收藏 ${picked.length} 篇`;
  }
  if (event === 'interactive.rating') {
    for (const article of picked) await adapter.doPoint(cookie, { articleId: article.id, channelId: article.channelId });
    return `点赞 ${picked.length} 篇`;
  }
  if (event === 'interactive.comment') {
    if (!gpt?.enabled) throw new Error('评论任务需要先启用 AI 回复');
    for (const article of picked) {
      const content = await generateComment({
        title: article.title,
        content: article.content,
        price: article.price,
        tone: gpt.tone,
        prompt: gpt.prompt
      });
      await adapter.doComment(cookie, { articleId: article.id, content });
    }
    return `AI 评论 ${picked.length} 篇`;
  }
  throw new Error(`暂不支持的活动类型：${event || '未知'}`);
}

// 每日任务：每天动态读取活动任务 → 完成可自动化任务 → 刷新状态 → 领取任务/阶段奖励。
export async function doDailyTasks(cookie, opts = {}) {
  const request = opts.request || appRequest;
  const adapter = opts.adapter || realAdapter;
  const getToken = opts.getToken || ((c) => realAdapter.getRobotToken(c));
  let tokenPromise;
  const getTokenCached = (c) => (tokenPromise ||= Promise.resolve(getToken(c)));
  const generateComment = opts.generateComment || generateProductComment;
  const context = { request, adapter, articles: opts.articles || [], gpt: opts.gpt || {}, generateComment };
  const first = await request('/task/list_v2', { cookie, method: 'POST', data: {} });
  const initial = parseDailyTaskList(first);
  const rewards = [];
  const completed = [];
  const skipped = [];
  const failed = [];
  const rewardedIds = new Set();

  for (const t of initial.tasks) {
    const taskId = t?.task_id || t?.id;
    if (!taskId) continue;
    const name = removeTags(t?.task_name || `任务 ${taskId}`);
    const status = String(t?.task_status ?? '');
    try {
      if (status === '3') {
        rewards.push(await receiveDailyTaskReward(taskId, cookie, request, getTokenCached));
        rewardedIds.add(String(taskId));
      } else if (status === '2') {
        completed.push(`${name}（${await performDailyTask(t, cookie, context)}）`);
      }
    } catch (e) {
      if (/暂不支持|未提供可关注对象|需要先启用 AI/.test(e.message)) skipped.push(`${name}：${e.message}`);
      else failed.push(`${name}：${e.message}`);
    }
  }

  const refreshed = parseDailyTaskList(await request('/task/list_v2', { cookie, method: 'POST', data: {} }));
  for (const t of refreshed.tasks) {
    const taskId = String(t?.task_id || t?.id || '');
    if (!taskId || rewardedIds.has(taskId) || String(t?.task_status ?? '') !== '3') continue;
    try {
      rewards.push(await receiveDailyTaskReward(taskId, cookie, request, getTokenCached));
      rewardedIds.add(taskId);
    } catch (e) {
      failed.push(`${removeTags(t?.task_name || taskId)}领奖：${e.message}`);
    }
  }
  for (const activity of refreshed.activities) {
    try {
      const r = await request('/task/activity_receive', {
        cookie,
        method: 'POST',
        data: { activity_id: activity.id }
      });
      if (Number(r?.error_code) !== 0) throw new Error(removeTags(r?.error_msg || '领取失败'));
      rewards.push(removeTags(r?.data?.reward_msg || `${activity.name}领取成功`));
    } catch (e) {
      failed.push(`${activity.name}：${e.message}`);
    }
  }

  const summary = `读取 ${initial.tasks.length} 项，完成 ${completed.length} 项，领取 ${rewards.length} 项` +
    (skipped.length ? `，跳过 ${skipped.length} 项` : '') +
    (failed.length ? `，失败 ${failed.length} 项` : '');
  const details = [
    completed.length ? `完成明细：${completed.join('；')}` : '',
    rewards.length ? `领取明细：${rewards.join('；')}` : '',
    skipped.length ? `跳过明细：${skipped.join('；')}` : '',
    failed.length ? `失败明细：${failed.join('；')}` : ''
  ].filter(Boolean);
  return {
    success: failed.length === 0,
    message: [summary, ...details].join('；'),
    rewards,
    completed,
    skipped,
    failed,
    count: completed.length + rewards.length,
    discovered: initial.tasks.length
  };
}

// 全民众测能量值任务（社区 smzdm_testing.js 逆向）：自动发现活动 → 取任务列表 → 逐个领奖。
// 这是社区真正可自动化的"众测"玩法，全程无需 crowd_id（用 activity_id 代替）。
// 端点均为 web 接口（zhiyou.m.smzdm.com / test.m.smzdm.com），不加 app 签名。
export async function getTestingActivityId(cookie, fetcher = call) {
  const json = await fetcher('https://zhiyou.m.smzdm.com/task/task/ajax_get_activity_id', {
    method: 'GET',
    cookie,
    referer: 'https://test.m.smzdm.com/',
    extraHeaders: { 'x-requested-with': 'com.smzdm.client.android', Origin: 'https://test.m.smzdm.com' }
  });
  // 兼容社区/官方字段偶发漂移：尝试多种可能的 activity_id 取值路径
  const aid =
    json?.data?.activity_id ??
    json?.data?.activityId ??
    json?.activity_id ??
    json?.activityId ??
    null;
  // 接口明确返回了错误码（未登录 / 活动结束 / 接口变更等）：抛出含真实 error_msg 的异常，
  // 便于与「无进行中活动」区分诊断，而非静默返回 null 误判。
  if (!aid && json && (json.error_code != null || json.error_msg || json.errorCode != null)) {
    throw new Error('众测活动接口返回异常：' + removeTags(String(json.error_msg || json.error_code || json.errorCode || '未知')));
  }
  return aid || null;
}

async function getTestingActivityInfo(activityId, cookie, fetcher = call) {
  const json = await fetcher('https://zhiyou.m.smzdm.com/task/task/ajax_get_activity_info', {
    method: 'GET',
    cookie,
    referer: 'https://test.m.smzdm.com/',
    extraHeaders: { 'x-requested-with': 'com.smzdm.client.android' },
    data: { activity_id: activityId }
  });
  return json?.data || null;
}

async function receiveTestingTask(taskId, cookie, fetcher = call) {
  const json = await fetcher('https://zhiyou.m.smzdm.com/task/task/ajax_activity_task_receive', {
    method: 'POST',
    cookie,
    referer: 'https://test.m.smzdm.com/',
    extraHeaders: { 'x-requested-with': 'com.smzdm.client.android' },
    body: { task_id: taskId }
  });
  return json;
}

// 自动跑全民众测能量值任务：返回已领奖励列表（best-effort，单个任务失败不阻断）
async function doCrowdEnergyTasks(cookie, fetcher = call) {
  let activityId;
  try {
    activityId = await getTestingActivityId(cookie, fetcher);
  } catch (e) {
    // 接口异常（未登录 / 接口变更 / 网络）：软跳过，不计入失败，附带诊断信息便于排查
    return {
      success: true,
      softSkip: true,
      message: '全民众测跳过：' + e.message + '（如持续出现请检查 Cookie 或 smzdm 接口是否变更）',
      rewards: [],
      count: 0
    };
  }
  if (!activityId) {
    // 无进行中的全民众测活动（活动为周期性开启，并非一直有）：软跳过，不计入失败
    return {
      success: true,
      softSkip: true,
      message: '全民众测暂无可参与的活动（可能未开启，或当前无进行中活动）',
      rewards: [],
      count: 0
    };
  }
  const info = await getTestingActivityInfo(activityId, cookie, fetcher);
  const tasks = (info?.activity_task?.default_list || []) || [];
  const rewards = [];
  for (const t of tasks) {
    const taskId = t?.task_id || t?.id;
    if (!taskId) continue;
    try {
      const r = await receiveTestingTask(taskId, cookie, fetcher);
      if (Number(r?.error_code) === 0) rewards.push(removeTags(r?.data?.reward_msg || '领取成功'));
    } catch {
      /* 单个能量任务失败跳过，继续下一个 */
    }
  }
  return {
    success: true,
    message: rewards.length ? '全民众测能量任务：' + rewards.join('；') : '全民众测暂无可领能量任务（可能已完成）',
    rewards,
    count: rewards.length
  };
}

// 众测任务：
//  - 若显式提供 crowd_id（或 topicUrl 能抓到 crowd_id）：走"申请具体众测商品"路径 ajax_participate；
//  - 否则自动跑全民众测能量值任务（doCrowdEnergyTasks），无需任何 crowd_id，开启即自动获取活动。
export async function doCrowdtest(cookie, { crowdId, topicUrl, call: fetcher = call } = {}) {
  let id = crowdId;
  if (!id && topicUrl) id = await fetchCrowdId(topicUrl, cookie, fetcher);
  if (id) {
    const json = await fetcher('https://zhiyou.m.smzdm.com/user/crowd/ajax_participate', {
      method: 'POST',
      cookie,
      base: 'https://zhiyou.m.smzdm.com',
      referer: M_REFERER,
      extraHeaders: ANDROID_XRW,
      body: { crowd_id: id }
    });
    if (Number(json?.error_code) !== 0) {
      throw new Error('众测参与失败：' + removeTags(json?.error_msg || '未知响应'));
    }
    const msg = removeTags(json?.error_msg || '参与成功');
    return { success: true, message: msg, result: json };
  }
  // 自动模式：全民众测能量值任务（无需 crowd_id）
  return await doCrowdEnergyTasks(cookie, fetcher);
}

// 关注用户 / 栏目 / 品牌（社区 smzdm_task library_task 逆向，app 签名接口）。
// dingyue-api.smzdm.com：user/tag 走 /dingyue/{create|destroy}，brand 走 /dy/util/api/user_action。
// 均为 best-effort 社区逆向值，需用户填 target（用户名/栏目名/品牌名），无法运行时自动发现。
// reqFn 可注入以便单测（默认 appRequest，自带 signFormData 签名）。
export async function doFollow(cookie, { target, type = 'user', method = 'create', keywordId } = {}, reqFn = appRequest) {
  if (!target) throw new Error('关注需要 target（用户名 / 栏目名 / 品牌名）');
  if (!['user', 'tag', 'brand'].includes(type)) throw new Error('type 仅支持 user / tag / brand');
  if (type === 'brand') {
    const params = JSON.stringify({ keyword: target, keyword_id: keywordId || target, type: 'brand' });
    const r = await reqFn('/dy/util/api/user_action', {
      cookie,
      method: 'POST',
      base: DINGYUE_BASE,
      data: {
        action: method === 'create' ? 'dingyue_lanmu_add' : 'dingyue_lanmu_del',
        params,
        refer: `Android/其他/品牌详情页/${target}/${keywordId || target}/`,
        touchstone_event: ''
      }
    });
    if (Number(r?.error_code) !== 0) throw new Error('关注品牌失败：' + removeTags(r?.error_msg || '未知响应'));
    return { success: true, message: removeTags(r?.error_msg || '关注成功') };
  }
  const r = await reqFn(`/dingyue/${method}`, {
    cookie,
    method: 'POST',
    base: DINGYUE_BASE,
    data: {
      keyword: target,
      keyword_id: type === 'tag' ? keywordId || target : '',
      type,
      refer: '',
      touchstone_event: ''
    }
  });
  if (Number(r?.error_code) !== 0) throw new Error('关注失败：' + removeTags(r?.error_msg || '未知响应'));
  return { success: true, message: removeTags(r?.error_msg || '关注成功') };
}

// 分享文章（社区 smzdm_task library_task 逆向，user-api 签名接口）。
// 分享流程：complete_share_rule → daily_reward → callback（best-effort，单个失败不阻断）。
// 需用户填 articleId（文章数字ID，如 https://www.smzdm.com/p/<id> 中的 <id>）；channel_id 可选。
export async function doShare(cookie, { articleId, channelId = '' } = {}, reqFn = appRequest) {
  if (!articleId) {
    throw new Error('分享需要 articleId（文章数字ID，如 https://www.smzdm.com/p/<id> 中的 <id>）');
  }
  const token = await realAdapter.getRobotToken(cookie).catch(() => null);
  const steps = [];
  const calls = [
    ['/share/complete_share_rule', { article_id: articleId, channel_id: channelId, tag_name: 'gerenzhongxin' }],
    ['/share/daily_reward', { channel_id: channelId }],
    ['/share/callback', { article_id: articleId, channel_id: channelId, touchstone_event: '' }]
  ];
  for (const [p, extra] of calls) {
    try {
      const r = await reqFn(p, { cookie, method: 'POST', data: { token, ...extra } });
      if (Number(r?.error_code) === 0) steps.push(removeTags(r?.error_msg || r?.data?.reward_msg || '完成'));
    } catch {
      /* 单个步骤失败跳过，继续下一步 */
    }
  }
  return {
    success: true,
    message: steps.length
      ? steps.join('；')
      : '分享流程已触发（响应未含奖励文案，可能无需奖励或端点变更）',
    count: steps.length
  };
}

// 真实策略表：任务类型 → 处理函数 + 是否需动态参数
// 转盘/抽奖：自动从内置稳定专题页获取 active_id（needsParam 置 null，可选填 activeId/topicUrl 覆盖）
// 众测：自动跑全民众测能量值任务（无需 crowd_id；可选填 crowd_id 走"申请具体商品"路径）
// 关注/分享：社区逆向端点已内置，但需用户填目标参数（target / articleId），无法自动发现
export const REAL_STRATEGIES = {
  turntable: {
    handler: doTurntable,
    needsParam: null,
    paramHint: '可选：active_id 或 topicUrl（不填则自动从 smzdm 转盘专题页获取 active_id）'
  },
  lottery: {
    handler: doTurntable,
    needsParam: null,
    paramHint: '可选：active_id 或 topicUrl（不填则自动获取）'
  },
  crowdtest: {
    handler: doCrowdtest,
    needsParam: null,
    paramHint: '可选：crowd_id（不填则自动跑全民众测能量值任务，无需 crowd_id）'
  },
  follow: {
    handler: doFollow,
    needsParam: 'target',
    paramHint: 'target（用户名/栏目名/品牌名），可填数组实现每次运行自动关注下一个（轮询）；可选 type(user/tag/brand)、keywordId、method(create/destroy)'
  },
  share: {
    handler: doShare,
    needsParam: 'articleId',
    paramHint: 'articleId（文章数字ID），可选 channelId'
  },
  dailyTasks: { handler: doDailyTasks, needsParam: null }
};

export const REAL_STRATEGY_TYPES = new Set(Object.keys(REAL_STRATEGIES));
