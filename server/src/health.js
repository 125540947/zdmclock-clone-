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
export async function checkCookie(cookie, adapter, { retries = 1, retryDelayMs = 800 } = {}) {
  let lastErr = '请求失败';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const info = await adapter.getUserInfo(cookie);
      const ok = !!(
        info &&
        (info.smzdmId || info.nickname || info.points || info.level || info.avatar)
      );
      if (ok) return { valid: true, reason: '', info: info || {} };
      // 没抛错但身份为空：Cookie 很可能已失效
      return { valid: false, reason: '返回空身份（Cookie 可能已失效）', info: info || {} };
    } catch (e) {
      lastErr = e && e.message ? e.message : '请求失败';
      if (attempt < retries) await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
  return { valid: false, reason: lastErr, info: {} };
}

// 批量检测所有账号 Cookie。返回结果数组，并就地更新 db.users[i].cookieExpired。
// onExpired(user, reason) 仅在「从有效→失效」状态迁移时触发一次，便于推送告警（去重，避免重复刷屏）。
export async function checkAccounts(db, adapter, { onExpired } = {}) {
  const results = [];
  for (const u of db.users) {
    const r = await checkCookie(u.cookie, adapter);
    r.id = u.id;
    r.nickname = u.nickname || '';
    const wasExpired = !!u.cookieExpired;
    if (!r.valid && !wasExpired && typeof onExpired === 'function') {
      try {
        await onExpired(u, r.reason);
      } catch {
        /* 通知失败不影响检测主流程 */
      }
    }
    // 成功时若此前已失效则自愈清零；失败后标 true（含瞬时失败，靠重试+下一轮自愈兜底）
    u.cookieExpired = !r.valid;
    results.push(r);
  }
  return results;
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
