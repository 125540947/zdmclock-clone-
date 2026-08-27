import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBaoliaoRss, parseDealTitle } from '../src/smzdm/rssFeed.js';

function rss(items) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>${items.join('')}</channel></rss>`;
}

function item({ title, link, date = 'Thu, 27 Aug 2026 15:08:39' }) {
  return `<item>
    <title><![CDATA[${title}]]></title>
    <link><![CDATA[${link}]]></link>
    <pubDate><![CDATA[${date}]]></pubDate>
  </item>`;
}

test('parseDealTitle：保留商品规格，拆出到手价与优惠信息', () => {
  const deal = parseDealTitle('伊利 高钙牛奶 200ml*12盒 16.85元（需用券）');
  assert.equal(deal.title, '伊利 高钙牛奶 200ml*12盒');
  assert.equal(deal.price, '16.85');
  assert.equal(deal.offer, '16.85元（需用券）');
});

test('parseDealTitle：兼容人民币符号、千位分隔与券后价', () => {
  const deal = parseDealTitle('护脊床垫 180*200cm 券后价￥1,058.00');
  assert.equal(deal.title, '护脊床垫 180*200cm');
  assert.equal(deal.price, '1058.00');
  assert.equal(deal.offer, '券后价￥1,058.00');
});

test('parseDealTitle：人民币符号与“元”同时出现时不污染商品标题', () => {
  const deal = parseDealTitle('测试商品 500ml ￥59元（包邮）');
  assert.equal(deal.title, '测试商品 500ml');
  assert.equal(deal.price, '59');
});

test('parseDealTitle：多金额时优先真实到手价，商品标题不混入标价', () => {
  const deal = parseDealTitle('淘金币86.88元、今日必买：西凤酒 酒海窖龄20年 500ml 礼盒装 136元（86.88元淘金币到手）');
  assert.equal(deal.title, '西凤酒 酒海窖龄20年 500ml 礼盒装');
  assert.equal(deal.price, '86.88');
});

test('parseDealTitle：淘金币抵扣金额不能覆盖商品主价格', () => {
  const deal = parseDealTitle('移动端：安佳 全脂纯牛奶250ml*24盒 99.66元（淘金币可抵4.17元起）');
  assert.equal(deal.title, '安佳 全脂纯牛奶250ml*24盒');
  assert.equal(deal.price, '99.66');
});

test('parseBaoliaoRss：解析、规范化链接、去重并限制数量', () => {
  const xml = rss([
    item({ title: '商品A 12.9元（包邮）', link: 'https://www.smzdm.com/p/181141098/' }),
    item({ title: '重复商品 13元', link: 'https://www.smzdm.com/p/181141098/' }),
    item({ title: '商品&amp;配件 59元', link: 'https://www.smzdm.com/p/181141099/' }),
    item({ title: '无效链接 9元', link: 'https://example.com/p/1/' })
  ]);
  const items = parseBaoliaoRss(xml, { limit: 2 });
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    title: '商品A',
    url: 'https://www.smzdm.com/p/181141098',
    smzdmUrl: 'https://www.smzdm.com/p/181141098',
    price: '12.9',
    content: '好价信息：商品A 12.9元（包邮）',
    source: 'smzdm-rss',
    publishedAt: '2026-08-27T07:08:39.000Z'
  });
  assert.equal(items[1].title, '商品&配件');
});

test('parseBaoliaoRss：非RSS与无有效条目明确失败', () => {
  assert.throws(() => parseBaoliaoRss('<html>challenge</html>'), /非RSS内容/);
  assert.throws(() => parseBaoliaoRss(rss([item({ title: '无效', link: 'https://example.com/x' })])), /未返回可识别/);
});
