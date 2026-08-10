// extreme-lazy 路由层测试：覆盖 /api/extreme-lazy 的 POST /run 与 GET /runs。
// 策略：在 import index 之前 mock extremeLazy.js 的 runExtremeLazy（立即 resolve，
//        避免真实跑 12 阶段拟人化流水线耗时），仅验证 HTTP 端点契约（taskId 生成 / 运行记录写入 / 列表返回）。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-xlroute-' + process.pid + '-' + Date.now());
const SRC = path.resolve(import.meta.dirname, '../src');
const p = (rel) => pathToFileURL(path.resolve(SRC, rel)).href;

mock.module(p('extremeLazy.js'), {
  namedExports: {
    runExtremeLazy: async () => ({
      ok: true,
      message: 'done',
      results: { totalOk: 12, totalFail: 0, steps: [] },
      logs: ['ok']
    })
  }
});

const { createApp } = await import('../src/index.js');
const { config } = await import('../src/config.js');
const { load } = await import('../src/store.js');

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

test('POST /api/extreme-lazy/run 立即返回 taskId（后台异步执行）', async () => {
  const r = await j('POST', '/api/extreme-lazy/run');
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.ok(r.data.taskId.startsWith('xl_'), 'taskId 应以 xl_ 开头');
  assert.ok('message' in r.data);
});

test('GET /api/extreme-lazy/runs 返回最近运行记录（含本次 run）', async () => {
  const r = await j('GET', '/api/extreme-lazy/runs');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.runs));
  assert.ok(r.data.runs.length >= 1, '应至少含一条运行记录');
  assert.ok(r.data.runs[0].id.startsWith('xl_'));
  // 验证记录结构
  const rec = r.data.runs.find((x) => x.id.startsWith('xl_'));
  assert.ok('status' in rec);
  assert.ok('startedAt' in rec);
});

test('关闭测试服务器', () => { server.close(); });
