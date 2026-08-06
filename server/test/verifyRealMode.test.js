import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runVerification, WRITE_NOTE } from '../src/verifyRealMode.js';

// 用假 Cookie 跑（不依赖真实网络）：离线签名探针必过，网络探针应为 FAIL/SKIP，
// 重点校验返回结构与各探针条目齐全，确保 CLI 与 Web 接口共用逻辑正确。
test('runVerification：返回结构完整、探针条目齐全', async () => {
  const results = await runVerification({ cookie: 'fake_cookie_for_test', withCheckin: false });
  assert.ok(Array.isArray(results), '应返回数组');
  assert.equal(results.length, 11, '共 11 个探针（含 4 个遗留端点可达性 + 1 个签到 SKIP）');

  // 每项结构
  for (const r of results) {
    assert.ok(r.name && r.kind && r.status && 'detail' in r && 'ms' in r, `条目结构完整: ${r.name}`);
    assert.ok(['PASS', 'FAIL', 'SKIP'].includes(r.status), `状态合法: ${r.status}`);
  }

  // 离线签名探针必过（不依赖网络）
  const offline = results.find((r) => r.name === '签名算法 signFormData');
  assert.ok(offline, '含离线签名探针');
  assert.equal(offline.status, 'PASS');

  // 4 个遗留端点可达性探针均在
  for (const n of ['评论 ajax_post_comment', '收藏 ajax_favorite', '点赞 ajax_vote', '爆料 ajax_create']) {
    assert.ok(results.find((r) => r.name === n), `含遗留端点探针: ${n}`);
  }

  // 默认不签：签到探针为 SKIP
  const checkin = results.find((r) => r.name.includes('签到'));
  assert.ok(checkin, '含签到探针');
  assert.equal(checkin.status, 'SKIP');
});

test('runVerification：withCheckin=true 时签到探针不再 SKIP', async () => {
  // 假 Cookie 实签必然失败（网络/鉴权），状态应为 FAIL 而非 SKIP，证明开关生效
  const results = await runVerification({ cookie: 'fake_cookie_for_test', withCheckin: true });
  const checkin = results.find((r) => r.name.includes('签到'));
  assert.ok(checkin, '含签到探针');
  assert.notEqual(checkin.status, 'SKIP', '开启 withCheckin 后不应再 SKIP');
});

test('WRITE_NOTE 为字符串且提示写操作端点', () => {
  assert.ok(typeof WRITE_NOTE === 'string' && WRITE_NOTE.includes('jsonp_draw'), '写操作提示含转盘抽奖');
});
