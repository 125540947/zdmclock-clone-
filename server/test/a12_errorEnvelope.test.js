// A-12 T5：统一错误响应信封契约测试（关联 A-09）
//
// A-09 定义统一错误信封 { ok, error, message }：所有业务失败响应（含全局兜底 500 与路由内部
// catch 的 5xx）都须返回 { ok:false, error, message }，与成功响应的 { ok:true, ... } 对称，
// 调用方（前端 / 自动化）只需判断 ok 字段即可，无需同时处理「HTTP 200 + ok:false」与
// 「HTTP 500 + message」两套语义。本文件固化该契约。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-envelope-' + process.pid + '-' + Date.now());
const SRC = path.resolve(import.meta.dirname, '../src');
const p = (rel) => pathToFileURL(path.resolve(SRC, rel)).href;

// --- 单测：sendError 工具本身产出统一信封 ---
test('sendError 产出 { ok:false, error, message } 且状态码正确', async () => {
  const { sendError } = await import('../src/httpError.js');
  let captured = null;
  const res = {
    status(code) { captured = { code, body: null }; return this; },
    json(body) { captured.body = body; return this; }
  };
  sendError(res, { status: 429, error: 'too_many', message: '超额' });
  assert.equal(captured.code, 429);
  assert.deepEqual(captured.body, { ok: false, error: 'too_many', message: '超额' });
});

// --- 集成：路由内部 catch 也走统一信封（gpt_error 502） ---
const gptReal = await import('../src/gptAdapter.js?realcopy');
mock.module(p('gptAdapter.js'), {
  namedExports: {
    ...gptReal,
    generateReply: async () => { throw new Error('model boom'); }
  }
});
const { createApp } = await import('../src/index.js');
const { config } = await import('../src/config.js');
config.requireAuth = false;
config.gptEnabled = true;
config.gptApiKey = 'x'; // 使 resolveGptProvider 判定 configured=true，避免 400 gpt_not_configured 短路

// 隔离：本文件 mock 了 gptAdapter.generateReply 抛错，必须在文件结束时复位，否则会泄漏到
// 后续测试文件（node:test 同一进程内 mock.module 在 mock.reset() 前持续生效）。
test.after(() => mock.reset());

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = 'http://localhost:' + server.address().port;

async function j(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch { /* 非 JSON 错误响应按 null 处理 */ }
  return { status: res.status, data };
}

test('T5 路由内部 catch（gpt_error）→ 502 + { ok:false, error, message }', async () => {
  const { load } = await import('../src/store.js');
  const db = load();
  db.settings.gpt.enabled = true;
  const r = await j('POST', '/api/gpt/reply', { text: 'x' });
  assert.equal(r.status, 502);
  assert.equal(r.data.ok, false, 'A-09 统一信封：失败响应须含 ok:false');
  assert.equal(r.data.error, 'gpt_error');
  assert.ok(typeof r.data.message === 'string' && r.data.message.length > 0);
});

test('关闭测试服务器', () => { server.close(); });
