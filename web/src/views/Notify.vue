<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>推送通知</h1>
        <div class="sub">签到 / 任务执行结果会推送到此处配置的渠道</div>
      </div>
    </header>

    <section class="card rise" style="animation-delay:0.05s">
      <div class="row between">
        <span class="card-title">启用推送</span>
        <label class="switch">
          <input type="checkbox" v-model="enabled" />
          <span class="slider"></span>
        </label>
      </div>

      <p class="card-title" style="margin-top:16px">推送渠道</p>
      <div class="chips">
        <button
          v-for="c in channels"
          :key="c.value"
          class="chip"
          :class="{ on: channel === c.value }"
          @click="channel = c.value"
        >{{ c.label }}</button>
      </div>

      <p class="hint-sm" style="margin-top:8px">{{ channelHint }}</p>

      <div v-if="channel !== 'none'" class="fields">
        <template v-if="channel === 'webhook'">
          <label class="lb">Webhook 地址</label>
          <input class="input" v-model="webhook" placeholder="https://your.service/hook" />
        </template>
        <template v-else>
          <label class="lb">{{ tokenLabel }}</label>
          <input class="input" v-model="token" :placeholder="tokenPlaceholder" />
          <label v-if="channel === 'telegram'" class="lb" style="margin-top:12px">Chat ID</label>
          <input
            v-if="channel === 'telegram'"
            class="input"
            v-model="chatId"
            placeholder="Telegram 聊天 ID"
          />
          <label v-if="channel === 'bark'" class="lb" style="margin-top:12px">自建服务地址（可选）</label>
          <input
            v-if="channel === 'bark'"
            class="input"
            v-model="webhook"
            placeholder="留空用默认 https://api.day.app"
          />
        </template>
      </div>

      <div class="actions">
        <button class="btn primary" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存配置' }}
        </button>
        <button class="btn ghost" :disabled="testing || channel === 'none'" @click="test">
          {{ testing ? '发送中…' : '发送测试' }}
        </button>
      </div>

      <p v-if="msg" class="msg" :class="msgType">{{ msg }}</p>
    </section>

    <p class="foot">
      推送为「尽力而为」：网络异常或渠道拒绝不会影响签到 / 任务主流程。未配置时所有推送静默跳过。
    </p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '../api/client.js';

const channels = [
  { value: 'none', label: '关闭' },
  { value: 'serverchan', label: 'Server酱' },
  { value: 'bark', label: 'Bark' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'webhook', label: '自定义 Webhook' }
];

const enabled = ref(false);
const channel = ref('serverchan');
const token = ref('');
const chatId = ref('');
const webhook = ref('');

const saving = ref(false);
const testing = ref(false);
const msg = ref('');
const msgType = ref('ok');

const tokenLabel = computed(() =>
  channel.value === 'telegram' ? 'Bot Token' : channel.value === 'bark' ? '设备 Key' : '令牌 / SendKey'
);
const tokenPlaceholder = computed(() =>
  channel.value === 'telegram'
    ? '123456:ABCdef…'
    : channel.value === 'bark'
    ? 'Bark 设备 Key'
    : 'Server酱 SendKey'
);

const channelHint = computed(() => {
  switch (channel.value) {
    case 'serverchan':
      return '在 sct.ftqq.com 获取 SendKey 填入下方「令牌」。';
    case 'bark':
      return '在 Bark App 复制设备 Key 填入「令牌」；自建服务可在下方填地址。';
    case 'telegram':
      return '向 @BotFather 创建 Bot 得到 Token 填「令牌」，再获取 chat_id 填「Chat ID」。';
    case 'webhook':
      return '任意可接收 POST JSON 的地址（企业微信 / 钉钉 / 自定义）。请求体含 {title, message, text}。';
    default:
      return '关闭后不会发送任何推送。';
  }
});

async function load() {
  try {
    const { data } = await api.get('/notify/config');
    enabled.value = !!data.enabled;
    channel.value = data.channel || 'serverchan';
    token.value = data.token || '';
    chatId.value = data.chatId || '';
    webhook.value = data.webhook || '';
  } catch (e) {
    /* 忽略加载失败 */
  }
}

async function save() {
  saving.value = true;
  msg.value = '';
  try {
    await api.put('/notify/config', {
      enabled: enabled.value,
      channel: channel.value,
      token: token.value,
      chatId: chatId.value,
      webhook: webhook.value
    });
    msgType.value = 'ok';
    msg.value = '配置已保存';
  } catch (e) {
    msgType.value = 'err';
    msg.value = e.response?.data?.message || '保存失败';
  } finally {
    saving.value = false;
  }
}

async function test() {
  testing.value = true;
  msg.value = '';
  try {
    await api.post('/notify/test');
    msgType.value = 'ok';
    msg.value = '测试推送已发送，请查收';
  } catch (e) {
    msgType.value = 'err';
    msg.value = e.response?.data?.message || '测试推送失败';
  } finally {
    testing.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.row.between {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hint-sm {
  font-size: 11px;
  color: var(--text-faint);
  line-height: 1.6;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.chip {
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.18s;
}
.chip.on {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-soft);
}
.fields {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lb {
  font-size: 12px;
  color: var(--text-dim);
}
.input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  font-family: var(--font-body);
}
.input:focus {
  outline: none;
  border-color: var(--primary);
}
.actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}
.btn {
  flex: 1;
  padding: 11px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.18s;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
.btn.ghost:hover {
  border-color: var(--primary);
  color: var(--primary);
}
.msg {
  margin-top: 12px;
  font-size: 12px;
}
.msg.ok {
  color: #7ee0a0;
}
.msg.err {
  color: #ff9a9a;
}
.foot {
  font-size: 11px;
  color: var(--text-faint);
  text-align: center;
  line-height: 1.6;
  margin-top: 14px;
}
.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}
.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}
.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  transition: 0.2s;
}
.slider::before {
  content: '';
  position: absolute;
  height: 16px;
  width: 16px;
  left: 3px;
  top: 3px;
  background: var(--text-dim);
  border-radius: 50%;
  transition: 0.2s;
}
.switch input:checked + .slider {
  background: var(--primary);
  border-color: var(--primary);
}
.switch input:checked + .slider::before {
  transform: translateX(20px);
  background: #fff;
}
</style>
