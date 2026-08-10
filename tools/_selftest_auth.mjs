import assert from 'node:assert';
import { config } from '../server/src/config.js';
import { authRequiredOrInstall } from '../server/src/auth.js';

let pass = 0, fail = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.error('  ✗', name, '\n    ', e.message); fail++; }
}

// ---- auth 单测 ----
function mkReq({ auth, queryToken } = {}) {
  const headers = {}; if (auth) headers.authorization = auth;
  return { headers, query: queryToken ? { token: queryToken } : {} };
}
function mkRes() {
  let s = 200, b = null;
  const r = { status(c) { s = c; return r; }, json(o) { b = o; return r; } };
  r._status = () => s; r._body = () => b; return r;
}
config.apiToken = 'api'; config.adminToken = 'adm'; config.installToken = 'inst';
config.openMode = false; config.requireAuth = false;
run('requireAuth=false 放行', () => { let c = false; authRequiredOrInstall(mkReq(), mkRes(), () => { c = true; }); assert.ok(c); });
config.requireAuth = true;
run('Bearer apiToken 通过', () => { let c = false; authRequiredOrInstall(mkReq({ auth: 'Bearer api' }), mkRes(), () => { c = true; }); assert.ok(c); });
run('Bearer adminToken 通过', () => { let c = false; authRequiredOrInstall(mkReq({ auth: 'Bearer adm' }), mkRes(), () => { c = true; }); assert.ok(c); });
run('Bearer installToken 通过', () => { let c = false; authRequiredOrInstall(mkReq({ auth: 'Bearer inst' }), mkRes(), () => { c = true; }); assert.ok(c); });
run('错误 token 拒绝(401)', () => { let c = false; const res = mkRes(); authRequiredOrInstall(mkReq({ auth: 'Bearer bad' }), res, () => { c = true; }); assert.ok(!c); assert.strictEqual(res._status(), 401); });
run('无 token 拒绝(401)', () => { let c = false; const res = mkRes(); authRequiredOrInstall(mkReq(), res, () => { c = true; }); assert.ok(!c); assert.strictEqual(res._status(), 401); });
run('query ?token=install 通过', () => { let c = false; authRequiredOrInstall(mkReq({ queryToken: 'inst' }), mkRes(), () => { c = true; }); assert.ok(c); });
run('installToken 为空时空 Bearer 拒绝(401)', () => { config.installToken = ''; let c = false; const res = mkRes(); authRequiredOrInstall(mkReq({ auth: 'Bearer ' }), res, () => { c = true; }); assert.ok(!c); assert.strictEqual(res._status(), 401); config.installToken = 'inst'; });
config.openMode = true; config.requireAuth = true;
run('openMode 放行', () => { let c = false; authRequiredOrInstall(mkReq(), mkRes(), () => { c = true; }); assert.ok(c); });
config.openMode = false; config.requireAuth = false;

// ---- 路由集成：/import-script.user.js 注入窄权限 token，不泄露会话 ----
function reqMock(url, query) { return { method: 'GET', url, query: query || {}, headers: { host: 'example.com' }, protocol: 'http' }; }
function resMock() { let typeV = null, bodyV = null; const r = { type(t) { typeV = t; return r; }, send(b) { bodyV = b; return r; } }; r._type = () => typeV; r._body = () => bodyV; return r; }

let usersRouter = null;
try { usersRouter = (await import('../server/src/routes/users.js')).default; }
catch (e) { console.warn('  ⚠ 跳过路由集成测试（express 不可解析）：', e.message); }

if (usersRouter) {
  config.installToken = 'inst';
  run('脚本注入 installToken 且不再含 __TOKEN__ 占位符', () => {
    const res = resMock();
    usersRouter.handle(reqMock('/import-script.user.js', { server: 'https://my.example.com' }), res, () => {});
    const body = res._body();
    assert.ok(body.includes('"inst"'), '应包含 installToken');
    assert.ok(!body.includes('__TOKEN__'), '占位符应已被替换');
    assert.ok(body.includes('https://my.example.com'), '应注入 server');
  });
  run('脚本忽略 ?token= 会话（不泄露）', () => {
    const res = resMock();
    usersRouter.handle(reqMock('/import-script.user.js', { server: 'https://x.com', token: 'SESSION_XYZ' }), res, () => {});
    const body = res._body();
    assert.ok(!body.includes('SESSION_XYZ'), '会话 token 不应出现在脚本内');
    assert.ok(body.includes('"inst"'), '仍应使用 installToken');
  });
  run('installToken 为空时脚本 token 为空串', () => {
    config.installToken = '';
    const res = resMock();
    usersRouter.handle(reqMock('/import-script.user.js', { server: 'https://x.com' }), res, () => {});
    const body = res._body();
    assert.ok(body.includes('const ZDMC_TOKEN = ""'), '应为空串');
    config.installToken = 'inst';
  });
}

console.log(`\nP1-2 self-test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
