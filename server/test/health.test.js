// #187 健康检查：并发探测 + 整体截止（AbortSignal.timeout），慢依赖超时被标 degraded 不致命。
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { probeHealth, checkCookie, checkAccounts } = await import('../src/health.js');

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

// H-08 修复：区分「真实登录失效」与「网络异常」。真实失效（空身份）标记 cookieExpired；
// 网络异常（适配器抛错）返回 degraded 且不得翻转既有 cookieExpired 状态。
function fakeAdapter(getUserInfo) {
  return { getUserInfo };
}

test('checkCookie：返回空身份 → 真实失效（degraded=false）', async () => {
  const r = await checkCookie('c', fakeAdapter(async () => ({ smzdmId: '', nickname: '' })));
  assert.equal(r.valid, false);
  assert.equal(r.degraded, false);
});

test('checkCookie：网络异常 → degraded=true，不得误判失效', async () => {
  const r = await checkCookie('c', fakeAdapter(async () => { throw new Error('ETIMEDOUT'); }));
  assert.equal(r.valid, false);
  assert.equal(r.degraded, true);
});

test('checkAccounts：网络异常不翻转既有 cookieExpired（H-08）', async () => {
  const db = { users: [{ id: 'u1', nickname: 'A', cookie: 'c', cookieExpired: false }] };
  await checkAccounts(db, fakeAdapter(async () => { throw new Error('ETIMEDOUT'); }));
  assert.equal(db.users[0].cookieExpired, false, '网络异常应保留既有未失效状态');
});

test('checkAccounts：真实失效仍标记 cookieExpired 且推送 onExpired', async () => {
  const db = { users: [{ id: 'u1', nickname: 'A', cookie: 'c', cookieExpired: false }] };
  let notified = 0;
  await checkAccounts(db, fakeAdapter(async () => ({})), {
    onExpired: () => { notified += 1; }
  });
  assert.equal(db.users[0].cookieExpired, true, '真实失效应标记');
  assert.equal(notified, 1, '有效→失效迁移应触发一次告警');
});

test('checkAccounts：并行检测（H-08 性能），结果与账号顺序一致', async () => {
  const db = {
    users: [
      { id: 'a', nickname: 'A', cookie: 'c', cookieExpired: false },
      { id: 'b', nickname: 'B', cookie: 'c', cookieExpired: false }
    ]
  };
  const results = await checkAccounts(db, fakeAdapter(async () => ({ smzdmId: 'x' })));
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((r) => r.id), ['a', 'b']);
  assert.ok(results.every((r) => r.valid === true));
});
