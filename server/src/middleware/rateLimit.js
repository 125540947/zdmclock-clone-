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
  message = '请求过于频繁，请稍后再试'
} = {}) {
  const hits = new Map(); // key -> { count, resetAt }

  function cleanup(now) {
    for (const [k, v] of hits) {
      if (v.resetAt <= now) hits.delete(k);
    }
  }

  return function rateLimitMiddleware(req, res, next) {
    if (!methods.includes(req.method)) return next();
    const now = Date.now();
    const k = key(req);
    let entry = hits.get(k);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(k, entry);
    }
    // 周期性清理过期条目，避免 Map 无界增长
    if (hits.size > 1000) cleanup(now);
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
  };
}
