import { Router } from 'express';
import { config } from '../config.js';
import { safeEqual } from '../auth.js';

const router = Router();

// 管理员登录：校验 ADMIN_USERNAME/ADMIN_PASSWORD，签发通用 API_TOKEN 与独立 adminToken。
// adminToken 用于「系统更新」等高危操作；未单独配置 ADMIN_TOKEN 时回落为 API_TOKEN（兼容性）。
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
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
