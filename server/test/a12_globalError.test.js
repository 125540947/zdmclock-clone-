// A-12 T5（续）：全局兜底 500 也走统一错误信封（关联 A-09）
//
// wrapAsync（M-15）把未自带 try/catch 的 async 路由处理器抛出的异常转交 Express 错误中间件
// （index.js 末尾的兜底 500）。该兜底经 A-09 改造后同样返回 { ok:false, error:'server_error', message }，
// 与路由内部 catch 的信封对称。本文件通过 mock store.load 抛错触发未捕获异常，断言全局兜底信封。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-glob-' + process.pid + '-' + Date.now());
const SRC = path.resolve(import.meta.dirname, '../src');
const p = (rel) => pathToFileURL(path.resolve(SRC, rel)).href;

// 用真实 store 的全部导出，仅覆盖 load 为抛错，模拟未捕获异常路径
const storeReal = await import('../src/store.js?realcopy');
mock.module(p('store.js'), {
  namedExports: {
    ...storeReal,
    load: () => { throw new Error('store boom'); }
  }
});
const { createApp } = await import('../src/index.js');
const { config } = await import('../src/config.js');
config.requireAuth = false;

// 隔离：本文件 mock 了 store.load 抛错，必须在文件结束时复位，否则会泄漏到后续测试文件
// （node:test 同一进程内 mock.module 在 mock.reset() 前持续生效），污染其他文件的 store 调用。
test.after(() => mock.reset());

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = 'http://localhost:' + server.address().port;

async function j(method, url) {
  const res = await fetch(base + url, { method });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

test('T5 未捕获异常 → 全局 500 兜底返回 { ok:false, error:"server_error" }', async () => {
  const r = await j('GET', '/api/users');
  assert.equal(r.status, 500);
  assert.equal(r.data.ok, false, 'A-09 统一信封：全局兜底须含 ok:false');
  assert.equal(r.data.error, 'server_error');
  assert.ok(typeof r.data.message === 'string' && r.data.message.length > 0);
});

test('关闭测试服务器', () => { server.close(); });
