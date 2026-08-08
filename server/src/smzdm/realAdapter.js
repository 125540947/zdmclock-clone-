// smzdm 适配器 —— REAL 实现（基于内置 fetch，零额外依赖）
//
// ⚠️ 合规与可行性说明（务必先读）：
// 1. 真实调用需要你自己的 smzdm 账号 Cookie，自动化访问可能违反 smzdm《用户协议》。
//    请仅在自有账号、且充分知悉风险的前提下启用（SMZDM_ADAPTER=real），
//    切勿用于批量注册、刷量或任何商用/牟利场景。
// 2. 真实签到链路（社区逆向，已在下方实现）：
//    doClockIn 优先走【APP robot 签到流程】——robot/token 取 token → POST user-api.smzdm.com/checkin（带 MD5 签名）。
//    实测：浏览器抓的网页 Cookie 对 user-api 同样有效（robot/token 返回 0），且 APP 流程**无网页端点验证码墙(110202)**，
//    故作为首选。网页 jsonp_checkin 仅作 robot 流程失败时的兜底（其常因验证码墙返回 110202）。
//    签名常量（SMZDM_SIGN_KEY / SMZDM_SK / SMZDM_APP_V）与社区脚本（checkinpanel / 52pojie）完全一致。
// 3. 返回值字段以社区经验为准，请按你账号的真实响应在解析处微调。

import crypto from 'node:crypto';
import { normalizeArticleId } from './articleId.js';

const BASE = (process.env.SMZDM_BASE || 'https://www.smzdm.com').replace(/\/$/, '');
const API_BASE = (process.env.SMZDM_API_BASE || 'https://user-api.smzdm.com').replace(/\/$/, '');
// 网页签到基址（与浏览器抓包 Cookie 匹配）：zhiyou.smzdm.com/user/checkin/jsonp_checkin
const WEB_BASE = (process.env.SMZDM_WEB_BASE || 'https://zhiyou.smzdm.com').replace(/\/$/, '');

// 社区逆向得到的签名密钥与客户端标识（失效时用抓包值覆盖）
const SIGN_KEY = process.env.SMZDM_SIGN_KEY || 'apr1$AwP!wRRT$gJ/q.X24poeBInlUJC';
const APP_SK = process.env.SMZDM_SK || 'ierkM0OZZbsuBKLoAgQ6OJneLMXBQXmzX+LXkNTuKch8Ui2jGlahuFyWIzBiDq/L';
const APP_V = process.env.SMZDM_APP_V || '10.4.1';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ANDROID_UA = `smzdm_android_V${APP_V} rv:841 (22021211RC;Android12;zh)smzdmapp`;

// 浏览器 UA 池：评论/收藏/点赞/爆料等 www 端点无 app 签名，靠「UA 多样化 + 拟人化间隔」
// 降低被 smzdm 风控按固定指纹识别为机器的概率（签名对这些 web 接口无意义）。
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
];

// 拟人化间隔窗口（毫秒）：评论/收藏/点赞的 count 多次动作之间随机等待，打破背靠背请求的固定时序。
// 默认 800~2500ms；可用同名环境变量覆盖（过大拖慢，过小无效）。
const ACTION_JITTER_MIN = Number(process.env.SMZDM_ACTION_JITTER_MIN || 800);
const ACTION_JITTER_MAX = Number(process.env.SMZDM_ACTION_JITTER_MAX || 2500);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 随机取一个浏览器 UA（rng 可注入便于单测）
export function pickUA(rng = Math.random) {
  return UA_POOL[Math.floor(rng() * UA_POOL.length)];
}

// 在 [min, max] 之间取整数毫秒（rng 可注入）
export function actionJitter(rng = Math.random) {
  const span = Math.max(0, ACTION_JITTER_MAX - ACTION_JITTER_MIN);
  return ACTION_JITTER_MIN + Math.floor(rng() * (span + 1));
}

const ENDPOINTS = {
  userInfo: process.env.SMZDM_API_USERINFO || '/user/',
  checkin: process.env.SMZDM_API_CHECKIN || '/user/checkin',
  // 评论/点赞：zhiyou 域网页互动端点（GET+JSONP），原 www/article/ajax_* 已失效返回 404（2026-08 实测）
  comment: process.env.SMZDM_API_COMMENT || '/user/comment/ajax_set_comment',
  point: process.env.SMZDM_API_POINT || '/user/comment/ajax_set_comment',
  // 收藏：user-api APP 接口（已验证端点存在，需签名+登录态）；www/zhiyou 同名路径已 404（2026-08 实测）
  favorite: process.env.SMZDM_API_FAVORITE || '/favorites/create',
  baoliao: process.env.SMZDM_API_BAOLIAO || '/publish/articles/ajax_create'
};

function headers(cookie, ua = UA) {
  return {
    'User-Agent': ua,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Referer: BASE + '/',
    Origin: BASE,
    'X-Requested-With': 'XMLHttpRequest',
    Cookie: cookie || ''
  };
}

// 统一请求：表单提交（x-www-form-urlencoded），解析 JSON（兼容 )]}' 前缀）
// 扩展：raw（返回原始文本，供 JSONP 类接口）、referer / extraHeaders（抓包接口常需特定来源与头）
export async function call(path, { method = 'GET', cookie, body, ua = UA, base = API_BASE, raw = false, referer, extraHeaders } = {}) {
  const url = path.startsWith('http') ? path : base + path;
  const timeoutMs = Number(process.env.SMZDM_REQUEST_TIMEOUT || 10000);
  const init = {
    method,
    headers: headers(cookie, ua),
    redirect: 'follow',
    // 关键可靠性修复：对外请求必须带超时，避免 smzdm 无响应时 Promise 永久 pending
    signal: AbortSignal.timeout(timeoutMs)
  };
  if (referer) init.headers['Referer'] = referer;
  if (extraHeaders && typeof extraHeaders === 'object') Object.assign(init.headers, extraHeaders);
  if (body) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(body).toString();
  }
  let resp;
  try {
    resp = await fetch(url, init);
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new Error(`请求超时（>${timeoutMs}ms）@ ${path}，请检查网络或被风控拦截`);
    }
    throw e;
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status} @ ${path}`);
  const text = await resp.text();
  if (raw) return text; // JSONP / 非 JSON 响应原样返回，由调用方自行解析
  if (text.length > 2_000_000) throw new Error('响应体过大，已拒绝（疑似异常响应）'); // b5：防超大响应占内存
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const cleaned = text.replace(/^\)\]\}',?\s*/, '').trim();
    try {
      json = JSON.parse(cleaned);
    } catch {
      throw new Error('非预期响应：' + text.slice(0, 80));
    }
  }
  return json;
}

function assertOk(json, where) {
  const ok =
    json && (Number(json.error_code) === 0 || json.success === true || Number(json.code) === 0 || Number(json.errorCode) === 0);
  if (ok) return;
  const msg =
    json?.error_msg || json?.error_reason || json?.errorMsg || json?.message || json?.msg || '未知错误';
  throw new Error(`${where}失败：${msg}`);
}

// smzdm 对"已做过 / 重复提交"类提示，对自动任务应视为软成功（动作已生效或无需重复），
// 不应当作失败抛错。覆盖：请勿重复提交、已评论/已赞/已收藏、已顶/已签过等。
function isSoftSuccess(json) {
  if (!json) return false;
  if (Number(json.error_code) === 0 || Number(json.errorCode) === 0 || json.success === true) return false; // 真成功走 assertOk
  const msg = String(json?.error_msg || json?.errorMsg || json?.message || json?.msg || '');
  return /请勿重复提交|已评论|已经评论|已赞|已经赞|已收藏|已经收藏|已顶|已经顶|已签过|已经签到|今天已|今日已|已经点过|您已经/.test(msg);
}

function md5Sign(str) {
  return crypto.createHash('md5').update(str).digest('hex').toUpperCase();
}

// 社区统一签名（青龙脚本 signFormData 等价实现）：
// 合并公共参数(weixin/basic_v/f/v/time) + 业务参数 → 过滤空值 → 按 key 字母排序 →
// key=value 拼接 → 追加 &key=SIGN_KEY → md5().toUpperCase()。time 用毫秒时间戳。
export function signFormData(data = {}) {
  const newData = {
    weixin: 1,
    basic_v: 0,
    f: 'android',
    v: APP_V,
    time: `${Math.round(Date.now() / 1000) * 1000}`,
    ...data
  };
  const keys = Object.keys(newData)
    .filter((k) => newData[k] !== '' && newData[k] != null)
    .sort();
  const signData = keys.map((k) => `${k}=${String(newData[k]).replace(/\s+/g, '')}`).join('&');
  const sign = crypto.createHash('md5').update(`${signData}&key=${SIGN_KEY}`).digest('hex').toUpperCase();
  return { ...newData, sign };
}

// 带社区统一签名的请求（POST 表单 / GET 查询），供 task / checkin 家族端点使用
export async function appRequest(path, { cookie, data = {}, method = 'POST', base = API_BASE, ua = ANDROID_UA } = {}) {
  const signed = signFormData(data);
  if (method === 'GET') {
    const url = (path.startsWith('http') ? path : base + path) + '?' + new URLSearchParams(signed).toString();
    return call(url, { method: 'GET', cookie, ua, base });
  }
  return call(path, { method, cookie, ua, base, body: signed });
}

function removeTags(s) {
  return String(s || '')
    .replace(/<[^<]+?>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 解析 smzdm 网页签到返回：兼容纯 JSON、JSONP 包裹（callback({...})）与 Angular 风格 )]}' 前缀
export function parseJsonp(text) {
  if (typeof text !== 'string') return text;
  let t = text.trim();
  const wrap = t.match(/^[a-zA-Z_$][\w$]*\s*\(([\s\S]*)\)\s*;?\s*$/);
  if (wrap) t = wrap[1];
  t = t.replace(/^\)\]\}',?\s*/, '');
  try {
    return JSON.parse(t);
  } catch {
    return {};
  }
}

// normalizeArticleId 已抽到 ./articleId.js 供 taskRunner 共用，这里 re-export 保持兼容
export { normalizeArticleId };

// 先取 robot token（带签名），后续 checkin 需要
async function getRobotToken(cookie) {
  const ts = Date.now();
  const sign = md5Sign(`f=android&time=${ts}&v=${APP_V}&weixin=1&key=${SIGN_KEY}`);
  const json = await call('/robot/token', {
    method: 'POST',
    cookie,
    ua: ANDROID_UA,
    body: { f: 'android', v: APP_V, weixin: 1, time: ts, sign }
  });
  // [诊断] 不论成败都打印，便于排查签名/Cookie 是否被 smzdm 拒绝
  console.log('[smzdm-debug] /robot/token error_code=', json?.error_code, 'error_msg=', json?.error_msg, 'hasToken=', !!json?.data?.token, 'cookieLen=', (cookie || '').length);
  if (Number(json?.error_code) !== 0) throw new Error('获取 token 失败：' + (json?.error_msg || '未知'));
  return json.data?.token;
}

// APP 签到流程（优先）：robot/token 取 token → POST /checkin（带 MD5 签名）。
// 该流程对网页 Cookie 同样有效（已验证 robot/token 返回 0），且**无网页端点验证码墙(110202)**，
// 故作为 doClockIn 的首选路径；网页 jsonp_checkin 仅作兜底。
async function robotCheckIn(cookie) {
  const token = await getRobotToken(cookie); // 内部已打印 [smzdm-debug] /robot/token
  const ts = Date.now();
  const sign = md5Sign(`f=android&sk=${APP_SK}&time=${ts}&token=${token}&v=${APP_V}&weixin=1&key=${SIGN_KEY}`);
  const body = { f: 'android', v: APP_V, sk: APP_SK, weixin: 1, time: ts, token, sign };
  const json = await call('/checkin', { method: 'POST', cookie, ua: ANDROID_UA, base: API_BASE, body });
  console.log('[smzdm-debug] robot /checkin raw:', JSON.stringify(json).slice(0, 1200), 'cookieLen=', (cookie || '').length);
  const ec = Number(json?.error_code ?? json?.errorCode);
  const msg = String(json?.error_msg || json?.errorMsg || json?.message || '');
  if (ec === 0) {
    const d = json.data || {};
    const gold = Number(d.cgold ?? d.gold ?? 0);
    const silver = Number(d.pre_re_silver ?? d.silver ?? 0);
    const exp = Number(d.cexperience ?? d.exp ?? 0);
    const level = d.rank ?? d.rank_name ?? d.level ?? null;
    const points = Number(d.cpoints ?? d.add_point ?? d.addPoint ?? gold);
    const continuity = Number(d.daily_num ?? d.continue_sign_days ?? d.continue_sign ?? 0);
    let extraMsg = '';
    try {
      const ex = await robotCheckinExtras(cookie, token);
      if (ex.rewards.length) extraMsg = '；额外：' + ex.rewards.join('；');
    } catch {
      /* 额外奖励非关键 */
    }
    return {
      success: true,
      points,
      balances: { gold, silver, exp, level },
      continuity,
      message: `签到成功（APP流程），金币 ${gold} / 碎银 ${silver} / 经验 ${exp}${extraMsg}`
    };
  }
  // 今日已签到：软成功，不报错
  if (/已签到|已经签到|今天已|今日已|已签过|已经签/.test(msg)) {
    return { success: true, points: 0, balances: {}, continuity: 0, message: '今日已签到（重复请求）' };
  }
  throw new Error('签到失败：' + (msg || '未知') + ' (error_code=' + ec + ')');
}

// APP 签到额外奖励（best-effort）：领取 /checkin/all_reward
async function robotCheckinExtras(cookie, token) {
  const rewards = [];
  const ts = Date.now();
  const sign = md5Sign(`f=android&sk=${APP_SK}&time=${ts}&token=${token}&v=${APP_V}&weixin=1&key=${SIGN_KEY}`);
  const body = { f: 'android', v: APP_V, sk: APP_SK, weixin: 1, time: ts, token, sign };
  try {
    const j = await call('/checkin/all_reward', { method: 'POST', cookie, ua: ANDROID_UA, base: API_BASE, body });
    if (Number(j?.error_code) === 0) rewards.push(removeTags(j?.data?.reward_msg || j?.data?.title || '领取成功'));
  } catch {
    /* 单个额外奖励失败不影响整体 */
  }
  return { rewards };
}

export const realAdapter = {
  name: 'real',

  // 自定义端点任务的底层请求（抓包得到的真实接口）。封装统一的签名头/超时/JSON 解析，
  // 供 taskMatrix 的"其他接口来源"任务调用。仅 real 适配器提供；mock 无此方法（自定义任务将标"待抓包"）。
  // opts 支持：method / cookie / body / raw(JSONP 原样返回) / referer / extraHeaders / base
  async requestRaw(path, opts = {}) {
    return call(path, opts);
  },

  // 取 robot token（部分 user-api 端点如 task 领奖需要），供 taskMatrix 的 needsRobotToken 任务预取
  async getRobotToken(cookie) {
    return getRobotToken(cookie);
  },

  async getUserInfo(cookie) {
    // F2：改用 user-api 基址（www.smzdm.com/user/ 返回 HTML 无法解析）；端点为社区经验值，未验证
    const json = await call(ENDPOINTS.userInfo, { cookie, base: API_BASE });
    const d = json?.data || json || {};
    return {
      smzdmId: d.userId || d.smzdm_id || '',
      nickname: d.nickName || d.nick_name || d.username || '',
      points: Number(d.point || d.points || 0),
      level: d.rank || d.level || 'Lv.0',
      vip: !!(d.is_vip || d.vip),
      avatar: d.avatar || ''
    };
  },

  // 签到主入口：优先走 APP robot 流程（user-api.smzdm.com/checkin，带 MD5 签名），
  // 该流程对网页 Cookie 同样有效（已验证 robot/token 返回 0），且**无网页端点验证码墙(110202)**。
  // 仅当 robot 流程异常时才回退网页 jsonp_checkin（兜底，部分账号/场景可用）。
  async doClockIn(cookie) {
    try {
      return await robotCheckIn(cookie);
    } catch (robotErr) {
      try {
        return await webCheckIn(cookie);
      } catch {
        throw robotErr; // 抛出 robot 流程的原始错误（更可能是根因）
      }
    }
  },

  // 网页签到流程（兜底）：GET zhiyou.smzdm.com/user/checkin/jsonp_checkin（带浏览器网页 Cookie）。
  // ⚠️ 该端点有验证码风控墙，直连常返回 110202「验证码输入错误」，故仅作 robot 流程失败后的兜底。
  async webCheckIn(cookie) {
    const text = await call('/user/checkin/jsonp_checkin', {
      method: 'GET',
      cookie,
      ua: UA,
      base: WEB_BASE,
      raw: true,
      referer: BASE + '/'
    });
    const json = parseJsonp(text);
    // [诊断] 打印 smzdm 真实返回，确认网页端点是否真签成（error_code=0 即成功）
    console.log('[smzdm-debug] web /jsonp_checkin raw:', JSON.stringify(json).slice(0, 1200), 'cookieLen=', (cookie || '').length);
    const ec = Number(json?.error_code ?? json?.errorCode);
    const msg = String(json?.error_msg || json?.errorMsg || json?.message || '');
    if (ec === 0) {
      const d = json.data || {};
      const gold = Number(d.cgold ?? d.gold ?? 0);
      const silver = Number(d.pre_re_silver ?? d.silver ?? 0);
      const exp = Number(d.cexperience ?? d.exp ?? 0);
      const level = d.rank ?? d.rank_name ?? d.level ?? null;
      const points = Number(d.add_point ?? d.addPoint ?? gold); // 本次 awarded（优先）否则用余额
      const continuity = Number(d.daily_num ?? d.continue_sign_days ?? d.continue_sign ?? 0);
      // 签约外奖励（best-effort，网页端点，失败静默跳过不阻断签到）
      let extraMsg = '';
      try {
        const ex = await doCheckinExtras(cookie);
        if (ex.rewards.length) extraMsg = '；额外：' + ex.rewards.join('；');
      } catch {
        /* 额外奖励非关键，忽略异常 */
      }
      return {
        success: true,
        points,
        balances: { gold, silver, exp, level },
        continuity,
        message: `签到成功，金币 ${gold} / 碎银 ${silver} / 经验 ${exp}${extraMsg}`
      };
    }
    // 今日已签到：软成功，不报错（避免重复触发失败 / 误判 Cookie 失效）
    if (/已签到|已经签到|今天已|今日已|已签过|已经签/.test(msg)) {
      return { success: true, points: 0, balances: {}, continuity: 0, message: '今日已签到（重复请求）' };
    }
    throw new Error('签到失败：' + (msg || '未知') + ' (error_code=' + ec + ')');
  },

  // 签到额外奖励（best-effort，网页端点）：领取 all_reward 与 extra_reward。
  // 网页 Cookie 无 APP 签名，直接 GET 对应网页端点；任一失败静默跳过，不阻断主签到。
  async doCheckinExtras(cookie) {
    const rewards = [];
    for (const ep of ['/checkin/all_reward', '/checkin/extra_reward']) {
      try {
        const text = await call(ep, { method: 'GET', cookie, ua: UA, base: WEB_BASE, raw: true, referer: BASE + '/' });
        const j = parseJsonp(text);
        if (Number(j?.error_code) === 0) rewards.push(removeTags(j?.data?.reward_msg || '领取成功'));
      } catch {
        /* 单个额外奖励失败不影响整体 */
      }
    }
    return { rewards };
  },

  async doComment(cookie, opts = {}) {
    const req = opts.callImpl || call;
    const wait = opts.sleepImpl || sleep;
    const articleId = normalizeArticleId(opts.articleId);
    if (!articleId) throw new Error('评论需要 articleId（请在自动任务里填写目标文章ID或链接）');
    const count = Math.min(Math.max(1, Number(opts.count) || 1), 5); // F3：真正循环 count（上限 5），消息如实
    let last;
    const uas = new Set();
    for (let i = 0; i < count; i++) {
      if (i > 0) await wait(actionJitter()); // 多次动作之间拟人化随机等待，避免背靠背
      const ua = pickUA();
      uas.add(ua);
      // zhiyou 域网页评论端点：GET + JSONP（type=3 评论，pid 文章ID，content 内容）
      const q = 'type=3&pid=' + encodeURIComponent(articleId) +
        '&content=' + encodeURIComponent(opts.content || '好价，感谢分享！') +
        '&callback=jsonp_' + Date.now();
      const text = await req(ENDPOINTS.comment + '?' + q, {
        method: 'GET', cookie, ua, base: WEB_BASE, raw: true
      });
      const json = typeof text === 'string' ? parseJsonp(text) : text;
      console.log('[smzdm-debug] comment raw:', JSON.stringify(json).slice(0, 800), 'articleId=', articleId, 'cookieLen=', (cookie || '').length);
      if (isSoftSuccess(json)) { last = json; continue; } // 请勿重复提交/已评论 = 软成功
      assertOk(json, '评论');
      last = json;
    }
    return { success: true, message: `评论成功 ×${count}（文章 ${articleId}）`, count, articleId, uas: [...uas] };
  },

  async doFavorite(cookie, opts = {}) {
    const req = opts.callImpl || call;
    const wait = opts.sleepImpl || sleep;
    const articleId = normalizeArticleId(opts.articleId);
    if (!articleId) throw new Error('收藏需要 articleId（请在自动任务里填写目标文章ID或链接）');
    const count = Math.min(Math.max(1, Number(opts.count) || 1), 5);
    let last;
    const uas = new Set();
    // user-api APP 收藏接口需登录态 + 社区签名；一并带入 robot token（与签到同套机制）。
    // www/zhiyou 的 /user/article/ajax_favorite 已 404（2026-08 实测），故走 user-api。
    let robotToken = '';
    try { robotToken = await getRobotToken(cookie); } catch { /* 取 token 失败则不带，端点可能仅校验签名+会话 */ }
    for (let i = 0; i < count; i++) {
      if (i > 0) await wait(actionJitter());
      const ua = pickUA();
      uas.add(ua);
      const signed = signFormData({ id: articleId, channel_id: '0', token: robotToken });
      last = await req(ENDPOINTS.favorite, { method: 'POST', cookie, ua, body: signed, base: API_BASE });
      console.log('[smzdm-debug] favorite raw:', JSON.stringify(last).slice(0, 800), 'articleId=', articleId, 'cookieLen=', (cookie || '').length);
      assertOk(last, '收藏');
    }
    return { success: true, message: `收藏成功 ×${count}（文章 ${articleId}）`, count, articleId, uas: [...uas] };
  },

  async doPoint(cookie, opts = {}) {
    const req = opts.callImpl || call;
    const wait = opts.sleepImpl || sleep;
    const articleId = normalizeArticleId(opts.articleId);
    if (!articleId) throw new Error('点赞需要 articleId（请在自动任务里填写目标文章ID或链接）');
    const count = Math.min(Math.max(1, Number(opts.count) || 1), 5);
    let last;
    const uas = new Set();
    for (let i = 0; i < count; i++) {
      if (i > 0) await wait(actionJitter());
      const ua = pickUA();
      uas.add(ua);
      // zhiyou 域网页「顶/有用」端点：与评论同接口，type=1（type=2 为踩），GET+JSONP
      const q = 'type=1&pid=' + encodeURIComponent(articleId) +
        '&callback=jsonp_' + Date.now();
      const text = await req(ENDPOINTS.point + '?' + q, {
        method: 'GET', cookie, ua, base: WEB_BASE, raw: true
      });
      const json = typeof text === 'string' ? parseJsonp(text) : text;
      console.log('[smzdm-debug] point raw:', JSON.stringify(json).slice(0, 800), 'articleId=', articleId, 'cookieLen=', (cookie || '').length);
      if (isSoftSuccess(json)) { last = json; continue; } // 请勿重复提交/已赞 = 软成功
      assertOk(json, '点赞');
      last = json;
    }
    return { success: true, message: `点赞成功 ×${count}（文章 ${articleId}）`, count, articleId, uas: [...uas] };
  },

  async submitBaoliao(cookie, payload = {}, opts = {}) {
    const req = opts.callImpl || call;
    const body = {
      title: payload.title || '',
      link: payload.url || '',
      price: payload.price || '',
      category: payload.cat || '',
      content: payload.content || ''
    };
    const json = await req(ENDPOINTS.baoliao, { method: 'POST', cookie, ua: pickUA(), body, base: BASE });
    assertOk(json, '爆料');
    const d = json?.data || json || {};
    return {
      success: true,
      message: `爆料「${payload.title}」提交成功`,
      url: d.url || d.article_url || '',
      points: 0
    };
  },

  // ⚠️ 好价真实抓取（best-effort，未验证）：
  // 抓取 smzdm 公开好价列表页，抽取文章卡片（href="/p/<id>" 及其标题文本）。
  // - 公开页无需登录 Cookie 即可读取；
  // - 页面结构可能随 smzdm 改版而失效，解析为空会明确报错，绝不静默成功；
  // - 任何网络异常 / 超时 / 超大响应都被捕获，调用方据此友好提示。
  async fetchBaoliao({ cookie, limit = 20, page = 1 } = {}) {
    const url = (process.env.SMZDM_BAOLIAO_URL || BASE + '/').replace(/\/$/, '') + `/?page=${page}`;
    const timeoutMs = Number(process.env.SMZDM_REQUEST_TIMEOUT || 10000);
    let resp;
    try {
      resp = await fetch(url, {
        headers: headers(cookie, pickUA()),
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (e) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        throw new Error(`抓取好价超时（>${timeoutMs}ms），可能被风控或网络不通`);
      }
      throw new Error('抓取好价网络错误：' + e.message);
    }
    if (!resp.ok) { console.log('[smzdm-debug] fetchBaoliao HTTP', resp.status); throw new Error(`抓取好价 HTTP ${resp.status}`); }
    const html = await resp.text();
    console.log('[smzdm-debug] fetchBaoliao http=', resp.status, 'htmlLen=', html.length);
    if (html.length > 5_000_000) throw new Error('好价列表响应过大，已拒绝（疑似异常响应）');
    // 抽取文章卡片：捕获 /p/<id> 链接与相邻标题文本（容忍标签嵌套）
    const cardRe = /href="\/p\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const seen = new Set();
    const items = [];
    let m;
    while ((m = cardRe.exec(html)) !== null && items.length < limit) {
      const id = m[1];
      if (seen.has(id)) continue;
      seen.add(id);
      const rawTitle = String(m[2] || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
      items.push({
        title: rawTitle,
        url: '',
        smzdmUrl: `${BASE}/p/${id}`,
        price: '',
        content: rawTitle
      });
    }
    if (!items.length) { console.log('[smzdm-debug] fetchBaoliao 解析到 0 条（页面结构可能已变更），htmlLen=', html.length); throw new Error('未能从页面解析到好价文章（页面结构可能已变更）'); }
    console.log('[smzdm-debug] fetchBaoliao 解析到', items.length, '条');
    return { ok: true, items, page };
  }
};
