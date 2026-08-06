// P0：数据层纯函数测试（mergeBaoliao 去重/过滤/钳制/截断、localDateStr/todayStr 时区、genId）
// 通过临时 DATA_DIR 隔离：load() 将默认库写入 tmp，不影响项目数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-store-' + process.pid + '-' + Date.now());
const { load, mergeBaoliao, localDateStr, todayStr, genId } = await import('../src/store.js');

test('localDateStr 固定日期格式与边界（含闰年 2/29）', () => {
  assert.equal(localDateStr(new Date(2026, 0, 1)), '2026-01-01');
  assert.equal(localDateStr(new Date(2024, 1, 29)), '2024-02-29'); // 闰年
  assert.equal(localDateStr(new Date(2026, 11, 31)), '2026-12-31'); // 年末
});

test('todayStr 返回 10 位 YYYY-MM-DD 且等于 localDateStr(now)', () => {
  const t = todayStr();
  assert.match(t, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(t, localDateStr(new Date()));
});

test('genId 以 prefix_ 开头且为字符串', () => {
  const id = genId('c');
  assert.equal(typeof id, 'string');
  assert.ok(id.startsWith('c_'));
  assert.notEqual(genId('c'), genId('c')); // 随机后缀基本不重复
});

test('mergeBaoliao 新增并按 smzdmUrl 去重', () => {
  const db = load();
  db.baoliao.length = 0;
  const a = mergeBaoliao([{ smzdmUrl: 'https://www.smzdm.com/p/111', title: 'A' }]);
  assert.equal(a, 1);
  assert.equal(db.baoliao.length, 1);
  // 重复链接：跳过
  const b = mergeBaoliao([{ smzdmUrl: 'https://www.smzdm.com/p/111', title: 'A2' }]);
  assert.equal(b, 0);
  assert.equal(db.baoliao.length, 1);
});

test('mergeBaoliao 缺 smzdmUrl 时回退 url 字段', () => {
  const db = load();
  db.baoliao.length = 0;
  const added = mergeBaoliao([{ url: 'https://www.smzdm.com/p/222', title: 'B' }]);
  assert.equal(added, 1);
  assert.equal(db.baoliao[0].smzdmUrl, 'https://www.smzdm.com/p/222');
});

test('mergeBaoliao 仅接受合法 http(s) 链接，过滤其余', () => {
  const db = load();
  db.baoliao.length = 0;
  const added = mergeBaoliao([
    { smzdmUrl: 'ftp://evil/x' },
    { smzdmUrl: 'javascript:alert(1)' },
    { smzdmUrl: '' },
    { url: 'not-a-url' }
  ]);
  assert.equal(added, 0);
  assert.equal(db.baoliao.length, 0);
});

test('mergeBaoliao 字段长度钳制（title/price/content）', () => {
  const db = load();
  db.baoliao.length = 0;
  mergeBaoliao([
    {
      smzdmUrl: 'https://www.smzdm.com/p/333',
      title: 'T'.repeat(500),
      price: 'P'.repeat(100),
      content: 'C'.repeat(5000)
    }
  ]);
  const it = db.baoliao[0];
  assert.ok(it.title.length <= 200, 'title 应被钳制到 200');
  assert.ok(it.price.length <= 50, 'price 应被钳制到 50');
  assert.ok(it.content.length <= 2000, 'content 应被钳制到 2000');
});

test('mergeBaoliao 超过 500 条时丢弃最旧（R5）', () => {
  const db = load();
  db.baoliao.length = 0; // 隔离前置污染
  // 预置 500 条
  for (let i = 0; i < 500; i++) {
    db.baoliao.push({ id: 'seed' + i, smzdmUrl: 'https://x/' + i, title: 's' });
  }
  assert.equal(db.baoliao.length, 500);
  mergeBaoliao([
    { smzdmUrl: 'https://www.smzdm.com/p/new1' },
    { smzdmUrl: 'https://www.smzdm.com/p/new2' }
  ]);
  // 超出上限后截断到 500（最旧 seed 被丢弃，新增的排在前面）
  assert.equal(db.baoliao.length, 500);
  assert.equal(db.baoliao[0].smzdmUrl, 'https://www.smzdm.com/p/new2');
});

test('mergeBaoliao 非数组入参返回 0 且不抛', () => {
  const db = load();
  db.baoliao.length = 0; // 隔离前置污染
  assert.equal(mergeBaoliao(null), 0);
  assert.equal(mergeBaoliao('x'), 0);
  assert.equal(mergeBaoliao(undefined), 0);
  assert.equal(db.baoliao.length, 0);
});

// 清理临时数据目录
test('清理临时 DATA_DIR', () => {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  assert.ok(true);
});
