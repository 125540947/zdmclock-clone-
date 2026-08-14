// H-07：开放模式（匿名可经 authRequired 放行）新增爆料草稿的容量/字段长度/recordedIp 防护集成测试。
// 复用 routesCore.test.js 的 createApp + 临时 DATA_DIR 范式，不污染项目数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-baoliao-' + process.pid + '-' + Date.now());
const { createApp } = await import('../src/index.js');
const { config } = await import('../src/config.js');
const { load } = await import('../src/store.js');
config.requireAuth = false; // 匿名可新增草稿（开放模式形态），验证 H-07 防护

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = 'http://localhost:' + server.address().port;

async function j(method, p, body, headers = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch { /* 可能无 JSON 体 */ }
  return { status: res.status, data };
}

test('H-07：POST /api/baoliao 防护（recordedIp + 字段长度 + 总量上限）', async () => {
  const db = load();
  db.baoliao = []; // 隔离：本测试前清空

  // 1) 合法草稿 → 200 且记录 recordedIp（供开放模式 /24 网段隔离生效）
  const ok = await j('POST', '/api/baoliao', { title: '测试好价', url: 'https://example.com', price: '9.9' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.ok, true);
  assert.equal(ok.data.item.status, 'draft');
  assert.ok(ok.data.item.recordedIp, '应记录录入来源 IP（H-07）');

  // 2) 字段超长 → 400（字段长度上限）
  const prevNote = config.maxNoteLen;
  config.maxNoteLen = 10; // 缩小上限以便测试
  try {
    const over = await j('POST', '/api/baoliao', { title: 'x'.repeat(11) });
    assert.equal(over.status, 400, '超长标题应被拒绝');
    assert.ok(over.data.error, '应有错误码');
  } finally {
    config.maxNoteLen = prevNote;
  }

  // 3) 总量上限 → 400 too_many
  const prevItems = config.maxBaoliaoItems;
  config.maxBaoliaoItems = 1; // 缩小上限以便测试
  try {
    db.baoliao = []; // 重置计数，仅本步验证上限
    const first = await j('POST', '/api/baoliao', { title: '第一条' });
    assert.equal(first.status, 200);
    const second = await j('POST', '/api/baoliao', { title: '第二条' });
    assert.equal(second.status, 400, '达上限后新建应被拒绝');
    assert.equal(second.data.error, 'too_many');
  } finally {
    config.maxBaoliaoItems = prevItems;
    db.baoliao = [];
    // 关闭监听端口，避免 keep-alive 连接挂起导致测试进程无法退出
    await new Promise((r) => {
      try { server.closeAllConnections?.(); } catch { /* 旧版 node 无此方法 */ }
      server.close(r);
    });
  }
});
