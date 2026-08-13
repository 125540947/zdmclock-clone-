// Cookie 健康检测（best-effort，不阻塞主业务）
//
// 为何需要：签到/任务依赖 smzdm Cookie，Cookie 失效后任务只会静默标 error，
// 用户难以及时发现。本模块定时（或手动）探测每个账号 Cookie 是否有效，
// 失效时通过 onExpired 回调（由调用方接 notifier 推送）告警，
// 并就地更新 db.users[i].cookieExpired，供前端展示「🍪 Cookie 失效」徽标。
//
// 判定口径：调用适配器 getUserInfo（mock 永远返回有效身份；real 走真实接口）。
//   - 返回带身份字段（smzdmId/nickname/points/level/avatar 任一）→ 有效
//   - 抛错（网络/超时/401 重定向到登录）→ 视为失效，仅 best-effort
//   - 未抛错但身份为空 → 视为失效（Cookie 被踢线/过期）
// 注：单次瞬时网络抖动可能导致误报，故 checkCookie 默认重试 1 次（800ms）以吸收抖动；
// 即便误标，下一轮检测成功会自动自愈（cookieExpired 清零），且 onExpired 仅在「有效→失效」
// 迁移时触发一次，不会重复刷屏。

// 校验单个 Cookie 是否有效。adapter 必须提供 getUserInfo（与 smzdm 适配器接口一致）。
// 返回 { valid, degraded, reason, info }：
//   - valid:true：身份有效
//   - valid:false && degraded:false：真实登录失效（返回空身份 / 登录被踢）——应标记 cookieExpired
//   - valid:false && degraded:true：网络超时 / DNS / 限流 / 服务端 5xx 等异常，无法判定登录态
//     （H-08 修复：这类异常不得误判为 Cookie 失效，否则一次网络抖动会把全部账号误标并停止自动化）
export async function checkCookie(cookie, adapter, { retries = 1, retryDelayMs = 800 } = {}) {
  let lastErr = '请求失败';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const info = await adapter.getUserInfo(cookie);
      const ok = !!(
        info &&
        (info.smzdmId || info.nickname || info.points || info.level || info.avatar)
      );
      if (ok) return { valid: true, degraded: false, reason: '', info: info || {} };
      // 没抛错但身份为空：Cookie 很可能已真实失效
      return { valid: false, degraded: false, reason: '返回空身份（Cookie 可能已失效）', info: info || {} };
    } catch (e) {
      lastErr = e && e.message ? e.message : '请求失败';
      // M-01 修复：HTTP 401 是明确的登录态失效（被踢线 / Cookie 过期），应归类为真实失效而非网络异常。
      // 即便带重试也必然再次 401，故立即按真实失效处理（degraded:false），使 checkAccounts 将其标记
      // 为 cookieExpired 并停止用失效 Cookie 继续自动化；不进入重试以免延迟判定。
      if (/^HTTP 401\b/.test(lastErr)) {
        return { valid: false, degraded: false, reason: lastErr, info: {} };
      }
      if (attempt < retries) await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  // 全部尝试均抛错（网络超时 / DNS / 限流 / 服务端 5xx 等）：无法判定登录态。
  // H-08 修复：返回 degraded，调用方应保留既有 cookieExpired 状态，而非误标为失效。
  return { valid: false, degraded: true, reason: lastErr, info: {} };
}

// M-06 修复：有界并发池。健康检查对每账号发起一次外部请求，账号数默认上限 500、可配到 100000，
// 若一次性全部 Promise.all 会同时建立数百~数万个对外 socket，瞬间打满 FD / 内存 / 触发 smzdm 限流。
// 故以固定并发上限分批执行：单轮在途 worker 数恒 ≤ concurrency，结果与入参顺序一致。
// 空数组直接返回 []；concurrency 越界（<1 或 >n）会被钳到 [1, n]。
async function mapWithConcurrency(items, concurrency, worker) {
  const n = items.length;
  const results = new Array(n);
  if (n === 0) return results;
  let cursor = 0;
  async function drain() {
    // cursor++ 在单次同步调用内完成取号与自增，多 worker 间不会重复取号
    while (cursor < n) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }
  const cap = Math.max(1, Math.min(concurrency, n));
  await Promise.all(Array.from({ length: cap }, () => drain()));
  return results;
}

// 默认并发上限（调用方未显式传 concurrency 时使用）；生产建议经 config.healthConcurrency 注入
const DEFAULT_HEALTH_CONCURRENCY = 10;

// 批量检测所有账号 Cookie。返回结果数组，并就地更新 db.users[i].cookieExpired。
// onExpired(user, reason) 仅在「从有效→真实失效（非网络异常）」状态迁移时触发一次，便于推送告警（去重）。
// concurrency：单轮在途检测数上限（M-06）；未传则回落到 DEFAULT_HEALTH_CONCURRENCY。
// H-08 修复：
//   - 并行检测（批内 Promise.all）而非串行：默认 500 账号 × 单请求 10s 超时下，串行可持续数小时，
//     并行后单轮耗时约等于「批次耗时」× 批数，避免健康检查长时间阻塞自动化。
//   - 仅「真实登录失效（degraded=false）」才翻转 cookieExpired；网络类异常（degraded=true）保留既有状态，
//     杜绝一次外部网络故障把全部账号误标为失效并停止自动化（最长持续到下一次成功检测）。
export async function checkAccounts(db, adapter, { onExpired, concurrency } = {}) {
  const users = db.users || [];
  // concurrency 未传（undefined）时回落默认；显式传 0/负数会被 Math.max 钳到 1（串行），
  // 不能用 `||` 否则 0 会被误当「未传」而跳到默认并发。
  const cap = Math.max(1, concurrency == null ? DEFAULT_HEALTH_CONCURRENCY : concurrency);
  const worker = async (u) => {
    const r = await checkCookie(u.cookie, adapter);
    r.id = u.id;
    r.nickname = u.nickname || '';
    const wasExpired = !!u.cookieExpired;
    // 仅真实失效（非网络异常）且为「有效→失效」迁移时推送告警一次（避免重复刷屏）。
    if (!r.valid && !r.degraded && !wasExpired && typeof onExpired === 'function') {
      try {
        await onExpired(u, r.reason);
      } catch {
        /* 通知失败不影响检测主流程 */
      }
    }
    // 仅真实失效翻转 cookieExpired；网络异常（degraded）保留既有状态（成功检测会自愈）。
    if (!r.degraded) u.cookieExpired = !r.valid;
    return r;
  };
  return mapWithConcurrency(users, cap, worker);
}

// 健康检查探测（#187）：并发检查各依赖，整体受 deadline 约束（AbortSignal.timeout）。
// 任一依赖慢/超时不会拖垮 /api/health（避免就绪探针超时导致实例被反复重启）。
// - db：调用方已完成 load()，这里仅校验结构可用（同步，瞬时）。
// - checks：调用方注入的额外依赖探测（如 real 模式探 smzdm 可达性）。
//   每项可为「函数」或「{ name, fn }」：函数签名为 async ({ signal }) => { name, ok, degraded? }，
//   其返回对象自带 name；若传入 { name, fn } 则 name 优先使用，确保超时（未能返回）时仍能定位是哪路依赖。
//   可接收 { signal } 自行响应截止；未响应的慢检查由外层 Promise.race 在 deadline 处中断为 degraded。
export async function probeHealth(db, { timeoutMs = 2000, checks = [] } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const abort = new Promise((_, reject) => {
    if (signal.aborted) return reject(new Error('timeout'));
    signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
  });
  // 归一化检查项：保留显式 name，缺省按序号，便于超时后定位
  const specs = (checks || []).map((c, i) => {
    if (typeof c === 'function') return { name: `check${i}`, fn: c };
    return { name: c && c.name ? c.name : `check${i}`, fn: c && (c.fn || c) };
  });
  const all = [
    { name: 'db', value: Promise.resolve({ name: 'db', ok: !!(db && Array.isArray(db.users) && Array.isArray(db.clockRecords)) }) },
    ...specs.map((s) => ({ name: s.name, value: Promise.resolve().then(() => s.fn({ signal })) }))
  ];
  const settled = await Promise.allSettled(all.map((a) => Promise.race([a.value, abort])));
  const details = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { name: all[i].name, ok: false, degraded: true, error: String(s.reason && s.reason.message || s.reason) }
  );
  const degraded = details.some((d) => d.degraded);
  const ok = !details.some((d) => !d.ok && !d.degraded);
  return { ok, degraded, details };
}
