// P2：调度 tick 同分钟去重验证（lastFiredMinute 避免同一分钟内重复执行）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-tick-' + process.pid + '-' + Date.now());
const { load, tick } = await import('../src/store.js');
const { tick: runTick } = await import('../src/scheduler.js');

test('tick 同分钟内对同一任务只执行一次（去重）', async () => {
  const db = load();
  db.baoliao = []; // 清空，便于计数
  const t = db.tasks.find((x) => x.id === 't_fetch');
  t.enabled = true;
  t.cron = '* * * * *'; // 永远命中当前分钟

  await runTick(); // 第一次：cron 命中 → 执行 fetch（mock 返回 3 条）→ baoliao +3
  assert.equal(db.baoliao.length, 3);

  await runTick(); // 同一分钟再次调用：lastFiredMinute 命中 → 跳过，不再执行
  assert.equal(db.baoliao.length, 3);

  // 模拟“跨分钟”：清空去重标记后再次执行应再次触发
  // 直接再跑一次无法跨分钟，这里仅验证去重本身（上文已证明长度不变）
});
