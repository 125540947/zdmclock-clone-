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
