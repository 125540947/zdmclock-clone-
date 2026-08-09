import { Router } from 'express';
import { load, persist, withWriteLock } from '../store.js';
import { authRequired, mutationGuard } from '../auth.js';
import { generateReply } from '../gptAdapter.js';
import { config } from '../config.js';

const router = Router();

const TONES = ['friendly', 'pro', 'humor'];
const TARGETS = ['comment', 'message', 'all'];

// 服务端是否配置了 GPT（供前端提示）
router.get('/status', authRequired, (req, res) => {
  res.json({ configured: config.gptEnabled });
});

// 读取 GPT 配置（开关 + 提示词），前端据此渲染
router.get('/config', authRequired, (req, res) => {
  const db = load();
  res.json({ config: db.settings.gpt });
});

// 保存 GPT 配置（前端开关与提示词持久化到后端，不再仅是 localStorage）。
// 配置类写操作：开放模式下强制管理员（mutationGuard）。
router.put('/config', mutationGuard, async (req, res) => {
  const db = load();
  const { enabled, target, tone, prompt } = req.body || {};
  const gpt = db.settings.gpt;
  if (enabled !== undefined) gpt.enabled = !!enabled;
  if (target !== undefined) {
    if (!TARGETS.includes(target)) return res.status(400).json({ error: 'invalid_target' });
    gpt.target = target;
  }
  if (tone !== undefined) {
    if (!TONES.includes(tone)) return res.status(400).json({ error: 'invalid_tone' });
    gpt.tone = tone;
  }
  if (prompt !== undefined) {
    if (typeof prompt !== 'string' || prompt.length > 2000) {
      return res.status(400).json({ error: 'invalid_prompt', message: '提示词需为不超过 2000 字符的字符串' });
    }
    gpt.prompt = prompt;
  }
  await withWriteLock(() => persist());
  res.json({ config: gpt });
});

// GPT 批量生成产生的草稿列表（前端「AI 评论草稿」展示 / 复制 / 删除）
router.get('/drafts', authRequired, (req, res) => {
  const db = load();
  const list = Array.isArray(db.gptDrafts) ? db.gptDrafts.slice(0, 100) : [];
  res.json({ items: list, total: list.length });
});

router.delete('/drafts/:id', mutationGuard, async (req, res) => {
  const db = load();
  const idx = (db.gptDrafts || []).findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  db.gptDrafts.splice(idx, 1);
  await withWriteLock(() => persist());
  res.json({ ok: true });
});

// 生成一条回复（真实调用大模型）。需：①服务端已配置 GPT_API_KEY；②前端已启用自动回复
router.post('/reply', authRequired, async (req, res) => {
  const db = load();
  if (!db.settings.gpt.enabled) {
    return res.status(400).json({ error: 'gpt_disabled', message: '请先在 GPT 自动回复页启用自动回复' });
  }
  if (!config.gptEnabled) {
    return res.status(400).json({ error: 'gpt_not_configured', message: '服务端未配置 GPT_API_KEY，无法调用大模型' });
  }
  const { text } = req.body || {};
  try {
    const reply = await generateReply({
      text,
      tone: db.settings.gpt.tone,
      prompt: db.settings.gpt.prompt
    });
    res.json({ ok: true, reply });
  } catch (e) {
    res.status(502).json({ error: 'gpt_error', message: e.message });
  }
});

export default router;
