// #182 DNS 重绑定防护单元测试（零依赖、脱离真实网络，解析器注入）
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { isPrivateOrReservedIp, assertPublicDns, setDnsResolver, getDnsResolver, pinnedFetch, __testSetAllowPrivateIps } from '../src/dnsGuard.js';

test('isPrivateOrReservedIp：常见私有/保留段识别', () => {
  for (const ip of ['10.0.0.1', '10.255.255.255', '127.0.0.1', '127.9.9.9', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '0.0.0.0', '224.0.0.1', '255.255.255.255']) {
    assert.equal(isPrivateOrReservedIp(ip), true, ip);
  }
});

test('isPrivateOrReservedIp：公开 IPv4 放行', () => {
  for (const ip of ['8.8.8.8', '93.184.216.34', '1.1.1.1', '223.5.5.5']) {
    assert.equal(isPrivateOrReservedIp(ip), false, ip);
  }
});

test('isPrivateOrReservedIp：IPv6 回环/ULA/映射私有识别', () => {
  assert.equal(isPrivateOrReservedIp('::1'), true);
  assert.equal(isPrivateOrReservedIp('fe80::1'), true);
  assert.equal(isPrivateOrReservedIp('fd00::1'), true);
  assert.equal(isPrivateOrReservedIp('::ffff:10.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('::ffff:8.8.8.8'), false);
});

test('isPrivateOrReservedIp：公开 IPv6 放行、非法格式保守拒绝', () => {
  assert.equal(isPrivateOrReservedIp('2606:4700:4700::1111'), false);
  assert.equal(isPrivateOrReservedIp('not-an-ip'), true);
  assert.equal(isPrivateOrReservedIp(''), true);
});

// H-03 修复补充：此前遗漏的保留/非公网地址段现应被识别为非公开。
test('isPrivateOrReservedIp：H-03 补齐的 IPv4 保留段识别', () => {
  for (const ip of [
    '100.64.0.1', '100.127.255.254', // 100.64.0.0/10（CGNAT）
    '192.0.0.1', '192.0.0.255', // 192.0.0.0/24（IETF 协议分配）
    '198.18.0.1', '198.19.255.255' // 198.18.0.0/15（基准网络）
  ]) {
    assert.equal(isPrivateOrReservedIp(ip), true, ip);
  }
  // 边界之外应放行
  assert.equal(isPrivateOrReservedIp('100.63.255.255'), false);
  assert.equal(isPrivateOrReservedIp('100.128.0.1'), false);
  assert.equal(isPrivateOrReservedIp('198.17.255.255'), false);
  assert.equal(isPrivateOrReservedIp('198.20.0.1'), false);
});

test('isPrivateOrReservedIp：H-03 补齐的 IPv6 链路本地/组播保留段', () => {
  assert.equal(isPrivateOrReservedIp('fe90::1'), true, 'fe80::/10 其它前缀（此前漏判）');
  assert.equal(isPrivateOrReservedIp('febf::1'), true, 'fe80::/10 边界');
  assert.equal(isPrivateOrReservedIp('ff02::1'), true, 'ff00::/8 组播');
  assert.equal(isPrivateOrReservedIp('fc00::1'), true, 'fc00::/7 ULA 下界');
  assert.equal(isPrivateOrReservedIp('fdff::1'), true, 'fc00::/7 ULA 上界');
  // 公开 IPv6 仍放行
  assert.equal(isPrivateOrReservedIp('2001:db8::1'), false);
});

test('assertPublicDns：解析到公开 IP 通过', async () => {
  setDnsResolver(async () => [{ address: '93.184.216.34' }]);
  const addrs = await assertPublicDns('example.com');
  assert.deepEqual(addrs, ['93.184.216.34']);
});

test('assertPublicDns：解析到私有 IP 拒绝（疑似 DNS 重绑定）', async () => {
  setDnsResolver(async () => [{ address: '10.0.0.5' }]);
  await assert.rejects(() => assertPublicDns('evil.example'), /疑似 DNS 重绑定/);
});

test('assertPublicDns：多地址中任一为私有即拒绝', async () => {
  setDnsResolver(async () => [{ address: '93.184.216.34' }, { address: '192.168.1.1' }]);
  await assert.rejects(() => assertPublicDns('mixed.example'), /疑似 DNS 重绑定/);
});

test('assertPublicDns：解析失败拒绝', async () => {
  setDnsResolver(async () => { throw new Error('ENOTFOUND'); });
  await assert.rejects(() => assertPublicDns('nope.example'), /DNS 解析失败/);
});

test('assertPublicDns：解析无结果拒绝', async () => {
  setDnsResolver(async () => []);
  await assert.rejects(() => assertPublicDns('empty.example'), /DNS 解析无结果/);
});

test('getDnsResolver/setDnsResolver：可还原默认解析器', () => {
  const def = getDnsResolver();
  const stub = async () => [];
  setDnsResolver(stub);
  assert.equal(getDnsResolver(), stub);
  setDnsResolver(def);
  assert.equal(getDnsResolver(), def);
});

// ===================== M-09：pinnedFetch（DNS 重绑定 TOCTOU 闭环） =====================
// 单独放在子测试套件内，用 t.before/t.after 隔离 __testSetAllowPrivateIps 的测试钩子，
// 避免污染上面的 isPrivateOrReservedIp 断言（那些用例要求私有 IP 必须被拒绝）。
test('pinnedFetch（M-09 DNS 重绑定 TOCTOU 闭环）', async (t) => {
  const savedR = getDnsResolver();
  let server;
  let baseUrl;
  let hits = 0;

  t.before(async () => {
    // 测试用：把任意主机名解析到本地，并放行内网/回环以便本地服务器验证
    setDnsResolver(async () => [{ address: '127.0.0.1' }]);
    __testSetAllowPrivateIps(true);
    server = http.createServer((req, res) => {
      hits += 1;
      if (req.url === '/gzip') {
        const data = zlib.gzipSync('hello-gzip-world');
        res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/plain' });
        res.end(data);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain', 'x-custom': 'yes' });
      res.end('hello-world');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://local.test:${port}`;
      resolve();
    }));
  });
  t.after(() => {
    setDnsResolver(savedR);
    __testSetAllowPrivateIps(false);
    server.close();
  });

  const sub = [];
  sub.push(t.test('成功路径返回 fetch 兼容响应', async () => {
    const r = await pinnedFetch(baseUrl + '/');
    assert.equal(r.status, 200);
    assert.equal(r.ok, true);
    assert.equal(r.headers.get('x-custom'), 'yes');
    assert.equal(r.headers.get('X-CUSTOM'), 'yes', '响应头查询应大小写不敏感');
    assert.equal(await r.text(), 'hello-world');
  }));

  sub.push(t.test('透明解压 gzip（content-encoding: gzip）', async () => {
    const r = await pinnedFetch(baseUrl + '/gzip');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'hello-gzip-world');
  }));

  sub.push(t.test('解析到非公开地址（DNS 重绑定）直接拒绝，不发请求', async () => {
    __testSetAllowPrivateIps(false); // 恢复：127.0.0.1 应判为保留地址
    setDnsResolver(async () => [{ address: '127.0.0.1' }]);
    const before = hits;
    await assert.rejects(() => pinnedFetch('http://evil.invalid/'), /DNS 重绑定|非公开/);
    assert.equal(hits, before, '拒绝后不应发起任何连接');
  }));

  sub.push(t.test('钉死校验过的 IP（连接目标 == 校验 IP，绝不二次解析域名）', async () => {
    // 解析器返回公网 IP 8.8.8.8（而非本地服务器），本地服务器不应收到任何请求——
    // 证明连接被钉到校验 IP，而不是对 whatever.invalid 做全新 DNS 解析（那样会 ENOTFOUND 且命中本地服务器）。
    setDnsResolver(async () => [{ address: '8.8.8.8' }]);
    const before = hits;
    try {
      await pinnedFetch('http://whatever.invalid:9/');
    } catch (e) {
      // 期望连接级错误（ECONNREFUSED/ENETUNREACH/ETIMEDOUT），而非对 whatever.invalid 的全新 DNS 解析（ENOTFOUND）
      const conn = new Set(['ECONNREFUSED', 'ENETUNREACH', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET']);
      assert.ok(conn.has(e.code) || e.code == null, `应为连接级错误，实际 code=${e.code}`);
    }
    assert.equal(hits, before, '连接被钉到校验 IP（8.8.8.8），本地服务器不应收到请求');
  }));

  await Promise.all(sub);
});
