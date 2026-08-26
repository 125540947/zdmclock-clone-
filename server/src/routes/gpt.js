import { Router } from 'express';
import { load, persistAwait, withWriteLock } from '../store.js';
import { authRequired, mutationGuard } from '../auth.js';
import { generateReply } from '../gptAdapter.js';
import { config } from '../config.js';
import { wrapAsync } from '../wrapAsync.js';

const router = Router();

const TONES = ['friendly', 'pro', 'humor'];
const TARGETS = ['comment', 'message', 'all'];

// 鏈嶅姟绔槸鍚﹂厤缃簡 GPT锛堜緵鍓嶇鎻愮ず锛?
router.get('/status', authRequired, (req, res) => {
  res.json({ configured: config.gptEnabled });
});

// 璇诲彇 GPT 閰嶇疆锛堝紑鍏? + 鎻愮ず璇嶏級锛屽墠绔嵁姝ゆ覆鏌?
router.get('/config', authRequired, (req, res) => {
  const db = load();
  res.json({ config: db.settings.gpt });
});

// 淇濆瓨 GPT 閰嶇疆锛堝墠绔紑鍏充笌鎻愮ず璇嶆寔涔呭寲鍒板悗绔紝涓嶅啀浠呮槸 localStorage锛夈€?
// 閰嶇疆绫诲啓鎿嶄綔锛氬紑鏀炬ā寮忎笅寮哄埗绠＄悊鍛橈紙mutationGuard锛夈€?
router.put('/config', mutationGuard, wrapAsync(async (req, res) => {
  const db = load();
  const { enabled, target, tone, prompt } = req.body || {};
  const gpt = db.settings.gpt;
  // M-04 淇锛氬厛鏍￠獙鍏ㄩ儴杈撳叆锛屾牎楠屽け璐ョ洿鎺? 400锛屼笉鏀瑰姩鍐呭瓨锛堟鍓? enabled/target 绛変細鍏堣鏀广€?400 鍚庣暀 partial state锛?
  if (target !== undefined && !TARGETS.includes(target)) {
    return res.status(400).json({ error: 'invalid_target' });
  }
  if (tone !== undefined && !TONES.includes(tone)) {
    return res.status(400).json({ error: 'invalid_tone' });
  }
  if (prompt !== undefined && (typeof prompt !== 'string' || prompt.length > 2000)) {
    return res.status(400).json({ error: 'invalid_prompt', message: '鎻愮ず璇嶉渶涓轰笉瓒呰繃 2000 瀛楃鐨勫瓧绗︿覆' });
  }
  // M-04锛氬湪鍐欓攣鍐呬竴娆℃€у簲鐢ㄥ叏閮ㄤ慨鏀瑰苟钀界洏锛圡-05锛歱ersistAwait 鐪熷疄钀界洏鍚庢墠杩斿洖锛?
  await withWriteLock(() => {
    if (enabled !== undefined) gpt.enabled = !!enabled;
    if (target !== undefined) gpt.target = target;
    if (tone !== undefined) gpt.tone = tone;
    if (prompt !== undefined) gpt.prompt = prompt;
    return persistAwait();
  });
  res.json({ config: gpt });
}));

// GPT 鎵归噺鐢熸垚浜х敓鐨勮崏绋垮垪琛紙鍓嶇銆孉I 璇勮鑽夌ǹ銆嶅睍绀? / 澶嶅埗 / 鍒犻櫎锛?
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

// 鐢熸垚涓€鏉″洖澶嶏紙鐪熷疄璋冪敤澶фā鍨嬶紝娑堣€楁湇鍔＄閰嶇疆鐨勬ā鍨嬮搴︼級銆?
// H-01 淇锛氭敼涓? mutationGuard鈥斺€旂敓鎴愬洖澶嶅睘鐪熷疄澶栭儴鍔ㄤ綔锛堟秷鑰? API 璐圭敤锛夛紝寮€鏀炬ā寮忎笅鍖垮悕涓嶅緱璋冪敤锛?
// 鍚﹀垯浠绘剰璁垮鍙€楀敖鏈嶅姟绔ā鍨嬮搴︺€傞潪寮€鏀炬ā寮忥紙榛樿 REQUIRE_AUTH=true锛変笅绛変环浜? authRequired銆?
router.post('/reply', mutationGuard, wrapAsync(async (req, res) => {
  const db = load();
  if (!db.settings.gpt.enabled) {
    return res.status(400).json({ error: 'gpt_disabled', message: '璇峰厛鍦? GPT 鑷姩鍥炲椤靛惎鐢ㄨ嚜鍔ㄥ洖澶?' });
  }
  if (!config.gptEnabled) {
    return res.status(400).json({ error: 'gpt_not_configured', message: '鏈嶅姟绔湭閰嶇疆 GPT_API_KEY锛屾棤娉曡皟鐢ㄥぇ妯″瀷' });
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
}));

export default router;
