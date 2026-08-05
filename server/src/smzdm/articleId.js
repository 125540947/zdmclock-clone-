// 从文章 ID 或文章链接中提取纯数字 ID。
// 支持：纯数字 "123456"、smzdm 文章链接 "https://www.smzdm.com/p/123456" 等。
// 抽成独立模块，便于 taskRunner（批量取好价文章ID）与 realAdapter 共用，
// 也避免 taskRunner 直接依赖 realAdapter 实现。
export function normalizeArticleId(input) {
  if (!input) return '';
  const s = String(input).trim();
  if (/^\d+$/.test(s)) return s;
  const m =
    s.match(/\/p\/(\d+)/i) ||
    s.match(/\/articles?\/(\d+)/i) ||
    s.match(/(\d{4,})/);
  return m ? m[1] : '';
}
