// P2：store.load 旧库迁移 + 字段钳制（在独立进程中一次性 load()，避免模块缓存干扰）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const dir = path.join(os.tmpdir(), 'zdm-loadmig-' + process.pid + '-' + Date.now());
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
// 预置一个缺字段且 limit 异常的旧库，验证迁移合并与钳制
fs.writeFileSync(
  path.join(dir, 'db.json'),
  JSON.stringify({
    users: [{ id: 'u1', nickname: '老用户' }],
    tasks: [
      { id: 't_gpt', type: 'gpt', limit: 999 },
      { id: 't_fetch', type: 'fetch', limit: 999 }
    ]
  })
);
process.env.DATA_DIR = dir;
const { load } = await import('../src/store.js');

test('load 旧库缺字段时合并默认（settings/tasks 补齐）', () => {
  const db = load();
  assert.equal(db.users.length, 1); // 保留旧数据
  assert.ok(db.settings.gpt); // 合并默认 gpt 设置
  assert.ok(db.settings.push); // 合并默认 push 设置
  assert.ok(Array.isArray(db.baoliao));
  assert.ok(db.tasks.length >= 6); // 补齐默认任务（t_clock..t_fetch）
});

test('load 旧库 t_gpt/t_fetch 异常 limit 被钳制（1~50）', () => {
  const db = load();
  const gpt = db.tasks.find((t) => t.id === 't_gpt');
  const fetch = db.tasks.find((t) => t.id === 't_fetch');
  assert.equal(gpt.limit, 10); // 钳制到 10
  assert.equal(fetch.limit, 50); // 钳制到 50
});

test('清理临时 DATA_DIR', () => {
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(true);
});
