// 统一调试日志封装：仅当 SMZDM_DEBUG=1 时输出，生产默认静默。
// 避免无条件 console.log 带来的噪音与潜在信息泄露（账号数、任务名、内部路径等）。
// 用法与 console.log 一致：dbgLog('[smzdm-debug] ...', arg1, arg2)。
export function dbgLog(...args) {
  if (process.env.SMZDM_DEBUG !== '1') return;
  console.log(...args);
}
