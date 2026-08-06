#!/usr/bin/env node
// 真机验证脚本（P1-1）：部署 SMZDM_ADAPTER=real 后，用你自己的 Cookie 跑一遍，
// 逐项报告哪些内置端点在当前 smzdm 版本下仍有效。
//
// 设计原则：
//  - 默认「只读探测」：只验证 Cookie 有效性、签名、以及各端点的可达性与解析结构，
//    绝不调用会消耗抽奖次数/领取奖励的写接口（jsonp_draw / activity_task_receive /
//    ajax_participate / 实际签到的 POST），避免误消耗。
//  - 加 --with-checkin 才真正签一次到（每日一次，低风险），用于端到端验证签到链路。
//  - 所有网络探测都走 realAdapter / tasks_real 的真实实现（与线上一致），不 mock。
//
// 用法：
//   node tools/verifyRealMode.mjs "<你的 smzdm Cookie>"
//   SMZDM_COOKIE="xxx" node tools/verifyRealMode.mjs
//   node tools/verifyRealMode.mjs "<cookie>" --with-checkin
//
// 退出码：全部 PASS/SKIP → 0；存在 FAIL → 1；参数错误 → 2。

import { realAdapter, signFormData, appRequest } from '../src/smzdm/realAdapter.js';
import { discoverActiveIds, getTestingActivityId } from '../src/smzdm/tasks_real.js';

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

// 探针结果收集
const results = [];
async function probe(name, kind, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    results.push({ name, kind, status: 'PASS', detail, ms: Date.now() - start });
  } catch (e) {
    results.push({ name, kind, status: 'FAIL', detail: e?.message || String(e), ms: Date.now() - start });
  }
}

function fmt(s) {
  return (s || '').length > 90 ? s.slice(0, 87) + '…' : s || '-';
}

console.log('\n=== smzdm 真机端点验证 ===');
console.log(`时间: ${new Date().toLocaleString('zh-CN')}`);
console.log(`Cookie: ${cookie.slice(0, 12)}…（${cookie.length} 字符）`);
console.log(`模式: 只读探测${withCheckin ? ' + 实签一次' : ''}\n`);

// 1) 离线：签名算法是否能产出 32 位大写 MD5（不依赖网络）
await probe('签名算法 signFormData', 'offline', () => {
  const r = signFormData({ sk: 'SK', token: 'TK' });
  if (!r.sign || !/^[0-9A-F]{32}$/.test(r.sign)) throw new Error('签名未生成或格式异常');
  return `sign=${r.sign}`;
});

// 2) Cookie 有效性 + 身份解析（GET /user/）
await probe('账号身份 /user/', 'cookie', async () => {
  const u = await realAdapter.getUserInfo(cookie);
  if (!u.nickname && !u.smzdmId) throw new Error('返回空身份（Cookie 失效或端点变更）');
  return `昵称=${u.nickname || '-'} 等级=${u.level} 积分=${u.points}`;
});

// 3) robot/token（签名鉴权前置，每日任务/签到都要）
await probe('robot/token 鉴权', 'auth', async () => {
  const t = await realAdapter.getRobotToken(cookie);
  if (!t) throw new Error('未返回 token');
  return `token=${String(t).slice(0, 6)}…（${String(t).length} 字符）`;
});

// 4) 每日任务 list_v2（只读，验证端点可达 + 结构解析，不领奖）
await probe('每日任务 list_v2', 'endpoint', async () => {
  const list = await appRequest('/task/list_v2', { cookie, method: 'POST', data: {} });
  const rows = list?.data?.data?.rows || list?.data?.rows || [];
  return `接口可达，任务分组数=${rows.length}`;
});

// 5) 转盘 active_id 自动发现（只读抓专题页抽 hashId，不抽奖）
await probe('转盘 active_id 自动发现', 'endpoint', async () => {
  const ids = await discoverActiveIds(cookie);
  if (!ids.length) throw new Error('未从内置专题页提取到 active_id（专题页可能改版）');
  return `命中 ${ids.length} 个: ${ids.join(', ')}`;
});

// 6) 众测 全民众测活动自动发现（只读，不领能量/不申请商品）
await probe('众测 全民众测 activity_id', 'endpoint', async () => {
  const aid = await getTestingActivityId(cookie);
  if (!aid) throw new Error('未找到进行中的全民众测活动（可能暂未开启）');
  return `activity_id=${aid}`;
});

// 7) 签到（写操作）：默认跳过，避免重复签到
if (withCheckin) {
  await probe('签到 /checkin（实签）', 'MUTATING', async () => {
    const r = await realAdapter.doClockIn(cookie);
    if (!r.success) throw new Error('签到返回失败');
    return r.message;
  });
} else {
  results.push({
    name: '签到 /checkin（实签）',
    kind: 'MUTATING',
    status: 'SKIP',
    detail: '默认不执行（避免重复签到）。加 --with-checkin 实签一次以端到端验证。',
    ms: 0
  });
}

// 打印表格
const ICON = { PASS: '✓', FAIL: '✗', SKIP: '⚠' };
let maxName = 0;
for (const r of results) maxName = Math.max(maxName, r.name.length);
console.log(`${'状态'.padEnd(6)}${'探测项'.padEnd(maxName + 2)}耗时  说明`);
console.log('-'.repeat(maxName + 22));
for (const r of results) {
  const flag = ICON[r.status];
  const ms = r.ms ? `${String(r.ms).padStart(4)}ms` : '   - ';
  console.log(`${flag.padEnd(6)}${r.name.padEnd(maxName + 2)}${ms}  ${fmt(r.detail)}`);
}

// 写操作端点提示
console.log('\n注：以下为「写操作」端点，本验证不主动调用以免消耗（仅验证其前置可达性）：');
console.log('  · 转盘抽奖 jsonp_draw       —— 由 #5 的 active_id 发现保障；真正抽奖在定时任务中执行');
console.log('  · 每日任务领奖 activity_task_receive —— 由 #4 的 list_v2 保障');
console.log('  · 众测能量领取 / 商品申请     —— 由 #6 的 activity_id 发现保障');
console.log('  若这些前置探测 PASS，则实际运行通常不会因端点失效而失败。\n');

const failed = results.filter((r) => r.status === 'FAIL');
if (failed.length) {
  console.error(`结果：${failed.length} 项 FAIL —— 见上方 ✗ 明细，多为 smzdm 端点/结构变更或 Cookie 失效。`);
  console.error('修复：用同名环境变量覆盖端点/签名（SMZDM_SIGN_KEY / SMZDM_API_BASE / …），或重新抓包更新。');
  process.exit(1);
}
console.log('结果：全部 PASS / SKIP —— 真实链路前置探测通过，可放心启用 SMZDM_ADAPTER=real。');
process.exit(0);
