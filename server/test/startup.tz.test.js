// #185 验证：智能启动调度按 ZDM_TZ 时区（而非进程本地时区）判定「今天/当前分钟」，
// 解决容器 UTC 导致启动时间整体偏移 8h 的问题。与 scheduler cron 求值共用 zonedWallClock。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// 必须在任何模块 import 之前设置 DATA_DIR，确保 store.js 的 DB_FILE 落在临时目录
process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-startup-tz-' + Date.now());
const cleanup = () => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });

const { config } = await import('../src/config.js');
const { zonedWallClock } = await import('../src/clockSchedule.js');
const startup = await import('../src/startup.js');
const { runStartupForAccounts } = startup;

test('runStartupForAccounts 按 config.tz 时区判定启动时间', async () => {
  const orig = { tz: config.tz, grace: config.startupGraceMin, stagger: config.clockStaggerMs, jitter: config.clockStaggerJitterMs };
  // 选一个与本地大概率不同的 IANA 时区放大偏移，使"用错时区就不会跑"可被区分
  config.tz = 'Asia/Shanghai';
  config.startupGraceMin = 5;
  config.clockStaggerMs = 0;
  config.clockStaggerJitterMs = 0;
  try {
    // 以"上海时区"当前 HH:MM 作为账号启动时间；db.tasks 为空 → 不会真正打 smzdm（runTask 不触发）
    const z = zonedWallClock(new Date(), config.tz);
    const hm = `${String(z.getHours()).padStart(2, '0')}:${String(z.getMinutes()).padStart(2, '0')}`;
    const db = {
      users: [{ id: 'u1', nickname: 't', cookie: 'x', autoRun: true, schedMode: 'manual', checkInTime: hm }],
      tasks: []
    };
    const r = await runStartupForAccounts(db);
    assert.ok(r.ran >= 1, `应至少跑 1 个账号（时区正确匹配），实际 ran=${r.ran}，上海 nowMin=${z.getHours() * 60 + z.getMinutes()}`);
    assert.equal(db.users[0].lastStartupDate, z.date, 'lastStartupDate 应为时区感知的今天');
  } finally {
    config.tz = orig.tz;
    config.startupGraceMin = orig.grace;
    config.clockStaggerMs = orig.stagger;
    config.clockStaggerJitterMs = orig.jitter;
    cleanup();
  }
});
