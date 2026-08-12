// 共享响应解析工具（P1-6 抽离）
//
// 原 realAdapter / tasks_real / taskMatrix 各有一份 removeTags / extractReward /
// parseJsonp 的实现，行为存在分叉（是否处理 Angular )]}' 前缀、解析失败是抛错还是返回 {}）。
// 这里收敛为唯一实现，避免重复与正确性漂移：
//   - parseJsonp：先剥离 )]}' 安全前缀，再解 JSONP 外壳（callback({...}) / jQuery123({...})），
//     解析失败**不抛**，返回 { error:'jsonp_parse_failed', raw }，由调用方按 .error 判定，
//     避免散落顶层 await 处变成 unhandledRejection；smzdm 网页端点返回 error_code 型 JSON，
//     调用方均以 error_code 判成败，{error} 与旧 {} 对其等价（error_code 均为 undefined→非 0→失败）。
//   - removeTags / extractReward：纯函数，奖励文案常含 <strong>5</strong>金币，先去标签再提取数值。

// 剥离 HTML 标签并压缩空白（best-effort）
export function removeTags(s) {
  return String(s || '')
    .replace(/<[^<]+?>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 从奖励文案近似提取金币/碎银/经验数量。
// 仅统计接口字面提及的数值，绝不做假数据；用于资产账本的近似记账。
// 返回 { gold, silver, exp }
export function extractReward(text) {
  const t = removeTags(text || '');
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

// 解析 JSONP / 裸 JSON / Angular )]}' 前缀：
// 兼容 callback({...})、jQuery123({...}) 外壳与尾部分号；兼容 Angular 安全前缀 )]}'（可能带换行/逗号）。
// 解析失败不抛，返回 { error, raw }。
export function parseJsonp(text) {
  if (typeof text !== 'string') return text;
  let t = text.trim();
  // 先去 Angular 风格安全前缀（可能带换行/逗号），再解 JSONP 外壳 —— 顺序很关键：
  // 否则 ")]}'\ncallback({...})" 会因前缀挡住回调名正则而无法剥离外壳。
  t = t.replace(/^\s*\)\]\}',?\s*/, '');
  const wrap = t.match(/^[a-zA-Z_$][\w$]*\s*\(([\s\S]*)\)\s*;?\s*$/);
  if (wrap) t = wrap[1];
  try {
    return JSON.parse(t);
  } catch {
    return { error: 'jsonp_parse_failed', raw: String(text).slice(0, 200) };
  }
}
