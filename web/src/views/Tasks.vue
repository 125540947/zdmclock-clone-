<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>自动任务</h1>
        <div class="sub">启用后由后端按 cron 自动执行（已接入调度器）</div>
      </div>
    </header>

    <section class="card rise" style="animation-delay: 0.05s">
      <div v-for="t in tasks" :key="t.id" class="task">
        <div class="task-ico">{{ t.icon }}</div>
        <div class="task-meta">
          <div class="t">{{ t.name }}</div>
          <div class="d">
            {{ t.type }} · {{ t.cron }}
            <span v-if="t.lastRun" class="muted"> · 上次 {{ t.lastRun }}</span>
          </div>
          <div v-if="t.lastResult" class="res">{{ t.lastResult }}</div>
          <div v-if="t.type !== 'clock'" class="art">
            <input
              class="input sm"
              v-model="t.articleId"
              placeholder="目标文章ID或链接，如 123456 / https://www.smzdm.com/p/123456"
              @change="saveArticleId(t)"
            />
            <span class="hint-sm">评论/收藏/点赞需指定目标文章，否则运行会报错</span>
          </div>
        </div>
        <div class="task-actions">
          <label class="switch">
            <input type="checkbox" :checked="t.enabled" @change="toggle(t, $event)" />
            <span class="slider"></span>
          </label>
          <button class="btn ghost sm" :disabled="busy === t.id" @click="run(t)">运行</button>
        </div>
      </div>
    </section>

    <transition name="toast">
      <div v-if="toast" class="toast" :class="toastType">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '../api/client.js';

const tasks = ref([]);
const busy = ref('');
const toast = ref('');
const toastType = ref('ok');

function showToast(m, t = 'ok') {
  toast.value = m;
  toastType.value = t;
  setTimeout(() => (toast.value = ''), 2400);
}

async function load() {
  const { data } = await api.get('/tasks');
  tasks.value = data.list || [];
}
async function toggle(t, e) {
  await api.put(`/tasks/${t.id}`, { enabled: e.target.checked });
  t.enabled = e.target.checked;
  showToast('已更新');
}
async function saveArticleId(t) {
  try {
    await api.put(`/tasks/${t.id}`, { articleId: t.articleId || '' });
    showToast('已保存目标文章');
  } catch (e) {
    showToast(e.response?.data?.message || '保存失败', 'err');
  }
}
async function run(t) {
  busy.value = t.id;
  try {
    const { data } = await api.post(`/tasks/${t.id}/run`);
    showToast(data.result?.message || '执行完成');
    await load();
  } catch (e) {
    showToast(e.response?.data?.message || '执行失败', 'err');
  } finally {
    busy.value = '';
  }
}
onMounted(load);
</script>

<style scoped>
.task {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.task:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.task-ico {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 20px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.task-meta {
  flex: 1;
}
.task-meta .t {
  font-size: 15px;
  font-weight: 600;
}
.task-meta .d {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 2px;
}
.task-meta .res {
  font-size: 12px;
  color: var(--gold);
  margin-top: 3px;
}
.task-meta .art {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.task-meta .art .input {
  width: 100%;
  max-width: 360px;
}
.input.sm {
  padding: 7px 10px;
  font-size: 12px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  outline: none;
}
.input.sm:focus {
  border-color: var(--primary);
}
.hint-sm {
  font-size: 10px;
  color: var(--text-faint);
}
.task-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.btn.sm {
  padding: 8px 12px;
  font-size: 12px;
  border-radius: 10px;
}
.switch {
  position: relative;
  display: inline-block;
  width: 42px;
  height: 24px;
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
.toast {
  position: fixed;
  left: 50%;
  bottom: 100px;
  transform: translateX(-50%);
  z-index: 50;
  padding: 12px 18px;
  border-radius: 12px;
  font-size: 14px;
  background: rgba(20, 17, 15, 0.92);
  border: 1px solid var(--border-strong);
}
.toast.ok {
  border-color: rgba(120, 224, 143, 0.5);
  color: #b7f3c6;
}
.toast.err {
  border-color: rgba(255, 90, 77, 0.6);
  color: #ffb3ac;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}
</style>
