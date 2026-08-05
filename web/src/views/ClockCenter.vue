<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>签到中心</h1>
        <div class="sub">为已录入的账号一键签到</div>
      </div>
      <button class="btn ghost sm" :disabled="busy" @click="load">刷新</button>
    </header>

    <section class="card rise" style="animation-delay:.05s" v-if="accounts.length">
      <div v-for="a in accounts" :key="a.id" class="acc">
        <div class="ai">{{ (a.nickname || '账').slice(0, 1) }}</div>
        <div class="am">
          <div class="n">{{ a.nickname || '未命名账号' }}</div>
          <div class="d">
            <span class="tag" :class="a.todayChecked ? 'on' : 'off'">{{ a.todayChecked ? '今日已签' : '未签到' }}</span>
            <span class="muted">连击 {{ a.streak || 0 }}</span>
          </div>
        </div>
        <button class="btn gold sm" :disabled="busy === a.id || a.todayChecked" @click="clock(a)">
          {{ a.todayChecked ? '✓' : '签到' }}
        </button>
      </div>
    </section>

    <div v-else class="card rise empty">还没账号，先去「录入账号」添加 smzdm Cookie</div>

    <transition name="toast">
      <div v-if="toast" class="toast" :class="toastType">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '../api/client.js';

const accounts = ref([]);
const busy = ref('');
const toast = ref('');
const toastType = ref('ok');

function showToast(m, t = 'ok') {
  toast.value = m;
  toastType.value = t;
  setTimeout(() => (toast.value = ''), 2400);
}

async function load() {
  const { data } = await api.get('/users');
  const list = data.list || [];
  accounts.value = await Promise.all(
    list.map(async (u) => {
      let st = { todayChecked: false, streak: u.streak || 0 };
      try {
        const r = await api.get('/clock/status?userId=' + u.id);
        st = r.data;
      } catch {
        /* ignore */
      }
      return { ...u, ...st };
    })
  );
}

async function clock(a) {
  busy.value = a.id;
  try {
    const { data } = await api.post('/clock/do', { userId: a.id });
    showToast('签到成功 +' + (data.record?.points || 0) + ' 金币');
    await load();
  } catch (e) {
    showToast(e.response?.data?.message || '签到失败', 'err');
  } finally {
    busy.value = '';
  }
}

onMounted(load);
</script>

<style scoped>
.acc {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 0;
  border-bottom: 1px solid var(--border);
}
.acc:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.ai {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: 600;
  background: var(--primary-soft);
  color: var(--primary);
  flex: none;
}
.am {
  flex: 1;
  min-width: 0;
}
.am .n {
  font-size: 15px;
  font-weight: 600;
}
.am .d {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 12px;
}
.btn.sm {
  padding: 8px 14px;
  font-size: 13px;
  border-radius: 10px;
  flex: none;
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
