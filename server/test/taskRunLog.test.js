// taskRunLog：执行明细记录 + 汇总纯函数测试（"每天任务做了啥/失败原因"能力）。
// 通过临时 DATA_DIR 隔离，load() 写入 tmp，不影响项目数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-runlog-' + process.pid + '-' + Date.now());
const { load } = await import('../src/store.js');
const { buildTaskRunRecord, filterTaskRuns, summarizeTaskRuns, recordTaskRun } = await import('../src/taskRunLog.js');
const { runTask } = await import('../src/taskRunner.js');

test('buildTaskRunRecord 形态正确', () => {
  const r = buildTaskRunRecord({
    taskId: 't_x',
    taskName: 'X',
    type: 'comment',
    userId: 'all',
    date: '2026-08-26',
    startedAt: '2026-08-26T10:00:00Z',
    ok: false,
    partial: false,
    skipped: false,
    message: 'm',
    perUser: ['a: ok'],
    reasons: [{ action: 'comment', articleId: '123', error_msg: '太快', user: 'u1' }]
  });
  assert.equal(r.taskId, 't_x');
  assert.ok(r.id.startsWith('run_'));
  assert.equal(r.ok, false);
  assert.equal(r.reasons.length, 1);
});

test('filterTaskRuns 按日期/任务/失败过滤 + 升序', () => {
  const list = [
    { date: '2026-08-26', taskId: 't_a', ok: true, skipped: false, finishedAt: '2026-08-26T10:00:00Z' },
    { date: '2026-08-26', taskId: 't_a', ok: false, skipped: false, finishedAt: '2026-08-26T11:00:00Z' },
    { date: '2026-08-25', taskId: 't_a', ok: true, skipped: false, finishedAt: '2026-08-25T10:00:00Z' },
    { date: '2026-08-26', taskId: 't_b', ok: true, skipped: true, finishedAt: '2026-08-26T09:00:00Z' }
  ];
  assert.equal(filterTaskRuns(list, { date: '2026-08-26' }).length, 3);
  assert.equal(filterTaskRuns(list, { date: '2026-08-26', onlyFailed: true }).length, 1);
  assert.equal(filterTaskRuns(list, { taskId: 't_b' }).length, 1);
  const sorted = filterTaskRuns(list, { date: '2026-08-26' });
  assert.ok(sorted[0].finishedAt <= sorted[1].finishedAt);
});

test('summarizeTaskRuns 聚合正确', () => {
  const list = [
    { date: '2026-08-26', taskId: 't_a', taskName: 'A', type: 'comment', ok: true, skipped: false, reasons: [] },
    {
      date: '2026-08-26',
      taskId: 't_a',
      taskName: 'A',
      type: 'comment',
      ok: false,
      skipped: false,
      reasons: [{ action: 'comment', articleId: '1', error_msg: '太快', user: 'u1' }]
    }
  ];
  const s = summarizeTaskRuns(list, '2026-08-26');
  assert.equal(s.total, 2);
  assert.equal(s.ok, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.byTask.length, 1);
  assert.equal(s.byTask[0].ok, 1);
  assert.equal(s.byTask[0].failed, 1);
  assert.equal(s.allReasons.length, 1);
  assert.equal(s.allReasons[0].error_msg, '太快');
});

test('recordTaskRun 在写锁内追加并落内存', async () => {
  const db = load();
  db.taskRuns = [];
  await recordTaskRun(db, {
    taskId: 't_x',
    taskName: 'X',
    type: 'clock',
    userId: null,
    date: '2026-08-26',
    startedAt: '2026-08-26T10:00:00Z',
    ok: true,
    partial: false,
    skipped: false,
    message: 'ok',
    perUser: [],
    reasons: []
  });
  assert.equal(db.taskRuns.length, 1);
  assert.equal(db.taskRuns[0].taskId, 't_x');
});

test('recordTaskRun 滚动截断不超过上限', async () => {
  const db = load();
  db.taskRuns = [];
  for (let i = 0; i < 3005; i++) {
    await recordTaskRun(db, {
      taskId: 't_x',
      taskName: 'X',
      type: 'clock',
      userId: null,
      date: '2026-08-26',
      startedAt: '2026-08-26T10:00:00Z',
      ok: true,
      partial: false,
      skipped: false,
      message: 'ok' + i,
      perUser: [],
      reasons: []
    });
  }
  assert.ok(db.taskRuns.length <= 3000, '应被截断到 <=3000，实际 ' + db.taskRuns.length);
});

test('runTask 对无账号任务写入失败明细（验证 runTask→recordTaskRun 接线）', async () => {
  const db = load();
  db.users = [];
  db.taskRuns = [];
  const task = { id: 't_comment', type: 'comment', name: '自动评论', enabled: true, cron: '0 10 * * *', articleSource: 'manual', articleId: '123' };
  const r = await runTask(task, db, {});
  assert.equal(r.ok, false);
  assert.equal(db.taskRuns.length, 1, '应写入一条执行明细');
  assert.equal(db.taskRuns[0].taskId, 't_comment');
  assert.equal(db.taskRuns[0].ok, false);
  assert.ok(db.taskRuns[0].message.includes('账号'), '失败原因应在 message 中可见');
});
