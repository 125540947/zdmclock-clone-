#!/usr/bin/env node
// zdmclock 每日任务执行报告 CLI
// 读取 db.json 的 taskRuns（由 runTask 在每次任务结束时写入），按日期汇总：
//   哪些任务做了 / 哪些失败 / 失败原因是什么。
//
// 用法：
//   node tools/taskReport.mjs                 # 今天
//   node tools/taskReport.mjs --date 2026-08-26
//   node tools/taskReport.mjs --fail          # 仅看失败 + 原因
//   node tools/taskReport.mjs --task t_comment
//   node tools/taskReport.mjs --user <id>
//   node tools/taskReport.mjs --json          # 输出 JSON（便于脚本/看板消费）
//   node tools/taskReport.mjs --db /path/db.json
//
// 注：taskRuns 仅记录"确有动作/结果"的运行；纯 skipped（如定时签到无待签账号）
// 为免每分钟刷屏不记录，故"今天没跑"的时段不会出现在报告里——这正符合"做了啥"的语义。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeTaskRuns, filterTaskRuns } from '../server/src/taskRunLog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') out.date = argv[++i];
    else if (a === '--task') out.taskId = argv[++i];
    else if (a === '--user') out.userId = argv[++i];
    else if (a === '--db') out.db = argv[++i];
    else if (a === '--fail') out.fail = true;
    else if (a === '--json') out.json = true;
  }
  return out;
}

function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function resolveDbPath(override) {
  if (override) return path.resolve(override);
  // 默认从仓库根（cwd 或本文件上级）找 data/db.json
  const candidates = [
    path.resolve(process.cwd(), 'data/db.json'),
    path.resolve(__dirname, '../data/db.json'),
    path.resolve(__dirname, '../server/data/db.json')
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[1];
}

function statusOf(r) {
  if (r.skipped) return '跳过';
  if (r.ok && !r.partial) return '成功';
  if (r.partial) return '部分成功';
  return '失败';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = resolveDbPath(args.db);
  if (!fs.existsSync(dbPath)) {
    console.error(`[taskReport] 找不到 db.json：${dbPath}`);
    process.exit(1);
  }
  let db;
  try {
    db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  } catch (e) {
    console.error(`[taskReport] db.json 解析失败：${e.message}`);
    process.exit(1);
  }
  const taskRuns = Array.isArray(db.taskRuns) ? db.taskRuns : [];
  const date = args.date || todayLocal();

  if (args.json) {
    const summary = summarizeTaskRuns(taskRuns, date);
    const list = filterTaskRuns(taskRuns, {
      date,
      taskId: args.taskId,
      userId: args.userId,
      onlyFailed: args.fail
    });
    console.log(JSON.stringify({ dbPath, summary, runs: list }, null, 2));
    return;
  }

  if (!taskRuns.length) {
    console.log('（暂无任务执行记录。任务运行后会自动写入 db.taskRuns。）');
    return;
  }

  const summary = summarizeTaskRuns(taskRuns, date);
  console.log('========================================');
  console.log(`  zdmclock 任务执行日报 · ${summary.date}`);
  console.log('========================================');
  console.log(
    `总运行 ${summary.total} 次 ｜ 成功 ${summary.ok} ｜ 部分成功 ${summary.partial} ｜ 失败 ${summary.failed} ｜ 跳过(无操作) ${summary.skipped}`
  );

  const filtered = filterTaskRuns(taskRuns, {
    date,
    taskId: args.taskId,
    userId: args.userId,
    onlyFailed: args.fail
  });

  if (args.fail) {
    console.log(`\n--- 失败 / 错误运行（${filtered.length} 条）---`);
  } else {
    console.log('\n--- 按任务 ---');
    for (const t of summary.byTask) {
      const flag = t.failed > 0 ? '⚠️' : '✅';
      console.log(
        `  ${flag} ${t.taskName}（${t.taskId}）: 运行 ${t.runs} ｜ 成功 ${t.ok} ｜ 失败 ${t.failed} ｜ 跳过 ${t.skipped}`
      );
    }
    console.log(`\n--- 执行明细（${filtered.length} 条）---`);
  }

  for (const r of filtered) {
    const st = statusOf(r);
    const who = r.userId === 'all' ? '全部账号' : r.userId || '-';
    console.log(`\n[${st}] ${r.taskName}（${r.taskId}）· ${r.date} ${String(r.finishedAt).slice(11, 19)} · 账号 ${who}`);
    if (r.message) console.log(`    概要: ${r.message.replace(/\n/g, '\n          ')}`);
    for (const pu of r.perUser || []) console.log(`    · ${pu}`);
  }

  // 失败原因明细（始终展示，直接回答"失败原因是什么"）
  const reasons = (args.fail ? filtered : taskRuns.filter((r) => r.date === date && !r.ok && !r.skipped)).flatMap(
    (r) => (r.reasons || []).map((x) => ({ ...x, taskName: r.taskName, date: r.date }))
  );
  if (reasons.length) {
    console.log(`\n=== 失败原因明细（${reasons.length} 条）===`);
    reasons.forEach((x, i) => {
      const article = x.articleId ? ` 文章 ${x.articleId}` : '';
      console.log(
        `  ${i + 1}. [${x.action}]${article} — ${x.error_msg}${x.user ? ` （账号 ${x.user}）` : ''}`
      );
    });
  } else if (!args.fail) {
    console.log('\n（今日无失败原因记录 ✅）');
  }
}

main();
