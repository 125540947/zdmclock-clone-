import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCookie, checkAccounts } from '../src/health.js';

// 可注入的假适配器：控制 getUserInfo 的返回/抛错，无需联网
function fakeAdapter(behavior) {
  return {
    async getUserInfo() {
      return behavior();
    }
  };
}

test('checkCookie：返回有效身份 → valid=true', async () => {
  const a = fakeAdapter(() => ({ smzdmId: '123', nickname: 'tester', points: 10 }));
  const r = await checkCookie('ck', a, { retries: 0 });
  assert.equal(r.valid, true);
  assert.equal(r.reason, '');
});

test('checkCookie：抛错（网络/超时）→ valid=false，带回错误原因', async () => {
  const a = fakeAdapter(() => {
    throw new Error('HTTP 401');
  });
  const r = await checkCookie('ck', a, { retries: 0 });
  assert.equal(r.valid, false);
  assert.match(r.reason, /HTTP 401/);
});

test('checkCookie：不抛错但身份为空 → valid=false（Cookie 失效）', async () => {
  const a = fakeAdapter(() => ({}));
  const r = await checkCookie('ck', a, { retries: 0 });
  assert.equal(r.valid, false);
  assert.match(r.reason, /空身份/);
});

test('checkCookie：首次失败、重试成功 → valid=true（吸收瞬时抖动）', async () => {
  let calls = 0;
  const a = fakeAdapter(() => {
    calls++;
    if (calls === 1) throw new Error('timeout');
    return { nickname: 'ok' };
  });
  const r = await checkCookie('ck', a, { retries: 1, retryDelayMs: 1 });
  assert.equal(r.valid, true);
  assert.equal(calls, 2);
});

test('checkAccounts：成功→失效仅触发一次 onExpired（不重复告警）', async () => {
  const a = fakeAdapter(() => {
    throw new Error('cookie dead');
  });
  const db = { users: [{ id: 'u1', nickname: 'A', cookie: 'c1', cookieExpired: false }] };
  let fired = 0;
  const onExpired = () => {
    fired++;
  };
  // 连续两轮检测都失效
  await checkAccounts(db, a, { onExpired });
  await checkAccounts(db, a, { onExpired });
  assert.equal(fired, 1, '第二轮不应再次触发告警');
  assert.equal(db.users[0].cookieExpired, true);
});

test('checkAccounts：失效→恢复（成功）自动自愈清零，不触发告警', async () => {
  const a = fakeAdapter(() => ({ smzdmId: '9' }));
  const db = { users: [{ id: 'u1', nickname: 'A', cookie: 'c1', cookieExpired: true }] };
  let fired = 0;
  await checkAccounts(db, a, { onExpired: () => fired++ });
  assert.equal(db.users[0].cookieExpired, false, '应自愈清零');
  assert.equal(fired, 0, '恢复不应触发失效告警');
});

test('checkAccounts：多账号分别判定并附带 id/nickname', async () => {
  const a = fakeAdapter(() => ({ points: 1 }));
  const db = {
    users: [
      { id: 'u1', nickname: 'A', cookie: 'c1' },
      { id: 'u2', nickname: 'B', cookie: 'c2' }
    ]
  };
  const results = await checkAccounts(db, a, {});
  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((r) => r.id),
    ['u1', 'u2']
  );
  assert.ok(results.every((r) => r.valid));
});
