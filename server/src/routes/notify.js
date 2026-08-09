import { Router } from 'express';
import { load, persist, withWriteLock } from '../store.js';
import { sendPush, resolvePushSettings, isSafePushUrl } from '../notifier.js';
import { authRequired, mutationGuard } from '../auth.js';

const router = Router();
const CHANNELS = ['none', 'serverchan', 'bark', 'telegram', 'webhook'];

// 凭据遮罩（P1-1）：展示时仅回显长度，绝不暴露明文 token/webhook
function masked(v) {
  return v ? `已配置(${String(v).length}字符)` : '';
}

// 读取推送配置（P1-1：凭据遮罩，绝不回显明文 token/webhook）
router.get('/config', authRequired, (req, res) => {
  const db = load();
  const p = db.settings.push || {};
  res.json({
    enabled: !!p.enabled,
    channel: p.channel || 'serverchan',
    token: masked(p.token),
    chatId: masked(p.chatId),
    webhook: masked(p.webhook)
  });
});

// 保存推送配置（配置类写操作：开放模式下强制管理员 mutationGuard）。
// webhook 经 SSRF 校验（P0-2），拒绝回环/私有/链路本地地址。
router.put('/config', mutationGuard, async (req, res) => {
  const db = load();
  const { enabled, channel, token, chatId, webhook } = req.body || {};
  if (channel !== undefined && !CHANNELS.includes(channel)) {
    return res.status(400).json({
      error: 'invalid_channel',
      message: 'channel 仅支持 none/serverchan/bark/telegram/webhook'
    });
  }
  if (webhook !== undefined && webhook && !isSafePushUrl(webhook)) {
    return res.status(400).json({
      error: 'unsafe_webhook',
      message: 'webhook 地址不安全：仅允许公网 http/https，拒绝回环/私有/内网地址'
    });
  }
  const p = db.settings.push || (db.settings.push = {});
  if (enabled !== undefined) p.enabled = !!enabled;
  if (channel !== undefined) p.channel = channel;
  if (token !== undefined) p.token = String(token || '').slice(0, 512);
  if (chatId !== undefined) p.chatId = String(chatId || '').slice(0, 128);
  if (webhook !== undefined) p.webhook = String(webhook || '').slice(0, 2048);
  await withWriteLock(() => persist());
  res.json({ ok: true, config: { enabled: p.enabled, channel: p.channel, token: masked(p.token), chatId: masked(p.chatId), webhook: masked(p.webhook) } });
});

// 发送测试推送，验证配置是否正确（触发服务端请求：开放模式下强制管理员 mutationGuard，防 SSRF 滥用）
router.post('/test', mutationGuard, async (req, res) => {
  const db = load();
  const settings = resolvePushSettings(db);
  if (settings.channel === 'none') {
    return res.status(400).json({ error: 'no_channel', message: '请先选择推送渠道并保存' });
  }
  if (!settings.token && !settings.webhook && !settings.chatId) {
    return res.status(400).json({ error: 'not_configured', message: '推送未配置令牌 / Webhook' });
  }
  try {
    const r = await sendPush(settings, {
      title: 'zdmclock 推送测试',
      message: '如果你收到这条消息，说明推送配置正确 ✓'
    });
    if (r.ok) return res.json({ ok: true, message: '测试推送已发送，请查收' });
    return res.status(502).json({ error: 'push_failed', message: r.error });
  } catch (e) {
    return res.status(502).json({ error: 'push_error', message: e.message });
  }
});

export default router;
