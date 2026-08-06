#!/usr/bin/env node
// 真机验证脚本（P1-1 CLI 入口）：部署 SMZDM_ADAPTER=real 后，用你自己的 Cookie 跑一遍，
// 逐项报告哪些内置端点在当前 smzdm 版本下仍有效。
//
// 核心探测逻辑见 server/src/verifyRealMode.js（与 Web 端「一键自检」共用）。
//
// 用法：
//   node tools/verifyRealMode.mjs "<你的 smzdm Cookie>"
//   SMZDM_COOKIE="xxx" node tools/verifyRealMode.mjs
//   node tools/verifyRealMode.mjs "<cookie>" --with-checkin
//
// 退出码：全部 PASS/SKIP → 0；存在 FAIL → 1；参数错误 → 2。

import { runVerification, WRITE_NOTE } from '../src/verifyRealMode.js';

const argv = process.argv.slice(2);
const withCheckin = argv.includes('--with-checkin');
const cookieFromArg = argv.find((a) => !a.startsWith('--'));
const cookie = cookieFromArg || process.env.SMZDM_COOKIE;

if (!cookie) {
  console.error('✗ 缺少 smzdm Cookie。\n');
  console.error('用法：');
  console.error('  node tools/verifyRealMode.mjs "<你的 smzdm Cookie>"');
  console.error('  SMZDM_COOKIE="xxx" node tools/verifyRealMode.mjs [--with-checkin]');
  console.error('\nCookie 获取：浏览器登录 smzdm 后，F12 → Network → 任意 smzdm 请求的 Request Headers → Cookie。');
  process.exit(2);
}

const results = await runVerification({ cookie, withCheckin });

// 打印表格
const ICON = { PASS: '✓', FAIL: '✗', SKIP: '⚠' };
let maxName = 0;
for (const r of results) maxName = Math.max(maxName, r.name.length);
const fmt = (s) => ((s || '').length > 90 ? s.slice(0, 87) + '…' : s || '-');

console.log('\n=== smzdm 真机端点验证 ===');
console.log(`时间: ${new Date().toLocaleString('zh-CN')}`);
console.log(`Cookie: ${cookie.slice(0, 12)}…（${cookie.length} 字符）`);
console.log(`模式: 只读探测${withCheckin ? ' + 实签一次' : ''}\n`);
console.log(`${'状态'.padEnd(6)}${'探测项'.padEnd(maxName + 2)}耗时  说明`);
console.log('-'.repeat(maxName + 22));
for (const r of results) {
  const flag = ICON[r.status];
  const ms = r.ms ? `${String(r.ms).padStart(4)}ms` : '   - ';
  console.log(`${flag.padEnd(6)}${r.name.padEnd(maxName + 2)}${ms}  ${fmt(r.detail)}`);
}

console.log('\n' + WRITE_NOTE + '\n');

const failed = results.filter((r) => r.status === 'FAIL');
if (failed.length) {
  console.error(`结果：${failed.length} 项 FAIL —— 见上方 ✗ 明细，多为 smzdm 端点/结构变更或 Cookie 失效。`);
  console.error('修复：用同名环境变量覆盖端点/签名（SMZDM_SIGN_KEY / SMZDM_API_BASE / …），或重新抓包更新。');
  process.exit(1);
}
console.log('结果：全部 PASS / SKIP —— 真实链路前置探测通过，可放心启用 SMZDM_ADAPTER=real。');
process.exit(0);
