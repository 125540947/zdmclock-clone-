// A-12 T3：无界结构缺上界 / 清理测试（关联 A-02 degradedWarned、A-03 riskControl.state）
//
// 审计（AUDIT_REPORT_2026-09-01.md A-02 / A-03）指出：
//   - realAdapter.degradedWarned 此前为仅 add 无界的 Set，长期运行内存单调增长；
//   - riskControl.state 在账号删除后未主动清理，缓慢累积。
// 二者当前均已在代码中落定上限 / 清理逻辑（realAdapter.js DEGRADED_WARN_MAX + clear()、
// riskControl.js resetRisk 删除条目、users.js DELETE 路由调用 resetRisk），本文件固化该行为防回归。
import assert from 'node:assert/strict';
import test from 'node:test';
import { __degradedWarnedSize, __warnDegradedChannel } from '../src/smzdm/realAdapter.js';
import { recordFailure, getRiskState, resetRisk } from '../src/riskControl.js';

test('A-02 degradedWarned 恒定有上限（不随文章数无限增长）', () => {
  const MAX = 1000; // 须与 realAdapter.js DEGRADED_WARN_MAX 一致
  // 喂入超过上限的大量唯一 articleId，验证集合不会突破上限
  for (let i = 0; i <= MAX + 50; i++) {
    __warnDegradedChannel('art-' + i);
  }
  const size = __degradedWarnedSize();
  assert.ok(size > 0, '至少应保留一条告警记录');
  assert.ok(size <= MAX, `degradedWarned 不得超过上限 ${MAX}，实际=${size}`);
});

test('A-03 riskControl.state 在 resetRisk 后被清理（账号删除类操作应调用）', () => {
  const cfg = { riskCircuitFailures: 2, riskCircuitCooldownMs: 1000 };
  recordFailure('uA11', cfg);
  recordFailure('uA11', cfg);
  let s = getRiskState('uA11');
  assert.equal(s.fails, 2, '连续失败计数应累加');
  assert.ok(s.circuitUntil > Date.now(), '达到阈值后熔断时间应被设置');
  resetRisk('uA11');
  s = getRiskState('uA11');
  assert.deepEqual(s, { fails: 0, circuitUntil: 0 }, 'resetRisk 应清空该账号的失败 / 熔断状态');
});
