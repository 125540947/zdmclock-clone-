// 轻量推送通知模块（best-effort：失败绝不阻塞主业务流程）
//
// 支持渠道：
//   serverchan —— Server酱 Turbo（https://sct.ftqq.com），token 即 SendKey
//   bark       —— iOS 推送（https://api.day.app），token 即设备 Key
//   telegram   —— Telegram Bot，需 token + chatId
//   webhook    —— 自定义 Webhook（POST JSON），可用于企业微信/钉钉/任意系统
//
// 任何异常都被捕获并返回 { ok:false, error }，不会向外抛出，保证签到/任务主流程不受影响。

import { config } from './config.js';

// 从 db.settings.push 解析推送设置；db 中缺省字段回退到环境变量（便于纯 env 部署）
export function resolvePushSettings(db) {
  const p = (db && db.settings && db.settings.push) || {};
  const channel = p.channel || config.pushChannel || 'none';
  const token = p.token || config.pushToken || '';
  const chatId = p.chatId || config.pushChatId || '';
  const webhook = p.webhook || config.pushWebhook || '';
  return {
    // 启用判定：UI 显式开启，或 env 已配置渠道+凭据（开箱即用）
    enabled: !!p.enabled || (channel !== 'none' && !!(token || webhook || chatId)),
    channel,
    token,
    chatId,
    webhook
  };
}

// 发送单条推送。返回 { ok, error? }，不抛出。
export async function sendPush(settings, { title, message }) {
  if (!settings || settings.channel === 'none') return { ok: false, error: 'channel_none' };
  const title_ = String(title || 'zdmclock').slice(0, 80);
  const body = String(message || '').slice(0, 2000);
  const signal = AbortSignal.timeout(10000);
  try {
    switch (settings.channel) {
      case 'serverchan': {
        if (!settings.token) return { ok: false, error: 'missing_token' };
        const url = `https://sctapi.ftqq.com/${encodeURIComponent(settings.token)}.send`;
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ title: title_, desp: body }).toString(),
          signal
        });
        const j = await r.json().catch(() => ({}));
        // Server酱 Turbo 返回 {code:0,...}；旧版返回 {errno:0}
        if (j.code === 0 || j.errno === 0) return { ok: true };
        return { ok: false, error: j.message || j.errmsg || `HTTP ${r.status}` };
      }
      case 'bark': {
        if (!settings.token) return { ok: false, error: 'missing_token' };
        const base = (settings.webhook || 'https://api.day.app').replace(/\/$/, '');
        const u = `${base}/${encodeURIComponent(settings.token)}/${encodeURIComponent(title_)}/${encodeURIComponent(body)}`;
        const r = await fetch(u, { signal });
        const j = await r.json().catch(() => ({}));
        if (j.code === 200 || j.message === 'success') return { ok: true };
        return { ok: false, error: j.message || `HTTP ${r.status}` };
      }
      case 'telegram': {
        if (!settings.token || !settings.chatId) return { ok: false, error: 'missing_token_or_chat' };
        const u = `https://api.telegram.org/bot${settings.token}/sendMessage`;
        const r = await fetch(u, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: settings.chatId, text: `${title_}\n${body}` }),
          signal
        });
        const j = await r.json().catch(() => ({}));
        if (j.ok) return { ok: true };
        return { ok: false, error: j.description || `HTTP ${r.status}` };
      }
      case 'webhook': {
        if (!settings.webhook) return { ok: false, error: 'missing_webhook' };
        const r = await fetch(settings.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title_, message: body, text: `${title_}\n${body}` }),
          signal
        });
        if (r.ok) return { ok: true };
        return { ok: false, error: `HTTP ${r.status}` };
      }
      default:
        return { ok: false, error: 'unknown_channel' };
    }
  } catch (e) {
    const name = e && e.name;
    if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, error: 'timeout' };
    return { ok: false, error: e && e.message ? e.message : 'unknown' };
  }
}

// 便捷入口：从 db 解析配置并发送（各业务路由调用）。未启用/未配置时静默跳过。
export async function notify(db, payload) {
  const settings = resolvePushSettings(db);
  if (!settings.enabled || settings.channel === 'none') return { ok: false, skipped: true };
  return sendPush(settings, payload);
}
