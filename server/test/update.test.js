// 更新路由 HTTP 测试（node:test）：用注入的假 selfUpdate 验证 /status /check /apply 的鉴权放行与响应结构。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createUpdateRouter } from '../src/routes/update.js';

function makeApp(fakeSelf) {
  const app = express();
  app.use(express.json());
  app.use('/api/update', createUpdateRouter(fakeSelf));
  return app;
}

async function j(app, method, p, body) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = 'http://localhost:' + server.address().port;
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  server.close();
  return { status: res.status, data };
}

const supportedState = {
  isRepo: true,
  hasRemote: true,
  channel: 'native',
  repoRoot: '/repo',
  branch: 'main',
  commit: 'abc123def456',
  commitShort: 'abc123d',
  commitMsg: 'feat: base',
  dirty: false,
  dirtyFiles: [],
  error: ''
};

test('GET /api/update/status 返回仓库状态与 supported', async () => {
  let restarted = 0;
  const fakeSelf = {
    getRepoState: async () => supportedState,
    checkUpdate: async () => ({ ok: true, behind: 0, ahead: 0 }),
    runUpdate: async () => ({ ok: true, log: [], restarting: true }),
    scheduleRestart: () => {
      restarted++;
    },
    updateSupported: (s) => s.isRepo && s.hasRemote && s.channel === 'native'
  };
  const { status, data } = await j(makeApp(fakeSelf), 'GET', '/api/update/status');
  assert.equal(status, 200);
  assert.equal(data.supported, true);
  assert.equal(data.commitShort, 'abc123d');
});

test('POST /api/update/check 返回落后提交数', async () => {
  const fakeSelf = {
    getRepoState: async () => supportedState,
    checkUpdate: async () => ({ ok: true, behind: 2, ahead: 0, localCommit: 'abc', remoteCommit: 'def789', branch: 'main' }),
    runUpdate: async () => ({ ok: true, log: [], restarting: true }),
    scheduleRestart: () => {},
    updateSupported: (s) => s.isRepo && s.hasRemote && s.channel === 'native'
  };
  const { status, data } = await j(makeApp(fakeSelf), 'POST', '/api/update/check');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.behind, 2);
  assert.equal(data.remoteCommit, 'def789');
});

test('POST /api/update/apply 成功时返回 willRestart 并触发重启', async () => {
  let restarted = 0;
  const fakeSelf = {
    getRepoState: async () => supportedState,
    checkUpdate: async () => ({ ok: true, behind: 0, ahead: 0 }),
    runUpdate: async () => ({ ok: true, log: ['done'], restarting: true, channel: 'native', commitShort: 'def789' }),
    scheduleRestart: () => {
      restarted++;
    },
    updateSupported: (s) => s.isRepo && s.hasRemote && s.channel === 'native'
  };
  const { status, data } = await j(makeApp(fakeSelf), 'POST', '/api/update/apply');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.willRestart, true);
  assert.equal(restarted, 1);
});

test('GET /api/update/status 在 unsupported 时 supported=false', async () => {
  const fakeSelf = {
    getRepoState: async () => ({ ...supportedState, isRepo: false, hasRemote: false, channel: 'docker' }),
    checkUpdate: async () => ({ ok: true, behind: 0, ahead: 0 }),
    runUpdate: async () => ({ ok: true, log: [], restarting: false }),
    scheduleRestart: () => {},
    updateSupported: () => false
  };
  const { data } = await j(makeApp(fakeSelf), 'GET', '/api/update/status');
  assert.equal(data.supported, false);
});
