import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const DB_FILE = path.join(config.dataDir, 'db.json');

function defaultData() {
  return {
    users: [],
    clockRecords: [],
    baoliao: [],
    tasks: [
      { id: 't_clock', type: 'clock', name: '每日签到', icon: '📅', enabled: true, cron: '0 9 * * *', lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_comment', type: 'comment', name: '自动评论', icon: '💬', enabled: false, cron: '0 10 * * *', articleId: '', lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_favorite', type: 'favorite', name: '自动收藏', icon: '⭐', enabled: false, cron: '0 11 * * *', articleId: '', lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_point', type: 'point', name: '自动点赞', icon: '👍', enabled: false, cron: '0 12 * * *', articleId: '', lastRun: null, lastResult: null, status: 'idle' }
    ],
    // GPT 自动回复配置（前端开关与提示词存这里，后端据此是否真正调用大模型）
    settings: {
      gpt: { enabled: false, target: 'comment', tone: 'friendly', prompt: '' }
    },
    meta: { version: 1 }
  };
}

let cache = null;

// 写串行化：所有"改内存 + persist()"通过同一 Promise 链，避免并发请求
// 在 await 边界互相穿插导致 lost-update（含真实双重签到竞态）。
let writeChain = Promise.resolve();
export function withWriteLock(fn) {
  const run = writeChain.then(fn, fn);
  // 无论成功失败都继续链条，避免单个写失败卡死后续写
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function ensureDir() {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

export function load() {
  if (cache) return cache;
  ensureDir();
  if (!fs.existsSync(DB_FILE)) {
    cache = defaultData();
    persist();
    return cache;
  }
  try {
    cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch {
    // R3：解析失败时先备份损坏文件，再重置为空库，避免静默清空无法恢复
    try {
      const backup = DB_FILE + '.corrupt-' + Date.now();
      fs.copyFileSync(DB_FILE, backup);
      // eslint-disable-next-line no-console
      console.error('[store] db.json 解析失败，已备份为', backup);
    } catch {
      /* 备份失败不影响重置 */
    }
    cache = defaultData();
  }
  const d = defaultData();
  cache.users = cache.users || [];
  cache.clockRecords = cache.clockRecords || [];
  cache.baoliao = cache.baoliao || [];
  cache.tasks = cache.tasks && cache.tasks.length ? cache.tasks : d.tasks;
  // settings.gpt 合并：保留已有配置，缺省补齐，避免旧库无 settings 字段时报错
  cache.settings = cache.settings && typeof cache.settings === 'object' ? cache.settings : {};
  cache.settings.gpt =
    cache.settings.gpt && typeof cache.settings.gpt === 'object'
      ? { ...d.settings.gpt, ...cache.settings.gpt }
      : { ...d.settings.gpt };
  return cache;
}

export function persist() {
  if (!cache) return; // 防御：load 之前调用不写空文件
  ensureDir();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export function genId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// 统一使用「本地时区」日期，避免 UTC 与本地混用导致重复签到 / 连续天数错乱
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr(d = new Date()) {
  return localDateStr(d);
}
