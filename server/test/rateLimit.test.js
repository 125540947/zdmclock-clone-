// P1：限流中间件单元测（middleware/rateLimit.js，P1-1 防爆破）。
// 纯函数工厂，用 mock req/res 验证固定窗口计数、429、方法过滤、自定义 key、窗口重置。
// 不依赖真实 IP/网络，无跨测试污染（状态封闭在工厂实例内）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../src/middleware/rateLimit.js';

function mockReq(over = {}) {
  return { method: 'POST', ip: '127.0.0.1', headers: {}, ...over };
}
function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(c) { this.statusCode = c; return this; },
    set(n, v) { this.headers[n] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

test('rateLimit：窗口内前 N 次放行，第 N+1 次 429 + Retry-After', () => {
  const mw = rateLimit({ windowMs: 60000, max: 3 });
  let passed = 0;
  const next = () => { passed++; };
  for (let i = 0; i < 3; i++) mw(mockReq(), mockRes(), next);
  assert.equal(passed, 3);
  const blocked = mockRes();
  mw(mockReq(), blocked, next);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.error, 'rate_limited');
  assert.ok(blocked.headers['Retry-After']);
  // 后续请求仍被限流
  const blocked2 = mockRes();
  mw(mockReq(), blocked2, next);
  assert.equal(blocked2.statusCode, 429);
});

test('rateLimit：仅对指定方法生效（GET 不过滤）', () => {
  const mw = rateLimit({ windowMs: 60000, max: 1, methods: ['POST'] });
  let passed = 0;
  const next = () => { passed++; };
  // 10 次 GET 全部放行（不受限）
  for (let i = 0; i < 10; i++) mw(mockReq({ method: 'GET' }), mockRes(), next);
  assert.equal(passed, 10);
  // POST 第 2 次即被限
  mw(mockReq({ method: 'POST' }), mockRes(), next);
  const blocked = mockRes();
  mw(mockReq({ method: 'POST' }), blocked, next);
  assert.equal(blocked.statusCode, 429);
});

test('rateLimit：自定义 key 按维度独立计数', () => {
  const mw = rateLimit({ windowMs: 60000, max: 1, key: (r) => r.headers['x-tenant'] || 'anon' });
  let passed = 0;
  const next = () => { passed++; };
  mw(mockReq({ headers: { 'x-tenant': 'A' } }), mockRes(), next);
  mw(mockReq({ headers: { 'x-tenant': 'B' } }), mockRes(), next);
  assert.equal(passed, 2, '不同 key 应独立计数');
  const blockedA = mockRes();
  mw(mockReq({ headers: { 'x-tenant': 'A' } }), blockedA, next);
  assert.equal(blockedA.statusCode, 429);
});

test('rateLimit：窗口过期后计数重置', async () => {
  const mw = rateLimit({ windowMs: 40, max: 1 });
  let passed = 0;
  const next = () => { passed++; };
  mw(mockReq(), mockRes(), next);
  const blocked = mockRes();
  mw(mockReq(), blocked, next);
  assert.equal(blocked.statusCode, 429);
  await new Promise((r) => setTimeout(r, 60));
  mw(mockReq(), mockRes(), next);
  assert.equal(passed, 2, '窗口过期后应重新放行');
});

test('rateLimit LRU 容量上限：超出 maxEntries 淘汰最久未访问条目', () => {
  const mw = rateLimit({ windowMs: 60000, max: 100, maxEntries: 3 });
  const next = () => {};
  for (const ip of ['a', 'b', 'c', 'd', 'e']) {
    mw(mockReq({ ip }), mockRes(), next);
  }
  // 仅保留最近访问的 3 个（c,d,e）；最早访问的 a,b 应被 LRU 淘汰
  assert.equal(mw._store.size, 3, '超出 maxEntries 后应淘汰最旧条目');
  assert.ok(mw._store.has('c') && mw._store.has('d') && mw._store.has('e'), '应保留最近访问的条目');
  assert.ok(!mw._store.has('a') && !mw._store.has('b'), '最久未访问的 a,b 应被淘汰');
  // 被淘汰的旧 key 重新访问应作为新条目（计数从 1 起），不应残留旧计数
  mw(mockReq({ ip: 'a' }), mockRes(), next);
  assert.equal(mw._store.get('a').count, 1, '被淘汰后重新访问应重置计数为 1');
});

test('rateLimit 仍按 max 正确限流（LRU 改造不破坏计数）', () => {
  const mw = rateLimit({ windowMs: 60000, max: 2, maxEntries: 100 });
  let passed = 0;
  const next = () => { passed++; };
  mw(mockReq({ ip: 'x' }), mockRes(), next);
  mw(mockReq({ ip: 'x' }), mockRes(), next);
  const blocked = mockRes();
  mw(mockReq({ ip: 'x' }), blocked, next);
  assert.equal(blocked.statusCode, 429, '超过 max 应返回 429');
  assert.equal(passed, 2);
});
