// 更新路由 HTTP 测试（node:test）：用注入的假 selfUpdate 验证 /status /check /apply 的鉴权放行与响应结构。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createUpdateRouter } from '../src/routes/update.js';
import { config } from '../src/config.js';

// 默认把鉴权设为"开启 + 通用 API_TOKEN"，走 requireAdmin 的兜底分支（未配 ADMIN_TOKEN 时）。
const SAVED = {};
before(() => {
  SAVED.requireAuth = config.requireAuth;
  SAVED.apiToken = config.apiToken;
  SAVED.adminToken = config.adminToken;
  config.requireAuth = true;
  config.apiToken = 'test-api-token';
  config.adminToken = '';
});
after(() => {
  config.requireAuth = SAVED.requireAuth;
  config.apiToken = SAVED.apiToken;
  config.adminToken = SAVED.adminToken;
});

function makeApp(fakeSelf) {
  const app = express();
  app.use(express.json());
  app.use('/api/update', createUpdateRouter(fakeSelf));
  return app;
}

// 默认带通用 API_TOKEN（兜底分支放行）；可传 headers 覆盖（如 X-Admin-Token）。
async function j(app, method, p, body, headers = {}) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = 'http://localhost:' + server.address().port;
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-api-token', ...headers },
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

test('M1：POST /api/update/apply 立即返回 202 并在后台执行，status 可轮询进度', async () => {
  let restarted = 0;
  // runUpdate 故意延迟 20ms，模拟真实构建耗时，验证接口不阻塞、且并发会被 409 拦截。
  const fakeSelf = {
    getRepoState: async () => supportedState,
    checkUpdate: async () => ({ ok: true, behind: 0, ahead: 0 }),
    runUpdate: async ({ onLog } = {}) => {
      await new Promise((r) => setTimeout(r, 20));
      if (typeof onLog === 'function') onLog('done');
      return { ok: true, log: ['done'], restarting: true, channel: 'native', commitShort: 'def789' };
    },
    scheduleRestart: () => {
      restarted++;
    },
    updateSupported: (s) => s.isRepo && s.hasRemote && s.channel === 'native'
  };
  const app = express();
  app.use(express.json());
  app.use('/api/update', createUpdateRouter(fakeSelf));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = 'http://localhost:' + server.address().port;
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer test-api-token' };

  const post = await fetch(base + '/api/update/apply', { method: 'POST', headers: H });
  assert.equal(post.status, 202, '应立刻返回 202 accepted，不阻塞构建');
  const pd = await post.json();
  assert.equal(pd.accepted, true);

  // 并发第二次应被 409 拦截（busy 防护）
  const post2 = await fetch(base + '/api/update/apply', { method: 'POST', headers: H });
  assert.equal(post2.status, 409, '并发更新应被拒');

  // 等后台完成（含触发重启）
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(restarted, 1, '后台完成后触发重启');

  const st = await fetch(base + '/api/update/status', { headers: H });
  const sd = await st.json();
  assert.equal(sd.apply.status, 'done', 'status 应暴露后台任务最终状态');
  assert.ok(sd.apply.log.includes('done'));
  server.close();
});

test('POST /api/update/apply 后台失败时 status 为 failed（不误报成功）', async () => {
  const fakeSelf = {
    getRepoState: async () => supportedState,
    checkUpdate: async () => ({ ok: true, behind: 0 }),
    runUpdate: async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { ok: false, log: ['pull failed'], error: 'git pull 失败' };
    },
    scheduleRestart: () => {},
    updateSupported: (s) => s.isRepo && s.hasRemote
  };
  const app = express();
  app.use(express.json());
  app.use('/api/update', createUpdateRouter(fakeSelf));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = 'http://localhost:' + server.address().port;
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer test-api-token' };
  const post = await fetch(base + '/api/update/apply', { method: 'POST', headers: H });
  assert.equal(post.status, 202);
  await new Promise((r) => setTimeout(r, 40));
  const st = await fetch(base + '/api/update/status', { headers: H });
  const sd = await st.json();
  assert.equal(sd.apply.status, 'failed');
  assert.equal(sd.apply.result.error, 'git pull 失败');
  server.close();
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

// ===== H2 修复：更新接口独立管理员鉴权 =====

test('配置了 ADMIN_TOKEN 时，提供正确的 X-Admin-Token 才放行', async () => {
  config.adminToken = 'secret-admin';
  try {
    const fakeSelf = {
      getRepoState: async () => supportedState,
      checkUpdate: async () => ({ ok: true, behind: 0 }),
      runUpdate: async () => ({ ok: true, log: [], restarting: false }),
      scheduleRestart: () => {},
      updateSupported: (s) => s.isRepo && s.hasRemote
    };
    const { status } = await j(makeApp(fakeSelf), 'GET', '/api/update/status', undefined, {
      'X-Admin-Token': 'secret-admin'
    });
    assert.equal(status, 200);
  } finally {
    config.adminToken = '';
  }
});

test('配置了 ADMIN_TOKEN 时，缺少/错误令牌一律 401（即使带通用 API_TOKEN 也不行）', async () => {
  config.adminToken = 'secret-admin';
  try {
    const fakeSelf = {
      getRepoState: async () => supportedState,
      checkUpdate: async () => ({ ok: true, behind: 0 }),
      runUpdate: async () => ({ ok: true, log: [], restarting: false }),
      scheduleRestart: () => {},
      updateSupported: (s) => s.isRepo && s.hasRemote
    };
    // 无 admin 头（但带默认 API_TOKEN）
    const r1 = await j(makeApp(fakeSelf), 'GET', '/api/update/status');
    assert.equal(r1.status, 401);
    assert.equal(r1.data.error, 'admin_token_required');
    // 错误的 admin 头
    const r2 = await j(makeApp(fakeSelf), 'POST', '/api/update/apply', {}, {
      'X-Admin-Token': 'wrong'
    });
    assert.equal(r2.status, 401);
    assert.equal(r2.data.error, 'admin_token_required');
  } finally {
    config.adminToken = '';
  }
});

test('H2 关键：REQUIRE_AUTH=false（默认）时，更新接口绝不匿名放行', async () => {
  config.adminToken = '';
  config.requireAuth = false; // 模拟开箱默认值
  try {
    const fakeSelf = {
      getRepoState: async () => supportedState,
      checkUpdate: async () => ({ ok: true, behind: 0 }),
      runUpdate: async () => ({ ok: true, log: [], restarting: false }),
      scheduleRestart: () => {},
      updateSupported: (s) => s.isRepo && s.hasRemote
    };
    // 不带任何令牌
    const r1 = await j(makeApp(fakeSelf), 'GET', '/api/update/status', undefined, {});
    assert.equal(r1.status, 401, '匿名请求必须被拒');
    // 只带通用 API_TOKEN（即便泄露也无法触发更新）
    const r2 = await j(makeApp(fakeSelf), 'GET', '/api/update/status', undefined, {});
    assert.equal(r2.status, 401, '仅靠 API_TOKEN 在 REQUIRE_AUTH=false 时也不能更新');
  } finally {
    config.requireAuth = true;
    config.apiToken = 'test-api-token';
  }
});

test('未配置 ADMIN_TOKEN 时，通用 API_TOKEN + REQUIRE_AUTH=true 可放行（兜底）', async () => {
  config.adminToken = '';
  config.requireAuth = true;
  config.apiToken = 'test-api-token';
  const fakeSelf = {
    getRepoState: async () => supportedState,
    checkUpdate: async () => ({ ok: true, behind: 0 }),
    runUpdate: async () => ({ ok: true, log: [], restarting: false }),
    scheduleRestart: () => {},
    updateSupported: (s) => s.isRepo && s.hasRemote
  };
  const { status } = await j(makeApp(fakeSelf), 'GET', '/api/update/status');
  assert.equal(status, 200);
});
