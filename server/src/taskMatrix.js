// 任务矩阵 · 自定义端点任务（模块 A 的任务补全部分）
//
// 背景：smzdm 的抽奖/转盘/众测/关注/分享等接口未公开，无法在仓库内硬编码"可用"端点。
// 这里把它们建模为「可配置端点任务」：接口 URL / 方法 / 请求体 / 资产字段映射由你从
// App 抓包得到后填入（db.settings.taskEndpoints）。系统对未配置的接口明确返回
// pendingCapture（待抓包），**绝不伪造成功**——这是与"假功能"的硬边界。
//
// 数据互通（A → B）：任务执行成功后的资产增量由 taskRunner 统一写入 assetLedger，
// 资产仪表盘（模块 B）直接读取该账本，无需各自维护数据。

import { smzdm } from './smzdm/adapter.js';

// 自定义端点任务的元数据（前端据此渲染"待抓包"徽标与配置表单）
export const CUSTOM_TASK_DEFS = [
  { type: 'lottery', name: '每日抽奖', icon: '🎰', desc: 'smzdm App 内的金币/实物抽奖，需抓包 lottery 类接口' },
  { type: 'turntable', name: '转盘抽奖', icon: '🎡', desc: '转盘/小金蛋类抽奖，需抓包 turntable 类接口' },
  { type: 'crowdtest', name: '众测申请', icon: '🧪', desc: '众测名额申请，需抓包 crowdtest 类接口' },
  { type: 'follow', name: '自动关注', icon: '➕', desc: '关注指定作者/话题，需抓包 follow 类接口与关注目标' },
  { type: 'share', name: '自动分享', icon: '🔗', desc: '分享内容领奖励，需抓包 share 类接口' }
];

export const CUSTOM_TYPES = CUSTOM_TASK_DEFS.map((d) => d.type);

// 推荐端点模板（社区脚本逆向得到的真实形态）。用户无需记住 URL —— 在「自动任务」页点
// "加载推荐模板"即可把真实端点形态填进表单，只需替换动态参数（如转盘的 active_id）。
// 注意：这些端点未在"你本人账号"逐一验证；动态参数（active_id / task_id）依赖抓包或导入器。
export const TASK_TEMPLATES = {
  lottery: {
    endpoint: 'https://zhiyou.smzdm.com/user/lottery/jsonp_draw?active_id=REPLACE_WITH_CAPTURED_ID',
    method: 'GET',
    jsonp: true,
    referer: 'https://m.smzdm.com/',
    headers: { 'x-requested-with': 'com.smzdm.client.android' },
    body: { callback: '' },
    assetFields: { message: 'error_msg' },
    note: '社区逆向端点；active_id 为动态值，需从 smzdm 专题页抓包获取（或用抓包导入器自动填）'
  },
  turntable: {
    endpoint: 'https://zhiyou.smzdm.com/user/lottery/jsonp_draw?active_id=REPLACE_WITH_CAPTURED_ID',
    method: 'GET',
    jsonp: true,
    referer: 'https://m.smzdm.com/',
    headers: { 'x-requested-with': 'com.smzdm.client.android' },
    body: { callback: '' },
    assetFields: { message: 'error_msg' },
    note: '转盘与抽奖共用 jsonp_draw，仅 active_id 不同；需抓包获取对应专题页的 active_id'
  },
  // 每日任务领奖（浏览/分享/关注等日常任务统一走此端点，task_id 为动态值）
  taskReceive: {
    endpoint: 'https://user-api.smzdm.com/task/activity_task_receive',
    method: 'POST',
    robotToken: true,
    tokenField: 'robot_token',
    assetFields: { message: 'data.reward_msg' },
    note: '每日任务统一领奖端点；task_id 每日变化，需从 /task/list_v2 抓包或用导入器自动填'
  }
};

// 安全读取嵌套路径：'data.gold' -> obj.data.gold；任一层缺失返回 undefined
export function getPath(obj, path) {
  if (!path || typeof path !== 'string') return undefined;
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

// 从接口响应按 assetFields 映射提取资产增量（纯函数，便于单测）
export function extractAsset(json, af = {}) {
  return {
    goldDelta: Number(getPath(json, af.gold)) || 0,
    silverDelta: Number(getPath(json, af.silver)) || 0,
    expDelta: Number(getPath(json, af.exp)) || 0,
    levelAfter: getPath(json, af.level) ?? null,
    message: String(getPath(json, af.message) || '执行成功')
  };
}

// 剥离 JSONP 响应外壳：形如 `callback({...})` 或 `jQuery123({...})` 提取内部 JSON。
// 纯函数，便于单测；无法解析时抛出。
export function parseJsonp(text) {
  if (typeof text !== 'string') return text;
  const m = text.match(/\(([\s\S]*)\)\s*$/);
  const inner = m ? m[1] : text;
  return JSON.parse(inner);
}

// 渲染请求体：支持对象或 JSON 字符串，并把占位符替换为账号信息
// 占位符：{{uid}} {{smzdmId}} {{nickname}}
export function renderBody(body, user) {
  const replacer = (s) =>
    String(s)
      .replace(/\{\{\s*uid\s*\}\}/g, user.id || '')
      .replace(/\{\{\s*smzdmId\s*\}\}/g, user.smzdmId || '')
      .replace(/\{\{\s*nickname\s*\}\}/g, user.nickname || '');
  if (body == null) return undefined;
  if (typeof body === 'string') {
    const text = replacer(body).trim();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      // 非 JSON：当作 key=value&key2=value2 表单串原样返回（call 内部会 URLSearchParams 化）
      return replacer(body);
    }
  }
  if (typeof body === 'object') {
    return JSON.parse(replacer(JSON.stringify(body)));
  }
  return undefined;
}

// 取某任务类型已配置的端点（抓包结果）
export function getTaskEndpoint(db, type) {
  const map = (db.settings && db.settings.taskEndpoints) || {};
  return map[type] || null;
}

// 执行一个自定义端点任务。
// 返回：
//   { ok:true, success:true, message, goldDelta, silverDelta, expDelta, levelAfter, explicit, result }
//   { ok:false, pendingCapture:true, message }  —— 未配置接口（待抓包）
//   { ok:false, error, message }                —— 执行失败（由调用方决定重试/记录）
export async function runCustomEndpointTask(task, db, user) {
  const def = getTaskEndpoint(db, task.type);
  if (!def || !def.endpoint) {
    return {
      ok: false,
      pendingCapture: true,
      error: 'pending_capture',
      message: `待抓包：${task.name} 尚未配置真实接口，请在「自动任务」页填入抓包得到的 URL/参数`
    };
  }

  // mock 适配器无 requestRaw：即便填了端点也不允许在 mock 模式下"假跑"
  if (typeof smzdm.requestRaw !== 'function') {
    return {
      ok: false,
      pendingCapture: true,
      error: 'pending_capture',
      message: `待抓包：${task.name} 需在 SMZDM_ADAPTER=real 模式下运行（当前为 mock，不发起真实请求）`
    };
  }

  const method = (def.method || 'POST').toUpperCase();
  let body = renderBody(def.body, user);

  // 预取 robot token（部分 user-api 端点如 task 领奖需要）：注入到请求体指定字段
  if (def.robotToken && typeof smzdm.getRobotToken === 'function') {
    const tok = await smzdm.getRobotToken(user.cookie);
    const field = def.tokenField || 'robot_token';
    body = typeof body === 'object' && body ? { ...body, [field]: tok } : { [field]: tok };
  }

  // 抓包接口可能需特定来源/请求头（如 jsonp 抽奖需 m.smzdm.com Referer + 安卓 x-requested-with）
  const extraOpts = {
    method,
    cookie: user.cookie,
    body: method === 'GET' ? undefined : body,
    referer: def.referer,
    extraHeaders: def.headers
  };
  const raw = def.jsonp ? await smzdm.requestRaw(def.endpoint, { ...extraOpts, raw: true }) : await smzdm.requestRaw(def.endpoint, extraOpts);

  // JSONP 响应形如 callback({...})，需剥离外层函数壳再解析
  let json = raw;
  if (def.jsonp && typeof raw === 'string') {
    try {
      json = parseJsonp(raw);
    } catch {
      throw new Error('JSONP 响应解析失败：' + raw.slice(0, 80));
    }
  }

  // 提取资产增量（按你抓包后填写的字段映射）
  const af = def.assetFields || {};
  const { goldDelta, silverDelta, expDelta, levelAfter, message } = extractAsset(json, af);

  return {
    ok: true,
    success: true,
    message,
    goldDelta,
    silverDelta,
    expDelta,
    levelAfter,
    explicit: { gold: goldDelta, silverDelta: silverDelta, exp: expDelta, level: levelAfter ?? undefined },
    result: { success: true, message }
  };
}
