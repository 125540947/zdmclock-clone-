// P0：大模型适配器测试（buildSystemPrompt 经 generateReply 间接验证、未配置/空内容/HTTP 错误路径）
// 通过 mock 全局 fetch 验证请求体拼接与响应解析，不发起真实网络请求。
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 必须在 import gptAdapter 之前设置，config 在加载时读取 GPT_API_KEY 决定 gptEnabled
process.env.GPT_API_KEY = 'test-key';
const { generateReply } = await import('../src/gptAdapter.js');
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

test('buildSystemPrompt friendly 默认口吻', async () => {
  mockFetchOnce({ choices: [{ message: { content: '  你好呀  ' } }] });
  const reply = await generateReply({ text: '原评论', tone: 'friendly' });
  assert.equal(reply, '你好呀'); // 去首尾空格
  assert.match(lastReq.init.body, /亲切友善/);
  assert.match(lastReq.init.body, /原评论/);
});

test('buildSystemPrompt pro / humor 口吻切换', async () => {
  mockFetchOnce({ choices: [{ message: { content: '专业回复' } }] });
  await generateReply({ text: 'x', tone: 'pro' });
  assert.match(lastReq.init.body, /专业客观/);

  mockFetchOnce({ choices: [{ message: { content: '幽默回复' } }] });
  await generateReply({ text: 'x', tone: 'humor' });
  assert.match(lastReq.init.body, /幽默轻松/);
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

// 还原真实 fetch，避免影响其它文件
test('还原全局 fetch', () => {
  globalThis.fetch = realFetch;
  assert.ok(true);
});
