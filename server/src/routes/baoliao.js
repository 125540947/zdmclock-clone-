import { Router } from 'express';
import { load, persist, genId, mergeBaoliao } from '../store.js';
import { smzdm } from '../smzdm/adapter.js';
import { authRequired } from '../auth.js';

const router = Router();

// 列表（可选 ?userId= 过滤；不传则返回全部）
router.get('/', (req, res) => {
  const db = load();
  const { userId } = req.query;
  let list = db.baoliao.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (userId) list = list.filter((x) => x.userId === userId);
  res.json({ items: list, total: list.length });
});

// 从 smzdm 抓取好价并合并进爆料箱（real 适配器抓真实列表；mock 返回样例数据）
// 注意：必须定义在任何 /:id 路由之前，否则 "refresh" 会被当成 id 匹配
router.post('/refresh', authRequired, async (req, res) => {
  const db = load();
  const { limit } = req.body || {};
  const lim = Math.min(50, Math.max(1, Number(limit) || 20));
  try {
    const fetched = await smzdm.fetchBaoliao({ limit: lim });
    const items = (fetched && fetched.items) || [];
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
    res.status(502).json({ error: 'fetch_failed', message: e.message });
  }
});

// 新增爆料草稿
router.post('/', authRequired, (req, res) => {
  const { title, url, price, cat, content, userId } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'invalid', message: '标题不能为空' });
  const db = load();
  const now = new Date().toISOString();
  const item = {
    id: genId('bl'),
    userId: userId || null,
    title: String(title).trim(),
    url: url || '',
    price: price || '',
    cat: cat || '',
    content: content || '',
    status: 'draft', // draft | submitted | failed
    smzdmUrl: '',
    lastResult: '',
    createdAt: now,
    updatedAt: now
  };
  db.baoliao.unshift(item);
  persist();
  res.json({ ok: true, item });
});

// 更新（标题/价格/分类/状态等）
router.put('/:id', authRequired, (req, res) => {
  const db = load();
  const item = db.baoliao.find((x) => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const { title, url, price, cat, content, status } = req.body || {};
  if (title !== undefined) item.title = String(title).trim();
  if (url !== undefined) item.url = url;
  if (price !== undefined) item.price = price;
  if (cat !== undefined) item.cat = cat;
  if (content !== undefined) item.content = content;
  if (status !== undefined) item.status = status;
  item.updatedAt = new Date().toISOString();
  persist();
  res.json({ ok: true, item });
});

// 删除
router.delete('/:id', authRequired, (req, res) => {
  const db = load();
  const idx = db.baoliao.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  db.baoliao.splice(idx, 1);
  persist();
  res.json({ ok: true });
});

// 提交到 smzdm（调用适配器；mock 直接返回成功）
router.post('/:id/submit', authRequired, async (req, res) => {
  const db = load();
  const item = db.baoliao.find((x) => x.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const { userId } = req.body || {};
  const user = userId ? db.users.find((u) => u.id === userId) : db.users[0];
  if (!user || !user.cookie) {
    item.status = 'failed';
    item.lastResult = '请先添加 smzdm 账号并录入 Cookie';
    item.updatedAt = new Date().toISOString();
    persist();
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
    persist();
    res.json({ ok: true, result: r, item });
  } catch (e) {
    item.status = 'failed';
    item.lastResult = e.message;
    item.updatedAt = new Date().toISOString();
    persist();
    res.status(502).json({ error: 'adapter_error', message: e.message });
  }
});

export default router;
