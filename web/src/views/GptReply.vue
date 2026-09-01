<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>AI 模型与自动评论</h1>
        <div class="sub">接入第三方模型，并为每篇商品生成自然短评</div>
      </div>
    </header>

    <GptProviderConfig :config="cfg" :configured="serverConfigured" @updated="applyProviderConfig" />

    <section class="card rise" style="animation-delay:.1s">
      <div class="row" style="border:none;padding-top:0">
        <div class="l">
          <div class="t">启用自动回复</div>
          <div class="d">开启后，后端「生成回复」会真正调用大模型（关闭则拒绝调用）</div>
        </div>
        <label class="switch">
          <input type="checkbox" v-model="cfg.enabled" @change="save" />
          <span class="slider"></span>
        </label>
      </div>

      <div class="field">
        <label>回复对象</label>
        <select v-model="cfg.target" @change="save" class="input">
          <option value="comment">我的评论区</option>
          <option value="message">私信</option>
          <option value="all">全部</option>
        </select>
      </div>

      <div class="field">
        <label>回复语气</label>
        <select v-model="cfg.tone" @change="save" class="input">
          <option value="friendly">自然随和</option>
          <option value="pro">懂行克制</option>
          <option value="humor">轻松有趣</option>
        </select>
      </div>

      <div class="field">
        <label>提示词模板（可选）</label>
        <textarea v-model="cfg.prompt" class="textarea" @change="save"
          placeholder="例如：像数码老用户聊天，少用感叹号；信息不足就简短追问。留空使用自然口语模板。"></textarea>
        <span class="hint-sm">默认会避开“感谢分享、值得入手”等套话，并围绕原文中的具体细节回复。</span>
      </div>

      <div class="row" style="border:none;padding-bottom:0">
        <span class="muted">状态：{{ cfg.enabled ? '已启用' : '已停用' }}</span>
        <span class="tag" :class="cfg.enabled ? 'on' : 'off'">{{ cfg.enabled ? 'ON' : 'OFF' }}</span>
      </div>

      <p v-if="!serverConfigured" class="warn">⚠️ 请先在上方填写并保存 API 密钥，否则自动评论不会运行。</p>
      <p v-else class="ok-line">✓ AI 服务已配置，可生成回复和商品短评。</p>
    </section>

    <section class="card rise" style="animation-delay:.15s">
      <div class="t" style="margin-bottom:10px">测试生成回复</div>
      <div class="field">
        <label>待回复内容</label>
        <textarea v-model="inputText" class="textarea" placeholder="粘贴一条评论或私信内容，点击生成回复。"></textarea>
      </div>
      <button class="btn sm" :disabled="genBusy" @click="genReply">生成回复</button>
      <div v-if="replyResult" class="reply">{{ replyResult }}</div>
      <p v-if="replyErr" class="warn">{{ replyErr }}</p>
    </section>

    <section class="card rise" style="animation-delay:.2s">
      <div class="t" style="margin-bottom:10px">定时批量生成</div>
      <div class="d sub2">从「好价爆料」列表取内容，调用大模型批量生成评论草稿（可选自动发布为评论）。</div>

      <div class="row" style="border:none;padding-top:12px">
        <div class="l">
          <div class="t">启用定时生成</div>
          <div class="d">开启后按下方计划由后端自动运行（需先在上方启用自动回复）</div>
        </div>
        <label class="switch">
          <input type="checkbox" :checked="gptTask?.enabled" @change="toggleGpt" />
          <span class="slider"></span>
        </label>
      </div>

      <div class="field">
        <label>运行计划（cron）</label>
        <input class="input" v-model="gptTaskCron" placeholder="30 21 * * *" @change="saveCron" />
        <span class="hint-sm">分 时 日 月 周，如每天 21:30 → 30 21 * * *</span>
      </div>

      <div class="field" style="display:flex;gap:14px;align-items:flex-end">
        <div style="flex:1">
          <label>每次处理条数（1~10）</label>
          <input class="input" type="number" min="1" max="10" v-model.number="gptTaskLimit" @change="saveLimit" />
        </div>
        <label class="switch" style="margin-bottom:8px">
          <input type="checkbox" :checked="gptTask?.autoPost" @change="toggleAutoPost" />
          <span class="slider"></span>
        </label>
        <div style="font-size:12px;color:var(--text-dim);margin-bottom:10px">生成后自动发布为评论</div>
      </div>

      <button class="btn sm" :disabled="runBusy" @click="runBatch">立即生成</button>
      <p v-if="runErr" class="warn">{{ runErr }}</p>
      <p v-if="runMsg" class="ok-line">{{ runMsg }}</p>

      <div v-if="drafts.length" class="drafts">
        <div class="drafts-head">AI 评论草稿（{{ drafts.length }}）</div>
        <div v-for="d in drafts" :key="d.id" class="draft">
          <div class="draft-body">{{ d.content }}</div>
          <div class="draft-meta">
            <span class="tag" :class="d.status === 'posted' ? 'on' : (d.status === 'post_failed' ? 'off' : '')">{{ statusText(d.status) }}</span>
            <button class="btn ghost xs" @click="copyDraft(d)"><span :id="'copied-' + d.id">复制</span></button>
            <button class="btn ghost xs" @click="delDraft(d)">删除</button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import api from '../api/client.js';
import GptProviderConfig from '../components/GptProviderConfig.vue';

const cfg = ref({
  enabled: false,
  target: 'comment',
  tone: 'friendly',
  prompt: '',
  apiBase: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  hasApiKey: false,
  hasSavedApiKey: false,
  keySource: 'none'
});
const serverConfigured = ref(false);
const inputText = ref('');
const genBusy = ref(false);
const replyResult = ref('');
const replyErr = ref('');

// A-11：完整 GPT 配置以服务端为唯一真相源（GptProviderConfig 已服务端化），
// 前端不再把 apiBase / model / keySource / hasApiKey 等配置写入 localStorage，
// 避免同源 XSS / 恶意扩展读取这些配置；仅持服务端下发的 serverConfigured 标记用于 UI 提示。
async function load() {
  try {
    const { data } = await api.get('/gpt/config');
    if (data?.config) {
      cfg.value = { ...cfg.value, ...data.config };
      serverConfigured.value = !!data.config.configured;
    }
  } catch {
    /* 旧后端/未登录：退回本地配置 */
  }
  try {
    const { data } = await api.get('/gpt/status');
    serverConfigured.value = !!data?.configured;
  } catch {
    serverConfigured.value = false;
  }
}

async function save() {
  try {
    await api.put('/gpt/config', {
      enabled: cfg.value.enabled,
      target: cfg.value.target,
      tone: cfg.value.tone,
      prompt: cfg.value.prompt
    });
  } catch {
    /* 旧后端/未登录：仅保留本地，不阻断 */
  }
}

function applyProviderConfig(next) {
  cfg.value = { ...cfg.value, ...next };
  serverConfigured.value = !!next?.configured;
}

async function genReply() {
  genBusy.value = true;
  replyErr.value = '';
  replyResult.value = '';
  try {
    const { data } = await api.post('/gpt/reply', { text: inputText.value });
    replyResult.value = data?.reply || '';
  } catch (e) {
    replyErr.value = e.response?.data?.message || '生成失败';
  } finally {
    genBusy.value = false;
  }
}

// ===== 定时批量生成 =====
const gptTask = ref(null);
const gptTaskCron = ref('30 21 * * *');
const gptTaskLimit = ref(3);
const runBusy = ref(false);
const runErr = ref('');
const runMsg = ref('');
const drafts = ref([]);

function statusText(s) {
  return (
    { generated: '待发布', posted: '已发布', post_failed: '发布失败', pending: '待处理' }[s] ||
    s ||
    '待处理'
  );
}

async function loadGptTask() {
  try {
    const { data } = await api.get('/tasks');
    const t = (data.list || []).find((x) => x.id === 't_gpt');
    if (t) {
      gptTask.value = t;
      gptTaskCron.value = t.cron || '30 21 * * *';
      gptTaskLimit.value = t.limit || 3;
    }
  } catch {
    /* ignore */
  }
}
async function saveGptTask(patch) {
  try {
    await api.put('/tasks/t_gpt', patch);
  } catch (e) {
    runErr.value = e.response?.data?.message || '保存失败';
  }
}
function toggleGpt(e) {
  saveGptTask({ enabled: e.target.checked });
  if (gptTask.value) gptTask.value.enabled = e.target.checked;
}
function saveCron() {
  if (!gptTaskCron.value?.trim()) return;
  saveGptTask({ cron: gptTaskCron.value.trim() });
}
function saveLimit() {
  const v = Math.min(10, Math.max(1, Number(gptTaskLimit.value) || 3));
  gptTaskLimit.value = v;
  saveGptTask({ limit: v });
}
function toggleAutoPost(e) {
  saveGptTask({ autoPost: e.target.checked });
  if (gptTask.value) gptTask.value.autoPost = e.target.checked;
}
async function loadDrafts() {
  try {
    const { data } = await api.get('/gpt/drafts');
    drafts.value = data.items || [];
  } catch {
    /* ignore */
  }
}
async function runBatch() {
  runBusy.value = true;
  runErr.value = '';
  runMsg.value = '';
  try {
    const { data } = await api.post('/tasks/t_gpt/run');
    runMsg.value = data?.result?.message || '生成完成';
    await loadDrafts();
  } catch (e) {
    runErr.value = e.response?.data?.message || '生成失败';
  } finally {
    runBusy.value = false;
  }
}
async function copyDraft(d) {
  try {
    await navigator.clipboard.writeText(d.content);
    showCopy(d.id);
  } catch {
    /* 复制失败不阻断 */
  }
}
async function delDraft(d) {
  try {
    await api.delete(`/gpt/drafts/${d.id}`);
    drafts.value = drafts.value.filter((x) => x.id !== d.id);
  } catch {
    /* ignore */
  }
}
// P2-13：复制提示计时器保存引用，组件卸载时清理，避免卸载后修改已卸载 DOM
let copyTimer = null;
function showCopy(id) {
  const el = document.getElementById('copied-' + id);
  if (el) {
    el.textContent = '已复制';
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (el.textContent = '复制'), 1200);
  }
}
onUnmounted(() => { if (copyTimer) clearTimeout(copyTimer); });

onMounted(async () => {
  await load();
  await loadGptTask();
  await loadDrafts();
});
</script>

<style scoped>
.switch {
  position: relative;
  display: inline-block;
  width: 42px;
  height: 24px;
  flex: none;
}
.switch input {
  display: none;
}
.slider {
  position: absolute;
  inset: 0;
  background: var(--surface-strong);
  border: 1px solid var(--border);
  border-radius: 999px;
  transition: 0.2s;
}
.slider::before {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  left: 3px;
  top: 2px;
  border-radius: 50%;
  background: var(--text-dim);
  transition: 0.2s;
}
.switch input:checked + .slider {
  background: var(--primary-soft);
  border-color: var(--primary);
}
.switch input:checked + .slider::before {
  transform: translateX(18px);
  background: var(--primary);
}
.field {
  margin: 16px 0;
}
.field label {
  display: block;
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.input,
.textarea {
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  outline: none;
  font-family: inherit;
}
.input:focus,
.textarea:focus {
  border-color: var(--primary);
}
.textarea {
  min-height: 76px;
  resize: vertical;
}
.btn.sm {
  padding: 9px 16px;
  font-size: 13px;
  border-radius: 10px;
  border: 1px solid var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
  cursor: pointer;
}
.btn.sm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.reply {
  margin-top: 12px;
  padding: 12px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.warn {
  font-size: 11px;
  color: #ffb3ac;
  margin: 14px 0 0;
  line-height: 1.6;
}
.ok-line {
  font-size: 11px;
  color: #b7f3c6;
  margin: 14px 0 0;
}
.sub2 {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.6;
}
.drafts {
  margin-top: 16px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.drafts-head {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.draft {
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  margin-bottom: 8px;
}
.draft-body {
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.draft-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.btn.ghost.xs {
  padding: 5px 10px;
  font-size: 11px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
}
.btn.ghost.xs:hover {
  border-color: var(--primary);
  color: var(--primary);
}
</style>
