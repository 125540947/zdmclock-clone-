// #182 DNS 重绑定防护单元测试（零依赖、脱离真实网络，解析器注入）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateOrReservedIp, assertPublicDns, setDnsResolver, getDnsResolver } from '../src/dnsGuard.js';

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
