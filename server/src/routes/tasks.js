import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load, persist, todayStr, withWriteLock } from '../store.js';
import { config } from '../config.js';
import { dbgLog } from '../log.js';
import { runTask } from '../taskRunner.js';
import { validateCron } from '../scheduler.js';
import { authRequired, mutationGuard } from '../auth.js';
import { notify, isSafePushUrl } from '../notifier.js';
import { CUSTOM_TYPES, CUSTOM_TASK_DEFS, TASK_TEMPLATES, REAL_STRATEGY_TYPES } from '../taskMatrix.js';

const router = Router();

// captures 目录：用户把抓包导出的 HAR / cURL 丢这里，跑 tools/importCapture.mjs 生成 detected.json
const CAPTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'captures');

// 任务列表（附带自定义端点任务的"已配置"标记，供前端显示待抓包徽标）
router.get('/', authRequired, (req, res) => {
  const db = load();
  const endpoints = (db.settings && db.settings.taskEndpoints) || {};
  const list = db.tasks.map((t) => {
    let configured = true;
    if (t.needsEndpoint) {
      if (REAL_STRATEGY_TYPES.has(t.type)) {
        // 内置真实任务分两类：
        //  - 自动获取动态参数的（turntable/lottery/crowdtest/dailyTasks）：无需手填，一律视为已就绪；
        //  - 需用户填目标参数的（follow 需 target、share 需 articleId）：须在已存 params 非空时才就绪。
        const AUTO_TYPES = new Set(['turntable', 'lottery', 'crowdtest', 'dailyTasks']);
        if (AUTO_TYPES.has(t.type)) {
          configured = true;
        } else {
          const p = endpoints[t.type] && endpoints[t.type].params;
          configured = !!(p && Object.keys(p).length);
        }
      } else {
        configured = !!endpoints[t.type];
      }
    }
    return { ...t, configured, builtin: !!t.builtin };
  });
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
// endpoint 传空即清空（回到"待抓包"），但内置真实任务（REAL_STRATEGY_TYPES）允许仅存 params。
// 仅允许 CUSTOM_TYPES。额外持久化 jsonp / robotToken / referer / headers / tokenField / params。
router.put('/endpoints', mutationGuard, async (req, res) => {
  const db = load();
  const { type, endpoint, method, body, assetFields, note, jsonp, robotToken, referer, headers, tokenField, params } = req.body || {};
  if (!CUSTOM_TYPES.includes(type)) {
    return res.status(400).json({ error: 'invalid_type', message: '仅自定义端点任务可配置接口' });
  }
  if (!db.settings.taskEndpoints) db.settings.taskEndpoints = {};

  // 解析内置任务用的动态参数（active_id / crowd_id / topicUrl 等），支持 JSON 字符串或对象
  let parsedParams = undefined;
  if (params != null) {
    if (typeof params === 'string') {
      const trimmed = params.trim();
      if (trimmed) {
        try {
          parsedParams = JSON.parse(trimmed);
        } catch {
          return res.status(400).json({ error: 'invalid_params', message: 'params 不是合法 JSON' });
        }
      }
    } else if (typeof params === 'object' && !Array.isArray(params)) {
      parsedParams = params;
    } else {
      return res.status(400).json({ error: 'invalid_params', message: 'params 需为 JSON 对象' });
    }
  }
  if (parsedParams && Object.keys(parsedParams).length > 12) {
    return res.status(400).json({ error: 'invalid_params', message: 'params 字段过多' });
  }

  const isReal = REAL_STRATEGY_TYPES.has(type);
  const epEmpty = endpoint === '' || endpoint == null;

  // SSRF 防护（P0-1）：endpoint / referer 必须为公网 http/https，拒绝内网/回环/链路本地，
  // 防止匿名在 OPEN_MODE 下配置端点探测内网或读取云元数据（169.254.169.254）。
  if (!epEmpty) {
    if (!isSafePushUrl(String(endpoint))) {
      return res.status(400).json({ error: 'unsafe_endpoint', message: 'endpoint 必须为公网 http/https 地址，禁止指向内网/回环/链路本地' });
    }
    if (referer && !isSafePushUrl(referer)) {
      return res.status(400).json({ error: 'unsafe_referer', message: 'referer 必须为公网 http/https 地址' });
    }
  }

  // 非内置类型必须提供 endpoint；内置类型允许仅存 params（运行时走内置 handler，无需 endpoint）
  if (epEmpty && !isReal) {
    delete db.settings.taskEndpoints[type];
    await withWriteLock(() => persist());
    return res.json({ ok: true, endpoints: db.settings.taskEndpoints });
  }

  const prev = db.settings.taskEndpoints[type] || {};
  if (epEmpty) {
    // 内置类型：仅更新 params，保留既有 endpoint（若有）
    db.settings.taskEndpoints[type] = { ...prev, params: parsedParams || prev.params || {} };
    await withWriteLock(() => persist());
    return res.json({ ok: true, endpoints: db.settings.taskEndpoints });
  }

  // 通用端点配置（含资产字段映射等）
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
    note: typeof note === 'string' ? note.slice(0, config.maxNoteLen) : ''
  };
  if (jsonp) cfg.jsonp = true;
  if (robotToken) cfg.robotToken = true;
  if (tokenField && typeof tokenField === 'string') cfg.tokenField = tokenField.slice(0, 40);
  if (referer && typeof referer === 'string') cfg.referer = referer.slice(0, config.maxNoteLen);
  if (headers && typeof headers === 'object') cfg.headers = headers;
  if (parsedParams) cfg.params = parsedParams;
  db.settings.taskEndpoints[type] = cfg;
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
// 注意：dailyTasks 等多步内置任务即使导入端点也会被内置策略覆盖（taskMatrix 强制走内置流程），
// 这类类型在此处跳过并明确告知，避免用户以为"导入失败"或产生无效配置。
router.post('/captures/apply', mutationGuard, async (req, res) => {
  let db;
  try {
    db = load();
  } catch (e) {
    dbgLog('[tasks] 读取数据库失败：', e.message);
    return res.status(500).json({ error: 'load_failed', message: '读取数据失败，请稍后重试' });
  }
  const { items } = req.body || {};
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'empty', message: '没有可应用的抓包项' });
  }
  if (!db.settings.taskEndpoints) db.settings.taskEndpoints = {};
  const skipped = [];
  let applied = 0;
  for (const it of items) {
    const type = it.type;
    if (!CUSTOM_TYPES.includes(type)) {
      skipped.push({ type, reason: '非自定义端点任务，已忽略' });
      continue;
    }
    // dailyTasks 为内置多步流程，导入单端点无效（运行时始终走内置 list_v2→activity_task_receive）
    if (type === 'dailyTasks') {
      skipped.push({ type, reason: '每日任务为内置任务，端点已内置、无需导入（已跳过）' });
      continue;
    }
    const endpoint = (it.endpoint || '').toString().slice(0, 2000).trim();
    if (endpoint && !isSafePushUrl(endpoint)) {
      skipped.push({ type, reason: '端点地址不安全（非公网），已跳过' });
      continue;
    }
    if (!endpoint) {
      skipped.push({ type, reason: '端点为空，已跳过' });
      continue;
    }
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
      note: typeof it.note === 'string' ? it.note.slice(0, config.maxNoteLen) : '抓包导入'
    };
    if (it.jsonp) cfg.jsonp = true;
    if (it.robotToken) cfg.robotToken = true;
    if (it.tokenField && typeof it.tokenField === 'string') cfg.tokenField = it.tokenField.slice(0, 40);
    if (it.referer && typeof it.referer === 'string') {
      const r = it.referer.slice(0, config.maxNoteLen);
      if (!isSafePushUrl(r)) {
        skipped.push({ type, reason: 'referer 地址不安全（非公网），已跳过' });
        continue;
      }
      cfg.referer = r;
    }
    if (it.headers && typeof it.headers === 'object') cfg.headers = it.headers;
    db.settings.taskEndpoints[type] = cfg;
    applied += 1;
  }
  if (applied === 0) {
    return res.status(400).json({
      error: 'nothing_applied',
      message: '没有可应用的抓包端点。说明：dailyTasks 为内置任务无需导入；请选择转盘/抽奖/关注/分享等类型再应用。',
      skipped
    });
  }
  try {
    await withWriteLock(() => persist());
  } catch (e) {
    dbgLog('[tasks] 保存失败：', e.message);
    return res.status(500).json({ error: 'persist_failed', message: '保存失败，请稍后重试' });
  }
  res.json({ ok: true, applied, skipped, endpoints: db.settings.taskEndpoints });
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
    await withWriteLock(() => persist());
    notify(db, { title: `✅ 任务完成 · ${t.name}`, message: r.result.message }).catch(() => {});
    res.json({ ok: true, result: r.result });
  } catch (e) {
    notify(db, { title: `❌ 任务异常 · ${t.name}`, message: e.message }).catch(() => {});
    t.lastResult = e.message;
    t.status = 'error';
    await withWriteLock(() => persist());
    dbgLog('[tasks] 任务执行异常：', e.message);
    res.status(502).json({ error: 'adapter_error', message: '任务执行异常，请稍后重试' });
  }
});

export default router;
