import assert from 'node:assert';

const { realAdapter } = await import('../server/src/smzdm/realAdapter.js');

let mockResp = null;
global.fetch = async () => mockResp;
function setResp(status, body) {
  mockResp = { ok: status >= 200 && status < 300, status, text: async () => body };
}
async function expectThrow(fn, re, label) {
  try {
    await fn();
    assert.fail(`${label}: 期望抛出但未抛`);
  } catch (e) {
    assert.match(e.message, re, `${label}: 错误信息不符 -> ${e.message}`);
  }
}

// 1) 202 挑战页：call 抛 HTTP 202，fetchBaoliao 应转「反爬拦截」友好提示（P2-7 复用 call）
setResp(202, '');
await expectThrow(() => realAdapter.fetchBaoliao({ cookie: 'x', limit: 5, page: 1 }), /反爬拦截/, '202 挑战页');

// 2) 200 但验证页（含「验证」且可能 <600）：应识别反爬
setResp(200, '<html><head><title>验证中心</title></head><body>请验证</body></html>');
await expectThrow(() => realAdapter.fetchBaoliao({ cookie: 'x' }), /反爬拦截/, '200 验证页');

// 3) 正常页面：解析去重 + smzdmUrl 拼接正确（padding 至 >600 字节，避开挑战页 length 兜底）
setResp(200, '<!-- ' + 'x'.repeat(800) + ' --><a href="/p/12345">好价标题</a><a href="/p/12345">dup</a><a href="/p/67890">第二条</a>');
const r = await realAdapter.fetchBaoliao({ cookie: 'x', limit: 10 });
assert.ok(r.ok && r.items.length === 2, `normal 应解析到 2 条去重，实际 ${r.items && r.items.length}`);
assert.strictEqual(r.items[0].smzdmUrl, 'https://www.smzdm.com/p/12345', 'smzdmUrl 拼接错误');

// 4) 网络错误（fetch 抛非 HTTP 错）：应转「网络错误」
global.fetch = async () => { throw new Error('ECONNREFUSED'); };
await expectThrow(() => realAdapter.fetchBaoliao({ cookie: 'x' }), /网络错误/, '网络错误');

// 5) 超大响应：应拒绝
global.fetch = async () => ({ ok: true, status: 200, text: async () => 'x'.repeat(5_000_001) });
await expectThrow(() => realAdapter.fetchBaoliao({ cookie: 'x' }), /响应过大/, '过大响应');

// 6) limit 截断：limit=1 只取 1 条（padding 至 >600 字节）
global.fetch = async () => ({ ok: true, status: 200, text: async () => '<!-- ' + 'x'.repeat(800) + ' --><a href="/p/1">a</a><a href="/p/2">b</a><a href="/p/3">c</a>' });
const r2 = await realAdapter.fetchBaoliao({ cookie: 'x', limit: 1 });
assert.strictEqual(r2.items.length, 1, 'limit 截断失效');

console.log('P2-7 fetchBaoliao 自检全部通过（6 项）');
