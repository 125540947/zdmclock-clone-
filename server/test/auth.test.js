// P0：鉴权与安全纯函数测试（safeEqual 恒定时间比较、maskCookie 遮罩、parseBool 布尔解析）
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { safeEqual, maskCookie, ipToBytes, sameSegment, parseCidrList, ipInCidrList } = await import('../src/auth.js');
const { parseBool } = await import('../src/config.js');

test('safeEqual 相等字符串返回 true', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('', ''), true);
});

test('safeEqual 不同内容返回 false', () => {
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'ab'), false);
});

test('safeEqual 长度不同直接返回 false（恒定时间比较前置）', () => {
  assert.equal(safeEqual('ab', 'abc'), false);
  assert.equal(safeEqual('longsecret', 'short'), false);
});

test('safeEqual 处理 undefined/null（按空串）', () => {
  assert.equal(safeEqual(undefined, undefined), true);
  assert.equal(safeEqual(null, ''), true);
  assert.equal(safeEqual('x', undefined), false);
});

test('maskCookie 空值返回空串、非空返回已隐藏标记', () => {
  assert.equal(maskCookie(''), '');
  assert.equal(maskCookie(undefined), '');
  assert.equal(maskCookie('  '), '已保存(已隐藏)'); // 空白串视为已保存
  assert.equal(maskCookie('sessid=abc'), '已保存(已隐藏)');
});

test('IPv4-mapped IPv6 规范化为 IPv4 并可参与网段隔离', () => {
  assert.deepEqual([...ipToBytes('::ffff:192.168.1.8')], [192, 168, 1, 8]);
  assert.deepEqual([...ipToBytes('::ffff:c0a8:0108')], [192, 168, 1, 8]);
  assert.equal(ipToBytes('::1').length, 16, '普通前导压缩 IPv6 仍应正确解析');
  assert.equal(sameSegment('::ffff:192.168.1.8', '192.168.1.99', 24), true);
  assert.equal(sameSegment('::ffff:192.168.2.8', '192.168.1.99', 24), false);
});

test('IPv4-mapped IPv6 可命中普通 IPv4 代理白名单', () => {
  const list = parseCidrList('192.168.1.0/24');
  assert.equal(ipInCidrList('::ffff:192.168.1.8', list), true);
  assert.equal(ipInCidrList('::ffff:192.168.2.8', list), false);
});

test('parseBool 真值集合', () => {
  for (const v of ['1', 'true', 'yes', 'on', 'TRUE', 'Yes', 'On']) {
    assert.equal(parseBool(v), true);
  }
});

test('parseBool 假值/未定义', () => {
  assert.equal(parseBool('0'), false);
  assert.equal(parseBool('false'), false);
  assert.equal(parseBool('no'), false);
  assert.equal(parseBool('off'), false);
  assert.equal(parseBool('anything'), false);
  assert.equal(parseBool(undefined), false);
  assert.equal(parseBool(undefined, true), true); // 默认值生效
});

test('parseBool：未识别值回退默认值（fail-closed，H-03 修复）', () => {
  // 笔误 "tru" 不应静默关闭鉴权：REQUIRE_AUTH=tru 应回退默认 true，而非被当成 false
  assert.equal(parseBool('tru', true), true);
  assert.equal(parseBool('TRUEe', true), true);
  // 其他随机字符串也严格回退默认（不臆造 false）
  assert.equal(parseBool('yesplease', false), false);
  assert.equal(parseBool('', true), true);
});
