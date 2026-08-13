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

// M-01 修复：HTTP 401 是明确的登录态失效（被踢线 / Cookie 过期），应归类为真实失效（degraded:false），
// 而非网络异常（degraded:true）。否则最明确的鉴权失败路径反而不会标记 cookieExpired，
// 健康检查会长期保留错误状态并继续用失效 Cookie 尝试自动化。
test('checkCookie：HTTP 401 视为真实失效（M-01，degraded=false）', async () => {
  const r = await checkCookie('c', fakeAdapter(async () => { throw new Error('HTTP 401 @ /user'); }));
  assert.equal(r.valid, false);
  assert.equal(r.degraded, false, '401 应归类真实失效而非网络退化');
});

test('checkAccounts：HTTP 401 标记 cookieExpired（M-01）', async () => {
  const db = { users: [{ id: 'u1', nickname: 'A', cookie: 'c', cookieExpired: false }] };
  await checkAccounts(db, fakeAdapter(async () => { throw new Error('HTTP 401 @ /user'); }));
  assert.equal(db.users[0].cookieExpired, true, '401 应标记 Cookie 失效');
});

// M-06 修复：批量检测引入有界并发池，单轮在途请求数恒 ≤ concurrency，
// 防止账号数（默认上限 500、可配 100000）一次性全部并发把 FD / 内存 / smzdm 限流打爆。
test('checkAccounts：在途并发受 concurrency 上限约束（M-06）', async () => {
  const N = 20;
  const cap = 4;
  const users = Array.from({ length: N }, (_, i) => ({ id: `u${i}`, nickname: `U${i}`, cookie: 'c', cookieExpired: false }));
  const db = { users };
  let inFlight = 0;
  let maxInFlight = 0;
  const adapter = fakeAdapter(async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 8));
    inFlight -= 1;
    return { smzdmId: 'x' };
  });
  const results = await checkAccounts(db, adapter, { concurrency: cap });
  assert.equal(results.length, N, '结果数应等于账号数');
  assert.deepEqual(
    results.map((r) => r.id),
    users.map((u) => u.id),
    '结果顺序应与账号顺序一致（分批不影响顺序）'
  );
  assert.ok(maxInFlight > 1, '应确有多并发（非纯串行），否则并发上限形同虚设');
  assert.ok(maxInFlight <= cap, `在途请求峰值 ${maxInFlight} 不得超过并发上限 ${cap}`);
});

test('checkAccounts：concurrency 越界被钳制（M-06 边界）', async () => {
  // 超大并发应被钳到账号数（不会真的开 999 个并发现场）
  const N = 3;
  const users = Array.from({ length: N }, (_, i) => ({ id: `u${i}`, cookie: 'c' }));
  const db = { users };
  let inFlight = 0;
  let maxInFlight = 0;
  const adapter = fakeAdapter(async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 8));
    inFlight -= 1;
    return { smzdmId: 'x' };
  });
  await checkAccounts(db, adapter, { concurrency: 999 });
  assert.ok(maxInFlight <= N, `超大并发应被钳到账号数 ${N}，实际峰值 ${maxInFlight}`);

  // concurrency<=0 应退化为串行（峰值 1），避免误配导致 0 worker 永久挂起
  const db2 = { users: Array.from({ length: 5 }, (_, i) => ({ id: `v${i}`, cookie: 'c' })) };
  let inf2 = 0;
  let max2 = 0;
  const adapter2 = fakeAdapter(async () => {
    inf2 += 1;
    max2 = Math.max(max2, inf2);
    await new Promise((r) => setTimeout(r, 8));
    inf2 -= 1;
    return { smzdmId: 'x' };
  });
  await checkAccounts(db2, adapter2, { concurrency: 0 });
  assert.equal(max2, 1, 'concurrency=0 应退化为串行（在途峰值 1）');
});
