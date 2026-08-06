// 风控对抗包（反检测 / 反限流 / 反封号）
//
// 设计目标：在不依赖外部服务的前提下，降低被 smzdm 风控识别为"机器批量签到"的概率，
// 并在出现连续失败 / 登录失效时主动降频、熔断、告警，避免盲目重试导致封号。
//
// 能力：
//  1) 人类化随机等待（jitterDelay）——打破固定周期，使请求到达时间更像真人浏览。
//  2) 失败熔断（recordFailure / isCircuitOpen）——连续失败达阈值后冷却该账号一段时间。
//  3) 自适应降频（adaptiveDelayMs）——失败越多，后续额外等待越长（温和减速）。
//  4) 登录失效识别（isAuthExpiredError）——real 适配器抛出特定文案时标记为 Cookie 失效。
//  5) 生效配置合并（resolveRisk）——env 默认值被 db.settings.risk 持久化配置覆盖。

import { config } from './config.js';

// 随机延迟窗口：在 [min, min+span] 之间取整数毫秒。rng 可注入便于单测。
export function jitterDelay(min, span, rng = Math.random) {
  const s = span > 0 ? Math.max(0, Math.floor(rng() * (span + 1))) : 0;
  return min + s;
}

// 进程内、按 userId 的失败 / 熔断状态（非持久；仅应对瞬时风控，重启即重置即可）。
// 跨重启持久化收益有限且增加复杂度，P0 阶段不引入。
const state = new Map(); // userId -> { fails, circuitUntil }

export function getRiskState(userId) {
  return state.get(userId) || { fails: 0, circuitUntil: 0 };
}
export function recordSuccess(userId) {
  state.set(userId, { fails: 0, circuitUntil: 0 });
}
export function recordFailure(userId, cfg) {
  const s = getRiskState(userId);
  s.fails += 1;
  if (cfg && s.fails >= cfg.riskCircuitFailures) {
    s.circuitUntil = Date.now() + cfg.riskCircuitCooldownMs;
  }
  state.set(userId, s);
  return s;
}
export function isCircuitOpen(userId, now = Date.now()) {
  const s = state.get(userId);
  return !!(s && s.circuitUntil > now);
}
// 自适应额外等待（毫秒）：失败次数 × 步长，封顶 riskMaxExtraMs。
export function adaptiveDelayMs(userId, cfg) {
  const s = getRiskState(userId);
  if (!s || s.fails <= 0) return 0;
  return Math.min((cfg && cfg.riskMaxExtraMs) || 0, s.fails * ((cfg && cfg.riskAdaptiveStepMs) || 0));
}
export function resetRisk(userId) {
  state.delete(userId);
}

// 登录失效识别：real 适配器在未登录 / Cookie 过期 / 鉴权失败时抛出的常见文案特征。
export function isAuthExpiredError(err) {
  if (!err || typeof err.message !== 'string') return false;
  return /(未登录|登录.*(过期|失效)|token.*(失效|过期|无效|错误)|请先登录|cookie.*失效|not\s*login|unauthorized|401|鉴权失败|登录态.*失效|身份.*过期)/i.test(
    err.message
  );
}

// 合并 db.settings.risk 与 env 默认值，得到"生效的风控配置"。
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
export function resolveRisk(db) {
  const r = (db && db.settings && db.settings.risk) || {};
  return {
    enabled: r.enabled !== undefined ? !!r.enabled : config.riskEnabled,
    preDelayMinMs: num(r.preDelayMinMs, config.riskPreDelayMinMs),
    preDelayMaxMs: num(r.preDelayMaxMs, config.riskPreDelayMaxMs),
    circuitFailures: num(r.circuitFailures, config.riskCircuitFailures),
    circuitCooldownMs: num(r.circuitCooldownMs, config.riskCircuitCooldownMs),
    adaptiveStepMs: num(r.adaptiveStepMs, config.riskAdaptiveStepMs),
    maxExtraMs: num(r.maxExtraMs, config.riskMaxExtraMs)
  };
}
