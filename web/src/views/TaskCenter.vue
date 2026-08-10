<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>{{ title }}</h1>
        <div class="sub">{{ desc }}</div>
      </div>
    </header>

    <section class="card rise" style="animation-delay:.05s" v-if="task">
      <div class="top">
        <div class="ti">{{ icon }}</div>
        <div class="tm">
          <div class="t1">{{ task.name }}</div>
          <div class="d">计划 {{ task.cron }}<span v-if="task.lastRun" class="muted"> · 上次 {{ task.lastRun }}</span></div>
        </div>
        <label class="switch">
          <input type="checkbox" :checked="task.enabled" @change="toggle($event)" />
          <span class="slider"></span>
        </label>
      </div>

      <div class="ctrl">
        <div class="field" style="margin:0">
          <label>单次执行条数：{{ count }}</label>
          <input type="range" min="1" max="10" v-model.number="count" class="range" />
        </div>
        <button class="btn block" :disabled="busy" @click="run">{{ busy ? '执行中…' : '立即执行一次' }}</button>
      </div>

      <div v-if="task.lastResult" class="res">最近结果：{{ task.lastResult }}</div>
      <div v-if="task.status === 'error'" class="res err">⚠️ 上次执行出错（real 适配器未配置真实接口时会报错，属正常）</div>
    </section>

    <div v-else class="card rise empty">加载中…</div>

    <transition name="toast">
      <div v-if="toast" class="toast" :class="toastType">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '../api/client.js';
import { useToast } from '../composables/useToast.js';

const props = defineProps({
  taskId: { type: String, required: true },
  title: { type: String, required: true },
  icon: { type: String, default: '⚙️' },
  desc: { type: String, default: '' }
});

const task = ref(null);
const count = ref(1);
const busy = ref(false);
const { toast, toastType, showToast } = useToast();


async function load() {
  const { data } = await api.get('/tasks');
  task.value = (data.list || []).find((t) => t.id === props.taskId) || null;
}
async function toggle(e) {
  const enabled = e.target.checked;
  await api.put(`/tasks/${props.taskId}`, { enabled });
  if (task.value) task.value.enabled = enabled;
  showToast(enabled ? '已启用（将按计划自动执行）' : '已停用');
}
async function run() {
  busy.value = true;
  try {
    const { data } = await api.post(`/tasks/${props.taskId}/run`, { count: count.value });
    showToast(data.result?.message || '执行完成');
    await load();
  } catch (e) {
    showToast(e.response?.data?.message || '执行失败', 'err');
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>

<style scoped>
.top {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.ti {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 20px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.tm {
  flex: 1;
}
.tm .t1 {
  font-size: 16px;
  font-weight: 600;
}
.tm .d {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 3px;
}
.ctrl {
  border-top: 1px solid var(--border);
  padding-top: 16px;
}
.range {
  width: 100%;
  accent-color: var(--primary);
}
.res {
  margin-top: 14px;
  font-size: 12px;
  color: var(--gold);
}
.res.err {
  color: #ffb3ac;
}
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
