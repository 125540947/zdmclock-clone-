// M-14 修复：数值型环境变量统一 boundedNum 校验（拒绝 NaN/负数/极大值/越界）
// 这是 M-14 的核心机制——所有超时/重试/窗口/容量/限流/抖动参数均经其钳制，
// 避免错误配置导致 AbortSignal.timeout 抛异常、定时任务永不触发或资源被放大。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedNum } from '../src/config.js';

test('boundedNum：非数字/NaN/undefined/空 回落默认', () => {
  assert.equal(boundedNum('abc', 1, 10, 5), 5);
  assert.equal(boundedNum(NaN, 1, 10, 5), 5);
  assert.equal(boundedNum(undefined, 1, 10, 5), 5);
  // 空串 Number('')===0 视为合法有限值，被钳到下限 min（非回落默认）
  assert.equal(boundedNum('', 1, 10, 5), 1);
  // null/'' 经 Number() 转为 0（有限值），钳到下限 min
  assert.equal(boundedNum(null, 1, 10, 5), 1);
});

test('boundedNum：负数钳到下限', () => {
  assert.equal(boundedNum(-5, 0, 10, 3), 0);
  assert.equal(boundedNum('-100', 1, 100, 50), 1);
});

test('boundedNum：极大值钳到上限', () => {
  assert.equal(boundedNum(99999, 1, 100, 50), 100);
  assert.equal(boundedNum('1e9', 0, 60000, 10000), 60000);
});

test('boundedNum：正常值与边界值透传', () => {
  assert.equal(boundedNum(5, 1, 10, 3), 5);
  assert.equal(boundedNum(1, 1, 10, 3), 1);
  assert.equal(boundedNum(10, 1, 10, 3), 10);
  assert.equal(boundedNum('7', 1, 10, 3), 7);
});

test('boundedNum：float 与字符串数字一致', () => {
  assert.equal(boundedNum('3.5', 0, 10, 1), 3.5);
});
