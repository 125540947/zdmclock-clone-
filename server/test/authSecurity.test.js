// P0：OPEN_MODE 安全模型单元测（auth.js）。
// 直接覆盖审计期 P0-2/P0-3 修复的核心：同网段可见、管理员绕过、写操作守卫、IP 解析、恒定时间比较。
// 全部用 mock req/res/next，无网络、无真实服务，零依赖。
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  safeEqual, getClientIp, ipToLong, sameSegment, extractAdminToken,
  isAdminRequest, canAccessUser, mutationGuard, requireAdmin,
  authRequired, authRequiredOrInstall, authRequiredOrQuery, maskCookie,
  computeVisibleUserIds, adminOrAuthRequired, parseCidrList, ipInCidrList
} from '../src/auth.js';
import { config } from '../src/config.js';

afterEach(() => {
  config.openMode = false;
  config.requireAuth = false;
  config.adminToken = '';
  config.installToken = '';
  config.trustProxy = false;
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
test('getClientIp：默认（trustProxy=false）忽略 XFF，返回真实 req.ip（防伪造绕过 P0-2）', () => {
  config.trustProxy = false;
  // 伪造 XFF 不应被采用，必须回退到真实套接字对端 IP
  assert.equal(getClientIp(mockReq({ headers: { 'x-forwarded-for': '203.0.113.9, 70.41.3.18' }, ip: '198.51.100.5' })), '198.51.100.5');
  assert.equal(getClientIp(mockReq({ ip: '10.0.0.5' })), '10.0.0.5');
});
test('getClientIp：trustProxy=true 时取 XFF 首段，无 XFF 回退 req.ip', () => {
  config.trustProxy = true;
  assert.equal(getClientIp(mockReq({ headers: { 'x-forwarded-for': '203.0.113.9, 70.41.3.18' } })), '203.0.113.9');
  assert.equal(getClientIp(mockReq({ headers: { 'x-forwarded-for': ' 198.51.100.2 ' } })), '198.51.100.2');
  assert.equal(getClientIp(mockReq({ ip: '10.0.0.5' })), '10.0.0.5');
  config.trustProxy = false;
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
test('canAccessUser：开放模式无 recordedIp 遗留账号不可见（M-10 修复）', () => {
  config.openMode = true;
  // 遗留数据归属不明，不应对匿名访客可见；仅同网段录入或管理员可访问，杜绝跨网段读取。
  assert.equal(canAccessUser(mockReq({ ip: '1.2.3.4' }), { recordedIp: undefined }), false);
});
test('canAccessUser：开放模式同段可见、跨段拒绝、无记录拒绝（trustProxy=true 时依据 XFF）', () => {
  config.openMode = true;
  const prevTrust = config.trustProxy;
  config.trustProxy = true; // 信任代理，XFF 模拟访客 IP 才生效
  try {
    const sameSeg = mockReq({ headers: { 'x-forwarded-for': '192.168.1.50' } });
    assert.equal(canAccessUser(sameSeg, { recordedIp: '192.168.1.99' }), true);
    const diffSeg = mockReq({ headers: { 'x-forwarded-for': '192.168.2.50' } });
    assert.equal(canAccessUser(diffSeg, { recordedIp: '192.168.1.99' }), false);
    assert.equal(canAccessUser(mockReq(), undefined), false);
  } finally {
    config.trustProxy = prevTrust;
  }
});

test('P0-2 修复：默认 trustProxy=false 时伪造 XFF 不被信任（跨段仍拒绝越权）', () => {
  const prevOpen = config.openMode;
  const prevTrust = config.trustProxy;
  config.openMode = true;
  config.trustProxy = false; // 默认配置：不信任客户端 XFF
  try {
    const forged = mockReq({ headers: { 'x-forwarded-for': '192.168.1.50' } });
    assert.equal(canAccessUser(forged, { recordedIp: '192.168.1.99' }), false, '伪造 XFF 不应被信任');
    const real = mockReq({ ip: '192.168.1.50' });
    assert.equal(canAccessUser(real, { recordedIp: '192.168.1.99' }), true, '真实同段 IP 应放行');
  } finally {
    config.openMode = prevOpen;
    config.trustProxy = prevTrust;
  }
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

// ---------- computeVisibleUserIds（Phase 2 OPEN_MODE 资产隔离）----------
test('computeVisibleUserIds：非开放模式返回 null（全部可见）', () => {
  config.openMode = false;
  const db = { users: [{ id: 'a', recordedIp: '9.9.9.9' }, { id: 'b', recordedIp: '8.8.8.8' }] };
  assert.equal(computeVisibleUserIds(db, mockReq()), null);
});
test('computeVisibleUserIds：开放模式管理员返回 null（全部可见）', () => {
  config.openMode = true; config.adminToken = 'SECRET_ADMIN';
  const db = { users: [{ id: 'a', recordedIp: '9.9.9.9' }] };
  assert.equal(computeVisibleUserIds(db, mockReq({ headers: { 'x-admin-token': 'SECRET_ADMIN' } })), null);
});
test('computeVisibleUserIds：开放模式非管理员仅同 /24 网段（遗留无 recordedIp 不可见，M-10）', () => {
  config.openMode = true; config.adminToken = 'SECRET_ADMIN';
  const db = {
    users: [
      { id: 'a', recordedIp: '192.168.1.10' }, // 同段（访客 192.168.1.50）→ 可见
      { id: 'b', recordedIp: '192.168.2.10' }, // 跨段 → 排除
      { id: 'c', recordedIp: undefined } // 遗留无记录 → 不可见（M-10 修复）
    ]
  };
  const ids = computeVisibleUserIds(db, mockReq({ ip: '192.168.1.50' }));
  assert.ok(ids instanceof Set);
  assert.ok(ids.has('a'));
  assert.equal(ids.has('b'), false);
  assert.equal(ids.has('c'), false, '遗留无 recordedIp 账号对匿名不可见');
});

// ---------- adminOrAuthRequired（Phase 2 管理/任务路由隔离）----------
test('adminOrAuthRequired：非开放模式维持 authRequired（免鉴权放行）', () => {
  config.openMode = false; config.requireAuth = false;
  let n = 0; const next = () => { n++; };
  adminOrAuthRequired(mockReq(), mockRes(), next);
  assert.equal(n, 1, '非开放免鉴权应放行');
});
test('adminOrAuthRequired：开放模式无管理员令牌 → 401，有则放行', () => {
  config.openMode = true; config.adminToken = 'SECRET_ADMIN'; config.requireAuth = false;
  let n = 0; const next = () => { n++; };
  const r = mockRes();
  adminOrAuthRequired(mockReq(), r, next);
  assert.equal(r.statusCode, 401, '开放模式匿名应拒');
  assert.equal(n, 0);
  const ok = mockRes();
  adminOrAuthRequired(mockReq({ headers: { 'x-admin-token': 'SECRET_ADMIN' } }), ok, next);
  assert.equal(n, 1, '开放模式管理员应放行');
});

// ---------- parseCidrList / ipInCidrList（Phase 2 代理认证来源白名单）----------
test('parseCidrList / ipInCidrList：CIDR 与单 IP 匹配', () => {
  const list = parseCidrList('10.0.0.0/8,192.168.1.10,127.0.0.1');
  assert.equal(list.length, 3);
  assert.equal(ipInCidrList('10.1.2.3', list), true);
  assert.equal(ipInCidrList('11.0.0.1', list), false);
  assert.equal(ipInCidrList('192.168.1.10', list), true);
  assert.equal(ipInCidrList('192.168.1.11', list), false);
  assert.equal(ipInCidrList('8.8.8.8', []), true, '空白名单不限制来源');
  assert.equal(ipInCidrList('not-an-ip', list), false);
});
