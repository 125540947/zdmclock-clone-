import { Router } from 'express';
import { config } from '../config.js';
import { safeEqual } from '../auth.js';

const router = Router();

// 管理员登录：校验 ADMIN_USERNAME/ADMIN_PASSWORD，签发 API_TOKEN
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (
    safeEqual(username, config.adminUsername) &&
    safeEqual(password, config.adminPassword)
  ) {
    return res.json({ token: config.apiToken, username });
  }
  res.status(401).json({ error: 'invalid_credentials', message: '账号或密码错误' });
});

export default router;
