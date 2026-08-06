// 任务矩阵 · 内置真实任务（移植自青龙社区 smzdm 脚本，端点与签名均为社区逆向验证值）
//
// 与"待抓包"占位任务的区别：这里的端点、签名、多步流程（如 列表→领奖、抓 active_id→抽奖）
// 都来自社区已验证的青龙脚本（hex-ci/smzdm_script、tanyong826/TG_Scripts 等），不是占位符。
// 仅动态参数（转盘/众测的 active_id / crowd_id）因每日/每活动变化需用户填入，其余全自动。
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

// 从专题页 HTML 提取转盘活动 ID（hashId / lottery_activity_id），best-effort
async function fetchTurntableId(topicUrl, cookie) {
  try {
    const html = await call(topicUrl, {
      method: 'GET',
      cookie,
      raw: true,
      referer: M_REFERER,
      extraHeaders: ANDROID_XRW
    });
    let m = html.match(/\\?"hashId\\?":\\?"([^\\"]+)\\?"/i);
    if (m) return m[1];
    m = html.match(/name\s*=\s*"?lottery_activity_id"?\s+value\s*=\s*"?([a-zA-Z0-9]+)"?/i);
    if (m) return m[1];
    return null;
  } catch {
    return null;
  }
}

// 从众测专题页 HTML 提取 crowd_id，best-effort
async function fetchCrowdId(topicUrl, cookie) {
  try {
    const html = await call(topicUrl, {
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
export async function doTurntable(cookie, { activeId, topicUrl } = {}) {
  let id = activeId;
  if (!id && topicUrl) id = await fetchTurntableId(topicUrl, cookie);
  if (!id) {
    throw new Error('转盘/抽奖需要 active_id：在任务配置的"参数"里填写，或填 topicUrl 让其自动抓取');
  }
  const cb = randomCallback();
  const url = `https://zhiyou.smzdm.com/user/lottery/jsonp_draw?active_id=${encodeURIComponent(
    id
  )}&callback=${encodeURIComponent(cb)}`;
  const text = await call(url, {
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
    throw new Error('转盘抽奖失败：' + removeTags(json?.error_msg || '未知响应'));
  }
  const msg = removeTags(json?.error_msg || '抽奖完成');
  return { success: true, message: msg, result: json };
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

// 众测申请：zhiyou.m.smzdm.com/user/crowd/ajax_participate（web 接口，不加 app 签名）
export async function doCrowdtest(cookie, { crowdId, topicUrl } = {}) {
  let id = crowdId;
  if (!id && topicUrl) id = await fetchCrowdId(topicUrl, cookie);
  if (!id) {
    throw new Error('众测需要 crowd_id：在任务配置的"参数"里填写众测活动ID，或填 topicUrl 让其自动抓取');
  }
  const json = await call('https://zhiyou.m.smzdm.com/user/crowd/ajax_participate', {
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

// 真实策略表：任务类型 → 处理函数 + 是否需动态参数
export const REAL_STRATEGIES = {
  turntable: { handler: doTurntable, needsParam: 'activeId', paramHint: 'active_id（转盘活动ID）或 topicUrl（专题页链接）' },
  lottery: { handler: doTurntable, needsParam: 'activeId', paramHint: 'active_id（抽奖活动ID）或 topicUrl（专题页链接）' },
  crowdtest: { handler: doCrowdtest, needsParam: 'crowdId', paramHint: 'crowd_id（众测活动ID）或 topicUrl（专题页链接）' },
  dailyTasks: { handler: doDailyTasks, needsParam: null }
};

export const REAL_STRATEGY_TYPES = new Set(Object.keys(REAL_STRATEGIES));
