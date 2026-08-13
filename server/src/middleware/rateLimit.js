// 零依赖的固定窗口速率限制中间件（P1-1 防爆破）。
// 不引入 express-rate-limit 等额外依赖，避免依赖漂移；满足本项目的极简/YAGNI 约定。
//
// 用法：
//   app.post('/api/auth/login', rateLimit({ windowMs: 60000, max: 10 }), loginHandler)
//   app.post('/api/users', rateLimit({ windowMs: 60000, max: 20 }), userHandler)
//
// 行为：
//   - 按 key（默认取网络层 req.ip，不可伪造）在 windowMs 内计数，超过 max 返回 429 + Retry-After。
//   - 仅对指定 HTTP 方法生效（默认 POST）。
//   - 限流状态存内存 Map，进程重启即清零（足够抵御在线爆破，无需分布式）。
//
// 安全约束：默认 key 一律使用 req.ip（套接字对端 IP），不依赖 getClientIp/X-Forwarded-For，
//   以免在 trustProxy=true 时攻击者伪造 XFF 绕过限流（与 P0-2 XFF 伪造同源隐患）。

export function rateLimit({
  windowMs = 60000,
  max = 20,
  methods = ['POST'],
  key = (req) => req.ip || 'unknown',
  message = '请求过于频繁，请稍后再试',
  // 容量上限（LRU）：Map 按访问顺序维护，超出时淘汰最久未访问的条目，
  // 防止 IPv6 / 多客户端场景下内存无限增长（P3-限流器 LRU）。
  maxEntries = 5000
} = {}) {
  const hits = new Map(); // key -> { count, resetAt }，按访问顺序（最近使用移到末尾）

  // 清理已过期条目（resetAt 已过期的桶直接丢弃，无需等待 LRU 淘汰）
  function evictExpired(now) {
    for (const [k, v] of hits) {
      if (v.resetAt <= now) hits.delete(k);
    }
  }

  function rateLimitMiddleware(req, res, next) {
    if (!methods.includes(req.method)) return next();
    const now = Date.now();
    const k = key(req);
    // LRU：访问即移到末尾（最近使用），淘汰时从首部删最久未访问
    let entry = hits.get(k);
    if (entry) {
      hits.delete(k);
      hits.set(k, entry);
    }
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(k, entry);
    }
    // 容量上限：先清过期，仍超限则淘汰最久未访问条目，保证内存有界
    if (hits.size > maxEntries) {
      evictExpired(now);
      while (hits.size > maxEntries) {
        const oldest = hits.keys().next().value;
        if (oldest === undefined) break;
        hits.delete(oldest);
      }
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(Math.max(1, retryAfter)));
      return res.status(429).json({
        error: 'rate_limited',
        message,
        retryAfter: Math.max(1, retryAfter)
      });
    }
    next();
  }
  // 测试钩子：暴露内部桶 Map，便于断言 LRU 容量上限行为（不影响运行时逻辑）
  rateLimitMiddleware._store = hits;
  return rateLimitMiddleware;
}
