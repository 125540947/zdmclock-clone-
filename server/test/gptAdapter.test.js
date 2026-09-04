// P0：大模型适配器测试（buildSystemPrompt 经 generateReply 间接验证、未配置/空内容/HTTP 错误路径）
// 通过 mock 全局 fetch 验证请求体拼接与响应解析，不发起真实网络请求。
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 必须在 import gptAdapter 之前设置，config 在加载时读取 GPT_API_KEY 决定 gptEnabled
process.env.GPT_API_KEY = 'test-key';
const {
  generateReply,
  generateProductComment,
  buildProductCommentPrompt,
  cleanReply,
  productCommentIssues,
  resolveGptProvider,
  isGptConfigured,
  isPlaceholderTitle,
  hasUsableProductFact
} = await import('../src/gptAdapter.js');
const { config } = await import('../src/config.js');

const realFetch = globalThis.fetch;
let lastReq = null;

function mockFetchOnce(body) {
  globalThis.fetch = async (url, init) => {
    lastReq = { url, init };
    return {
      ok: true,
      json: async () => body
    };
  };
}

function mockFetchHttp(status, body) {
  globalThis.fetch = async () => ({
    ok: false,
    status,
    json: async () => body
  });
}

test('generateReply 未配置 GPT_API_KEY 时直接抛错（不发起请求）', async () => {
  const prev = config.gptEnabled;
  config.gptEnabled = false;
  globalThis.fetch = realFetch; // 即便有 fetch 也不应被调用
  let called = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (...a) => { called = true; return origFetch(...a); };
  await assert.rejects(
    () => generateReply({ text: 'hi' }),
    /未配置/
  );
  assert.equal(called, false);
  config.gptEnabled = prev;
  globalThis.fetch = realFetch;
});

test('resolveGptProvider 页面配置优先且状态不依赖进程重启', () => {
  const prev = config.gptEnabled;
  config.gptEnabled = false;
  const p = resolveGptProvider({
    apiKey: 'saved-key',
    apiBase: 'https://api.deepseek.com/v1/',
    model: 'deepseek-chat'
  });
  assert.equal(p.apiKey, 'saved-key');
  assert.equal(p.apiBase, 'https://api.deepseek.com/v1');
  assert.equal(p.model, 'deepseek-chat');
  assert.equal(p.keySource, 'saved');
  assert.equal(p.usePinnedFetch, true);
  assert.equal(isGptConfigured({ apiKey: 'saved-key' }), true);
  config.gptEnabled = prev;
});

test('buildSystemPrompt friendly 默认口吻', async () => {
  mockFetchOnce({ choices: [{ message: { content: '  你好呀  ' } }] });
  const reply = await generateReply({ text: '原评论', tone: 'friendly' });
  assert.equal(reply, '你好呀'); // 去首尾空格
  assert.match(lastReq.init.body, /普通网友/);
  assert.match(lastReq.init.body, /不要复述原文/);
  assert.match(lastReq.init.body, /感谢分享/);
  assert.match(lastReq.init.body, /原评论/);
});

test('buildSystemPrompt pro / humor 口吻切换', async () => {
  mockFetchOnce({ choices: [{ message: { content: '专业回复' } }] });
  await generateReply({ text: 'x', tone: 'pro' });
  assert.match(lastReq.init.body, /懂行但不端着/);

  mockFetchOnce({ choices: [{ message: { content: '幽默回复' } }] });
  await generateReply({ text: 'x', tone: 'humor' });
  assert.match(lastReq.init.body, /自然的小幽默/);
});

test('cleanReply 移除模型包装但保留正文', () => {
  assert.equal(cleanReply(' 回复：这价格确实可以，再等等券更香。 '), '这价格确实可以，再等等券更香。');
  assert.equal(cleanReply('“用了一周，续航比我预想的稳。”'), '用了一周，续航比我预想的稳。');
  assert.equal(cleanReply('```text\n尺码偏小的话，建议大一码。\n```'), '尺码偏小的话，建议大一码。');
});

test('商品评论提示词压制模板腔和虚构体验', () => {
  const prompt = buildProductCommentPrompt({ tone: 'friendly' });
  assert.match(prompt, /标题、正文和价格/);
  assert.match(prompt, /禁止“好价，感谢分享”/);
  assert.match(prompt, /不要假装买过或用过/);
});

test('generateProductComment 将标题、内容、价格作为独立事实传给模型', async () => {
  mockFetchOnce({ choices: [{ message: { content: '这个容量放桌面上刚好。' } }] });
  const reply = await generateProductComment({ title: '迷你电饭煲', content: '适合一人食', price: '79 元' });
  assert.equal(reply, '这个容量放桌面上刚好。');
  const body = JSON.parse(lastReq.init.body);
  assert.match(body.messages[1].content, /商品标题：迷你电饭煲/);
  assert.match(body.messages[1].content, /商品正文：适合一人食/);
  assert.match(body.messages[1].content, /商品价格：79 元/);
});

test('productCommentIssues 识别常见 AI 套话，放行具体口语短评', () => {
  assert.ok(productCommentIssues('总体来说，这款产品性价比很高，值得入手。').length > 0);
  assert.deepEqual(productCommentIssues('1.2L 两个人吃估计都够了。'), []);
});

test('productCommentIssues 识别新增的导购/营销腔（闭眼入、不容错过等）', () => {
  assert.ok(productCommentIssues('这款闭眼入就完事了，不容错过。').length > 0);
  assert.ok(productCommentIssues('性价比之王，强烈推荐入手。').length > 0);
  // 具体口语短评仍应放行
  assert.deepEqual(productCommentIssues('1.2L 两个人吃估计都够了。'), []);
});

test('generateProductComment 首稿有 AI 味时携带问题自动重写', async () => {
  const replies = ['总体来说，这款产品性价比很高，值得入手。', '1.2L 两个人吃估计都够了。'];
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    lastReq = { url, init };
    return { ok: true, json: async () => ({ choices: [{ message: { content: replies[calls++] } }] }) };
  };
  const reply = await generateProductComment({ title: '1.2L 电饭煲', content: '双碗容量', price: '79 元' });
  assert.equal(reply, '1.2L 两个人吃估计都够了。');
  assert.equal(calls, 2);
  assert.match(lastReq.init.body, /这条评论不能用/);
});

test('buildSystemPrompt 拼接自定义 prompt', async () => {
  mockFetchOnce({ choices: [{ message: { content: 'ok' } }] });
  await generateReply({ text: 'x', tone: 'friendly', prompt: '请简短' });
  assert.match(lastReq.init.body, /额外要求：请简短/);
});

test('generateReply 空文本回退为「你好」', async () => {
  mockFetchOnce({ choices: [{ message: { content: 'r' } }] });
  await generateReply({});
  assert.match(lastReq.init.body, /你好/);
});

test('generateReply 大模型返回空内容时抛错', async () => {
  mockFetchOnce({ choices: [{ message: { content: '   ' } }] });
  await assert.rejects(() => generateReply({ text: 'x' }), /返回内容为空/);
});

test('generateReply HTTP 非 200 抛错并带状态码', async () => {
  mockFetchHttp(401, { error: { message: 'invalid key' } });
  await assert.rejects(() => generateReply({ text: 'x' }), /HTTP 401/);
});

test('generateReply 走正确的 chat/completions 端点', async () => {
  mockFetchOnce({ choices: [{ message: { content: 'r' } }] });
  await generateReply({ text: 'x' });
  assert.match(lastReq.url, /\/chat\/completions$/);
  assert.equal(lastReq.init.headers.Authorization, 'Bearer test-key');
});

test('requestCompletion 使用 config.gptMaxTokens 作为输出上限（A-13 推理模型截断修复）', async () => {
  const prev = config.gptMaxTokens;
  config.gptMaxTokens = 1234;
  mockFetchOnce({ choices: [{ message: { content: 'r' } }] });
  await generateReply({ text: 'x' });
  const body = JSON.parse(lastReq.init.body);
  assert.equal(body.max_tokens, 1234);
  assert.notEqual(body.max_tokens, 200); // 回归：不得再硬编码 200（推理模型会因此截断为空）
  config.gptMaxTokens = prev;
});

test('config.gptMaxTokens 落在合理区间（A-13）', () => {
  // 本文件 import 前未设 GPT_MAX_TOKENS，应回退默认值；仅校验有限数字且在边界内，
  // 避免对运行环境变量做强假设。
  assert.ok(Number.isFinite(config.gptMaxTokens));
  assert.ok(config.gptMaxTokens >= 256 && config.gptMaxTokens <= 8192);
});

test('requestCompletion 超时取自 config.gptRequestTimeout（不再裸读 env）', async () => {
  const prev = config.gptRequestTimeout;
  config.gptRequestTimeout = 12345;
  // 让 fetch 直接抛超时，断言错误信息里带上配置值（说明 timeoutMs 来自 config）
  globalThis.fetch = async () => {
    const e = new Error('aborted');
    e.name = 'TimeoutError';
    throw e;
  };
  await assert.rejects(() => generateReply({ text: 'x' }), /请求超时（>12345ms）|>12345ms/);
  config.gptRequestTimeout = prev;
});

test('超时余量必须够跑满 token 预算（防止只调预算不调超时）', () => {
  // 线上实测出词速率约 50~110 tokens/s；按最保守的 50 tokens/s 计，跑满 gptMaxTokens 所需毫秒数
  // 必须 ≤ 超时值，否则放宽的预算根本用不到，思维链跑飞时只会从「截断为空」变成「请求超时」。
  const SLOWEST_TOKENS_PER_SEC = 50;
  const needMs = (config.gptMaxTokens / SLOWEST_TOKENS_PER_SEC) * 1000;
  assert.ok(
    config.gptRequestTimeout >= needMs,
    `超时 ${config.gptRequestTimeout}ms 不足以产出 ${config.gptMaxTokens} tokens（约需 ${Math.round(needMs)}ms）`
  );
});

// ===== 批次 39：自动评论话术"太冲"回归测试 =====
// 线上实证：导入只有链接时标题被回填成「文章 <id>」占位、正文与价格为空，
// 模型把提示词里的"自然追问"演绎成质问/嘲讽发布者，并原样通过检查直接发布。

const OFFENDING_SAMPLES = [
  '啥正文都不给，就甩个长文章id糊弄人呢？',
  '啥内容啥价格都不说，就给个编号糊弄谁呢？',
  '啥信息都没有就挂个文章ID，这是卖啥啊？'
];

test('productCommentIssues 识别攻击性质问/嘲讽（线上"太冲"真实样本）', () => {
  for (const sample of OFFENDING_SAMPLES) {
    const issues = productCommentIssues(sample);
    assert.ok(
      issues.includes('语气带质问或嘲讽'),
      `应识别出冲话术，实际放行：${sample} → ${JSON.stringify(issues)}`
    );
  }
});

test('productCommentIssues 收敛临界冲话术（累不累）', () => {
  assert.ok(productCommentIssues('39块还整优惠券，累不累啊').includes('语气带质问或嘲讽'));
});

test('productCommentIssues 放行带具体信息的口语短评与轻微调侃（不误伤）', () => {
  // 前两条是用户明确认可"甚至不错"的参照样本，第三条是既有用例
  assert.deepEqual(productCommentIssues('299这价蔡司1.67还带钛架，商家不会算错账吧？'), []);
  assert.deepEqual(productCommentIssues('这价拿Z7Pro？比我上周看的便宜快两百块'), []);
  assert.deepEqual(productCommentIssues('1.2L 两个人吃估计都够了。'), []);
});

test('buildProductCommentPrompt 明确禁止质问、嘲讽与数落发布者', () => {
  const prompt = buildProductCommentPrompt({ tone: 'friendly' });
  assert.match(prompt, /禁止质问、嘲讽、阴阳怪气或数落发布者/);
  assert.match(prompt, /糊弄/);
  // 回归：不允许再出现把"信息不足"导向追问发布者的措辞
  assert.doesNotMatch(prompt, /自然追问/);
});

test('isPlaceholderTitle 识别导入侧回填的「文章 <id>」占位标题', () => {
  assert.equal(isPlaceholderTitle('文章 180074206'), true);
  assert.equal(isPlaceholderTitle('文章180074206'), true);
  assert.equal(isPlaceholderTitle(' 文章 180074206 '), true);
  assert.equal(isPlaceholderTitle('蔡司1.67钛架'), false);
  assert.equal(isPlaceholderTitle(''), false);
});

test('hasUsableProductFact 占位标题 + 空正文空价格视为无可用信息', () => {
  // 线上 3 条好价的真实形态：只有回填的占位标题
  assert.equal(hasUsableProductFact({ title: '文章 180074206', content: '', price: '' }), false);
  assert.equal(hasUsableProductFact({ title: '文章 180074206' }), false);
  assert.equal(hasUsableProductFact({}), false);
  // 任一要素有真实内容即视为可用
  assert.equal(hasUsableProductFact({ title: '蔡司1.67钛架', content: '', price: '' }), true);
  assert.equal(hasUsableProductFact({ title: '文章 180074206', content: '适合一人食', price: '' }), true);
  assert.equal(hasUsableProductFact({ title: '文章 180074206', content: '', price: '299' }), true);
});

test('generateProductComment 占位标题按「未提供」传给模型（不再喂裸文章ID）', async () => {
  mockFetchOnce({ choices: [{ message: { content: '这个价我先观望下。' } }] });
  await generateProductComment({ title: '文章 180074206', content: '', price: '' });
  const body = JSON.parse(lastReq.init.body);
  assert.match(body.messages[1].content, /商品标题：未提供/);
  assert.match(body.messages[1].content, /商品正文：未提供/);
  assert.match(body.messages[1].content, /商品价格：未提供/);
  assert.doesNotMatch(body.messages[1].content, /180074206/);
});

test('generateProductComment 首稿话术太冲时带语气约束重写后发布', async () => {
  const replies = ['啥正文都不给，就甩个长文章id糊弄人呢？', '这个价我先观望下。'];
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    lastReq = { url, init };
    return { ok: true, json: async () => ({ choices: [{ message: { content: replies[calls++] } }] }) };
  };
  const reply = await generateProductComment({ title: '蔡司1.67钛架', content: '', price: '299' });
  assert.equal(reply, '这个价我先观望下。');
  assert.equal(calls, 2); // 首稿被拦下并触发一次重写
  const rewriteBody = JSON.parse(lastReq.init.body);
  assert.match(rewriteBody.messages.at(-1).content, /语气带质问或嘲讽/);
  assert.match(rewriteBody.messages.at(-1).content, /语气必须平和/);
  assert.match(rewriteBody.messages.at(-1).content, /不得质问、嘲讽或数落发布者/);
});

// 还原真实 fetch，避免影响其它文件
test('还原全局 fetch', () => {
  globalThis.fetch = realFetch;
  assert.ok(true);
});
