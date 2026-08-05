<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>GPT 自动回复</h1>
        <div class="sub">配置评论区自动回复（本地设置）</div>
      </div>
    </header>

    <section class="card rise" style="animation-delay:.05s">
      <div class="row" style="border:none;padding-top:0">
        <div class="l">
          <div class="t">启用自动回复</div>
          <div class="d">开启后由后端按任务调度执行</div>
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
        <label>提示词模板</label>
        <textarea v-model="cfg.prompt" class="textarea" @change="save"
          placeholder="例如：根据用户提问，用{语气}的口吻，回答关于好价的问题，不超过 50 字。"></textarea>
      </div>

      <div class="row" style="border:none;padding-bottom:0">
        <span class="muted">状态：{{ cfg.enabled ? '已启用' : '已停用' }}</span>
        <span class="tag" :class="cfg.enabled ? 'on' : 'off'">{{ cfg.enabled ? 'ON' : 'OFF' }}</span>
      </div>
      <p class="hint">当前配置仅保存在本机（localStorage）。要让后端真正调用大模型自动回复，需在 server 侧新增 GPT 任务类型与适配器（可后续扩展）。</p>
    </section>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const KEY = 'zdm_gpt_reply';
const cfg = ref({ enabled: false, target: 'comment', tone: 'friendly', prompt: '' });

function read() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    cfg.value = { ...cfg.value, ...s };
  } catch {
    /* ignore */
  }
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(cfg.value));
}
onMounted(read);
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
.hint {
  font-size: 11px;
  color: var(--text-faint);
  margin: 14px 0 0;
  line-height: 1.6;
}
</style>
