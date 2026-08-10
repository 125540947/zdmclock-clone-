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
