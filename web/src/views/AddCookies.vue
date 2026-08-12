<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>录入账号</h1>
        <div class="sub">添加你的 smzdm Cookie 以启用自动化</div>
      </div>
    </header>

    <section class="card rise" style="animation-delay: 0.05s">
      <p class="muted" style="margin-top: 0">
        在浏览器登录 smzdm 后，从开发者工具 → Application → Cookies 复制
        <code>Cookie</code> 请求头完整内容粘贴到下方。数据仅存于本地 JSON 文件。
      </p>
      <div class="field">
        <label>昵称（可选）</label>
        <input v-model="nickname" class="input" placeholder="如：我的小号" />
      </div>
      <div class="field">
        <label>smzdmId（可选）</label>
        <input v-model="smzdmId" class="input" placeholder="留空将自动识别" />
      </div>
      <div class="field">
        <label>Cookie <span class="primary-text">*</span></label>
        <textarea v-model="cookie" class="textarea" placeholder="粘贴完整 Cookie 字符串…"></textarea>
      </div>
      <div class="field row" style="align-items:center; gap:10px;">
        <input id="autoRun" v-model="autoRun" type="checkbox" style="width:auto; transform:scale(1.2);" />
        <label for="autoRun" style="margin:0; cursor:pointer;">录入后自动跑任务（签到/互动等）</label>
      </div>

      <div class="field">
        <label>🚀 智能启动调度</label>
        <div class="seg">
          <button
            v-for="m in schedModes"
            :key="m.value"
            type="button"
            class="seg-btn"
            :class="{ active: schedMode === m.value }"
            @click="schedMode = m.value"
          >{{ m.label }}</button>
        </div>
        <div v-if="schedMode === 'manual'" class="sched-time">
          <input type="time" step="60" v-model="schedTime" />
          <span class="hint">手动指定每日启动时间（届时触发完整日常流水线：签到/互动/抽奖等）。</span>
        </div>
        <p v-else class="hint">
          系统将在 08:00~10:59 窗口内自动分配一个分散的固定启动时间，避免多账号同时启动造成 VPS 卡顿。
        </p>
      </div>
      <button class="btn block" :disabled="saving || !cookie" @click="submit">
        {{ saving ? '保存中…' : '保存账号' }}
      </button>
    </section>

    <transition name="toast">
      <div v-if="toast" class="toast" :class="toastType">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api/client.js';
import { useToast } from '../composables/useToast.js';

const router = useRouter();
const nickname = ref('');
const smzdmId = ref('');
const cookie = ref('');
const autoRun = ref(true);
const saving = ref(false);
// 智能启动调度：默认 auto（系统按账号错峰分配启动时间，遵守第一定律）；可切换 manual 自定义。
const schedMode = ref('auto');
const schedTime = ref('09:00');
const schedModes = [
  { value: 'auto', label: '系统自动' },
  { value: 'manual', label: '手动指定' }
];
const { toast, toastType, showToast } = useToast();

// P2-13：跳转计时器保存引用，组件卸载时清理，避免卸载后 router.push 访问已卸载组件
let navTimer = null;
onUnmounted(() => { if (navTimer) clearTimeout(navTimer); });


async function submit() {
  saving.value = true;
  try {
    await api.post('/users', {
      nickname: nickname.value.trim(),
      smzdmId: smzdmId.value.trim(),
      cookie: cookie.value.trim(),
      autoRun: autoRun.value,
      schedMode: schedMode.value,
      ...(schedMode.value === 'manual' ? { checkInTime: schedTime.value } : {})
    });
    showToast('账号已保存');
    navTimer = setTimeout(() => router.push({ name: 'users' }), 900);
  } catch (e) {
    showToast(e.response?.data?.message || '保存失败', 'err');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
code {
  background: var(--surface-2);
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--gold);
}
.seg {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  margin: 8px 0 4px;
}
.seg-btn {
  flex: 1;
  min-width: 84px;
  padding: 9px 8px;
  font-size: 13px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  transition: all 0.15s;
}
.seg-btn.active {
  border-color: var(--primary);
  color: var(--primary);
  background: rgba(255, 208, 107, 0.1);
}
.sched-time {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.sched-time input[type='time'] {
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
}
.hint {
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.5;
  margin: 8px 0 0;
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
