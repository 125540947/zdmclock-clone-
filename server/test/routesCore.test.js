// P0/P1：核心路由层 HTTP 测试（clock / tasks / health / baoliao）。
// 复用 routes.test.js 的 createApp + 临时 DATA_DIR 范式，不污染项目数据。
// 重点覆盖：核心读/写分支、分页钳制、SSRF 守卫（P0-1）、openMode 跨网段越权（P0-3）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-routescore-' + process.pid + '-' + Date.now());
const { createApp } = await import('../src/index.js');
const { config } = await import('../src/config.js');
const { load } = await import('../src/store.js');

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

// 录入一个用户并返回 id（默认 requireAuth=false，匿名可录入）
async function makeUser(nickname, cookie = 'ck_' + nickname) {
  const r = await j('POST', '/api/users', { nickname, cookie, schedMode: 'auto' });
  return r.data.id;
}

// ---------- clock：状态 / 历史（无需账号） ----------
test('GET /api/clock/status 无 userId 返回聚合状态', async () => {
  const { status, data } = await j('GET', '/api/clock/status');
  assert.equal(status, 200);
  assert.ok('today' in data && 'todayChecked' in data && Array.isArray(data.calendar));
  assert.equal(typeof data.todayChecked, 'boolean');
});

test('GET /api/clock/status 不存在 userId → 404 not_found', async () => {
  const { status, data } = await j('GET', '/api/clock/status?userId=no_such_user');
  assert.equal(status, 404);
  assert.equal(data.error, 'not_found');
});

test('GET /api/clock/history 无 userId 返回分页结构', async () => {
  const { status, data } = await j('GET', '/api/clock/history');
  assert.equal(status, 200);
  assert.equal(typeof data.total, 'number');
  assert.ok(Array.isArray(data.list));
  assert.equal(typeof data.page, 'number');
  assert.equal(typeof data.pageSize, 'number');
});

test('GET /api/clock/history 不存在 userId → 404', async () => {
  const { status, data } = await j('GET', '/api/clock/history?userId=no_such_user');
  assert.equal(status, 404);
  assert.equal(data.error, 'not_found');
});

test('GET /api/clock/history pageSize 越界被钳制到 maxPageSize', async () => {
  const { status, data } = await j('GET', '/api/clock/history?pageSize=99999');
  assert.equal(status, 200);
  assert.ok(data.pageSize <= config.maxPageSize, 'pageSize 不应超过 maxPageSize');
});

// ---------- tasks：列表 / 端点配置 / 抓包导入 ----------
test('GET /api/tasks 返回任务列表且每项含 configured', async () => {
  const { status, data } = await j('GET', '/api/tasks');
  assert.equal(status, 200);
  assert.ok(Array.isArray(data.list));
  assert.ok(data.list.length > 0);
  assert.ok(data.list.every((t) => typeof t.configured === 'boolean'));
});

test('GET /api/tasks/endpoints 返回 endpoints/templates', async () => {
  const { status, data } = await j('GET', '/api/tasks/endpoints');
  assert.equal(status, 200);
  assert.ok('endpoints' in data && 'templates' in data);
});

test('GET /api/tasks/templates 返回模板对象', async () => {
  const { status, data } = await j('GET', '/api/tasks/templates');
  assert.equal(status, 200);
  assert.ok(typeof data.templates === 'object');
});

test('GET /api/tasks/captures 返回 items 数组（无 detected.json 时为空 + hint）', async () => {
  const { status, data } = await j('GET', '/api/tasks/captures');
  assert.equal(status, 200);
  assert.ok(Array.isArray(data.items));
  // detected.json 存在时返回已识别端点；缺失时 items 为空且带 hint（环境相关）
  if (data.items.length === 0) assert.ok('hint' in data);
});

test('PUT /api/tasks/endpoints 非自定义类型 → 400 invalid_type', async () => {
  const { status, data } = await j('PUT', '/api/tasks/endpoints', { type: 'bogus', endpoint: 'https://example.com/x' });
  assert.equal(status, 400);
  assert.equal(data.error, 'invalid_type');
});

test('PUT /api/tasks/endpoints 内网端点 → 400 unsafe_endpoint（SSRF P0-1）', async () => {
  const { status, data } = await j('PUT', '/api/tasks/endpoints', {
    type: 'follow', endpoint: 'http://169.254.169.254/latest/meta-data/'
  });
  assert.equal(status, 400);
  assert.equal(data.error, 'unsafe_endpoint');
});

test('PUT /api/tasks/endpoints 回环端点 → 400 unsafe_endpoint', async () => {
  const { status, data } = await j('PUT', '/api/tasks/endpoints', {
    type: 'follow', endpoint: 'http://localhost:3000/x'
  });
  assert.equal(status, 400);
  assert.equal(data.error, 'unsafe_endpoint');
});

test('PUT /api/tasks/endpoints 不安全 referer → 400 unsafe_referer', async () => {
  const { status, data } = await j('PUT', '/api/tasks/endpoints', {
    // endpoint 先用合法 smzdm 域通过白名单，referer 用内网地址触发 unsafe_referer
    type: 'follow', endpoint: 'https://zhiyou.smzdm.com/x', referer: 'http://127.0.0.1/y'
  });
  assert.equal(status, 400);
  assert.equal(data.error, 'unsafe_referer');
});

test('PUT /api/tasks/endpoints 非法 params JSON → 400 invalid_params', async () => {
  const { status, data } = await j('PUT', '/api/tasks/endpoints', {
    // endpoint 先用合法 smzdm 域通过白名单，再校验 params
    type: 'follow', endpoint: 'https://zhiyou.smzdm.com/x', params: 'not json{'
  });
  assert.equal(status, 400);
  assert.equal(data.error, 'invalid_params');
});

// Phase 1：Cookie 出口白名单。自定义端点仅允许 smzdm 域名（之前 any 公网即放行，可被配成第三方窃取 Cookie）。
test('PUT /api/tasks/endpoints 非 smzdm 公网端点 → 400 unsafe_endpoint（防 Cookie 泄露）', async () => {
  const { status, data } = await j('PUT', '/api/tasks/endpoints', {
    type: 'follow', endpoint: 'https://example.com/api/follow'
  });
  assert.equal(status, 400);
  assert.equal(data.error, 'unsafe_endpoint');
});

test('PUT /api/tasks/endpoints 合法 smzdm 端点 → 200 ok', async () => {
  const { status, data } = await j('PUT', '/api/tasks/endpoints', {
    type: 'follow', endpoint: 'https://user-api.smzdm.com/api/follow', method: 'POST'
  });
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.ok(data.endpoints.follow && data.endpoints.follow.endpoint === 'https://user-api.smzdm.com/api/follow');
});

test('PUT /api/tasks/endpoints 空 endpoint（内置类型仅更新 params）→ 200 ok', async () => {
  const { status, data } = await j('PUT', '/api/tasks/endpoints', { type: 'follow', endpoint: '' });
  assert.equal(status, 200);
  assert.equal(data.ok, true);
});

test('POST /api/tasks/captures/apply 空 items → 400 empty', async () => {
  const { status, data } = await j('POST', '/api/tasks/captures/apply', { items: [] });
  assert.equal(status, 400);
  assert.equal(data.error, 'empty');
});

test('POST /api/tasks/captures/apply dailyTasks 内置任务被跳过', async () => {
  const { status, data } = await j('POST', '/api/tasks/captures/apply', {
    items: [{ type: 'dailyTasks', endpoint: 'https://example.com/x' }]
  });
  assert.equal(status, 400);
  assert.equal(data.error, 'nothing_applied');
  assert.ok(data.skipped.some((s) => s.type === 'dailyTasks'));
});

test('POST /api/tasks/captures/apply 非自定义类型被跳过', async () => {
  const { status, data } = await j('POST', '/api/tasks/captures/apply', {
    items: [{ type: 'bogus', endpoint: 'https://example.com/x' }]
  });
  assert.equal(status, 400);
  assert.ok(data.skipped.some((s) => s.type === 'bogus'));
});

test('POST /api/tasks/captures/apply 不安全端点（非 smzdm 域）被跳过', async () => {
  const { status, data } = await j('POST', '/api/tasks/captures/apply', {
    items: [{ type: 'follow', endpoint: 'http://127.0.0.1/x' }]
  });
  assert.equal(status, 400);
  assert.ok(data.skipped.some((s) => s.type === 'follow' && /非 smzdm 域名|不安全/.test(s.reason)));
});

test('POST /api/tasks/captures/apply 合法 smzdm 端点 → 应用成功', async () => {
  const { status, data } = await j('POST', '/api/tasks/captures/apply', {
    items: [{ type: 'follow', endpoint: 'https://user-api.smzdm.com/api/follow2' }]
  });
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.applied, 1);
});

test('PUT /api/tasks/:id articleId 超长 → 400 invalid_article_id', async () => {
  const { status, data } = await j('PUT', '/api/tasks/t_comment', {
    articleId: 'x'.repeat(513)
  });
  assert.equal(status, 400);
  assert.equal(data.error, 'invalid_article_id');
});

test('PUT /api/tasks/:id 非法 articleSource → 400 invalid_source', async () => {
  const { status, data } = await j('PUT', '/api/tasks/t_comment', { articleSource: 'xxx' });
  assert.equal(status, 400);
  assert.equal(data.error, 'invalid_source');
});

test('PUT /api/tasks/:id 不存在 → 404 not_found', async () => {
  const { status } = await j('PUT', '/api/tasks/nope', { name: 'x' });
  assert.equal(status, 404);
});

test('POST /api/tasks/:id/run 不存在 → 404 not_found', async () => {
  const { status } = await j('POST', '/api/tasks/nope/run', {});
  assert.equal(status, 404);
});

// ---------- health：Cookie 检测 / 真机自检（无网络分支） ----------
test('GET /api/health/cookies 无账号 → total 0', async () => {
  const { status, data } = await j('GET', '/api/health/cookies');
  assert.equal(status, 200);
  assert.equal(data.total, 0);
  assert.equal(data.message, '暂无账号');
});

test('POST /api/health/verify 账号不存在 → 404', async () => {
  const { status } = await j('POST', '/api/health/verify', { userId: 'no_such' });
  assert.equal(status, 404);
});

test('POST /api/health/verify 账号无 Cookie → 400', async () => {
  const id = await makeUser('verify_nocookie');
  // 直接改内存态 db（与 app 同进程同 cache），置空 cookie 以命中「未配置 Cookie」分支
  const db = load();
  const u = db.users.find((x) => x.id === id);
  u.cookie = '';
  const { status, data } = await j('POST', '/api/health/verify', { userId: id });
  assert.equal(status, 400);
  assert.ok(data.error);
});

// ---------- baoliao：CRUD（无需账号的读/404 分支） ----------
test('GET /api/baoliao 返回空列表结构', async () => {
  const { status, data } = await j('GET', '/api/baoliao');
  assert.equal(status, 200);
  assert.ok(Array.isArray(data.items));
  assert.equal(typeof data.total, 'number');
});

test('POST /api/baoliao 缺标题 → 400 invalid', async () => {
  const { status, data } = await j('POST', '/api/baoliao', { title: '   ' });
  assert.equal(status, 400);
  assert.equal(data.error, 'invalid');
});

test('POST /api/baoliao/bulk 无有效 smzdm 链接 → 400 no_valid', async () => {
  const { status, data } = await j('POST', '/api/baoliao/bulk', { text: '随便一段文字没有链接' });
  assert.equal(status, 400);
  assert.equal(data.error, 'no_valid');
});

test('POST /api/baoliao/bulk 合法 smzdm 文章链接 → 应用成功', async () => {
  const { status, data } = await j('POST', '/api/baoliao/bulk', {
    text: 'https://www.smzdm.com/p/12345678\nhttps://www.smzdm.com/p/87654321'
  });
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.ok(data.added >= 1);
});

test('POST /api/baoliao/bulk items 形式 → 应用成功', async () => {
  const { status, data } = await j('POST', '/api/baoliao/bulk', {
    items: [{ url: 'https://www.smzdm.com/p/55555555', title: '测试文章' }]
  });
  assert.equal(status, 200);
  assert.equal(data.received, 1);
});

// 好价贴 channel_id 服务端无法稳定取到（反爬），故需浏览器导入侧携带；
// 验证全局默认 channelId 能写入导入的 baoliao 条目（点赞/收藏得以复用真实频道）。
test('POST /api/baoliao/bulk 携带全局 channelId → 写入条目', async () => {
  const { status } = await j('POST', '/api/baoliao/bulk', {
    text: 'https://www.smzdm.com/p/12340000',
    channelId: '99'
  });
  assert.equal(status, 200);
  const list = await j('GET', '/api/baoliao');
  const hit = list.data.items.find((x) => (x.smzdmUrl || x.url) === 'https://www.smzdm.com/p/12340000');
  assert.ok(hit, '导入的条目应出现在列表');
  assert.equal(hit.channelId, '99', '全局默认 channelId 应写入条目');
});

test('PUT /api/baoliao/:id 不存在 → 404', async () => {
  const { status } = await j('PUT', '/api/baoliao/nope', { title: 'x' });
  assert.equal(status, 404);
});

test('DELETE /api/baoliao/:id 不存在 → 404', async () => {
  const { status } = await j('DELETE', '/api/baoliao/nope');
  assert.equal(status, 404);
});

test('POST /api/baoliao/:id/submit 不存在 → 404', async () => {
  const { status } = await j('POST', '/api/baoliao/nope/submit', {});
  assert.equal(status, 404);
});

// ---------- 需要账号的分支 ----------
test('GET /api/clock/status 真实 userId → 200 含 streak/total/points', async () => {
  const id = await makeUser('clk_status');
  const { status, data } = await j('GET', '/api/clock/status?userId=' + id);
  assert.equal(status, 200);
  assert.equal(typeof data.streak, 'number');
  assert.equal(typeof data.total, 'number');
  assert.equal(typeof data.points, 'number');
  assert.ok(Array.isArray(data.calendar));
});

test('POST /api/clock/do 真实账号（mock）→ 200 ok', async () => {
  const id = await makeUser('clk_do');
  const { status, data } = await j('POST', '/api/clock/do', { userId: id });
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.ok(data.record);
});

test('POST /api/baoliao 合法 → 200 草稿', async () => {
  const { status, data } = await j('POST', '/api/baoliao', { title: '测试好价标题', url: 'https://example.com', price: '9.9' });
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.item.status, 'draft');
  assert.ok(data.item.id);
});

// ---------- openMode 跨网段越权（P0-3 路由级集成） ----------
test('openMode 下跨 /24 网段访问他人账号 → 403，同段 → 200（trustProxy=true 时依据 XFF）', async () => {
  const id = await makeUser('seg_user');
  const db = load();
  const u = db.users.find((x) => x.id === id);
  u.recordedIp = '203.0.113.5'; // TEST-NET-3，公网示例地址
  const prevOpen = config.openMode;
  const prevTrust = config.trustProxy;
  config.openMode = true;
  config.trustProxy = true; // 信任代理，XFF 模拟访客 IP 才生效
  try {
    const cross = await j('GET', '/api/clock/status?userId=' + id, undefined, {
      'X-Forwarded-For': '198.51.100.7'
    });
    assert.equal(cross.status, 403, '跨网段应被拒');
    assert.equal(cross.data.error, 'forbidden');

    const same = await j('GET', '/api/clock/status?userId=' + id, undefined, {
      'X-Forwarded-For': '203.0.113.99'
    });
    assert.equal(same.status, 200, '同网段应放行');
  } finally {
    config.openMode = prevOpen;
    config.trustProxy = prevTrust;
  }
});

// ---------- P0-2 修复：默认 trustProxy=false 时伪造 XFF 不能越权 ----------
test('P0-2 修复：默认 trustProxy=false 时伪造 XFF 命中同段也不放行（拒绝越权）', async () => {
  const id = await makeUser('xff_user');
  const db = load();
  const u = db.users.find((x) => x.id === id);
  u.recordedIp = '203.0.113.5';
  const prevOpen = config.openMode;
  const prevTrust = config.trustProxy;
  config.openMode = true;
  config.trustProxy = false; // 默认配置：不信任客户端 XFF
  try {
    // 攻击者伪造 X-Forwarded-For 命中同 /24 网段，但必须被忽略（真实 IP 为测试对端，与 recordedIp 跨段）
    const r = await j('GET', '/api/clock/status?userId=' + id, undefined, {
      'X-Forwarded-For': '203.0.113.99'
    });
    assert.equal(r.status, 403, '伪造 XFF 不应被信任，跨段应被拒');
    assert.equal(r.data.error, 'forbidden');
  } finally {
    config.openMode = prevOpen;
    config.trustProxy = prevTrust;
  }
});

test('关闭测试服务器', () => {
  server.close();
  assert.ok(true);
});
