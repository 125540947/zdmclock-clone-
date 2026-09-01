<template>
  <section class="card rise" style="animation-delay:.05s">
    <div class="title">AI 模型配置</div>
    <div class="description">选择常用第三方服务，或接入任意 OpenAI 兼容接口。密钥只保存到服务器，页面不会再次显示明文。</div>

    <div class="field">
      <label>模型服务商</label>
      <select
        v-model="selectedProvider"
        data-test="provider-preset"
        class="input"
        @change="applyProviderPreset"
      >
        <option v-for="provider in providers" :key="provider.id" :value="provider.id">
          {{ provider.label }}
        </option>
      </select>
      <span class="hint">{{ providerHint }}</span>
    </div>

    <div class="provider-grid">
      <div class="field">
        <label>接口地址</label>
        <input
          v-model.trim="apiBase"
          data-test="api-base"
          class="input"
          placeholder="https://api.openai.com/v1"
        />
        <span class="hint">填写服务商的 OpenAI 兼容地址，系统会自动补全 /chat/completions</span>
      </div>
      <div class="field">
        <label>模型名称</label>
        <div class="model-row">
          <input
            v-model.trim="model"
            data-test="model"
            class="input"
            placeholder="gpt-4o-mini"
            list="gpt-model-list"
          />
          <button
            type="button"
            class="fetch-models-button"
            data-test="fetch-models"
            :disabled="fetchingModels"
            @click="fetchModels"
          >{{ fetchingModels ? '获取中…' : '获取模型' }}</button>
        </div>
        <datalist id="gpt-model-list">
          <option v-for="m in availableModels" :key="m" :value="m">{{ m }}</option>
        </datalist>
        <span class="hint">可点击「获取模型」从服务商拉取可用模型，或从预设自动带入；也支持手动填写自定义模型名。</span>
      </div>
    </div>

    <div class="field">
      <label>API 密钥</label>
      <input
        v-model="apiKeyInput"
        data-test="api-key"
        class="input"
        type="password"
        autocomplete="new-password"
        :placeholder="config.hasApiKey ? '已配置；留空表示保持不变' : '请输入 API Key'"
      />
    </div>

    <div class="provider-actions">
      <button class="save-button" data-test="save-provider" :disabled="busy" @click="saveProvider">
        {{ busy ? '保存中…' : '保存 AI 配置' }}
      </button>
      <button
        v-if="config.hasSavedApiKey"
        class="clear-button"
        :disabled="busy"
        @click="clearProviderKey"
      >清除已保存密钥</button>
      <span class="provider-state" :class="configured ? 'ready' : 'missing'">
        {{ configured ? `✓ 已配置（${sourceText}）` : '尚未配置密钥' }}
      </span>
    </div>
    <p v-if="message" class="ok-line">{{ message }}</p>
    <p v-if="error" class="warn">{{ error }}</p>
    <p v-if="modelsError" class="warn">{{ modelsError }}</p>
  </section>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import api from '../api/client.js';
import { fetchGptModels } from '../api/client.js';
import { AI_PROVIDER_PRESETS, identifyAiProvider } from '../config/aiProviderPresets.js';

const props = defineProps({
  config: { type: Object, required: true },
  configured: { type: Boolean, default: false }
});
const emit = defineEmits(['updated']);

const apiBase = ref('https://api.openai.com/v1');
const model = ref('gpt-4o-mini');
const selectedProvider = ref('openai');
const apiKeyInput = ref('');
const busy = ref(false);
const message = ref('');
const error = ref('');
const availableModels = ref([]);
const fetchingModels = ref(false);
const modelsError = ref('');
const sourceText = computed(() => props.config.keySource === 'environment' ? '服务器环境' : '网页保存');
const providers = AI_PROVIDER_PRESETS;
const providerHint = computed(() => (
  providers.find((item) => item.id === selectedProvider.value)?.hint || ''
));

watch(
  () => props.config,
  (value) => {
    apiBase.value = value?.apiBase || 'https://api.openai.com/v1';
    model.value = value?.model || 'gpt-4o-mini';
    selectedProvider.value = identifyAiProvider(apiBase.value);
  },
  { immediate: true, deep: true }
);

watch(apiBase, (value) => {
  selectedProvider.value = identifyAiProvider(value);
});

function applyProviderPreset() {
  const preset = providers.find((item) => item.id === selectedProvider.value);
  if (!preset || preset.id === 'custom') return;
  apiBase.value = preset.apiBase;
  model.value = preset.model;
}

// 从服务商拉取可用模型列表（OpenAI 兼容 /models），结果作为模型名称输入框的候选。
async function fetchModels() {
  if (!apiBase.value.trim()) {
    modelsError.value = '请先填写接口地址';
    return;
  }
  fetchingModels.value = true;
  modelsError.value = '';
  try {
    const { data } = await fetchGptModels();
    const list = Array.isArray(data?.models) ? data.models : [];
    availableModels.value = list;
    if (!list.length) {
      modelsError.value = '未获取到模型列表，请确认接口地址与密钥正确（部分本地服务可能不支持 /models）';
    } else if (!model.value || !list.includes(model.value)) {
      // 当前未选或所选不在列表中时，默认选中第一项，方便直接采用。
      model.value = list[0];
    }
  } catch (e) {
    modelsError.value = e.response?.data?.message || '获取模型列表失败';
  } finally {
    fetchingModels.value = false;
  }
}

async function saveProvider() {
  busy.value = true;
  message.value = '';
  error.value = '';
  modelsError.value = '';
  try {
    const payload = { apiBase: apiBase.value, model: model.value };
    if (apiKeyInput.value.trim()) payload.apiKey = apiKeyInput.value.trim();
    const { data } = await api.put('/gpt/config', payload);
    apiKeyInput.value = '';
    if (data?.config) emit('updated', data.config);
    message.value = data?.config?.configured
      ? 'AI 配置已保存，可以启用自动回复。'
      : '接口和模型已保存，请继续填写 API 密钥。';
  } catch (e) {
    error.value = e.response?.data?.message || 'AI 配置保存失败';
  } finally {
    busy.value = false;
  }
}

async function clearProviderKey() {
  if (!window.confirm('确定清除网页保存的 API 密钥吗？')) return;
  busy.value = true;
  message.value = '';
  error.value = '';
  try {
    const { data } = await api.put('/gpt/config', { clearApiKey: true });
    if (data?.config) emit('updated', data.config);
    message.value = data?.config?.configured
      ? '已清除网页密钥，当前继续使用服务器环境密钥。'
      : '已清除 API 密钥。';
  } catch (e) {
    error.value = e.response?.data?.message || '清除失败';
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.title { font-size: 15px; font-weight: 650; margin-bottom: 4px; }
.description, .hint { color: var(--text-dim); font-size: 12px; line-height: 1.6; }
.provider-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(180px, .8fr); gap: 12px; }
.model-row { display: flex; align-items: stretch; gap: 8px; }
.model-row .input { flex: 1; }
.fetch-models-button {
  flex: none; padding: 0 14px; font-size: 12px; white-space: nowrap; border-radius: 10px; cursor: pointer;
  background: var(--surface-2); color: var(--text); border: 1px solid var(--border);
}
.fetch-models-button:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
.fetch-models-button:disabled { opacity: .5; cursor: not-allowed; }
.field { margin: 16px 0; }
.field label { display: block; font-size: 12px; color: var(--text-dim); margin-bottom: 6px; }
.input {
  width: 100%; padding: 10px 12px; font-size: 13px; border-radius: 10px;
  border: 1px solid var(--border); background: var(--surface-2); color: var(--text); outline: none;
}
.input:focus { border-color: var(--primary); }
.provider-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.save-button, .clear-button {
  padding: 9px 16px; font-size: 13px; border-radius: 10px; cursor: pointer;
  background: var(--primary-soft); color: var(--primary); border: 1px solid var(--primary);
}
.clear-button { color: #ffb3ac; border-color: rgba(255, 90, 77, .35); background: transparent; }
.save-button:disabled, .clear-button:disabled { opacity: .5; cursor: not-allowed; }
.provider-state { font-size: 12px; margin-left: auto; }
.provider-state.ready, .ok-line { color: #b7f3c6; }
.provider-state.missing, .warn { color: #ffb3ac; }
.ok-line, .warn { font-size: 11px; margin: 14px 0 0; line-height: 1.6; }
@media (max-width: 680px) {
  .provider-grid { grid-template-columns: 1fr; gap: 0; }
  .provider-state { width: 100%; margin-left: 0; }
}
</style>
