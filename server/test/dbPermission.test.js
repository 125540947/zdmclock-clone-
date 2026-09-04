// db.json 落盘权限收紧（P1-安全，AUDIT_REPORT_2026-09-04）：
// db.json 须为 640（owner rw / group r / other 无），data 目录须为 750。
// db.json 含 Cookie、推送凭据与 AI 配置，须避免同机其他用户可读。
// 注：POSIX 权限位仅在 Linux 生效；Windows 上 chmod 仅映射只读位，故模式断言仅在非 win32 平台执行，
// 其余平台退化为「不抛错 + 文件已落盘」的冒烟断言。修复目标（VPS 为 Debian/Linux）以 Linux 校验为准。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 照既定模式：先设 DATA_DIR 再动态 import，确保 config.dataDir 指向隔离目录
const DATA_DIR = path.join(os.tmpdir(), 'zdm-dbperm-' + process.pid + '-' + Date.now());
process.env.DATA_DIR = DATA_DIR;
const { config } = await import('../src/config.js');
const { load, persistNow, flushPersist, chmodSecure } = await import('../src/store.js');

const IS_WIN = process.platform === 'win32';
const FILE_MODE = 0o640;
const DIR_MODE = 0o750;

test('chmodSecure 收紧权限且不抛错', () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const f = path.join(DATA_DIR, 'probe-' + Date.now());
  fs.writeFileSync(f, 'x');
  assert.doesNotThrow(() => chmodSecure(f, FILE_MODE));
  if (!IS_WIN) assert.strictEqual(fs.statSync(f).mode & 0o777, FILE_MODE);
  fs.unlinkSync(f);
});

test('persistNow 同步落盘权限', () => {
  const dbFile = path.join(config.dataDir, 'db.json');
  load();
  persistNow();
  if (!IS_WIN) {
    assert.strictEqual(fs.statSync(dbFile).mode & 0o777, FILE_MODE, 'db.json 应为 640');
    assert.strictEqual(fs.statSync(config.dataDir).mode & 0o777, DIR_MODE, 'data 目录应为 750');
  } else {
    assert.ok(fs.existsSync(dbFile), 'db.json 应已落盘');
  }
});

test('flushPersist 异步落盘权限', async () => {
  const dbFile = path.join(config.dataDir, 'db.json');
  load();
  await flushPersist();
  if (!IS_WIN) {
    assert.strictEqual(fs.statSync(dbFile).mode & 0o777, FILE_MODE, '异步写后 db.json 应为 640');
  } else {
    assert.ok(fs.existsSync(dbFile), 'db.json 应已落盘');
  }
});

test('连续写不回退权限', () => {
  const dbFile = path.join(config.dataDir, 'db.json');
  const db = load();
  db.__permProbe = Date.now();
  persistNow();
  persistNow();
  if (!IS_WIN) {
    assert.strictEqual(fs.statSync(dbFile).mode & 0o777, FILE_MODE, '多次落盘后 db.json 仍应为 640');
  } else {
    assert.ok(fs.existsSync(dbFile), 'db.json 应已落盘');
  }
});
