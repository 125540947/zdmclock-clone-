import { Router } from 'express';
import { config } from '../config.js';
import { safeEqual } from '../auth.js';

const router = Router();

// 公开配置：前端据此决定是否走「前置代理自动登录」（无需弹密码框）。
router.get('/config', (req, res) => {
  res.json({
    openMode: config.openMode,
    trustProxyAuth: config.trustProxyAuth,
    proxyAuthHeader: !!config.proxyAuthHeader,
    requireAuth: config.requireAuth
  });
});

// 管理员登录：校验 ADMIN_USERNAME/ADMIN_PASSWORD，签发通用 API_TOKEN 与独立 adminToken。
// adminToken 用于「系统更新」等高危操作；未单独配置 ADMIN_TOKEN 时回落为 API_TOKEN（兼容性）。
// 前置代理已认证模式（TRUST_PROXY_AUTH=true）：不再校验 ADMIN_PASSWORD，login 自动放行并返回 token；
// 若同时配置了 PROXY_AUTH_HEADER，则要求该注入头存在才放行（否则 401，防止前置失效时裸奔）。
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  // 开放模式（OPEN_MODE）：彻底免登录，login 直接返回合法 token，前端可自动注入后正常调用所有接口。
  if (config.openMode) {
    return res.json({
      token: config.apiToken,
      adminToken: config.adminToken || config.apiToken,
      username: username || 'open'
    });
  }
  if (config.trustProxyAuth) {
    if (config.proxyAuthHeader) {
      const h = req.headers[String(config.proxyAuthHeader).toLowerCase()];
      if (!h) {
        return res.status(401).json({ error: 'proxy_unauthenticated', message: '前置代理未认证，拒绝放行' });
      }
    }
    return res.json({
      token: config.apiToken,
      adminToken: config.adminToken || config.apiToken,
      username: username || 'proxy'
    });
  }
  if (
    safeEqual(username, config.adminUsername) &&
    safeEqual(password, config.adminPassword)
  ) {
    return res.json({
      token: config.apiToken,
      adminToken: config.adminToken || config.apiToken,
      username
    });
  }
  res.status(401).json({ error: 'invalid_credentials', message: '账号或密码错误' });
});

export default router;
