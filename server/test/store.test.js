// P0：数据层纯函数测试（mergeBaoliao 去重/过滤/钳制/截断、localDateStr/todayStr 时区、genId）
// 通过临时 DATA_DIR 隔离：load() 将默认库写入 tmp，不影响项目数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-store-' + process.pid + '-' + Date.now());
const { load, mergeBaoliao, localDateStr, todayStr, genId, persistSoon, flushPersist, persistNow, persistAwait } = await import('../src/store.js');

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

test('mergeBaoliao 重导相同链接幂等更新 channelId（不新增、不覆盖原标题）', () => {
  const db = load();
  db.baoliao.length = 0;
  mergeBaoliao([{ smzdmUrl: 'https://www.smzdm.com/p/111', title: 'A' }]);
  assert.equal(db.baoliao.length, 1);
  assert.equal(db.baoliao[0].channelId, '');
  // 重导携带 channelId=3（导入页曾填过频道 ID）
  const b = mergeBaoliao([{ smzdmUrl: 'https://www.smzdm.com/p/111', channelId: '3', title: 'A2' }]);
  assert.equal(b, 0, '重导不应新增');
  assert.equal(db.baoliao.length, 1);
  assert.equal(db.baoliao[0].channelId, '3', '重导应刷新 channelId');
  assert.equal(db.baoliao[0].title, 'A', '未携带 title 时不覆盖原标题');
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

// ===================== #183：单写者落盘 + 优雅关机 flush =====================

test('flushPersist 可 await 且最终落盘为合法 JSON', async () => {
  const db = load();
  db.users.push({ id: 'flush-u1', nickname: 'flush', cookie: 'sess=x', autoRun: false });
  persistNow(); // 立即写一版
  // 触发合并写（debounce）后立刻 flush：flush 应等待在途异步写并再落一次，最终文件合法
  persistSoon();
  const r = await flushPersist();
  assert.equal(r, undefined);
  const raw = fs.readFileSync(path.join(process.env.DATA_DIR, 'db.json'), 'utf-8');
  const parsed = JSON.parse(raw); // 不抛即合法
  assert.ok(Array.isArray(parsed.users));
  assert.ok(parsed.users.some((u) => u.id === 'flush-u1'));
});

// M-04：关键写接口应使用 persistAwait（而非 debounce 的 persistSoon），确保"已确认成功"的数据
// 在响应返回前真正落盘，避免 1.2s 窗口内进程被杀（SIGKILL/崩溃/断电）导致数据丢失。
test('M-04：persistAwait 立即落盘，await 后磁盘文件已反映变更', async () => {
  const db = load();
  db.users.length = 0;
  db.users.push({ id: 'pa1', nickname: 'p', cookie: 'c', autoRun: false });
  await persistAwait(); // 关键路径：await 真实磁盘写完成
  const raw = fs.readFileSync(path.join(process.env.DATA_DIR, 'db.json'), 'utf-8');
  const parsed = JSON.parse(raw);
  assert.ok(parsed.users.some((u) => u.id === 'pa1'), 'persistAwait 后数据应已写入磁盘');
});

// M-11：单账号记录远超 cap 时，enforceClockCap 必须截断（旧 guard 在总记录 < 账号数*cap+64 时跳过，导致不截断）
test('M-11：单账号超限仍被截断（不依赖总记录数宽松跳过）', async () => {
  const { config } = await import('../src/config.js');
  const prevCap = config.clockRecordsMaxPerUser;
  config.clockRecordsMaxPerUser = 3;
  try {
    const db = load();
    db.clockRecords.length = 0;
    // 单一账号写入 10 条（远超 cap=3）；总记录 10 < 账号数(1)*3 + 64（旧 guard 阈值），旧实现会跳过截断
    for (let i = 1; i <= 10; i++) {
      db.clockRecords.push({ userId: 'u_m11', date: '2026-02-' + String(i).padStart(2, '0') });
    }
    persistNow(); // 内部调用 enforceClockCap
    const kept = db.clockRecords.filter((r) => r.userId === 'u_m11');
    assert.equal(kept.length, 3, '单账号记录应被截断到 cap=3');
  } finally {
    config.clockRecordsMaxPerUser = prevCap;
  }
});

// 清理临时数据目录
test('清理临时 DATA_DIR', () => {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  assert.ok(true);
});
