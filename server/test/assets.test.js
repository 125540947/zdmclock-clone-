// assets 路由层测试：覆盖 /api/assets 四个只读端点（summary/daily/by-task/ledger）。
// 策略：直接 mutate store.load() 返回的共享 db（同进程 cache），构造资产/账本数据，
//       验证仪表盘聚合与 days 钳制（Math.min(365, ...)）行为。无网络依赖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-assets-' + process.pid + '-' + Date.now());
const { createApp } = await import('../src/index.js');
const { config } = await import('../src/config.js');
const { load, todayStr } = await import('../src/store.js');

config.requireAuth = false;

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = 'http://localhost:' + server.address().port;

async function j(method, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch { /* 可能无 JSON 体 */ }
  return { status: res.status, data };
}

// 构造有数据的 db
const db = load();
const today = todayStr();
db.users = [
  { id: 'u1', nickname: 'Alice', assets: { gold: 10, silver: 20, exp: 5, level: 2 }, streak: 3, totalClockIn: 100, cookieExpired: false },
  { id: 'u2', nickname: 'Bob', assets: { gold: 5, silver: 0, exp: 0, level: null }, streak: 0, totalClockIn: 10, cookieExpired: true }
];
db.assetLedger = [
  { id: 'a1', ts: new Date(Date.now() - 3600_000).toISOString(), date: today, userId: 'u1', taskType: 'clock', taskName: '每日签到', goldDelta: 2, silverDelta: 0, expDelta: 1, goldAfter: 10, silverAfter: 20, expAfter: 5, levelAfter: 2, success: true, message: '' },
  { id: 'a2', ts: new Date().toISOString(), date: today, userId: 'u2', taskType: 'comment', taskName: '自动评论', goldDelta: 0, silverDelta: 1, expDelta: 0, goldAfter: 5, silverAfter: 0, expAfter: 0, levelAfter: null, success: true, message: '' }
];

test('GET /api/assets/summary 聚合每用户资产 + 全局合计', async () => {
  const r = await j('GET', '/api/assets/summary');
  assert.equal(r.status, 200);
  assert.equal(r.data.users.length, 2);
  const alice = r.data.users.find((u) => u.id === 'u1');
  assert.equal(alice.nickname, 'Alice');
  assert.equal(alice.assets.gold, 10);
  assert.equal(alice.today.gold, 2);
  assert.equal(alice.cookieExpired, false);
  assert.equal(r.data.totals.gold, 15);
  assert.equal(r.data.totals.users, 2);
  assert.ok('generatedAt' in r.data);
});

test('GET /api/assets/daily 默认 30 天 + ?days=999 钳制到 365', async () => {
  const def = await j('GET', '/api/assets/daily');
  assert.equal(def.status, 200);
  assert.equal(def.data.series.length, 30);
  assert.ok('date' in def.data.series[0]);
  assert.ok('goldTotal' in def.data.series[0]);
  const big = await j('GET', '/api/assets/daily?days=999');
  assert.equal(big.data.days, 365);
  assert.equal(big.data.series.length, 365);
});

test('GET /api/assets/by-task 按任务类型聚合（含 clock/comment）', async () => {
  const r = await j('GET', '/api/assets/by-task?days=30');
  assert.equal(r.status, 200);
  const types = r.data.items.map((i) => i.taskType);
  assert.ok(types.includes('clock'));
  assert.ok(types.includes('comment'));
  const clock = r.data.items.find((i) => i.taskType === 'clock');
  assert.equal(clock.count, 1);
  assert.equal(clock.goldDelta, 2);
});

test('GET /api/assets/ledger 带昵称的最近明细 + ?limit 钳制', async () => {
  const r = await j('GET', '/api/assets/ledger');
  assert.equal(r.status, 200);
  assert.equal(r.data.list.length, 2);
  assert.equal(r.data.list[0].nickname, 'Bob'); // 按 ts 倒序，a2 在后但 ts 相近；不依赖顺序，校验存在
  assert.ok(r.data.list.some((e) => e.nickname === 'Alice'));
  const limited = await j('GET', '/api/assets/ledger?limit=1');
  assert.equal(limited.data.list.length, 1);
});

test('OPEN_MODE 下 /api/assets/summary 仅返回同 /24 网段账号（遗留无 recordedIp 不可见，M-10）', async () => {
  const prevOpen = config.openMode;
  const prevAdm = config.adminToken;
  const prevTrust = config.trustProxy;
  config.openMode = true; // 匿名（无 adminToken）访客，依网段隔离
  config.adminToken = '';
  config.trustProxy = true; // 信任 loopback 代理，使来自本机且带 XFF 的请求按 XFF 计算 req.ip（H-04 后隔离以 req.ip 为准）
  // 创建一份信任代理的应用实例，XFF 才会被 proxy-addr 采信算作访客 IP（模块级 app 默认不信任代理）。
  const testApp = createApp();
  const testServer = testApp.listen(0);
  await new Promise((r) => testServer.once('listening', r));
  const testBase = 'http://localhost:' + testServer.address().port;
  async function tj(method, p, body, headers = {}) {
    const res = await fetch(testBase + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch { /* 可能无 JSON 体 */ }
    return { status: res.status, data };
  }
  const d = load();
  // 访客 XFF=203.0.113.99，与 u1.recordedIp=203.0.113.50 同 /24；u2=198.51.100.5 跨段应被排除
  d.users[0].recordedIp = '203.0.113.50';
  d.users[1].recordedIp = '198.51.100.5';
  try {
    const r = await tj('GET', '/api/assets/summary', undefined, { 'X-Forwarded-For': '203.0.113.99' });
    assert.equal(r.status, 200);
    assert.equal(r.data.users.length, 1, '跨段账号 u2 应被隔离排除');
    assert.equal(r.data.users[0].id, 'u1');
    assert.equal(r.data.totals.users, 1);
    assert.equal(r.data.totals.gold, 10);
  } finally {
    config.openMode = prevOpen;
    config.adminToken = prevAdm;
    config.trustProxy = prevTrust;
    d.users[0].recordedIp = undefined;
    d.users[1].recordedIp = undefined;
    await new Promise((r) => {
      try { testServer.closeAllConnections?.(); } catch { /* 旧版 node 无此方法 */ }
      testServer.close(r);
    });
  }
});

test('关闭测试服务器', () => { server.close(); });
