import { Router } from 'express';
import { load, persist, genId, mergeBaoliao, withWriteLock } from '../store.js';
import { smzdm } from '../smzdm/adapter.js';
import { config } from '../config.js';
import {
  authRequired,
  authRequiredOrQuery,
  mutationGuard,
  getClientIp,
  sameSegment,
  isAdminRequest
} from '../auth.js';
import { dbgLog } from '../log.js';
import { normalizeArticleId } from '../smzdm/articleId.js';

const router = Router();

// 列表（可选 ?userId= 过滤；不传则返回全部）
// 注意：读接口同样加 authRequired，保证 REQUIRE_AUTH=true 时不会泄露好价数据（与写接口一致）。
// 开放模式下（P1-2）：非管理员访客仅可见「同 /24 网段」录入的好价，与 users 列表策略一致，
// 避免匿名跨网段看到全部好价文本。
router.get('/', authRequired, (req, res) => {
  const db = load();
  const { userId } = req.query;
  let list = db.baoliao.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (userId) list = list.filter((x) => x.userId === userId);
  if (config.openMode && !isAdminRequest(req)) {
    const viewerIp = getClientIp(req);
    list = list.filter((x) => !x.recordedIp || sameSegment(viewerIp, x.recordedIp, 24));
  }
  res.json({ items: list, total: list.length });
});

// 从 smzdm 抓取好价并合并进爆料箱（real 适配器抓真实列表；mock 返回样例数据）
// 注意：必须定义在任何 /:id 路由之前，否则 "refresh" 会被当成 id 匹配。开放模式下强制管理员（mutationGuard）。
router.post('/refresh', mutationGuard, async (req, res) => {
  const db = load();
  const { limit } = req.body || {};
  const lim = Math.min(50, Math.max(1, Number(limit) || 20));
  try {
    dbgLog('[baoliao] refresh 开始：limit=', lim);
    const fetched = await smzdm.fetchBaoliao({ limit: lim });
    const items = (fetched && fetched.items) || [];
    dbgLog('[baoliao] refresh 完成：fetched=', items.length);
    if (!items.length) {
      return res.status(502).json({ error: 'no_items', message: '未抓取到好价（页面结构可能已变更或被风控）' });
    }
    let added = 0;
    await withWriteLock(() => {
      added = mergeBaoliao(items);
      persist();
    });
    res.json({ ok: true, fetched: items.length, added, total: db.baoliao.length });
  } catch (e) {
    dbgLog('[baoliao] refresh 失败：', e.message);
    res.status(502).json({ error: 'fetch_failed', message: '好价抓取失败，请稍后重试或查看服务端日志' });
  }
});

// 批量导入好价文章链接（浏览器导入入口；支持 ?token= 以便书签/同源页面调用）
// 背景：服务端直抓 smzdm 好价被反爬挡死（首页 202 挑战页 / 内部 JSON 接口要签名 / RSSHub 403），
// 故改为「数据从用户浏览器来」——用户在 smzdm 页用书签抓取链接，粘贴到 /baoliao-import 同源页面，
// 由本接口解析 /p/<id> 并合并进 db.baoliao，「从好价列表取」即可正常工作。
// 输入：{ text: "url1\nurl2" } 或 { items: [{url,title}] } 或裸字符串（空格/逗号/分号分隔）。
router.post('/bulk', authRequiredOrQuery, async (req, res) => {
  const db = load();
  const body = req.body || {};
  let raw = [];
  if (Array.isArray(body.items)) raw = body.items;
  else if (typeof body.text === 'string' && body.text.trim())
    raw = body.text.split(/[\s,;]+/).filter(Boolean).map((u) => ({ url: u }));
  else if (typeof body === 'string' && body.trim())
    raw = body.split(/[\s,;]+/).filter(Boolean).map((u) => ({ url: u }));
  const defaultChannelId = typeof body.channelId === 'string' && body.channelId.trim() ? body.channelId.trim().slice(0, 20) : '';
  const items = [];
  for (const it of raw) {
    const url = typeof it === 'string' ? it : String(it.url || it.smzdmUrl || '');
    const id = normalizeArticleId(url);
    if (!id) continue; // 跳过非 smzdm 文章链接
    const title = typeof it === 'object' && it.title ? String(it.title).trim() : '';
    // 好价(Deal)贴的真实 channel_id 服务端无法稳定取到（article-api 对 Deal 返 104、www 被反爬），
    // 故由浏览器导入侧携带：每条可单独带 channelId，缺省时回退到本次导入的全局默认频道。
    const itemChannelId = typeof it === 'object' && it.channelId ? String(it.channelId).trim().slice(0, 20) : '';
    const full = `https://www.smzdm.com/p/${id}`;
    items.push({ url: full, smzdmUrl: full, title: title || `文章 ${id}`, content: title, channelId: itemChannelId || defaultChannelId });
  }
  if (!items.length) {
    return res.status(400).json({ error: 'no_valid', message: '没有解析到有效的 smzdm 文章链接（需包含 /p/<数字>）' });
  }
  let added = 0;
  await withWriteLock(() => {
    added = mergeBaoliao(items);
    persist();
  });
  res.json({ ok: true, received: items.length, added, total: db.baoliao.length });
});

// 新增爆料草稿
router.post('/', authRequired, async (req, res) => {
  const { title, url, price, cat, content, userId } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'invalid', message: '标题不能为空' });
  const db = load();
  const now = new Date().toISOString();
  const item = {
    id: genId('bl'),
    userId: userId || null,
    title: String(title).trim(),
    url: url ? String(url) : '',
    price: price ? String(price) : '',
    cat: cat ? String(cat) : '',
    content: content ? String(content) : '',
    status: 'draft', // draft | submitted | failed
    smzdmUrl: '',
    lastResult: '',
    createdAt: now,
    updatedAt: now
  };
  await withWriteLock(() => {
    db.baoliao.unshift(item);
    persist();
  });
  res.json({ ok: true, item });
});

// 更新（标题/价格/分类/状态等）
router.put('/:id', mutationGuard, async (req, res) => {
  const db = load();
  const item = db.baoliao.find((x) => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const { title, url, price, cat, content, status } = req.body || {};
  if (title !== undefined) item.title = String(title).trim();
  if (url !== undefined) item.url = String(url);
  if (price !== undefined) item.price = String(price);
  if (cat !== undefined) item.cat = String(cat);
  if (content !== undefined) item.content = String(content);
  if (status !== undefined) item.status = String(status);
  item.updatedAt = new Date().toISOString();
  await withWriteLock(() => {
    persist();
  });
  res.json({ ok: true, item });
});

// 删除
router.delete('/:id', mutationGuard, async (req, res) => {
  const db = load();
  const idx = db.baoliao.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  await withWriteLock(() => {
    db.baoliao.splice(idx, 1);
    persist();
  });
  res.json({ ok: true });
});

// 提交到 smzdm（调用适配器；mock 直接返回成功）
// 真实动作类接口：开放模式下强制管理员（mutationGuard），避免匿名用任意 cookie 提交爆料（IDOR）。
router.post('/:id/submit', mutationGuard, async (req, res) => {
  const db = load();
  const item = db.baoliao.find((x) => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const { userId } = req.body || {};
  const user = userId ? db.users.find((u) => u.id === userId) : db.users[0];
  if (!user || !user.cookie) {
    item.status = 'failed';
    item.lastResult = '请先添加 smzdm 账号并录入 Cookie';
    item.updatedAt = new Date().toISOString();
    await withWriteLock(() => persist());
    return res.status(400).json({ error: 'no_user', message: '请先添加 smzdm 账号' });
  }
  try {
    const r = await smzdm.submitBaoliao(user.cookie, {
      title: item.title,
      url: item.url,
      price: item.price,
      cat: item.cat,
      content: item.content
    });
    item.status = 'submitted';
    item.smzdmUrl = r.url || '';
    item.lastResult = r.message || '提交成功';
    item.submittedAt = new Date().toISOString();
    item.updatedAt = item.submittedAt;
    await withWriteLock(() => persist());
    res.json({ ok: true, result: r, item });
  } catch (e) {
    item.status = 'failed';
    item.lastResult = e.message;
    item.updatedAt = new Date().toISOString();
    await withWriteLock(() => persist());
    dbgLog('[baoliao] 任务执行异常：', e.message);
    res.status(502).json({ error: 'adapter_error', message: '任务执行异常，请稍后重试' });
  }
});

export default router;
