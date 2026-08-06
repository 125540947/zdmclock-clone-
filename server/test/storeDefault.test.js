// P2：store.load 首次创建默认库（独立进程）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const dir = path.join(os.tmpdir(), 'zdm-loaddefault-' + process.pid + '-' + Date.now());
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
process.env.DATA_DIR = dir;
const { load } = await import('../src/store.js');

test('load 首次运行创建默认库并落盘 db.json', () => {
  const db = load();
  assert.equal(db.users.length, 0);
  assert.ok(db.tasks.length >= 6); // 含 t_clock..t_fetch 默认任务
  assert.ok(db.settings.gpt && db.settings.push);
  assert.ok(fs.existsSync(path.join(dir, 'db.json')), '默认库应已写入磁盘');
});

test('清理临时 DATA_DIR', () => {
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(true);
});
