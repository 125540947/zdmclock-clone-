import { Router } from 'express';
import { load, persistAwait, withWriteLock } from '../store.js';
import { authRequired, mutationGuard } from '../auth.js';
import { generateReply, resolveGptProvider } from '../gptAdapter.js';
import { wrapAsync } from '../wrapAsync.js';
import { sendError } from '../httpError.js';

const router = Router();

const TONES = ['friendly', 'pro', 'humor'];
const TARGETS = ['comment', 'message', 'all'];
const MAX_KEY_LENGTH = 4096;

function publicConfig(gpt = {}) {
  const provider = resolveGptProvider(gpt);
  return {
    enabled: !!gpt.enabled,
    target: TARGETS.includes(gpt.target) ? gpt.target : 'comment',
    tone: TONES.includes(gpt.tone) ? gpt.tone : 'friendly',
    prompt: typeof gpt.prompt === 'string' ? gpt.prompt : '',
    apiBase: provider.apiBase,
    model: provider.model,
    configured: provider.configured,
    hasApiKey: provider.configured,
    hasSavedApiKey: provider.keySource === 'saved',
    keySource: provider.keySource
  };
}

function normalizeApiBase(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase());
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

// 服务端是否已有可用密钥（页面保存或 .env），不回传密钥本身。
router.get('/status', authRequired, (req, res) => {
  const provider = resolveGptProvider(load().settings.gpt);
  res.json({ configured: provider.configured, keySource: provider.keySource });
});

// 读取可公开的 GPT 配置。apiKey 永远不进入响应体。
router.get('/config', authRequired, (req, res) => {
  res.json({ config: publicConfig(load().settings.gpt) });
});

// 保存 GPT 行为与服务配置。空密钥表示“保持原值”，clearApiKey=true 才会删除页面保存的密钥。
router.put('/config', mutationGuard, wrapAsync(async (req, res) => {
  const db = load();
  const { enabled, target, tone, prompt, apiKey, apiBase, model, clearApiKey } = req.body || {};
  const gpt = db.settings.gpt;

  if (target !== undefined && !TARGETS.includes(target)) {
    return res.status(400).json({ error: 'invalid_target', message: '回复对象无效' });
  }
  if (tone !== undefined && !TONES.includes(tone)) {
    return res.status(400).json({ error: 'invalid_tone', message: '回复语气无效' });
  }
  if (prompt !== undefined && (typeof prompt !== 'string' || prompt.length > 2000)) {
    return res.status(400).json({ error: 'invalid_prompt', message: '提示词需为不超过 2000 字符的字符串' });
  }
  if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > MAX_KEY_LENGTH || /[\r\n]/.test(apiKey))) {
    return res.status(400).json({ error: 'invalid_api_key', message: 'API 密钥格式无效' });
  }
  const normalizedBase = apiBase === undefined ? undefined : normalizeApiBase(apiBase);
  if (apiBase !== undefined && normalizedBase === null) {
    return res.status(400).json({
      error: 'invalid_api_base',
      message: '接口地址需为 HTTPS；本机模型可使用 http://127.0.0.1 或 http://localhost'
    });
  }
  if (model !== undefined && (typeof model !== 'string' || !model.trim() || model.length > 160 || /[\r\n]/.test(model))) {
    return res.status(400).json({ error: 'invalid_model', message: '模型名称格式无效' });
  }

  await withWriteLock(() => {
    if (enabled !== undefined) gpt.enabled = !!enabled;
    if (target !== undefined) gpt.target = target;
    if (tone !== undefined) gpt.tone = tone;
    if (prompt !== undefined) gpt.prompt = prompt;
    if (normalizedBase !== undefined) gpt.apiBase = normalizedBase;
    if (model !== undefined) gpt.model = model.trim();
    if (clearApiKey === true) gpt.apiKey = '';
    else if (typeof apiKey === 'string' && apiKey.trim()) gpt.apiKey = apiKey.trim();
    return persistAwait();
  });
  res.json({ config: publicConfig(gpt) });
}));

router.get('/drafts', authRequired, (req, res) => {
  const db = load();
  const list = Array.isArray(db.gptDrafts) ? db.gptDrafts.slice(0, 100) : [];
  res.json({ items: list, total: list.length });
});

router.delete('/drafts/:id', mutationGuard, wrapAsync(async (req, res) => {
  const db = load();
  const idx = (db.gptDrafts || []).findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  db.gptDrafts.splice(idx, 1);
  await withWriteLock(() => persistAwait());
  res.json({ ok: true });
}));

// 生成一条测试回复。该操作会真实消耗模型额度，因此沿用写操作鉴权。
router.post('/reply', mutationGuard, wrapAsync(async (req, res) => {
  const db = load();
  if (!db.settings.gpt.enabled) {
    return res.status(400).json({ error: 'gpt_disabled', message: '请先启用 AI 回复' });
  }
  const provider = resolveGptProvider(db.settings.gpt);
  if (!provider.configured) {
    return res.status(400).json({ error: 'gpt_not_configured', message: '请先填写并保存 API 密钥' });
  }
  const { text } = req.body || {};
  try {
    const reply = await generateReply({
      text,
      tone: db.settings.gpt.tone,
      prompt: db.settings.gpt.prompt,
      provider: db.settings.gpt
    });
    res.json({ ok: true, reply });
  } catch (e) {
    sendError(res, { status: 502, error: 'gpt_error', message: e.message });
  }
}));

export default router;
