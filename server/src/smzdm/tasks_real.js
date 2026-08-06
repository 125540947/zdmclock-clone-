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

const ANDROID_XRW = { 'x-requested-with': 'com.smzdm.client.android' };
const M_REFERER = 'https://m.smzdm.com/';

function removeTags(s) {
  return String(s || '')
    .replace(/<[^<]+?>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 剥离 JSONP 响应外壳 callback({...})，取内部 JSON（纯函数）
export function parseJsonp(text) {
  if (typeof text !== 'string') return text;
  const m = text.match(/\(([\s\S]*)\)\s*$/);
  const inner = m ? m[1] : text;
  return JSON.parse(inner);
}

// 从奖励文案近似提取金币/碎银/经验数量（best-effort，仅统计接口字面提及的数值，
// 绝不做假数据；用于资产账本的近似记账）。返回 { gold, silver, exp }
export function extractReward(text) {
  const t = removeTags(text || ''); // 先去 HTML 标签（奖励文案常含 <strong>5</strong>金币）
  let gold = 0;
  let silver = 0;
  let exp = 0;
  const g = t.match(/(\d+(?:\.\d+)?)\s*(?:金币|金豆)/);
  if (g) gold += parseFloat(g[1]) || 0;
  const s = t.match(/(\d+(?:\.\d+)?)\s*(?:碎银|碎银子)/);
  if (s) silver += parseFloat(s[1]) || 0;
  const e = t.match(/(\d+(?:\.\d+)?)\s*点?\s*经验/) || t.match(/经验[+：:]\s*(\d+(?:\.\d+)?)/);
  if (e) exp += parseFloat(e[1]) || 0;
  return { gold, silver, exp };
}

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

// 每日任务：list_v2 取任务列表 → 逐个 activity_task_receive 领奖（带 robot_token）
export async function doDailyTasks(cookie) {
  const list = await appRequest('/task/list_v2', { cookie, method: 'POST', data: {} });
  const rows = list?.data?.data?.rows || list?.data?.rows || [];
  const tasks = [];
  for (const row of rows) {
    const at = row?.cell_data?.activity_task;
    if (at?.default_list_v2 && Array.isArray(at.default_list_v2)) {
      for (const grp of at.default_list_v2) {
        if (Array.isArray(grp.task_list)) tasks.push(...grp.task_list);
      }
    }
  }
  const rewards = [];
  let token = null;
  for (const t of tasks) {
    const taskId = t?.task_id || t?.id;
    if (!taskId) continue;
    try {
      if (!token) token = await realAdapter.getRobotToken(cookie);
      const r = await appRequest('/task/activity_task_receive', {
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
      if (Number(r?.error_code) === 0) rewards.push(removeTags(r?.data?.reward_msg || '领取成功'));
    } catch {
      /* 单个任务失败跳过，继续领下一个 */
    }
  }
  return {
    success: true,
    message: rewards.length ? rewards.join('；') : '暂无可领的日常任务奖励（可能已全部领取）',
    rewards,
    count: rewards.length
  };
}

// 全民众测能量值任务（社区 smzdm_testing.js 逆向）：自动发现活动 → 取任务列表 → 逐个领奖。
// 这是社区真正可自动化的"众测"玩法，全程无需 crowd_id（用 activity_id 代替）。
// 端点均为 web 接口（zhiyou.m.smzdm.com / test.m.smzdm.com），不加 app 签名。
async function getTestingActivityId(cookie, fetcher = call) {
  const json = await fetcher('https://zhiyou.m.smzdm.com/task/task/ajax_get_activity_id', {
    method: 'GET',
    cookie,
    referer: 'https://test.m.smzdm.com/',
    extraHeaders: { 'x-requested-with': 'com.smzdm.client.android', Origin: 'https://test.m.smzdm.com' }
  });
  return json?.data?.activity_id || null;
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
  const activityId = await getTestingActivityId(cookie, fetcher);
  if (!activityId) {
    throw new Error('未找到进行中的全民众测活动（可能暂未开启，或 smzdm 接口变更）');
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

// 真实策略表：任务类型 → 处理函数 + 是否需动态参数
// 转盘/抽奖：自动从内置稳定专题页获取 active_id（needsParam 置 null，可选填 activeId/topicUrl 覆盖）
// 众测：自动跑全民众测能量值任务（无需 crowd_id；可选填 crowd_id 走"申请具体商品"路径）
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
  dailyTasks: { handler: doDailyTasks, needsParam: null }
};

export const REAL_STRATEGY_TYPES = new Set(Object.keys(REAL_STRATEGIES));
