// P2：store.load 损坏恢复（R3）—— 解析失败先备份为 .corrupt-* 再重置默认库（独立进程）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const dir = path.join(os.tmpdir(), 'zdm-loadcorrupt-' + process.pid + '-' + Date.now());
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'db.json'), '{ this is not valid json'); // 故意损坏
process.env.DATA_DIR = dir;
const { load } = await import('../src/store.js');

test('load 损坏 db.json 时备份为 .corrupt 并重置默认库', () => {
  const db = load();
  assert.equal(db.users.length, 0); // 重置为默认
  assert.ok(db.tasks.length >= 6);
  const files = fs.readdirSync(dir);
  assert.ok(files.some((f) => f.startsWith('db.json.corrupt')), '应存在 .corrupt 备份文件');
});

test('清理临时 DATA_DIR', () => {
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(true);
});
