// smzdm 适配器 —— REAL 实现（基于内置 fetch，零额外依赖）
//
// ⚠️ 合规与可行性说明（务必先读）：
// 1. 真实调用需要你自己的 smzdm 账号 Cookie，自动化访问可能违反 smzdm《用户协议》。
//    请仅在自有账号、且充分知悉风险的前提下启用（SMZDM_ADAPTER=real），
//    切勿用于批量注册、刷量或任何商用/牟利场景。
// 2. 真实签到链路（社区逆向，已在下方实现）：
//    robot/token → checkin，带 MD5 签名。签名用的 key / sk 为社区逆向出的客户端常量，
//    可能随 smzdm 版本更新而失效，请用同名环境变量覆盖：
//      SMZDM_SIGN_KEY / SMZDM_SK / SMZDM_APP_V / SMZDM_API_BASE
// 3. 返回值字段以社区经验为准，请按你账号的真实响应在解析处微调。

import crypto from 'node:crypto';

const BASE = (process.env.SMZDM_BASE || 'https://www.smzdm.com').replace(/\/$/, '');
const API_BASE = (process.env.SMZDM_API_BASE || 'https://user-api.smzdm.com').replace(/\/$/, '');

// 社区逆向得到的签名密钥与客户端标识（失效时用抓包值覆盖）
const SIGN_KEY = process.env.SMZDM_SIGN_KEY || 'apr1$AwP!wRRT$gJ/q.X24poeBInlUJC';
const APP_SK = process.env.SMZDM_SK || 'ierkM0OZZbsuBKLoAgQ6OJneLMXBQXmzX+LXkNTuKch8Ui2jGlahuFyWIzBiDq/L';
const APP_V = process.env.SMZDM_APP_V || '10.4.1';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ANDROID_UA = `smzdm_android_V${APP_V} rv:841 (22021211RC;Android12;zh)smzdmapp`;

const ENDPOINTS = {
  userInfo: process.env.SMZDM_API_USERINFO || '/user/',
  checkin: process.env.SMZDM_API_CHECKIN || '/user/checkin',
  comment: process.env.SMZDM_API_COMMENT || '/article/ajax_post_comment',
  favorite: process.env.SMZDM_API_FAVORITE || '/article/ajax_favorite',
  point: process.env.SMZDM_API_POINT || '/article/ajax_vote',
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
async function call(path, { method = 'GET', cookie, body, ua = UA, base = API_BASE } = {}) {
  const url = path.startsWith('http') ? path : base + path;
  const timeoutMs = Number(process.env.SMZDM_REQUEST_TIMEOUT || 10000);
  const init = {
    method,
    headers: headers(cookie, ua),
    redirect: 'follow',
    // 关键可靠性修复：对外请求必须带超时，避免 smzdm 无响应时 Promise 永久 pending
    signal: AbortSignal.timeout(timeoutMs)
  };
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

function md5Sign(str) {
  return crypto.createHash('md5').update(str).digest('hex').toUpperCase();
}

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
  if (Number(json?.error_code) !== 0) throw new Error('获取 token 失败：' + (json?.error_msg || '未知'));
  return json.data?.token;
}

export const realAdapter = {
  name: 'real',

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

  async doClockIn(cookie) {
    const token = await getRobotToken(cookie);
    const ts = Date.now();
    const sign = md5Sign(
      `f=android&sk=${APP_SK}&time=${ts}&token=${token}&v=${APP_V}&weixin=1&key=${SIGN_KEY}`
    );
    const json = await call('/checkin', {
      method: 'POST',
      cookie,
      ua: ANDROID_UA,
      body: { f: 'android', v: APP_V, sk: APP_SK, weixin: 1, time: ts, token, sign }
    });
    if (Number(json?.error_code) !== 0) throw new Error('签到失败：' + (json?.error_msg || '未知'));
    const d = json.data || {};
    const points = Number(d.add_point ?? d.addPoint ?? 0);
    const continuity = Number(d.continue_sign_days ?? d.continueSignDays ?? 0);
    return { success: true, points, message: `签到成功，+${points} 金币`, continuity };
  },

  async doComment(cookie, opts = {}) {
    if (!opts.articleId) throw new Error('评论需要 articleId（real 模式暂未采集文章 ID）');
    const count = Math.min(Math.max(1, Number(opts.count) || 1), 5); // F3：真正循环 count（上限 5），消息如实
    let last;
    for (let i = 0; i < count; i++) {
      last = await call(ENDPOINTS.comment, {
        method: 'POST',
        cookie,
        body: { article_id: opts.articleId, content: opts.content || '好价，感谢分享！' },
        base: BASE
      });
      assertOk(last, '评论');
    }
    return { success: true, message: `评论成功 ×${count}`, count };
  },

  async doFavorite(cookie, opts = {}) {
    if (!opts.articleId) throw new Error('收藏需要 articleId（real 模式暂未采集文章 ID）');
    const count = Math.min(Math.max(1, Number(opts.count) || 1), 5);
    let last;
    for (let i = 0; i < count; i++) {
      last = await call(ENDPOINTS.favorite, { method: 'POST', cookie, body: { article_id: opts.articleId }, base: BASE });
      assertOk(last, '收藏');
    }
    return { success: true, message: `收藏成功 ×${count}`, count };
  },

  async doPoint(cookie, opts = {}) {
    if (!opts.articleId) throw new Error('点赞需要 articleId（real 模式暂未采集文章 ID）');
    const count = Math.min(Math.max(1, Number(opts.count) || 1), 5);
    let last;
    for (let i = 0; i < count; i++) {
      last = await call(ENDPOINTS.point, { method: 'POST', cookie, body: { article_id: opts.articleId }, base: BASE });
      assertOk(last, '点赞');
    }
    return { success: true, message: `点赞成功 ×${count}`, count };
  },

  async submitBaoliao(cookie, payload = {}) {
    const body = {
      title: payload.title || '',
      link: payload.url || '',
      price: payload.price || '',
      category: payload.cat || '',
      content: payload.content || ''
    };
    const json = await call(ENDPOINTS.baoliao, { method: 'POST', cookie, body, base: BASE });
    assertOk(json, '爆料');
    const d = json?.data || json || {};
    return {
      success: true,
      message: `爆料「${payload.title}」提交成功`,
      url: d.url || d.article_url || '',
      points: 0
    };
  }
};
