// 风控对抗包单元测试：随机等待确定性、登录失效识别、失败熔断、自适应降频、配置合并。
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  jitterDelay,
  isAuthExpiredError,
  recordFailure,
  recordSuccess,
  isCircuitOpen,
  adaptiveDelayMs,
  resetRisk,
  resolveRisk
} = await import('../src/riskControl.js');
const { config } = await import('../src/config.js');

test('jitterDelay 在 [min, min+span] 内（rng 可注入）', () => {
  assert.equal(jitterDelay(200, 1000, () => 0), 200);
  assert.equal(jitterDelay(200, 1000, () => 0.9999), 1200);
  assert.equal(jitterDelay(200, 1000, () => 0.5), 200 + 500);
  assert.equal(jitterDelay(200, 0), 200); // span=0 → 恒为 min
});

test('isAuthExpiredError 识别登录/鉴权失效文案', () => {
  assert.equal(isAuthExpiredError(new Error('用户未登录，请先登录')), true);
  assert.equal(isAuthExpiredError(new Error('token 失效，请重新登录')), true);
  assert.equal(isAuthExpiredError(new Error('HTTP 401 @ /checkin')), true);
  assert.equal(isAuthExpiredError(new Error('Unauthorized')), true);
  assert.equal(isAuthExpiredError(new Error('签到失败：频率限制')), false);
  assert.equal(isAuthExpiredError(new Error('网络超时')), false);
  assert.equal(isAuthExpiredError(null), false);
  assert.equal(isAuthExpiredError(new Error('')), false);
});

test('recordFailure 达阈值触发熔断；recordSuccess / resetRisk 解除', () => {
  const prevF = config.riskCircuitFailures;
  const prevC = config.riskCircuitCooldownMs;
  config.riskCircuitFailures = 2;
  config.riskCircuitCooldownMs = 1000;
  resetRisk('uX');
  try {
    assert.equal(isCircuitOpen('uX'), false);
    recordFailure('uX', config);
    assert.equal(isCircuitOpen('uX'), false); // 1 次未达阈值
    recordFailure('uX', config);
    assert.equal(isCircuitOpen('uX'), true); // 2 次达阈值 → 熔断
    recordSuccess('uX');
    assert.equal(isCircuitOpen('uX'), false); // 成功重置
    resetRisk('uX');
    assert.equal(isCircuitOpen('uX'), false);
  } finally {
    config.riskCircuitFailures = prevF;
    config.riskCircuitCooldownMs = prevC;
  }
});

test('adaptiveDelayMs 随失败次数线性增长并封顶', () => {
  const prevStep = config.riskAdaptiveStepMs;
  const prevMax = config.riskMaxExtraMs;
  config.riskAdaptiveStepMs = 2000;
  config.riskMaxExtraMs = 5000;
  resetRisk('uY');
  try {
    assert.equal(adaptiveDelayMs('uY', config), 0); // 无失败
    recordFailure('uY', config);
    assert.equal(adaptiveDelayMs('uY', config), 2000);
    recordFailure('uY', config);
    recordFailure('uY', config);
    assert.equal(adaptiveDelayMs('uY', config), 5000); // 3×2000=6000 但封顶 5000
  } finally {
    config.riskAdaptiveStepMs = prevStep;
    config.riskMaxExtraMs = prevMax;
    resetRisk('uY');
  }
});

test('resolveRisk 合并 db.settings.risk 覆盖 env 默认', () => {
  const db = { settings: { risk: { enabled: false, preDelayMinMs: 50, circuitFailures: 9 } } };
  const r = resolveRisk(db);
  assert.equal(r.enabled, false); // db 覆盖
  assert.equal(r.preDelayMinMs, 50);
  assert.equal(r.circuitFailures, 9);
  assert.equal(r.preDelayMaxMs, config.riskPreDelayMaxMs); // 未提供 → env 默认
  // 无 db 配置时回退 env 默认
  const r2 = resolveRisk({ settings: {} });
  assert.equal(r2.enabled, config.riskEnabled);
});
