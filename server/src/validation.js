// 轻量输入校验（#188，零依赖）：集中约束字符串长度 / 数组大小 / 数值范围，
// 防止超大字段或数组撑爆 db.json 或触发拒绝服务。返回净化值，非法时抛 InputError（调用方转 HTTP 400）。
// 设计取舍：项目 VPS 部署为「源码直拉 + 重启」，无 npm install 环节；为避免新增运行时依赖，
// 这里用原生函数实现，而非引入 zod（如后续允许部署期 npm install，可平滑替换为 zod schema）。

export class InputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'InputError';
  }
}

// 关键上限常量（与 config 的 max* 系列呼应，集中此处便于一处调参）
export const MAX_COOKIE_LEN = 16384; // smzdm Cookie 字符串上限（防单账号字段撑爆 db）
export const MAX_IMPORT_ITEMS = 500; // 单次好价/文章导入条数上限（防超大数组拖垮合并）
export const MAX_NAME_LEN = 128; // 任务/账号展示名上限

export function limitStr(v, max, label = '字段') {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : String(v);
  if (s.length > max) throw new InputError('too_long', `${label}超过长度上限 ${max} 字符`);
  return s;
}

export function requireStr(v, max, label) {
  if (typeof v !== 'string' || !v.trim()) {
    throw new InputError('missing', `${label}必填且为字符串`);
  }
  return limitStr(v, max, label);
}

export function limitArr(v, max, label = '数组') {
  if (!Array.isArray(v)) throw new InputError('not_array', `${label}必须为数组`);
  if (v.length > max) throw new InputError('too_many', `${label}数量超过上限 ${max}`);
  return v;
}

// 把任意输入钳制到 [min,max] 整数区间；非有限数回退 fallback。
export function boundedInt(v, min, max, fallback = min) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
