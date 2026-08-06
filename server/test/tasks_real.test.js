import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signFormData } from '../src/smzdm/realAdapter.js';
import {
  extractReward,
  parseJsonp,
  extractHashId,
  discoverActiveIds,
  doTurntable,
  doCrowdtest
} from '../src/smzdm/tasks_real.js';

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

test('extractHashId：从转义/未转义 JSON 与表单值提取 active_id', () => {
  assert.equal(extractHashId('var x={\\"hashId\\":\\"ABC123\\"}'), 'ABC123');
  assert.equal(extractHashId('{"hashId":"DEF456"}'), 'DEF456');
  assert.equal(extractHashId('<input name="lottery_activity_id" value="GHI789">'), 'GHI789');
  assert.equal(extractHashId('no id here'), null);
});

test('discoverActiveIds：遍历内置专题页抽取 hashId（注入 fetcher 避免联网）', async () => {
  const fetcher = async (url) => {
    if (url.includes('bwrzf5')) return 'a \\"hashId\\":\\"ABC123\\" b';
    return 'c \\"hashId\\":\\"DEF456\\" d';
  };
  const ids = await discoverActiveIds('cookie', fetcher);
  assert.deepEqual(ids.sort(), ['ABC123', 'DEF456']);
});

test('doTurntable 自动模式：无参时从专题页获取 active_id 并抽奖', async () => {
  const fetcher = async (url) => {
    if (url.startsWith('https://m.smzdm.com/topic')) return '{"hashId":"TID999"}';
    return 'jQuery123({"error_code":0,"error_msg":"抽奖完成"})';
  };
  const r = await doTurntable('cookie', { call: fetcher });
  assert.equal(r.success, true);
  assert.match(r.message, /抽奖完成/);
});

test('doTurntable 自动模式：专题页无法获取 active_id 时抛错（绝不伪造成功）', async () => {
  const fetcher = async () => 'no hashId here';
  await assert.rejects(() => doTurntable('cookie', { call: fetcher }), /未能自动获取/);
});

test('doCrowdtest 自动模式：无 crowd_id 时跑全民众测能量任务', async () => {
  const fetcher = async (url) => {
    if (url.includes('ajax_get_activity_id')) return { data: { activity_id: 'ACT1' } };
    if (url.includes('ajax_get_activity_info')) {
      return { data: { activity_task: { default_list: [{ task_id: 't1' }, { task_id: 't2' }] } } };
    }
    if (url.includes('ajax_activity_task_receive')) return { error_code: 0, data: { reward_msg: '能量+10' } };
    return {};
  };
  const r = await doCrowdtest('cookie', { call: fetcher });
  assert.equal(r.success, true);
  assert.match(r.message, /全民众测能量任务/);
});

test('doCrowdtest 自动模式：无进行中活动时报错', async () => {
  const fetcher = async () => ({ data: {} });
  await assert.rejects(() => doCrowdtest('cookie', { call: fetcher }), /未找到进行中的全民众测活动/);
});

test('doCrowdtest 显式 crowd_id：走 ajax_participate 申请路径', async () => {
  const fetcher = async (url) => {
    if (url.includes('ajax_participate')) return { error_code: 0, error_msg: '申请成功' };
    return {};
  };
  const r = await doCrowdtest('cookie', { crowdId: 'C123', call: fetcher });
  assert.equal(r.success, true);
  assert.match(r.message, /申请成功/);
});
