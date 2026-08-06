import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signFormData } from '../src/smzdm/realAdapter.js';
import { extractReward, parseJsonp } from '../src/smzdm/tasks_real.js';

test('signFormData：按键字母排序 + 追加 key + md5 大写', () => {
  const out = signFormData({ sk: 'SK', token: 'TK' });
  const keys = Object.keys(out).filter((k) => k !== 'sign').sort();
  // 公共参数 + 业务参数齐全
  for (const k of ['weixin', 'basic_v', 'f', 'v', 'time', 'sk', 'token']) {
    assert.ok(k in out, `缺少 ${k}`);
  }
  // sign 是 32 位大写十六进制
  assert.match(out.sign, /^[0-9A-F]{32}$/);
  // 自洽：sign 等于对排序串联 + key 的 md5
  const signData = keys.map((k) => `${k}=${String(out[k]).replace(/\s+/g, '')}`).join('&');
  const expected = crypto.createHash('md5').update(`${signData}&key=apr1$AwP!wRRT$gJ/q.X24poeBInlUJC`).digest('hex').toUpperCase();
  assert.equal(out.sign, expected);
});

test('extractReward：从奖励文案近似提取金币/碎银/经验', () => {
  assert.deepEqual(extractReward('恭喜获得<strong>5</strong>金币'), { gold: 5, silver: 0, exp: 0 });
  assert.deepEqual(extractReward('获得10碎银子奖励'), { gold: 0, silver: 10, exp: 0 });
  assert.deepEqual(extractReward('经验+20点'), { gold: 0, silver: 0, exp: 20 });
  const mix = extractReward('获得3金币、5碎银、经验+8');
  assert.equal(mix.gold, 3);
  assert.equal(mix.silver, 5);
  assert.equal(mix.exp, 8);
});

test('parseJsonp：剥离回调外壳取内部 JSON', () => {
  assert.deepEqual(parseJsonp('jQuery123_169({ "a": 1, "b": "x" })'), { a: 1, b: 'x' });
  assert.deepEqual(parseJsonp('{"c":2}'), { c: 2 }); // 无外壳直接解析
});
