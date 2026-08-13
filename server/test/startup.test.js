// 智能启动调度测试（零依赖，mock taskRunner.runTask 避免真实联网）
//
// 覆盖 M-03 修复：runStartupForAccounts 并发幂等（原子区守卫）。
//   - 调度器每分钟 tick 触发 t_startup，同时用户可手动 POST /api/tasks/:id/run 立即触发；
//     若一次运行尚未结束，第二次并发调用不得再跑一遍流水线（否则同一账号当天被启动两次，
//     破坏"每账号每天仅启动一次"幂等，并违反"账号间绝不同时启动"第一定律）。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// 大宽限窗 + 00:00 启动时间，使账号在任意时刻都落在"今日启动窗口内"，
// 这样无论测试运行于一天中哪个时刻，流水线都会真实触发。
process.env.STARTUP_GRACE_MIN = '1440';
// persist() 会落盘到 DATA_DIR，指向临时目录避免污染真实 db.json
process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-startup-' + process.pid + '-' + Date.now());

const SRC = path.resolve(import.meta.dirname, '../src');
const p = (rel) => pathToFileURL(path.resolve(SRC, rel)).href;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 记录每次实际跑到的流水线任务，用于断言"并发未重复执行"
let runTaskCalls = [];
mock.module(p('taskRunner.js'), {
  namedExports: {
    // 仅提供 startup 依赖的 runTask；故意放慢以制造并发重叠窗口
    runTask: async (t, db, opts) => {
      runTaskCalls.push({ type: t.type, userId: opts && opts.userId });
      await sleep(40);
    }
  }
});

const { runStartupForAccounts } = await import('../src/startup.js');
const { config } = await import('../src/config.js');

function makeDb() {
  return {
    users: [
      {
        id: 'u1',
        nickname: '测试号',
        cookie: 'sess=x',
        autoRun: true,
        cookieExpired: false,
        schedMode: 'manual',
        checkInTime: '00:00'
      }
    ],
    tasks: [{ id: 't1', type: 'clock', name: '签到', enabled: true }]
  };
}

test('M-03 并发触发：同一账号流水线仅执行一次（原子区复用进行中结果）', async () => {
  runTaskCalls = [];
  const db = makeDb();
  // 两次并发调用：第二次应在"原子区"守卫处复用第一次的进行中 promise，而非再跑一遍
  const [r1, r2] = await Promise.all([
    runStartupForAccounts(db),
    runStartupForAccounts(db)
  ]);
  assert.equal(runTaskCalls.length, 1, '并发两次只应触发一次流水线（runTask 调用数=1）');
  assert.equal(runTaskCalls[0].userId, 'u1');
  assert.equal(r1, r2, '第二次并发调用应复用第一次的进行中 promise（同一引用）');
  assert.equal(r1.ran, 1, '应成功启动 1 个账号');
  assert.ok(
    /^\d{4}-\d{2}-\d{2}$/.test(db.users[0].lastStartupDate),
    '账号应被标记为已启动（lastStartupDate 为 YYYY-MM-DD）'
  );
});

test('M-03 已完成当天启动的账号，二次调用被幂等跳过', async () => {
  runTaskCalls = [];
  const db = makeDb();
  const first = await runStartupForAccounts(db);
  assert.equal(first.ran, 1);
  const callsAfterFirst = runTaskCalls.length;
  // 立刻再次调用：lastStartupDate 已为今天 → 应直接跳过，不再进入流水线
  const second = await runStartupForAccounts(db);
  assert.equal(second.ran, 0, '当天已启动 → ran=0');
  assert.equal(runTaskCalls.length, callsAfterFirst, '不应再触发任何流水线任务');
});
