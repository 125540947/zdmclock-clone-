#!/usr/bin/env node
// 一键抓包导入器（替你做"抓包"的最后一公里）
//
// 你不需要懂抓包：用任意工具（Chrome 开发者工具 / Charles / Fiddler / 安卓抓包 App）捕获 smzdm
// 的请求，然后二选一：
//   1) 导出 HAR 文件，命名为 *.har 放进 server/captures/
//   2) 在开发者工具里对请求"复制为 cURL"，粘贴进 server/captures/ 下任意 *.curl.txt
// 运行：  node tools/importCapture.mjs
// 它会自动识别 smzdm 的端点（抽奖/转盘/jsonp、每日任务领奖等），剥离 JSONP 外壳，
// 提取响应里的金币/碎银/经验/奖励字段候选，生成 server/captures/detected.json。
// 之后在前端「自动任务 → 抓包导入」里勾选并应用即可，无需手写任何 URL。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAPTURES_DIR = path.join(__dirname, '..', 'captures');

const SMZDM_HOST_RE = /(^|\.)smzdm\.com$/i;

// ---------- 解析：HAR ----------
function parseHar(text) {
  let har;
  try {
    har = JSON.parse(text);
  } catch {
    return [];
  }
  const entries = (har && har.log && har.log.entries) || [];
  const out = [];
  for (const e of entries) {
    const req = e.request || {};
    const url = req.url || '';
    let host;
    try {
      host = new URL(url).host;
    } catch {
      continue;
    }
    if (!SMZDM_HOST_RE.test(host)) continue;
    let body = null;
    const pd = req.postData;
    if (pd) {
      if (Array.isArray(pd.params)) {
        body = Object.fromEntries(pd.params.map((p) => [p.name, p.value]));
      } else if (typeof pd.text === 'string' && pd.text.trim()) {
        body = tryParse(pd.text);
      }
    }
    const headers = Object.fromEntries((req.headers || []).map((h) => [h.name, h.value]));
    out.push({ url, method: (req.method || 'GET').toUpperCase(), body, respText: e.response?.content?.text || null, headers });
  }
  return out;
}

// ---------- 解析：cURL ----------
function tokenize(s) {
  const re = /'([^']*)'|"([^"]*)"|(\S+)/g;
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
function tryParse(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* not json */
  }
  try {
    const params = {};
    for (const pair of t.split('&')) {
      const idx = pair.indexOf('=');
      if (idx > 0) params[pair.slice(0, idx)] = decodeURIComponent(pair.slice(idx + 1));
    }
    if (Object.keys(params).length) return params;
  } catch {
    /* ignore */
  }
  return t;
}
function parseCurl(text) {
  const flat = text.replace(/\\\n/g, ' ').replace(/\n+/g, ' ');
  const args = tokenize(flat);
  let method = 'GET';
  let url = '';
  let body = null;
  const headers = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-X' || a === '--request') {
      method = (args[++i] || 'GET').toUpperCase();
    } else if (a === '-d' || a === '--data' || a === '--data-raw' || a === '--data-binary') {
      const v = args[++i] || '';
      if (method === 'GET') method = 'POST';
      body = tryParse(v);
    } else if (a === '-H' || a === '--header') {
      const v = args[++i] || '';
      const idx = v.indexOf(':');
      if (idx > 0) headers[v.slice(0, idx).trim()] = v.slice(idx + 1).trim();
    } else if (/^https?:\/\//i.test(a)) {
      url = a;
    } else if (!a.startsWith('-') && !url) {
      url = a;
    }
  }
  if (!url) return null;
  let host;
  try {
    host = new URL(url).host;
  } catch {
    host = null;
  }
  if (!SMZDM_HOST_RE.test(host) && !/smzdm\.com/i.test(url)) return null;
  return { url, method, body, respText: null, headers };
}

// ---------- 分类 + 组装 ----------
function classify(url) {
  const u = url.toLowerCase();
  if (u.includes('lottery/jsonp_draw')) return 'turntable'; // 转盘/抽奖共用 jsonp_draw
  if (u.includes('/checkin') && !u.includes('all_reward') && !u.includes('extra_reward') && !u.includes('show_view')) return 'clock';
  // 每日任务领奖端点（task_id 动态）：dailyTasks 内置已用此端点，标记 dailyTasks 让前端提示"已内置、无需导入"
  if (u.includes('task/activity_task_receive') || u.includes('task/activity_receive')) return 'dailyTasks';
  if (u.includes('task/list_v2')) return 'skip'; // 任务列表，不是动作，跳过
  return 'unknown';
}

function findAssetHints(text) {
  if (!text) return [];
  let s = text;
  const m = s.match(/\(([\s\S]*)\)\s*$/);
  if (m) s = m[1];
  let obj;
  try {
    obj = JSON.parse(s);
  } catch {
    return [];
  }
  const hits = [];
  const walk = (o, p) => {
    if (!o || typeof o !== 'object' || p.length > 6 || hits.length >= 12) return;
    for (const k of Object.keys(o)) {
      if (/gold|silver|exp|point|reward|rank|coin|experience/i.test(k)) hits.push(p.concat(k).join('.'));
      walk(o[k], p.concat(k));
    }
  };
  walk(obj, []);
  return hits;
}

function toDetected(req) {
  const { url, method, body, respText, headers } = req;
  const type = classify(url);
  if (type === 'skip') return null;
  const isJsonp = url.toLowerCase().includes('jsonp_draw');
  const referer = headers['Referer'] || headers['referer'] || (isJsonp ? 'https://m.smzdm.com/' : undefined);
  const xrw = headers['x-requested-with'];
  const extraHeaders = xrw ? { 'x-requested-with': xrw } : undefined;
  const assetHint = findAssetHints(respText);
  return {
    guessedType: type,
    method,
    endpoint: url,
    body: method === 'GET' ? null : body,
    jsonp: isJsonp,
    robotToken: /task\/activity/i.test(url),
    referer,
    headers: extraHeaders,
    assetHint,
    note:
      type === 'dailyTasks'
        ? '每日任务领奖端点，task_id 为动态值；dailyTasks 已内置此端点（list_v2→activity_task_receive），无需导入'
        : isJsonp
        ? 'JSONP 抽奖端点，active_id 为动态值（专题页链接里抓）'
        : ''
  };
}

// ---------- 主流程 ----------
function main() {
  if (!fs.existsSync(CAPTURES_DIR)) {
    fs.mkdirSync(CAPTURES_DIR, { recursive: true });
    console.log(`已创建 captures 目录：${CAPTURES_DIR}\n请把抓包文件（*.har 或 *.curl.txt）放入后重新运行。`);
    fs.writeFileSync(path.join(CAPTURES_DIR, 'README.md'), README);
    return;
  }
  const files = fs.readdirSync(CAPTURES_DIR).filter((f) => /\.(har|curl\.txt|curl)$/i.test(f));
  if (!files.length) {
    console.log('captures/ 内没有 .har 或 .curl.txt 文件。');
    console.log('用法：把抓包文件放进来后运行  node tools/importCapture.mjs');
    return;
  }
  const seen = new Map();
  for (const f of files) {
    const full = path.join(CAPTURES_DIR, f);
    const text = fs.readFileSync(full, 'utf-8');
    const reqs = /\.har$/i.test(f) ? parseHar(text) : [parseCurl(text)].filter(Boolean);
    for (const r of reqs) {
      const d = toDetected(r);
      if (!d) continue;
      const key = `${d.method} ${d.endpoint}`;
      if (!seen.has(key)) seen.set(key, d);
    }
  }
  const items = [...seen.values()];
  fs.writeFileSync(path.join(CAPTURES_DIR, 'detected.json'), JSON.stringify(items, null, 2));
  console.log(`识别到 ${items.length} 个 smzdm 端点：`);
  for (const it of items) {
    console.log(`  [${it.guessedType}] ${it.method} ${it.endpoint.slice(0, 90)}`);
    if (it.assetHint.length) console.log(`       资产字段候选：${it.assetHint.slice(0, 6).join(', ')}`);
  }
  console.log(`\n已写入 ${path.join(CAPTURES_DIR, 'detected.json')}`);
  console.log('下一步：前端「自动任务 → 抓包导入」勾选并应用。');
}

const README = `# 抓包导入：你不用懂抓包

目标：把 smzdm App 的抽奖 / 转盘 / 每日任务等真实接口补进 zdmclock，
全程不用手写 URL。

## 三步
1. **抓**：在手机/电脑上用任意抓包工具捕获 smzdm 的请求
   - 最简单：电脑浏览器装个能抓包的插件，或手机用 Charles/小黄鸟(HTTP Catcher)，
     打开 smzdm App 点一下「抽奖 / 转盘 / 做任务」，
     在抓包列表里找到 \`zhiyou.smzdm.com\` 或 \`user-api.smzdm.com\` 的请求。
2. **导**：把该请求导出
   - Charles/Fiddler：右键 → Export Session → 选 HAR，存为 \`xxx.har\`
   - 浏览器/任意工具：「复制为 cURL」，粘贴进 \`xxx.curl.txt\`
   把文件放进本目录（server/captures/）。
3. **转**：在本目录运行
   \`\`\`
   node tools/importCapture.mjs
   \`\`\`
   生成 detected.json；然后到前端「自动任务 → 抓包导入」勾选并应用即可。

## 说明
- 抽奖/转盘（jsonp_draw）需要 \`active_id\`（在专题页请求里），工具会自动带上你抓到的那个。
- 每日任务领奖需要 \`task_id\`（每天变化），请用本工具抓「领奖」那次请求。
- 一键导入器只读取你提供的抓包文件，绝不伪造任何接口或响应。
`;

main();
