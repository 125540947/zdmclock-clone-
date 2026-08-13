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
import { REAL_STRATEGIES, REAL_STRATEGY_TYPES, extractReward } from './smzdm/tasks_real.js';
import { parseJsonp as parseJsonpSafe } from './smzdm/parse.js';

// 供 routes/tasks.js 等直接从 taskMatrix 引用真实策略集合
export { REAL_STRATEGIES, REAL_STRATEGY_TYPES };

// 自定义端点任务的元数据（前端据此渲染徽标与配置表单）
// builtin:true 表示端点/签名/多步流程已内置（移植自青龙社区逆向）；其中转盘/众测/每日任务的
// 动态参数运行时自动获取，用户无需手填；而 follow/share 虽端点已内置，但需用户填目标参数
// （target / articleId），无法自动发现，故仍标记为需配置（前端参数表单）。
export const CUSTOM_TASK_DEFS = [
  { type: 'lottery', name: '每日抽奖', icon: '🎰', builtin: true, desc: '已内置青龙社区逆向端点（jsonp_draw）；active_id 自动从 smzdm 转盘专题页获取，开启即运行，无需手填' },
  { type: 'turntable', name: '转盘抽奖', icon: '🎡', builtin: true, desc: '已内置青龙社区逆向端点（jsonp_draw）；active_id 自动获取（含会员/值会员双转盘），无需手填' },
  { type: 'crowdtest', name: '全民众测', icon: '🧪', builtin: true, desc: '已内置：自动发现全民众测活动并完成能量值任务（无需 crowd_id）；也可填 crowd_id 走"申请具体商品"' },
  { type: 'follow', name: '自动关注', icon: '➕', builtin: true, desc: '已内置青龙社区逆向端点（dingyue-api 关注用户/栏目/品牌，app 签名）；填 target（用户名/栏目名/品牌名）即可运行，无需抓包。target 支持填数组，每次运行自动关注列表里的下一个（轮询），实现「每次适配」' },
  { type: 'share', name: '自动分享', icon: '🔗', builtin: true, desc: '已内置青龙社区逆向端点（user-api 分享流程 complete_share_rule/daily_reward/callback）；填 articleId 即可运行，无需抓包' },
  { type: 'dailyTasks', name: '每日任务', icon: '📋', builtin: true, desc: '已内置：自动领取每日任务奖励（list_v2 → activity_task_receive）' }
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

// 剥离 JSONP 响应外壳：委托共享 parseJsonp（含 )]}' 前缀处理与失败兜底）。
// 保留本模块的"抛错"契约：runCustomEndpointTask 在 try/catch 中据此抛出友好错误，
// 避免把解析失败的响应误判为"执行成功"（assetFields 取不到字段会返回 message='执行成功'）。
export function parseJsonp(text) {
  const r = parseJsonpSafe(text);
  if (r && r.error) throw new Error('JSONP 响应解析失败：' + String(text).slice(0, 80));
  return r;
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
export async function runCustomEndpointTask(task, db, user, adapter = smzdm) {
  const def = getTaskEndpoint(db, task.type) || {};
  const hasCustomEndpoint = !!(def && def.endpoint);
  // 内置真实策略（移植自青龙社区逆向）：默认优先走这里，用户只需填动态参数（active_id/crowd_id 等）。
  // 但若用户显式导入/配置了真实端点（抓包导入 / 手动配置），则让导入的端点生效，覆盖内置策略——
  // 这正是「抓包导入」功能的目的（用你抓到的真实 active_id / task_id）。
  // 注：dailyTasks 是多步流程（list_v2 → 批量领奖），单端点无法表达，始终走内置策略。
  const strategy = REAL_STRATEGIES[task.type];
  const useBuiltin = strategy && (task.type === 'dailyTasks' || !hasCustomEndpoint);
  if (useBuiltin) {
    const params = def && def.params && typeof def.params === 'object' ? { ...def.params } : {};
    // 「每次适配」：自动关注的 target 支持填数组，每次运行自动取列表里的下一个（轮询游标持久化在 db），
    // 实现"每天自动关注不同对象"，无需每次手动改参数。单个字符串维持原固定关注行为。
    if (task.type === 'follow' && Array.isArray(params.target)) {
      if (params.target.length === 0) {
        delete params.target; // 空数组视为未配置，走下方待配置分支
      } else {
        const ep = (db.settings.taskEndpoints.follow = db.settings.taskEndpoints.follow || {});
        let cursor = Number.isInteger(ep._cursor) ? ep._cursor : 0;
        if (cursor < 0 || cursor >= params.target.length) cursor = 0;
        params.target = String(params.target[cursor]);
        ep._cursor = (cursor + 1) % params.target.length;
      }
    }
    if (strategy.needsParam && !params[strategy.needsParam] && !params.topicUrl) {
      return {
        ok: false,
        pendingCapture: true,
        error: 'need_param',
        message: `待配置：${task.name} 需要填写参数 ${strategy.paramHint}（在「自动任务」页该任务的"配置参数"里填）`
      };
    }
    // mock 适配器无 requestRaw：即便内置也不允许在 mock 模式下"假跑"
    if (typeof adapter.requestRaw !== 'function') {
      return {
        ok: false,
        pendingCapture: true,
        error: 'pending_capture',
        message: `${task.name} 需在 SMZDM_ADAPTER=real 模式下运行（当前为 mock，不发起真实请求）`
      };
    }
    try {
      const r = await strategy.handler(user.cookie, params);
      const reward = extractReward(r.message || '');
      return {
        ok: true,
        success: true,
        message: r.message,
        goldDelta: reward.gold,
        silverDelta: reward.silver,
        expDelta: reward.exp,
        levelAfter: null,
        explicit: { gold: reward.gold, silver: reward.silver, exp: reward.exp },
        result: { success: true, message: r.message }
      };
    } catch (e) {
      return { ok: false, error: 'exec', message: `${task.name}执行失败：${e.message}` };
    }
  }

  // 通用端点路径：抓包导入 / 手动配置的真实端点（单端点调用，支持 jsonp / robotToken / 资产字段映射）。
  // 这里才真正使用用户导入的 endpoint / body / headers / jsonp / assetFields，覆盖内置策略。
  if (!def || !def.endpoint) {
    return {
      ok: false,
      pendingCapture: true,
      error: 'pending_capture',
      message: `待抓包：${task.name} 尚未配置真实接口，请在「自动任务」页填入抓包得到的 URL/参数`
    };
  }

  // mock 适配器无 requestRaw：即便填了端点也不允许在 mock 模式下"假跑"
  if (typeof adapter.requestRaw !== 'function') {
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
  if (def.robotToken && typeof adapter.getRobotToken === 'function') {
    const tok = await adapter.getRobotToken(user.cookie);
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
  // Phase 1 严重#1/#2 修复：自定义端点带登录 Cookie 发起请求。call() 已强制"仅允许 smzdm 域名"，
  // 若用户配了非 smzdm 端点会被 call() 拒绝；这里捕获并转为友好错误，避免上层把"被拦截"误判为未知异常。
  let raw;
  try {
    raw = def.jsonp ? await adapter.requestRaw(def.endpoint, { ...extraOpts, raw: true }) : await adapter.requestRaw(def.endpoint, extraOpts);
  } catch (e) {
    return {
      ok: false,
      error: 'blocked_endpoint',
      message: `自定义端点请求被拒绝（仅允许发往 smzdm 域名，以防 Cookie 泄露）：${e.message}`
    };
  }

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
