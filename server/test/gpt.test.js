// gpt 路由层测试：覆盖 /api/gpt 各端点（status/config/drafts/reply）与鉴权/校验分支。
// 策略：在 import index 之前 mock gptAdapter.generateReply，避免真实联网调用大模型；
//       同时覆盖页面保存 API Key、响应脱敏与环境变量回退。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-gpt-' + process.pid + '-' + Date.now());

const SRC = path.resolve(import.meta.dirname, '../src');
const p = (rel) => pathToFileURL(path.resolve(SRC, rel)).href;

// 可切换的 generateReply 行为（闭包变量，避免重复注册 mock）
let REPLY = { ok: true, reply: 'mocked reply' };
mock.module(p('gptAdapter.js'), {
  namedExports: {
    // 批次 39：taskRunner 会 import 这两个判定函数，mock 必须同步提供，否则模块实例化失败
    isPlaceholderTitle: (v) => /^文章\s*\d+$/u.test(String(v || '').trim()),
    hasUsableProductFact: ({ title, content, price } = {}) =>
      (String(title || '').trim() && !/^文章\s*\d+$/u.test(String(title || '').trim())) ||
      String(content || '').trim().length > 0 ||
      String(price || '').trim().length > 0,
    // 可切换的 generateReply 行为（闭包变量，避免重复注册 mock）
    generateReply: async ({ text } = {}) => {
      if (!REPLY.ok) throw new Error(REPLY.error || 'boom');
      return REPLY.reply + ':' + (text || '');
    },
    generateProductComment: async () => 'mocked product comment',
    // taskRunner / tasks_real 在发布前会复用自然度检查；路由测试只需提供安全短评结果。
    productCommentIssues: () => [],
    resolveGptProvider: (saved = {}) => {
      const savedKey = typeof saved.apiKey === 'string' ? saved.apiKey.trim() : '';
      const envKey = config.gptEnabled ? String(config.gptApiKey || '').trim() : '';
      return {
        configured: !!(savedKey || envKey),
        keySource: savedKey ? 'saved' : envKey ? 'environment' : 'none',
        apiKey: savedKey || envKey,
        apiBase: saved.apiBase || config.gptApiBase,
        model: saved.model || config.gptModel
      };
    }
  }
});

const { createApp } = await import('../src/index.js');
const { config } = await import('../src/config.js');
const { load } = await import('../src/store.js');

config.requireAuth = false;

const app = createApp();
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = 'http://localhost:' + server.address().port;

async function j(method, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch { /* 可能无 JSON 体 */ }
  return { status: res.status, data };
}

test('API 响应禁止浏览器缓存（Cache-Control: no-store）', async () => {
  // 回归：早期未禁缓存，JSON 响应带 ETag，浏览器发 If-None-Match 命中 304（空 body），
  // 前端 axios 解析到空 data → 误判空列表（如「获取模型」服务端有数据、浏览器显空）。
  const res = await fetch(base + '/api/gpt/status');
  assert.match(res.headers.get('Cache-Control') || '', /no-store/);
});

test('GET /api/gpt/status 同时识别环境密钥和页面保存密钥', async () => {
  const db = load();
  db.settings.gpt.apiKey = '';
  config.gptEnabled = false;
  let r = await j('GET', '/api/gpt/status');
  assert.equal(r.status, 200);
  assert.equal(r.data.configured, false);
  config.gptApiKey = 'env-test-key';
  config.gptEnabled = true;
  r = await j('GET', '/api/gpt/status');
  assert.equal(r.data.configured, true);
  assert.equal(r.data.keySource, 'environment');
  config.gptEnabled = false;
  db.settings.gpt.apiKey = 'saved-secret';
  r = await j('GET', '/api/gpt/status');
  assert.equal(r.data.configured, true);
  assert.equal(r.data.keySource, 'saved');
});

test('GET /api/gpt/config 返回公开配置且绝不回显密钥', async () => {
  const db = load();
  db.settings.gpt = {
    enabled: true,
    target: 'comment',
    tone: 'pro',
    prompt: 'hi',
    apiKey: 'super-secret',
    apiBase: 'https://api.example.com/v1',
    model: 'model-x'
  };
  const r = await j('GET', '/api/gpt/config');
  assert.equal(r.status, 200);
  assert.equal(r.data.config.target, 'comment');
  assert.equal(r.data.config.tone, 'pro');
  assert.equal(r.data.config.hasApiKey, true);
  assert.equal(r.data.config.hasSavedApiKey, true);
  assert.equal(r.data.config.apiBase, 'https://api.example.com/v1');
  assert.ok(!('apiKey' in r.data.config));
  assert.doesNotMatch(JSON.stringify(r.data), /super-secret/);
});

test('PUT /api/gpt/config 非法 target/tone/prompt/provider → 400', async () => {
  assert.equal((await j('PUT', '/api/gpt/config', { target: 'bogus' })).status, 400);
  assert.equal((await j('PUT', '/api/gpt/config', { tone: 'angry' })).status, 400);
  assert.equal((await j('PUT', '/api/gpt/config', { prompt: 'x'.repeat(2001) })).status, 400);
  assert.equal((await j('PUT', '/api/gpt/config', { apiBase: 'http://169.254.169.254/latest' })).status, 400);
  assert.equal((await j('PUT', '/api/gpt/config', { apiBase: 'https://user:pass@example.com/v1' })).status, 400);
  assert.equal((await j('PUT', '/api/gpt/config', { apiKey: 'bad\nkey' })).status, 400);
  assert.equal((await j('PUT', '/api/gpt/config', { model: '' })).status, 400);
});

test('PUT /api/gpt/config 合法 → 200 且持久化到 db', async () => {
  const db = load();
  const r = await j('PUT', '/api/gpt/config', {
    enabled: true,
    target: 'all',
    tone: 'humor',
    prompt: '请友好',
    apiKey: 'saved-key-123',
    apiBase: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat'
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.config.enabled, true);
  assert.equal(r.data.config.target, 'all');
  assert.equal(r.data.config.hasSavedApiKey, true);
  assert.ok(!('apiKey' in r.data.config));
  assert.equal(db.settings.gpt.tone, 'humor');
  assert.equal(db.settings.gpt.prompt, '请友好');
  assert.equal(db.settings.gpt.apiKey, 'saved-key-123');
  assert.equal(db.settings.gpt.apiBase, 'https://api.deepseek.com/v1');
  assert.equal(db.settings.gpt.model, 'deepseek-chat');
});

test('PUT /api/gpt/config 空密钥保持原值，clearApiKey 才清除', async () => {
  const db = load();
  db.settings.gpt.apiKey = 'keep-me';
  await j('PUT', '/api/gpt/config', { apiKey: '' });
  assert.equal(db.settings.gpt.apiKey, 'keep-me');
  const r = await j('PUT', '/api/gpt/config', { clearApiKey: true });
  assert.equal(r.status, 200);
  assert.equal(db.settings.gpt.apiKey, '');
  assert.equal(r.data.config.hasSavedApiKey, false);
});

test('GET /api/gpt/drafts 返回 items 数组与 total', async () => {
  const db = load();
  db.gptDrafts = [{ id: 'd1', text: 't' }, { id: 'd2', text: 'u' }];
  const r = await j('GET', '/api/gpt/drafts');
  assert.equal(r.status, 200);
  assert.equal(r.data.items.length, 2);
  assert.equal(r.data.total, 2);
});

test('DELETE /api/gpt/drafts/:id 404（不存在）与 删除成功', async () => {
  const db = load();
  db.gptDrafts = [{ id: 'd-zzz', text: 't' }];
  assert.equal((await j('DELETE', '/api/gpt/drafts/nope')).status, 404);
  const r = await j('DELETE', '/api/gpt/drafts/d-zzz');
  assert.equal(r.status, 200);
  assert.equal(db.gptDrafts.length, 0);
});

test('POST /api/gpt/reply gpt_disabled（db 未启用自动回复）→ 400', async () => {
  config.gptEnabled = true;
  const db = load();
  db.settings.gpt.enabled = false;
  const r = await j('POST', '/api/gpt/reply', { text: '你好' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'gpt_disabled');
});

test('POST /api/gpt/reply gpt_not_configured（服务端无 API_KEY）→ 400', async () => {
  config.gptEnabled = false;
  const db = load();
  db.settings.gpt.enabled = true;
  db.settings.gpt.apiKey = '';
  const r = await j('POST', '/api/gpt/reply', { text: '你好' });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'gpt_not_configured');
});

test('POST /api/gpt/reply 成功 → 200 + mocked reply', async () => {
  config.gptEnabled = true;
  const db = load();
  db.settings.gpt.enabled = true;
  db.settings.gpt.apiKey = '';
  db.settings.gpt.tone = 'friendly';
  db.settings.gpt.prompt = '';
  const r = await j('POST', '/api/gpt/reply', { text: '今天天气' });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.match(r.data.reply, /mocked reply/);
});

test('POST /api/gpt/reply generateReply 抛错 → 502', async () => {
  REPLY = { ok: false, error: 'model boom' };
  config.gptEnabled = true;
  const db = load();
  db.settings.gpt.enabled = true;
  const r = await j('POST', '/api/gpt/reply', { text: 'x' });
  assert.equal(r.status, 502);
  assert.equal(r.data.error, 'gpt_error');
  REPLY = { ok: true, reply: 'mocked reply' };
});

test('GET /api/gpt/models 成功拉取并规整模型列表（带鉴权头）', async () => {
  const db = load();
  db.settings.gpt = { apiBase: 'https://api.openai.com/v1', apiKey: 'k-secret', model: 'gpt-4o-mini' };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://') && String(url).endsWith('/models')) {
      assert.equal(url, 'https://api.openai.com/v1/models');
      assert.equal(init.headers.Authorization, 'Bearer k-secret');
      return {
        ok: true,
        json: async () => ({ object: 'list', data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }, 'not-object'] })
      };
    }
    return realFetch(url, init);
  };
  try {
    const r = await j('GET', '/api/gpt/models');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.models, ['gpt-4o-mini', 'gpt-4o', 'not-object']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('GET /api/gpt/models 遇到一次 ECONNRESET 会重试并返回模型', async () => {
  const db = load();
  db.settings.gpt = { apiBase: 'https://apihub.agnes-ai.com/v1', apiKey: 'k-secret', model: 'agnes-2.5-flash' };
  const realFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://') && String(url).endsWith('/models')) {
      attempts += 1;
      assert.equal(init.headers.Authorization, 'Bearer k-secret');
      if (attempts === 1) {
        const error = new Error('read ECONNRESET');
        error.code = 'ECONNRESET';
        throw error;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'agnes-2.5-flash' }, { id: 'agnes-2.5-pro' }] })
      };
    }
    return realFetch(url, init);
  };
  try {
    const r = await j('GET', '/api/gpt/models');
    assert.equal(attempts, 2);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.models, ['agnes-2.5-flash', 'agnes-2.5-pro']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('GET /api/gpt/models 远端返回非 200 → 502 错误信封', async () => {
  const db = load();
  db.settings.gpt = { apiBase: 'https://api.deepseek.com/v1', apiKey: 'k-secret', model: 'deepseek-chat' };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://') && String(url).endsWith('/models')) {
      return { ok: false, status: 401, json: async () => ({ error: { message: 'unauthorized' } }) };
    }
    return realFetch(url, init);
  };
  try {
    const r = await j('GET', '/api/gpt/models');
    assert.equal(r.status, 502);
    assert.equal(r.data.error, 'gpt_models_error');
    assert.match(r.data.message, /unauthorized/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('GET /api/gpt/models 未配置接口地址 → 400', async () => {
  const db = load();
  config.gptApiBase = '';
  db.settings.gpt = { apiBase: '', apiKey: '', model: '' };
  const r = await j('GET', '/api/gpt/models');
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'gpt_not_configured');
});

test('GET /api/gpt/models 通义/DashScope 走原生 /api/v1/models 并取 output.models[].model_name', async () => {
  const db = load();
  db.settings.gpt = { apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'k-secret', model: 'qwen-plus' };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/api/v1/models')) {
      assert.equal(url, 'https://dashscope.aliyuncs.com/api/v1/models?page_size=100');
      assert.equal(init.headers.Authorization, 'Bearer k-secret');
      return { ok: true, json: async () => ({ request_id: 'r1', output: { models: [{ model_name: 'qwen-plus' }, { model_name: 'qwen-turbo' }, { model_name: 'deepseek-r1' }] } }) };
    }
    return realFetch(url, init);
  };
  try {
    const r = await j('GET', '/api/gpt/models');
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.models, ['qwen-plus', 'qwen-turbo', 'deepseek-r1']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('GET /api/gpt/models 通义/DashScope 401（顶层 message）→ 502 错误信封', async () => {
  const db = load();
  db.settings.gpt = { apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'bad-key', model: 'qwen-plus' };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/api/v1/models')) {
      return { ok: false, status: 401, json: async () => ({ code: 'InvalidApiKey', message: '无效的令牌' }) };
    }
    return realFetch(url, init);
  };
  try {
    const r = await j('GET', '/api/gpt/models');
    assert.equal(r.status, 502);
    assert.equal(r.data.error, 'gpt_models_error');
    assert.match(r.data.message, /无效的令牌/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('GET /api/gpt/models 服务商返回 HTTP 200 + 错误体（未提供令牌）→ 502 错误信封', async () => {
  const db = load();
  db.settings.gpt = { apiBase: 'https://apihub.agnes-ai.com/v1', apiKey: '', model: 'gpt-4o-mini' };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://') && String(url).endsWith('/models')) {
      return { ok: true, json: async () => ({ error: { code: '', message: '未提供令牌 (request id: x)', type: 'AgnesAI_error' } }) };
    }
    return realFetch(url, init);
  };
  try {
    const r = await j('GET', '/api/gpt/models');
    assert.equal(r.status, 502);
    assert.equal(r.data.error, 'gpt_models_error');
    assert.match(r.data.message, /未提供令牌/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('关闭测试服务器', () => { server.close(); });
