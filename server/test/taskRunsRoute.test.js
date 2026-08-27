// GET /api/tasks/runs 只读端点测试：过滤 / 汇总 / 结构化失败原因。
// 复用 routes.test.js 的匿名模式（config.requireAuth=false → adminOrAuthRequired 放行）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-runsroute-' + process.pid + '-' + Date.now());
const { createApp } = await import('../src/index.js');
const { config } = await import('../src/config.js');
const { load, persist } = await import('../src/store.js');
config.requireAuth = false;

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = 'http://localhost:' + server.address().port;

async function j(method, p, body, headers = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch { /* 可能无 JSON 体 */ }
  return { status: res.status, data };
}

// 种子数据：两个日期、含成功/失败(带 reasons)/跳过
const SEED = [
  {
    id: 'r1', taskId: 't_clock', taskName: '每日签到', type: 'clock', userId: 'all',
    date: '2026-08-26', startedAt: '2026-08-26T09:00:00Z', finishedAt: '2026-08-26T09:00:02Z',
    ok: true, partial: false, skipped: false, message: '签到成功', perUser: ['A：签到成功'], reasons: []
  },
  {
    id: 'r2', taskId: 't_comment', taskName: '自动评论', type: 'comment', userId: 'all',
    date: '2026-08-26', startedAt: '2026-08-26T10:00:00Z', finishedAt: '2026-08-26T10:00:05Z',
    ok: false, partial: false, skipped: false, message: '1 失败',
    perUser: ['A：文章 123456: 速度太快'],
    reasons: [{ action: 'comment', articleId: '123456', error_msg: '速度太快，请稍后重试', user: 'A' }]
  },
  {
    id: 'r3', taskId: 't_clock', taskName: '每日签到', type: 'clock', userId: 'all',
    date: '2026-08-26', startedAt: '2026-08-26T09:05:00Z', finishedAt: '2026-08-26T09:05:01Z',
    ok: true, partial: true, skipped: false, message: '部分成功', perUser: ['A：ok', 'B：fail'], reasons: []
  },
  {
    id: 'r4', taskId: 't_fetch', taskName: '自动获取', type: 'fetch', userId: 'all',
    date: '2026-08-26', startedAt: '2026-08-26T08:00:00Z', finishedAt: '2026-08-26T08:00:01Z',
    ok: true, partial: false, skipped: true, message: '跳过', perUser: [], reasons: []
  },
  {
    id: 'r5', taskId: 't_clock', taskName: '每日签到', type: 'clock', userId: 'all',
    date: '2026-08-25', startedAt: '2026-08-25T09:00:00Z', finishedAt: '2026-08-25T09:00:02Z',
    ok: true, partial: false, skipped: false, message: 'ok', perUser: ['A：ok'], reasons: []
  }
];

test('seed: taskRuns 写入并落盘', () => {
  const db = load();
  db.taskRuns = SEED.map((x) => ({ ...x }));
  persist();
  assert.equal(db.taskRuns.length, SEED.length);
});

test('GET /api/tasks/runs 默认返回全部 + 汇总', async () => {
  const { status, data } = await j('GET', '/api/tasks/runs');
  assert.equal(status, 200);
  assert.equal(data.total, SEED.length);
  assert.ok(Array.isArray(data.runs));
  assert.ok('summary' in data);
  // summary 按全部日期聚合：ok=3(r1,r3,r5) failed=1(r2) skipped=1(r4)
  assert.equal(data.summary.ok, 3);
  assert.equal(data.summary.failed, 1);
  assert.equal(data.summary.skipped, 1);
  // 时间线：最新在上（r2 finishedAt=10:00:05Z 最晚）
  assert.equal(data.runs[0].id, 'r2');
});

test('GET /api/tasks/runs?fail=1 仅返回失败(非跳过)', async () => {
  const { status, data } = await j('GET', '/api/tasks/runs?fail=1');
  assert.equal(status, 200);
  assert.equal(data.total, 1);
  assert.equal(data.runs[0].id, 'r2');
  assert.equal(data.runs[0].reasons.length, 1);
  assert.equal(data.runs[0].reasons[0].articleId, '123456');
});

test('GET /api/tasks/runs?date= 按日期过滤', async () => {
  const { status, data } = await j('GET', '/api/tasks/runs?date=2026-08-25');
  assert.equal(status, 200);
  assert.equal(data.total, 1);
  assert.equal(data.runs[0].id, 'r5');
});

test('GET /api/tasks/runs?taskId= 按任务过滤', async () => {
  const { status, data } = await j('GET', '/api/tasks/runs?taskId=t_comment');
  assert.equal(status, 200);
  assert.equal(data.total, 1);
  assert.equal(data.runs[0].id, 'r2');
});

test('OPEN_MODE 下 /api/tasks/runs 匿名可读（与签到记录页一致）', async () => {
  // 模拟开放模式：此时 adminOrAuthRequired 会强制管理员(401/403)，而 authRequired 应匿名放行。
  config.openMode = true;
  try {
    const { status, data } = await j('GET', '/api/tasks/runs'); // 不带任何 Token
    assert.equal(status, 200, 'OPEN_MODE 下匿名应可读执行明细');
    assert.equal(data.total, SEED.length);
  } finally {
    config.openMode = false; // 复原，避免影响其他用例
  }
});

test('关闭测试服务器', () => {
  server.close();
  assert.ok(true);
});
