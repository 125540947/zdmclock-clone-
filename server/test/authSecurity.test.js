// P0：OPEN_MODE 安全模型单元测（auth.js）。
// 直接覆盖审计期 P0-2/P0-3 修复的核心：同网段可见、管理员绕过、写操作守卫、IP 解析、恒定时间比较。
// 全部用 mock req/res/next，无网络、无真实服务，零依赖。
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  safeEqual, getClientIp, ipToLong, sameSegment, extractAdminToken,
  isAdminRequest, canAccessUser, mutationGuard, requireAdmin,
  authRequired, authRequiredOrInstall, authRequiredOrQuery, maskCookie
} from '../src/auth.js';
import { config } from '../src/config.js';

afterEach(() => {
  config.openMode = false;
  config.requireAuth = false;
  config.adminToken = '';
  config.installToken = '';
  config.apiToken = 'zdmclock';
});

function mockReq(over = {}) {
  return { headers: {}, ip: '127.0.0.1', query: {}, body: {}, ...over };
}
function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(c) { this.statusCode = c; return this; },
    set(n, v) { this.headers[n] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

// ---------- safeEqual ----------
test('safeEqual：相等/不等/长度不同/空值', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual(null, 'a'), false);
  assert.equal(safeEqual('a', undefined), false);
});

// ---------- getClientIp ----------
test('getClientIp：优先 XFF 首段，回退 req.ip', () => {
  assert.equal(getClientIp(mockReq({ headers: { 'x-forwarded-for': '203.0.113.9, 70.41.3.18' } })), '203.0.113.9');
  assert.equal(getClientIp(mockReq({ headers: { 'x-forwarded-for': ' 198.51.100.2 ' } })), '198.51.100.2');
  assert.equal(getClientIp(mockReq({ ip: '10.0.0.5' })), '10.0.0.5');
});

// ---------- ipToLong ----------
test('ipToLong：合法 IPv4 / 非法返回 null', () => {
  assert.equal(ipToLong('192.168.1.1'), 3232235777);
  assert.equal(ipToLong('0.0.0.0'), 0);
  assert.equal(ipToLong('255.255.255.255'), 4294967295);
  assert.equal(ipToLong('999.1.1.1'), null);
  assert.equal(ipToLong('::1'), null);
  assert.equal(ipToLong('not-an-ip'), null);
  assert.equal(ipToLong(''), null);
});

// ---------- sameSegment ----------
test('sameSegment：/24 同段、跨段、非 IPv4、/16、/32', () => {
  assert.equal(sameSegment('192.168.1.5', '192.168.1.200', 24), true);
  assert.equal(sameSegment('192.168.1.5', '192.168.2.5', 24), false);
  assert.equal(sameSegment('192.168.1.5', 'example.com', 24), false);
  assert.equal(sameSegment('192.168.1.5', '192.168.2.5', 16), true);
  assert.equal(sameSegment('192.168.1.5', '192.168.1.6', 32), false);
});

// ---------- extractAdminToken ----------
test('extractAdminToken：X-Admin-Token > body.adminToken > Authorization', () => {
  assert.equal(extractAdminToken(mockReq({ headers: { 'x-admin-token': 'A1' } })), 'A1');
  assert.equal(extractAdminToken(mockReq({ body: { adminToken: 'B2' } })), 'B2');
  assert.equal(extractAdminToken(mockReq({ headers: { authorization: 'Admin C3' } })), 'C3');
  assert.equal(extractAdminToken(mockReq({ headers: { authorization: 'Bearer D4' } })), 'D4');
  assert.equal(extractAdminToken(mockReq()), '');
});

// ---------- isAdminRequest ----------
test('isAdminRequest：仅有效 ADMIN_TOKEN 认管理员（apiToken 不认）', () => {
  config.adminToken = 'SECRET_ADMIN';
  assert.equal(isAdminRequest(mockReq({ headers: { 'x-admin-token': 'SECRET_ADMIN' } })), true);
  assert.equal(isAdminRequest(mockReq({ headers: { authorization: 'Bearer ' + config.apiToken } })), false);
  assert.equal(isAdminRequest(mockReq({ headers: { 'x-admin-token': 'WRONG' } })), false);
  config.adminToken = '';
  assert.equal(isAdminRequest(mockReq({ headers: { 'x-admin-token': 'ANY' } })), false);
});

// ---------- canAccessUser ----------
test('canAccessUser：非开放模式全放行', () => {
  config.openMode = false;
  assert.equal(canAccessUser(mockReq(), { recordedIp: '9.9.9.9' }), true);
});
test('canAccessUser：开放模式管理员绕过', () => {
  config.openMode = true;
  config.adminToken = 'SECRET_ADMIN';
  const req = mockReq({ headers: { 'x-admin-token': 'SECRET_ADMIN' } });
  assert.equal(canAccessUser(req, { recordedIp: '9.9.9.9' }), true);
});
test('canAccessUser：开放模式无 recordedIp 遗留账号可见', () => {
  config.openMode = true;
  assert.equal(canAccessUser(mockReq({ ip: '1.2.3.4' }), { recordedIp: undefined }), true);
});
test('canAccessUser：开放模式同段可见、跨段拒绝、无记录拒绝', () => {
  config.openMode = true;
  const sameSeg = mockReq({ headers: { 'x-forwarded-for': '192.168.1.50' } });
  assert.equal(canAccessUser(sameSeg, { recordedIp: '192.168.1.99' }), true);
  const diffSeg = mockReq({ headers: { 'x-forwarded-for': '192.168.2.50' } });
  assert.equal(canAccessUser(diffSeg, { recordedIp: '192.168.1.99' }), false);
  assert.equal(canAccessUser(mockReq(), undefined), false);
});

// ---------- authRequired（中间件）----------
test('authRequired：openMode/!requireAuth 放行；requireAuth 校验 Bearer', () => {
  const ok = mockRes(); let n = 0; const next = () => { n++; };
  config.openMode = true;
  authRequired(mockReq(), ok, next);
  assert.equal(n, 1, 'openMode 应放行');

  config.openMode = false; config.requireAuth = false;
  authRequired(mockReq(), ok, next);
  assert.equal(n, 2, '!requireAuth 应放行');

  config.requireAuth = true;
  authRequired(mockReq(), ok, next);
  assert.equal(n, 2, '无 token 应拒（next 不调用）');
  assert.equal(ok.statusCode, 401);

  const good = mockRes();
  authRequired(mockReq({ headers: { authorization: 'Bearer ' + config.apiToken } }), good, next);
  assert.equal(n, 3, '有效 token 应放行');

  const bad = mockRes();
  authRequired(mockReq({ headers: { authorization: 'Bearer wrong' } }), bad, next);
  assert.equal(bad.statusCode, 401);
});

// ---------- authRequiredOrQuery ----------
test('authRequiredOrQuery：支持 ?token= 查询参数', () => {
  config.requireAuth = true;
  let n = 0; const next = () => { n++; };
  const noTok = mockRes();
  authRequiredOrQuery(mockReq(), noTok, next);
  assert.equal(noTok.statusCode, 401);
  const withQ = mockRes();
  authRequiredOrQuery(mockReq({ query: { token: config.apiToken } }), withQ, next);
  assert.equal(n, 1);
});

// ---------- authRequiredOrInstall ----------
test('authRequiredOrInstall：接受 apiToken/adminToken/installToken 任一', () => {
  config.requireAuth = true;
  config.adminToken = 'ADM';
  config.installToken = 'INST';
  let n = 0; const next = () => { n++; };
  const reject = mockRes();
  authRequiredOrInstall(mockReq(), reject, next);
  assert.equal(reject.statusCode, 401);
  authRequiredOrInstall(mockReq({ headers: { authorization: 'Bearer ' + config.apiToken } }), mockRes(), next);
  authRequiredOrInstall(mockReq({ headers: { authorization: 'Bearer ADM' } }), mockRes(), next);
  authRequiredOrInstall(mockReq({ query: { token: 'INST' } }), mockRes(), next);
  assert.equal(n, 3, 'apiToken/adminToken/installToken 均应放行');
});

// ---------- requireAdmin ----------
test('requireAdmin：独立 ADMIN_TOKEN 优先；兜底要求 apiToken+requireAuth；绝不匿名', () => {
  let n = 0; const next = () => { n++; };
  // 配置了 ADMIN_TOKEN → 仅其有效
  config.adminToken = 'SECRET_ADMIN';
  const ok = mockRes();
  requireAdmin(mockReq({ headers: { 'x-admin-token': 'SECRET_ADMIN' } }), ok, next);
  assert.equal(n, 1);
  const noAdm = mockRes();
  requireAdmin(mockReq({ headers: { authorization: 'Bearer ' + config.apiToken } }), noAdm, next);
  assert.equal(noAdm.statusCode, 401);
  assert.equal(noAdm.body.error, 'admin_token_required');
  // 未配置 ADMIN_TOKEN → 要求 apiToken 且 requireAuth 开启
  config.adminToken = '';
  config.requireAuth = true;
  const fb = mockRes();
  requireAdmin(mockReq({ headers: { authorization: 'Bearer ' + config.apiToken } }), fb, next);
  assert.equal(n, 2);
  const anon = mockRes();
  requireAdmin(mockReq(), anon, next);
  assert.equal(anon.statusCode, 401);
  assert.equal(anon.body.error, 'unauthorized');
});

// ---------- mutationGuard ----------
test('mutationGuard：开放模式走 requireAdmin；非开放走 authRequired', () => {
  let n = 0; const next = () => { n++; };
  config.openMode = true; config.adminToken = 'SECRET_ADMIN';
  const ok = mockRes();
  mutationGuard(mockReq({ headers: { 'x-admin-token': 'SECRET_ADMIN' } }), ok, next);
  assert.equal(n, 1, '开放模式+管理员应放行');
  const noAdm = mockRes();
  mutationGuard(mockReq(), noAdm, next);
  assert.equal(noAdm.statusCode, 401, '开放模式匿名应拒');

  config.openMode = false; config.requireAuth = true; config.adminToken = '';
  const reqAuth = mockRes();
  mutationGuard(mockReq({ headers: { authorization: 'Bearer ' + config.apiToken } }), reqAuth, next);
  assert.equal(n, 2, '非开放模式+有效 apiToken 应放行');
  const reqNo = mockRes();
  mutationGuard(mockReq(), reqNo, next);
  assert.equal(reqNo.statusCode, 401);
});

// ---------- maskCookie ----------
test('maskCookie：非空遮罩、空串返回空', () => {
  assert.equal(maskCookie('sess_abc'), '已保存(已隐藏)');
  assert.equal(maskCookie(''), '');
});
