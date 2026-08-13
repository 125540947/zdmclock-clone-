// #187 健康检查：并发探测 + 整体截止（AbortSignal.timeout），慢依赖超时被标 degraded 不致命。
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { probeHealth } = await import('../src/health.js');

test('probeHealth：db 结构校验通过', async () => {
  const h = await probeHealth({ users: [1], clockRecords: [] }, { timeoutMs: 1000 });
  const db = h.details.find((d) => d.name === 'db');
  assert.equal(db.ok, true);
  assert.equal(h.ok, true);
  assert.equal(h.degraded, false);
});

test('probeHealth：db 缺失时标不 ok', async () => {
  const h = await probeHealth({}, { timeoutMs: 1000 });
  const db = h.details.find((d) => d.name === 'db');
  assert.equal(db.ok, false);
  assert.equal(h.ok, false);
});

test('probeHealth：慢检查超时被标 degraded，不拖垮返回（并发+截止）', async () => {
  const slow = async () => new Promise((r) => setTimeout(() => r({ name: 'x', ok: true }), 5000));
  const start = Date.now();
  // 用 { name, fn } 显式命名，确保超时（未返回）时仍能按 name 定位该依赖
  const h = await probeHealth({ users: [], clockRecords: [] }, { timeoutMs: 150, checks: [{ name: 'x', fn: slow }] });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1500, `应在 deadline 附近返回，实际耗时 ${elapsed}ms`);
  const x = h.details.find((d) => d.name === 'x');
  assert.ok(x, '超时依赖应保留其 name=x 的明细条目');
  assert.equal(x.degraded, true, '超时的慢检查应被标 degraded');
  assert.equal(h.ok, true, 'degraded 不致命，整体仍 ok');
});

test('probeHealth：注入的快速检查正常计入 details', async () => {
  const fast = async () => ({ name: 'ext', ok: true });
  const h = await probeHealth({ users: [], clockRecords: [] }, { timeoutMs: 1000, checks: [fast] });
  const ext = h.details.find((d) => d.name === 'ext');
  assert.equal(ext.ok, true);
});
