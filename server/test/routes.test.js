// P1：路由层 HTTP 测试（createApp + 临时端口 + fetch）。覆盖各 400/401/404/409 分支与 /login。
// 通过临时 DATA_DIR 与运行时切换 config.requireAuth 验证鉴权，不污染项目数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-routes-' + process.pid + '-' + Date.now());
const { createApp } = await import('../src/index.js');
const { config } = await import('../src/config.js');

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

test('GET /api/health 返回 ok 且 scheduler 字段', async () => {
  const { status, data } = await j('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.ok('scheduler' in data);
});

test('POST /api/auth/login 正确凭据签发 token', async () => {
  const { status, data } = await j('POST', '/api/auth/login', {
    username: config.adminUsername,
    password: config.adminPassword
  });
  assert.equal(status, 200);
  assert.ok(data.token);
  assert.equal(data.username, config.adminUsername);
});

test('POST /api/auth/login 错误凭据返回 401', async () => {
  const { status } = await j('POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
  assert.equal(status, 401);
});

test('POST /api/users 缺少 cookie 返回 400', async () => {
  const { status } = await j('POST', '/api/users', { nickname: 'x' });
  assert.equal(status, 400);
});

test('PUT /api/tasks/:id 非法 cron 返回 400 invalid_cron', async () => {
  const { status, data } = await j('PUT', '/api/tasks/t_clock', { cron: 'not-a-cron' });
  assert.equal(status, 400);
  assert.equal(data.error, 'invalid_cron');
});

test('PUT /api/tasks/:id limit 越界返回 400 invalid_limit', async () => {
  const { status, data } = await j('PUT', '/api/tasks/t_clock', { limit: 99 });
  assert.equal(status, 400);
  assert.equal(data.error, 'invalid_limit');
});

test('PUT /api/tasks/:id 非法 source 返回 400 invalid_source', async () => {
  const { status, data } = await j('PUT', '/api/tasks/t_clock', { source: 'xxx' });
  assert.equal(status, 400);
  assert.equal(data.error, 'invalid_source');
});

test('POST /api/clock/do 无账号返回 400 no_user', async () => {
  const { status, data } = await j('POST', '/api/clock/do', {});
  assert.equal(status, 400);
  assert.equal(data.error, 'no_user');
});

test('POST /api/tasks/:id/run 无账号返回 400 no_user', async () => {
  const { status, data } = await j('POST', '/api/tasks/t_clock/run', {});
  assert.equal(status, 400);
  assert.equal(data.error, 'no_user');
});

test('POST /api/baoliao 创建草稿 → submit 无账号返回 400 no_user', async () => {
  const created = await j('POST', '/api/baoliao', { title: '测试好价' });
  assert.equal(created.status, 200);
  const id = created.data.item.id;
  const submit = await j('POST', '/api/baoliao/' + id + '/submit', {});
  assert.equal(submit.status, 400);
  assert.equal(submit.data.error, 'no_user');
});

test('POST /api/baoliao/refresh mock 适配器返回 200', async () => {
  const { status, data } = await j('POST', '/api/baoliao/refresh', { limit: 3 });
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.ok(data.added >= 0);
});

test('POST /api/gpt/reply GPT 未启用返回 400 gpt_disabled', async () => {
  const { status, data } = await j('POST', '/api/gpt/reply', { text: 'hi' });
  assert.equal(status, 400);
  assert.equal(data.error, 'gpt_disabled');
});

test('POST /api/notify/test 未配置令牌返回 400 not_configured', async () => {
  const { status, data } = await j('POST', '/api/notify/test', {});
  assert.equal(status, 400);
  assert.equal(data.error, 'not_configured');
});

test('GET /api/admin/stats 返回聚合统计（200）', async () => {
  const { status, data } = await j('GET', '/api/admin/stats');
  assert.equal(status, 200);
  assert.ok('users' in data && 'tasks' in data && 'todayClocks' in data);
});

test('requireAuth=true 时未带 Token 的管理接口返回 401，带 Token 则 200', async () => {
  config.requireAuth = true;
  const denied = await j('GET', '/api/users');
  assert.equal(denied.status, 401);
  const allowed = await j('GET', '/api/users', undefined, {
    Authorization: 'Bearer ' + config.apiToken
  });
  assert.equal(allowed.status, 200);
  config.requireAuth = false; // 还原，避免影响其它用例
});

test('POST /api/users manual 模式非法时间返回 400 invalid_time', async () => {
  const { status, data } = await j('POST', '/api/users', {
    nickname: '坏时间',
    cookie: 'ck_test',
    schedMode: 'manual',
    checkInTime: '25:99'
  });
  assert.equal(status, 400);
  assert.equal(data.error, 'invalid_time');
});

test('POST /api/users auto 模式返回 200 且分配了窗口内时间', async () => {
  const { status, data } = await j('POST', '/api/users', {
    nickname: '自动账号',
    cookie: 'ck_auto',
    schedMode: 'auto'
  });
  assert.equal(status, 200);
  assert.equal(data.schedMode, 'auto');
  assert.ok(/^([01]?\d|2[0-3]):[0-5]\d$/.test(data.checkInTime), 'auto 应固化一个合法时间');
});

test('PUT /api/users/:id 改 manual + 合法时间返回 200', async () => {
  const created = await j('POST', '/api/users', { nickname: '待改', cookie: 'ck_tmp', schedMode: 'auto' });
  const id = created.data.id;
  const { status, data } = await j('PUT', '/api/users/' + id, { schedMode: 'manual', checkInTime: '07:15' });
  assert.equal(status, 200);
  assert.equal(data.schedMode, 'manual');
  assert.equal(data.checkInTime, '07:15');
});

test('GET /api/admin/clock-distribution 返回时段桶与总数', async () => {
  // 先建一个 manual 09:30 的账号，便于断言落在对应时段桶
  const created = await j('POST', '/api/users', { nickname: '分布账号', cookie: 'ck_dist', schedMode: 'manual', checkInTime: '09:30' });
  const id = created.data.id;
  const { status, data } = await j('GET', '/api/admin/clock-distribution?mode=custom&start=09:00&end=10:00&bucketMinutes=30');
  assert.equal(status, 200);
  assert.equal(data.mode, 'custom');
  assert.equal(data.bucketMinutes, 30);
  assert.ok(Array.isArray(data.buckets));
  assert.ok(data.totalUsers >= 1);
  // 该账号（manual 09:30）应落在 09:30 桶（custom 区间 09:00~10:00 / 30 分钟 → 两个桶：09:00、09:30）
  const slot = data.buckets.find((b) => b.accounts.some((a) => a.id === id));
  assert.ok(slot, '应存在包含该账号的时段桶');
  assert.equal(slot.slot, '09:30');
  assert.ok(slot.accounts.some((a) => a.id === id && a.checkInTime === '09:30'));
  assert.equal(slot.scheduledCount, slot.accounts.length);
});

test('POST /api/users/import 缺 cookie 返回 400', async () => {
  config.requireAuth = true;
  const { status } = await j('POST', '/api/users/import', { nickname: 'x' }, {
    Authorization: 'Bearer ' + config.apiToken
  });
  assert.equal(status, 400);
  config.requireAuth = false;
});

test('POST /api/users/import 新建 → 再次同 cookie 走 upsert（不重复建号）', async () => {
  config.requireAuth = true;
  const headers = { Authorization: 'Bearer ' + config.apiToken };
  const first = await j('POST', '/api/users/import', { cookie: 'ck_import_same' }, headers);
  assert.equal(first.status, 200);
  assert.equal(first.data.imported, true);
  const id1 = first.data.id;
  assert.ok(id1, '应返回账号 id');
  const second = await j('POST', '/api/users/import', { cookie: 'ck_import_same' }, headers);
  assert.equal(second.status, 200);
  assert.equal(second.data.id, id1, '同 cookie 应 upsert 而非新建第二个账号');
  // 安全断言：响应不得泄露「该账号是否已存在」（防枚举，P2-2）
  assert.ok(!('upserted' in first.data), '响应不应暴露 upserted 字段（防账号枚举）');
  config.requireAuth = false;
});

test('GET /api/users/import-script 返回油猴脚本源码（text/plain）', async () => {
  config.requireAuth = true;
  const res = await fetch(base + '/api/users/import-script', {
    headers: { Authorization: 'Bearer ' + config.apiToken }
  });
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(text.includes('UserScript'), '应返回油猴脚本内容');
  config.requireAuth = false;
});

test('GET /api/users/import-script.user.js 注入服务地址并返回 javascript', async () => {
  config.requireAuth = false;
  const origin = 'http://1.2.3.4:3000';
  const res = await fetch(base + '/api/users/import-script.user.js?server=' + encodeURIComponent(origin));
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(text.includes('UserScript'), '应返回油猴脚本内容');
  assert.ok(text.includes(JSON.stringify(origin)), '应注入服务地址');
  assert.ok(!text.includes('__SERVER__'), '地址占位符应被替换');
  assert.ok(!text.includes('__TOKEN__'), 'Token 占位符应被替换');
  assert.ok((res.headers.get('content-type') || '').includes('javascript'), '应为 javascript 类型');
  config.requireAuth = false;
});

test('GET /api/users/import-script.user.js 公开可读且注入窄权限 installToken（不依赖会话 token）', async () => {
  config.requireAuth = true;
  const origin = 'http://1.2.3.4:3000';
  // 无 token → 200（安装端点公开可读，P1-2：不依赖会话 token，避免凭证泄露）
  const noToken = await fetch(base + '/api/users/import-script.user.js?server=' + encodeURIComponent(origin));
  assert.equal(noToken.status, 200, '安装端点应公开可读（无需会话 token）');
  const text = await noToken.text();
  assert.ok(text.includes('UserScript'), '应返回油猴脚本内容');
  assert.ok(text.includes(JSON.stringify(origin)), '应注入服务地址');
  assert.ok(!text.includes('__SERVER__'), '地址占位符应被替换');
  assert.ok(!text.includes('__TOKEN__'), 'Token 占位符应被替换');
  // 安全断言：脚本内不得内联真实会话 token（仅窄权限 installToken）
  assert.ok(!text.includes(config.apiToken), '脚本不得内联真实会话 token');
  // ?token= 会话参数应被忽略（不再作为鉴权手段），仍 200 且不含会话 token
  const withToken = await fetch(
    base + '/api/users/import-script.user.js?server=' + encodeURIComponent(origin) + '&token=' + encodeURIComponent(config.apiToken)
  );
  assert.equal(withToken.status, 200, '?token= 会话参数应被忽略（不作为鉴权）');
  config.requireAuth = false;
});

test('关闭测试服务器', () => {
  server.close();
  assert.ok(true);
});
