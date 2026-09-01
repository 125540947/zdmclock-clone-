// OPEN_MODE 网段隔离集成测试（A-01）：验证好价列表 GET /api/baoliao 在开放模式下
// 匿名访客仅可见「同 /24 网段」录入的好价；跨网段与无归属（遗留）好价对匿名不可见。
// 直接复用 assets.test.js 的 OPEN_MODE 范式：新建信任代理的应用实例 + X-Forwarded-For 设定访客 IP。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-baoliao-vis-' + process.pid + '-' + Date.now());
const { createApp } = await import('../src/index.js');
const { config } = await import('../src/config.js');
const { load } = await import('../src/store.js');

// 主 app 用于占位（非开放模式，不发起请求）；OPEN_MODE 场景在测试内新建独立实例。
const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = 'http://localhost:' + server.address().port;

async function j(method, url, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
  let data = null;
  try { data = await res.json(); } catch { /* 可能无 JSON 体 */ }
  return { status: res.status, data };
}

test('OPEN_MODE 下 GET /api/baoliao 仅返回同 /24 网段好价（跨段/无归属不可见，A-01 + M-10）', async () => {
  const prevOpen = config.openMode;
  const prevAdm = config.adminToken;
  const prevTrust = config.trustProxy;
  config.openMode = true; // 匿名（无 adminToken）访客，依网段隔离
  config.adminToken = '';
  config.trustProxy = true; // 信任 loopback 代理，使带 XFF 的请求按 XFF 计算 req.ip（H-04 后隔离以 req.ip 为准）
  const testApp = createApp();
  const testServer = testApp.listen(0);
  await new Promise((r) => testServer.once('listening', r));
  const testBase = 'http://localhost:' + testServer.address().port;
  async function tj(method, p, headers = {}) {
    const res = await fetch(testBase + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers }
    });
    let data = null;
    try { data = await res.json(); } catch { /* 可能无 JSON 体 */ }
    return { status: res.status, data };
  }
  const d = load();
  // 访客 XFF=203.0.113.99 与 b1.recordedIp=203.0.113.50 同 /24；b2=198.51.100.5 跨段、b3 无归属应被排除
  d.baoliao = [
    { id: 'b1', title: '同段好价', recordedIp: '203.0.113.50', createdAt: '2026-09-01T10:00:00Z' },
    { id: 'b2', title: '跨段好价', recordedIp: '198.51.100.5', createdAt: '2026-09-01T11:00:00Z' },
    { id: 'b3', title: '遗留无归属', recordedIp: undefined, createdAt: '2026-09-01T12:00:00Z' }
  ];
  try {
    const r = await tj('GET', '/api/baoliao', { 'X-Forwarded-For': '203.0.113.99' });
    assert.equal(r.status, 200);
    assert.equal(r.data.total, 1, '跨段与无归属好价应被隔离排除');
    assert.equal(r.data.items.length, 1);
    assert.equal(r.data.items[0].id, 'b1');
  } finally {
    config.openMode = prevOpen;
    config.adminToken = prevAdm;
    config.trustProxy = prevTrust;
    d.baoliao = [];
    await new Promise((r) => {
      try { testServer.closeAllConnections?.(); } catch { /* 旧版 node 无此方法 */ }
      testServer.close(r);
    });
  }
});

test('关闭测试服务器', () => { server.close(); });
