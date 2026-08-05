<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>GPT 自动回复</h1>
        <div class="sub">配置评论区自动回复（已接入后端真实大模型）</div>
      </div>
    </header>

    <section class="card rise" style="animation-delay:.05s">
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
          <option value="friendly">亲切友善</option>
          <option value="pro">专业客观</option>
          <option value="humor">幽默轻松</option>
        </select>
      </div>

      <div class="field">
        <label>提示词模板（可选）</label>
        <textarea v-model="cfg.prompt" class="textarea" @change="save"
          placeholder="例如：适当提及性价比，避免夸张用词。留空则使用默认模板。"></textarea>
      </div>

      <div class="row" style="border:none;padding-bottom:0">
        <span class="muted">状态：{{ cfg.enabled ? '已启用' : '已停用' }}</span>
        <span class="tag" :class="cfg.enabled ? 'on' : 'off'">{{ cfg.enabled ? 'ON' : 'OFF' }}</span>
      </div>

      <p v-if="!serverConfigured" class="warn">
        ⚠️ 服务端未配置 GPT_API_KEY，即使启用也无法调用大模型。请在服务端 .env 设置 GPT_API_KEY（及可选的 GPT_API_BASE / GPT_MODEL）后重启。
      </p>
      <p v-else class="ok-line">✓ 服务端已配置大模型接口，可直接生成回复。</p>
    </section>

    <section class="card rise" style="animation-delay:.1s">
      <div class="t" style="margin-bottom:10px">测试生成回复</div>
      <div class="field">
        <label>待回复内容</label>
        <textarea v-model="inputText" class="textarea" placeholder="粘贴一条评论或私信内容，点击生成回复。"></textarea>
      </div>
      <button class="btn sm" :disabled="genBusy" @click="genReply">生成回复</button>
      <div v-if="replyResult" class="reply">{{ replyResult }}</div>
      <p v-if="replyErr" class="warn">{{ replyErr }}</p>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '../api/client.js';

const KEY = 'zdm_gpt_reply';
const cfg = ref({ enabled: false, target: 'comment', tone: 'friendly', prompt: '' });
const serverConfigured = ref(false);
const inputText = ref('');
const genBusy = ref(false);
const replyResult = ref('');
const replyErr = ref('');

function readLocal() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    cfg.value = { ...cfg.value, ...s };
  } catch {
    /* ignore */
  }
}
function saveLocal() {
  localStorage.setItem(KEY, JSON.stringify(cfg.value));
}

async function load() {
  readLocal();
  try {
    const { data } = await api.get('/gpt/config');
    if (data?.config) cfg.value = { ...cfg.value, ...data.config };
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
  saveLocal();
  try {
    await api.put('/gpt/config', cfg.value);
  } catch {
    /* 旧后端/未登录：仅保留本地，不阻断 */
  }
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
    genBusy.value = '';
  }
}

onMounted(load);
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
</style>
