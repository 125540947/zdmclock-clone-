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
import { assertPublicDns } from './dnsGuard.js';

// SSRF 防护：用户可控的 webhook（及 bark base）、任务自定义 endpoint / referer 都必须经过校验，
// 仅允许公网 http/https，拒绝回环 / 私有 / 链路本地地址，防止在 OPEN_MODE 下被匿名
// 配置 webhook=http://169.254.169.254/latest/meta-data/ 探测内网或读取云凭据。
export function isSafePushUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host === '[::1]') return false;
  // 任何 IPv6 字面量（含内嵌）一律拒绝（推送端点均为公网域名，安全优先）
  if (host.includes(':')) return false;
  // 私有 IPv4 段
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const p = m.slice(1, 5).map(Number);
    if (p.some((x) => x > 255)) return false;
    if (p[0] === 10) return false; // 10/8
    if (p[0] === 127) return false; // 127/8
    if (p[0] === 169 && p[1] === 254) return false; // 169.254/16 链路本地（云元数据）
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return false; // 172.16/12
    if (p[0] === 192 && p[1] === 168) return false; // 192.168/16
  }
  return true;
}

// 安全解析 JSON 响应体（容错）
function safeJson(text) {
  try {
    return JSON.parse(text || '');
  } catch {
    return {};
  }
}

// 推送响应体上限（字节）：固定可信渠道（serverchan/bark/telegram）直连 fetch 也须限制，
// 防止异常/受控上游返回超大响应占满内存（M-03 修复）。与 safePushFetch 中常量一致。
const MAX_PUSH_BODY = 2_000_000;

// M-07 修复：响应体大小超限专属错误。流式读取时一旦超限立即抛出，便于调用方按类型映射为
// 结构化错误（如 safePushFetch 返回 { error:'body_too_large' }），而非通用的 fetch_failed。
export class BodyTooLargeError extends Error {
  constructor(maxBytes) {
    super('响应体过大，已拒绝');
    this.name = 'BodyTooLargeError';
    this.maxBytes = maxBytes;
  }
}

// M-07 修复：流式读取响应体并「边读边钳制」大小，超过上限立即取消后续读取（不把整段响应载入内存）。
// 替代原先 `arrayBuffer()`/`text()` 后判断大小的写法——后者会先把完整响应缓冲到内存，仅影响"解析结果"，
// 无法限制下载与峰值内存（异常/受控上游仍能让进程在判定前分配完整大响应）。
// r：fetch 的 Response（或其兼容替身，须提供 .body.getReader()）。encoding 仅影响最终文本解码。
export async function readBodyCapped(r, { maxBytes = MAX_PUSH_BODY, encoding = 'utf8' } = {}) {
  if (!r.body || typeof r.body.getReader !== 'function') {
    // 无流式分身（非标准 Response）：退化为有限 arrayBuffer，但同样先判断上限再解码
    const buf = await r.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new BodyTooLargeError(maxBytes);
    return Buffer.from(buf).toString(encoding);
  }
  const reader = r.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        // 超限即取消后续下载并抛错，避免继续把超大响应缓冲进内存
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new BodyTooLargeError(maxBytes);
        }
        chunks.push(Buffer.from(value));
      }
    }
  } catch (e) {
    // 连接中断等读取异常：同样取消并释放底层流，再上抛（含超限错误）
    await reader.cancel().catch(() => {});
    throw e;
  }
  return Buffer.concat(chunks).toString(encoding);
}

// M-03 修复：直连 fetch（serverchan/bark/telegram 等固定可信域名）也限制响应体大小，
// 防止超大响应占内存（此前直接 r.json() 无上限，完全绕过限制）。
// M-07 修复：改用流式 readBodyCapped 边读边限，不再整段缓冲。
export async function readJsonCapped(r) {
  const text = await readBodyCapped(r, { maxBytes: MAX_PUSH_BODY });
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

// Phase 1（P0 严重#1/#2 修复）：Cookie 出口白名单。
// 用户的 smzdm 登录 Cookie（含 sess / __ckguid）属于高敏感凭据，只能发往 smzdm 自家域名。
// 此前统一出口 call() 仅用 isSafePushUrl（只挡内网、放行一切公网域名），匿名在 OPEN_MODE 下把
// 「自定义端点」配成自己的服务器即可通过 call() 把他人 Cookie 外泄。这里收紧为"仅 smzdm.com 及其子域"。
// allowedExact 用于放行 env 自定义基址（如自建反代域名）；其余公网域名一律拒绝。
export function isSafeSmzdmUrl(url, allowedExact = []) {
  if (typeof url !== 'string' || !url.trim()) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  // H-02 修复：Cookie 只应经 HTTPS 发送，禁止明文 http —— 否则 smzdm 登录凭据会在网络中明文传输。
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  // 拒 IP 字面量（IPv4 / IPv6 含 [::1]）与 localhost：Cookie 只应发往域名（便于审计与 TLS 校验）
  if (host === 'localhost') return false;
  if (host.includes(':')) return false; // 含冒号即 IPv6 字面量
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return false; // IPv4 字面量
  // 显式放行 env 自定义基址（调用方传入，形如 ['my-proxy.example.com']）
  if (Array.isArray(allowedExact) && allowedExact.some((h) => String(h).toLowerCase() === host)) return true;
  // 仅允 smzdm.com 及其子域
  return host === 'smzdm.com' || host.endsWith('.smzdm.com');
}

// #182 DNS 重绑定防护 + #102 推送 webhook/Bark SSRF 校验的落点：
// 对用户可控的出站 URL（webhook / bark 自定义 base），先经 isSafePushUrl 拒绝内网/回环/非公网，
// 再经 assertPublicDns 确认解析到的 IP 全部公开（防 DNS 重绑定把请求导到内网）。
// 固定公开域名（serverchan/telegram/默认 bark）不经过此路径（非用户可控主机，无需解析）。
// 返回 { ok, error?, message?, text?, status?, okStatus? }；ok=false 时调用方应放弃发送（绝不回退到裸 fetch）。
// H-03 修复：使用 redirect:'manual' 并拒绝任何 3xx 重定向（绝不跟随），防止受控 webhook 把推送
// 重定向到内网地址形成 SSRF；同时先经 assertPublicDns 拒绝 DNS 重绑定。
// M-03 修复：读取响应体并限制大小，防止异常/受控上游用超大响应撑爆内存。
export async function safePushFetch(url, init = {}) {
  if (!isSafePushUrl(url)) {
    return { ok: false, error: 'unsafe_url', message: `拒绝向非公网地址推送 @ ${url}` };
  }
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { ok: false, error: 'bad_url', message: `推送地址非法 @ ${url}` };
  }
  try {
    await assertPublicDns(host);
  } catch (e) {
    return { ok: false, error: 'dns_rebind', message: e && e.message ? e.message : 'DNS 校验失败' };
  }
  try {
    const r = await fetch(url, { ...init, redirect: 'manual' });
    // H-03：拒绝重定向（不跟随），避免被引向内网/云元数据地址
    if (r.status >= 300 && r.status < 400) {
      return { ok: false, error: 'redirect_not_allowed', message: `推送目标返回重定向，已拒绝跟随 @ ${url}` };
    }
    // M-03 / M-07：流式读取并「边读边限」大小，防止超大响应占满内存；超限映射为 body_too_large。
    let text;
    try {
      text = await readBodyCapped(r, { maxBytes: MAX_PUSH_BODY });
    } catch (e) {
      if (e instanceof BodyTooLargeError) {
        return { ok: false, error: 'body_too_large', message: '推送响应体过大，已拒绝' };
      }
      throw e;
    }
    return { ok: true, text, status: r.status, okStatus: r.ok };
  } catch (e) {
    const name = e && e.name;
    if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, error: 'timeout' };
    return { ok: false, error: 'fetch_failed', message: e && e.message ? e.message : 'unknown' };
  }
}

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
        const j = await readJsonCapped(r).catch(() => ({}));
        // Server酱 Turbo 返回 {code:0,...}；旧版返回 {errno:0}
        if (j.code === 0 || j.errno === 0) return { ok: true };
        return { ok: false, error: j.message || j.errmsg || `HTTP ${r.status}` };
      }
      case 'bark': {
        if (!settings.token) return { ok: false, error: 'missing_token' };
        const base = (settings.webhook || 'https://api.day.app').replace(/\/$/, '');
        const u = `${base}/${encodeURIComponent(settings.token)}/${encodeURIComponent(title_)}/${encodeURIComponent(body)}`;
        // 仅当用户显式配置了自定义 base（非默认 api.day.app）时才需经 safePushFetch 做 SSRF + DNS 校验；
        // 默认 base 为知名公开服务，直接发送。
        if (settings.webhook) {
          const guard = await safePushFetch(u, { signal });
          if (!guard.ok) return { ok: false, error: guard.error, message: guard.message };
          const j = safeJson(guard.text);
          if (j.code === 200 || j.message === 'success') return { ok: true };
          return { ok: false, error: j.message || `HTTP ${guard.status}` };
        }
        const r = await fetch(u, { signal });
        const j = await readJsonCapped(r).catch(() => ({}));
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
        const j = await readJsonCapped(r).catch(() => ({}));
        if (j.ok) return { ok: true };
        return { ok: false, error: j.description || `HTTP ${r.status}` };
      }
      case 'webhook': {
        if (!settings.webhook) return { ok: false, error: 'missing_webhook' };
        // 用户完全可控的 URL：必须经 safePushFetch（isSafePushUrl + DNS 重绑定校验）后才发送，
        // 防止 OPEN_MODE 匿名把 webhook 配成内网地址探测 / 读取云元数据（SSRF）。
        const guard = await safePushFetch(settings.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title_, message: body, text: `${title_}\n${body}` }),
          signal
        });
        if (!guard.ok) return { ok: false, error: guard.error, message: guard.message };
        if (guard.okStatus) return { ok: true };
        return { ok: false, error: `HTTP ${guard.status}` };
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
