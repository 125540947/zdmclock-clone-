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
    generateReply: async ({ text } = {}) => {
      if (!REPLY.ok) throw new Error(REPLY.error || 'boom');
      return REPLY.reply + ':' + (text || '');
    },
    generateProductComment: async () => 'mocked product comment',
    resolveGptProvider: (saved = {}) => {
      const savedKey = typeof saved.apiKey === 'string' ? saved.apiKey.trim() : '';
      const envKey = config.gptEnabled ? String(config.gptApiKey || '').trim() : '';
      return {
        configured: !!(savedKey || envKey),
        keySource: savedKey ? 'saved' : envKey ? 'environment' : 'none',
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

test('关闭测试服务器', () => { server.close(); });
