import { normalizeArticleId } from './articleId.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 1000;

function decodeXmlEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"'
  };
  const decodeCodePoint = (raw, radix) => {
    const point = Number.parseInt(raw, radix);
    return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '�';
  };
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => decodeCodePoint(hex, 16))
    .replace(/&#(\d+);/g, (_, dec) => decodeCodePoint(dec, 10))
    .replace(/&(amp|apos|gt|lt|quot);/gi, (_, key) => named[key.toLowerCase()]);
}

function readTag(block, tag) {
  const escaped = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(block || '').match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  if (!match) return '';
  return match[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();
}

function toPlainText(value) {
  return decodeXmlEntities(
    String(value || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

const PRICE_PATTERNS = [
  /(?:到手价?|券后价?|实付价?|折后价?|秒杀价?|活动价?|优惠价?|售价|低至|约)?\s*[¥￥]\s*(\d[\d,]*(?:\.\d{1,2})?)/gi,
  /(?<![¥￥\d.,])(?:到手价?|券后价?|实付价?|折后价?|秒杀价?|活动价?|优惠价?|售价|低至|约)?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*元(?:起)?/gi
];

function collectPrices(rawTitle) {
  const found = [];
  const seen = new Set();
  for (const pattern of PRICE_PATTERNS) {
    for (const match of rawTitle.matchAll(pattern)) {
      const key = `${match.index}:${match[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        index: match.index,
        end: match.index + match[0].length,
        price: String(match[1] || '').replace(/,/g, ''),
        matched: match[0]
      });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

function priceScore(rawTitle, found) {
  const before = rawTitle.slice(Math.max(0, found.index - 12), found.index);
  const after = rawTitle.slice(found.end, found.end + 16);
  let score = 10;
  if (/到手价?|券后价?|实付价?|折后价?|最终价/.test(found.matched + before.slice(-6))) score += 100;
  if (/^[^\d]{0,10}(?:到手|实付)/.test(after)) score += 100;
  if (/(?:可抵|抵扣|返|立减|满减|省|淘金币)\s*$/.test(before) && !/^[^\d]{0,10}到手/.test(after)) score -= 60;
  if (/^(?:\s*$|\s*[（(]|\s*(?:包邮|需|返|起|到手))/.test(after)) score += 10;
  return score;
}

function findPrice(rawTitle) {
  let best = null;
  for (const found of collectPrices(rawTitle)) {
    const score = priceScore(rawTitle, found);
    if (!best || score > best.score || (score === best.score && found.index < best.index)) {
      best = { ...found, score };
    }
  }
  return best;
}

function stripPromoPrefix(value) {
  let title = value;
  let previous;
  do {
    previous = title;
    title = title
      .replace(/^淘金币\s*\d[\d,]*(?:\.\d{1,2})?\s*元[、，]\s*/i, '')
      .replace(/^(?:88VIP|今日必买|移动端|值友专享|大件超省|百亿补贴|历史新低|绝对值|PLUS会员)[：:]\s*/i, '');
  } while (title !== previous);
  return title.trim();
}

export function parseDealTitle(value) {
  const rawTitle = toPlainText(value).slice(0, 300);
  const found = findPrice(rawTitle);
  if (!found) return { title: rawTitle, price: '', offer: '' };

  const titleBody = stripPromoPrefix(rawTitle);
  const splitCandidate = collectPrices(titleBody).find((candidate) => {
    if (candidate.index < 4) return false;
    const before = titleBody.slice(Math.max(0, candidate.index - 10), candidate.index);
    const after = titleBody.slice(candidate.end, candidate.end + 10);
    if (/(?:可抵|抵扣|返|立减|满减|省|淘金币)\s*$/.test(before)) return false;
    return /^(?:\s*$|\s*[（(]|\s*(?:包邮|需|返|起|到手))/.test(after);
  });
  const splitIndex = splitCandidate ? splitCandidate.index : found.index;
  const prefix = titleBody
    .slice(0, splitIndex)
    .replace(/[\s,，;；:：|｜·\-—]+$/, '')
    .trim();
  return {
    title: (prefix.length >= 2 ? prefix : titleBody).slice(0, 200),
    price: found.price.slice(0, 50),
    offer: titleBody.slice(splitIndex).trim().slice(0, 300)
  };
}

function normalizedPublishedAt(value) {
  const text = toPlainText(value);
  // 官方 RSS 的 pubDate 当前没有时区后缀，实际使用北京时间。显式补 GMT+0800，
  // 避免部署到 UTC 等不同时区的服务器后同一条目出现 8 小时时差。
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2}|\b(?:GMT|UTC)\b)$/i.test(text);
  const parsed = Date.parse(hasTimezone ? text : `${text} GMT+0800`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

export function parseBaoliaoRss(xml, { limit = DEFAULT_LIMIT } = {}) {
  const source = String(xml || '');
  if (!source.trim()) throw new Error('官方RSS返回空内容');
  if (!/<rss\b|<feed\b/i.test(source)) throw new Error('官方RSS返回了非RSS内容');

  const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT));
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const seen = new Set();
  const items = [];
  let match;
  while ((match = itemRe.exec(source)) !== null && items.length < safeLimit) {
    const block = match[1];
    const rawTitle = toPlainText(readTag(block, 'title'));
    const rawLink = toPlainText(readTag(block, 'link') || readTag(block, 'guid'));
    const articleId = normalizeArticleId(rawLink);
    if (!rawTitle || !articleId || seen.has(articleId)) continue;
    seen.add(articleId);

    const canonicalUrl = `https://www.smzdm.com/p/${articleId}`;
    const deal = parseDealTitle(rawTitle);
    items.push({
      title: deal.title,
      url: canonicalUrl,
      smzdmUrl: canonicalUrl,
      price: deal.price,
      content: `好价信息：${rawTitle}`.slice(0, 2000),
      source: 'smzdm-rss',
      publishedAt: normalizedPublishedAt(readTag(block, 'pubDate'))
    });
  }

  if (!items.length) throw new Error('官方RSS未返回可识别的好价条目');
  return items;
}
