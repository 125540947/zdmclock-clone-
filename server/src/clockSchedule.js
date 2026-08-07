import { config } from './config.js';

// 签到时间调度辅助：把"账号级个人签到时间"从 schedMode/checkInTime 解析为 HH:MM，
// 并为"系统自动"模式在配置窗口内确定性地分配一个分散的固定时间，避免多账号同秒扎堆。

// 解析 "HH:MM"（24 小时制）。非法返回 null。
export function parseHM(s) {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { h, mi };
}

export function fmtHM(h, mi) {
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

// 计算任意时区下的"墙上时间"对象，供 cron 求值与"当前分钟/今天"判定使用。
// 返回对象实现与 Date 相同的 getMinutes/getHours/getDate/getMonth/getDay 语义，
// 并额外提供 date(YYYY-MM-DD 字符串)，用于在指定时区下判定"今天"。
// tz 为 'local' / 空 / 'UTC' 时直接基于传入的 Date（即进程本地/UTC），保持历史行为；
// 指定具体 IANA 时区（如 'Asia/Shanghai'）时按该时区折算墙钟。
const WEEKDAY_MAP = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function zonedWallClock(date, tz) {
  if (!tz || tz === 'local' || tz === 'UTC') {
    return {
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      getTime: () => date.getTime(),
      getMinutes: () => date.getMinutes(),
      getHours: () => date.getHours(),
      getDate: () => date.getDate(),
      getMonth: () => date.getMonth(),
      getDay: () => date.getDay()
    };
  }
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short'
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const minute = Number(p.minute);
  const hour = Number(p.hour) % 24; // 个别环境午夜会返回 24，归一成 0
  const day = Number(p.day);
  const month = Number(p.month) - 1;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    getTime: () => new Date(Number(p.year), month, day, hour, minute).getTime(),
    getMinutes: () => minute,
    getHours: () => hour,
    getDate: () => day,
    getMonth: () => month,
    getDay: () => WEEKDAY_MAP[p.weekday] ?? date.getDay()
  };
}

// 窗口 [start, end] 转为相对分钟的起止与跨度（含端点）。
export function windowMinutes(start, end) {
  const a = parseHM(start) || { h: 8, mi: 0 };
  const b = parseHM(end) || { h: 10, mi: 59 };
  const startMin = a.h * 60 + a.mi;
  let endMin = b.h * 60 + b.mi;
  if (endMin < startMin) endMin = startMin; // 防御：end 早于 start 时退化为单点
  return { startMin, endMin, span: endMin - startMin + 1 };
}

// 系统自动分配：把 userId 哈希映射到窗口内的某一分钟（确定性、稳定、尽量分散）。
export function assignAutoCheckInTime(userId, cfg = config) {
  const { startMin, span } = windowMinutes(cfg.autoWindowStart, cfg.autoWindowEnd);
  let h = 2166136261; // FNV-1a 初始值，分布更均匀
  for (let i = 0; i < String(userId).length; i++) {
    h ^= String(userId).charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const off = h % Math.max(1, span);
  const total = startMin + off;
  return fmtHM(Math.floor(total / 60) % 24, total % 60);
}

// 解析某账号实际生效的签到时间（HH:MM）：
// - manual：用其 checkInTime（非法/缺失则回退系统默认）
// - default：系统默认时间
// - auto：用已固化的 checkInTime；若缺失则按 userId 哈希重新分配
export function resolvedCheckInTime(user, cfg = config) {
  const mode = user && user.schedMode ? user.schedMode : 'auto';
  const fallback = cfg.defaultCheckInTime || '09:00';
  if (mode === 'manual') {
    const p = parseHM(user.checkInTime);
    return p ? fmtHM(p.h, p.mi) : fallback;
  }
  if (mode === 'default') {
    return fallback;
  }
  // auto
  const p = parseHM(user.checkInTime);
  if (p) return fmtHM(p.h, p.mi);
  return assignAutoCheckInTime(user.id, cfg);
}
