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
      { id: 't_comment', type: 'comment', name: '自动评论', icon: '💬', enabled: false, cron: '0 10 * * *', lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_favorite', type: 'favorite', name: '自动收藏', icon: '⭐', enabled: false, cron: '0 11 * * *', lastRun: null, lastResult: null, status: 'idle' },
      { id: 't_point', type: 'point', name: '自动点赞', icon: '👍', enabled: false, cron: '0 12 * * *', lastRun: null, lastResult: null, status: 'idle' }
    ],
    meta: { version: 1 }
  };
}

let cache = null;

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
    cache = defaultData();
  }
  const d = defaultData();
  cache.users = cache.users || [];
  cache.clockRecords = cache.clockRecords || [];
  cache.baoliao = cache.baoliao || [];
  cache.tasks = cache.tasks && cache.tasks.length ? cache.tasks : d.tasks;
  return cache;
}

export function persist() {
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
