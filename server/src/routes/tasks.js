import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load, persist, todayStr, withWriteLock } from '../store.js';
import { runTask } from '../taskRunner.js';
import { validateCron } from '../scheduler.js';
import { authRequired } from '../auth.js';
import { notify } from '../notifier.js';
import { CUSTOM_TYPES, CUSTOM_TASK_DEFS, TASK_TEMPLATES } from '../taskMatrix.js';

const router = Router();

// captures 目录：用户把抓包导出的 HAR / cURL 丢这里，跑 tools/importCapture.mjs 生成 detected.json
const CAPTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'captures');

// 任务列表（附带自定义端点任务的"已配置"标记，供前端显示待抓包徽标）
router.get('/', authRequired, (req, res) => {
  const db = load();
  const endpoints = (db.settings && db.settings.taskEndpoints) || {};
  const list = db.tasks.map((t) => ({
    ...t,
    configured: t.needsEndpoint ? !!endpoints[t.type] : true
  }));
  res.json({ list });
});

// 任务接口配置（抓包结果）读取：返回已配置端点 + 自定义任务元数据 + 推荐模板
router.get('/endpoints', authRequired, (req, res) => {
  const db = load();
  res.json({
    endpoints: (db.settings && db.settings.taskEndpoints) || {},
    customTypes: CUSTOM_TASK_DEFS,
    templates: TASK_TEMPLATES
  });
});

// 推荐端点模板（社区逆向的真实形态），前端"加载推荐模板"用，免去记忆 URL
router.get('/templates', authRequired, (req, res) => {
  res.json({ templates: TASK_TEMPLATES });
});

// 保存某任务类型的接口配置（抓包得到的真实 URL/参数/资产字段映射）。
// endpoint 传空即清空（回到"待抓包"）。仅允许 CUSTOM_TYPES。
// 额外持久化 jsonp / robotToken / referer / headers / tokenField 等抓包接口特有标志。
router.put('/endpoints', authRequired, async (req, res) => {
  const db = load();
  const { type, endpoint, method, body, assetFields, note, jsonp, robotToken, referer, headers, tokenField } = req.body || {};
  if (!CUSTOM_TYPES.includes(type)) {
    return res.status(400).json({ error: 'invalid_type', message: '仅自定义端点任务可配置接口' });
  }
  if (!db.settings.taskEndpoints) db.settings.taskEndpoints = {};
  if (endpoint === '' || endpoint == null) {
    delete db.settings.taskEndpoints[type]; // 清空 → 待抓包
  } else {
    // 仅允许白名单键作为资产字段映射，避免任意字段污染账本
    const af = {};
    if (assetFields && typeof assetFields === 'object') {
      for (const k of ['gold', 'silver', 'exp', 'level', 'message']) {
        if (assetFields[k] != null && typeof assetFields[k] === 'string') af[k] = assetFields[k].slice(0, 80);
      }
    }
    const cfg = {
      endpoint: String(endpoint).slice(0, 2000),
      method: String(method || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST',
      body: body ?? null,
      assetFields: af,
      note: typeof note === 'string' ? note.slice(0, 500) : ''
    };
    if (jsonp) cfg.jsonp = true;
    if (robotToken) cfg.robotToken = true;
    if (tokenField && typeof tokenField === 'string') cfg.tokenField = tokenField.slice(0, 40);
    if (referer && typeof referer === 'string') cfg.referer = referer.slice(0, 500);
    if (headers && typeof headers === 'object') cfg.headers = headers;
    db.settings.taskEndpoints[type] = cfg;
  }
  await withWriteLock(() => persist());
  res.json({ ok: true, endpoints: db.settings.taskEndpoints });
});

// 扫描 captures 目录：读取 importCapture.mjs 生成的 detected.json（已识别的 smzdm 端点）
router.get('/captures', authRequired, (req, res) => {
  const file = path.join(CAPTURES_DIR, 'detected.json');
  if (!fs.existsSync(file)) return res.json({ items: [], hint: '未找到 detected.json，请先把抓包文件放入 captures/ 并运行 node tools/importCapture.mjs' });
  try {
    const items = JSON.parse(fs.readFileSync(file, 'utf-8'));
    res.json({ items: Array.isArray(items) ? items : [] });
  } catch {
    res.status(500).json({ error: 'parse_failed', message: 'detected.json 解析失败' });
  }
});

// 应用抓包结果：把用户在 UI 中选定/调整后的端点配置写入 db.settings.taskEndpoints
router.post('/captures/apply', authRequired, async (req, res) => {
  const db = load();
  const { items } = req.body || {};
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'empty', message: '没有可应用的抓包项' });
  }
  if (!db.settings.taskEndpoints) db.settings.taskEndpoints = {};
  let applied = 0;
  for (const it of items) {
    const type = it.type;
    if (!CUSTOM_TYPES.includes(type)) continue;
    const endpoint = (it.endpoint || '').toString().slice(0, 2000).trim();
    if (!endpoint) continue;
    const af = {};
    if (it.assetFields && typeof it.assetFields === 'object') {
      for (const k of ['gold', 'silver', 'exp', 'level', 'message']) {
        if (it.assetFields[k] != null && typeof it.assetFields[k] === 'string') af[k] = it.assetFields[k].slice(0, 80);
      }
    }
    const cfg = {
      endpoint,
      method: String(it.method || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST',
      body: it.body ?? null,
      assetFields: af,
      note: typeof it.note === 'string' ? it.note.slice(0, 500) : '抓包导入'
    };
    if (it.jsonp) cfg.jsonp = true;
    if (it.robotToken) cfg.robotToken = true;
    if (it.tokenField && typeof it.tokenField === 'string') cfg.tokenField = it.tokenField.slice(0, 40);
    if (it.referer && typeof it.referer === 'string') cfg.referer = it.referer.slice(0, 500);
    if (it.headers && typeof it.headers === 'object') cfg.headers = it.headers;
    db.settings.taskEndpoints[type] = cfg;
    applied += 1;
  }
  await withWriteLock(() => persist());
  res.json({ ok: true, applied, endpoints: db.settings.taskEndpoints });
});

// 更新任务（启用/停用/名称/cron）
router.put('/:id', authRequired, async (req, res) => {
  const db = load();
  const t = db.tasks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  const { enabled, cron, name, articleId, articleSource, source, autoPost, limit } = req.body || {};
  if (enabled !== undefined) t.enabled = enabled;
  if (cron !== undefined) {
    // b3：拒绝非法 cron，避免静默永不触发
    if (!validateCron(cron)) {
      return res.status(400).json({
        error: 'invalid_cron',
        message: 'cron 表达式非法（需 5 段：分 时 日 月 周，如 "0 9 * * *"）',
      });
    }
    t.cron = cron;
  }
  // 评论/收藏/点赞需要目标文章 ID（或文章链接）；允许为空字符串（运行时再校验）
  if (articleId !== undefined) {
    if (typeof articleId !== 'string' || articleId.length > 512) {
      return res.status(400).json({ error: 'invalid_article_id', message: 'articleId 需为不超过 512 字符的字符串' });
    }
    t.articleId = articleId.trim();
  }
  // 文章来源：manual（手填）| baoliao（从好价列表取）
  if (articleSource !== undefined) {
    if (!['manual', 'baoliao'].includes(articleSource)) {
      return res.status(400).json({ error: 'invalid_source', message: 'articleSource 仅支持 manual / baoliao' });
    }
    t.articleSource = articleSource;
  }
  // GPT 批量生成任务参数
  if (source !== undefined) {
    if (!['manual', 'baoliao'].includes(source)) {
      return res.status(400).json({ error: 'invalid_source', message: 'source 仅支持 manual / baoliao' });
    }
    t.source = source;
  }
  if (autoPost !== undefined) t.autoPost = !!autoPost;
  if (limit !== undefined) {
    const lim = Number(limit);
    // 兼容两类任务：GPT 批量生成（运行时再钳制到 10）与好价抓取（允许 1~50）
    if (!Number.isFinite(lim) || lim < 1 || lim > 50) {
      return res.status(400).json({ error: 'invalid_limit', message: 'limit 需为 1~50 的整数' });
    }
    t.limit = Math.floor(lim);
  }
  if (name !== undefined) t.name = name;
  await withWriteLock(() => persist());
  res.json(t);
});

// 手动执行任务（调用适配器；mock 直接返回成功）
router.post('/:id/run', authRequired, async (req, res) => {
  const db = load();
  const t = db.tasks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not_found' });
  const { userId, count, articleId, articleSource } = req.body || {};
  try {
    const r = await runTask(t, db, { userId, count, articleId, articleSource });
    if (!r.ok) {
      notify(db, { title: `❌ 任务失败 · ${t.name}`, message: r.message }).catch(() => {});
      return res.status(400).json({ error: r.error, message: r.message });
    }
    t.lastRun = todayStr();
    t.lastResult = r.result.message;
    t.status = 'done';
    persist();
    notify(db, { title: `✅ 任务完成 · ${t.name}`, message: r.result.message }).catch(() => {});
    res.json({ ok: true, result: r.result });
  } catch (e) {
    notify(db, { title: `❌ 任务异常 · ${t.name}`, message: e.message }).catch(() => {});
    t.lastResult = e.message;
    t.status = 'error';
    persist();
    res.status(502).json({ error: 'adapter_error', message: e.message });
  }
});

export default router;
