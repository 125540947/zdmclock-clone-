// #188：零依赖输入校验（validation.js）单元测。
// 覆盖 limitStr / requireStr / limitArr / boundedInt 的边界与 InputError 抛出语义。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InputError,
  limitStr,
  requireStr,
  limitArr,
  boundedInt,
  MAX_COOKIE_LEN,
  MAX_IMPORT_ITEMS,
  MAX_NAME_LEN
} from '../src/validation.js';

test('limitStr：正常字符串透传，null/undefined 归空串', () => {
  assert.equal(limitStr('hello', 10, 'name'), 'hello');
  assert.equal(limitStr(undefined, 10, 'name'), '');
  assert.equal(limitStr(null, 10, 'name'), '');
  // 非字符串输入转为字符串后判定
  assert.equal(limitStr(123, 10, 'n'), '123');
});

test('limitStr：超长抛 InputError(too_long)', () => {
  const long = 'x'.repeat(MAX_NAME_LEN + 1);
  assert.throws(() => limitStr(long, MAX_NAME_LEN, 'name'), (e) => {
    return e instanceof InputError && e.code === 'too_long';
  });
});

test('requireStr：空/空白/非字符串抛 InputError(missing)', () => {
  for (const v of [undefined, '', '   ', 123, null]) {
    assert.throws(() => requireStr(v, 10, 'cookie'), (e) => {
      return e instanceof InputError && e.code === 'missing';
    });
  }
});

test('requireStr：合法字符串受长度上限约束', () => {
  const ok = 'a'.repeat(5);
  assert.equal(requireStr(ok, MAX_COOKIE_LEN, 'cookie'), ok);
  assert.throws(() => requireStr('a'.repeat(MAX_COOKIE_LEN + 1), MAX_COOKIE_LEN, 'cookie'), (e) =>
    e.code === 'too_long'
  );
});

test('limitArr：非数组抛 InputError(not_array)', () => {
  for (const v of [undefined, {}, 'x', 1]) {
    assert.throws(() => limitArr(v, 10, '导入项'), (e) =>
      e instanceof InputError && e.code === 'not_array'
    );
  }
});

test('limitArr：超量抛 InputError(too_many)，未超量原样返回', () => {
  const items = Array.from({ length: MAX_IMPORT_ITEMS }, (_, i) => i);
  assert.equal(limitArr(items, MAX_IMPORT_ITEMS, '导入项').length, MAX_IMPORT_ITEMS);
  assert.throws(() => limitArr([...items, 1], MAX_IMPORT_ITEMS, '导入项'), (e) =>
    e.code === 'too_many'
  );
});

test('boundedInt：非有限数回退 fallback', () => {
  assert.equal(boundedInt('abc', 0, 100, 42), 42);
  assert.equal(boundedInt(undefined, 0, 100, 7), 7);
  assert.equal(boundedInt(NaN, 0, 100, 5), 5);
});

test('boundedInt：钳制到 [min,max] 并向下取整', () => {
  assert.equal(boundedInt(50, 0, 100, 0), 50);
  assert.equal(boundedInt(-5, 0, 100, 0), 0, '负值应钳到 min');
  assert.equal(boundedInt(999, 0, 100, 0), 100, '超上限应钳到 max');
  assert.equal(boundedInt(3.9, 0, 100, 0), 3, '应向下取整');
});

test('InputError 携带 code 与 message', () => {
  const e = new InputError('missing', '必填');
  assert.equal(e.name, 'InputError');
  assert.equal(e.code, 'missing');
  assert.equal(e.message, '必填');
  assert.ok(e instanceof Error);
});
