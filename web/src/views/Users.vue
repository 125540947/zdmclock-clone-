<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>我的账号</h1>
        <div class="sub">共 {{ users.length }} 个 smzdm 账号</div>
      </div>
      <button class="btn ghost" @click="$router.push({ name: 'addCookies' })">+ 录入</button>
    </header>

    <section v-if="users.length" class="card rise" style="animation-delay: 0.05s">
      <div v-for="u in users" :key="u.id" class="acc">
        <div class="acc-top">
          <div class="avatar">{{ (u.nickname || '?').slice(0, 1) }}</div>
          <div class="acc-meta">
            <div class="nm">
              {{ u.nickname }}
              <span v-if="u.vip" class="tag on">VIP</span>
            </div>
            <div class="sub">{{ u.smzdmId || '未识别' }} · {{ u.level || '—' }}</div>
          </div>
          <div class="acc-pts">
            <div class="display">{{ u.points }}</div>
            <div class="muted">金币</div>
          </div>
        </div>
        <div class="acc-stats">
          <span class="tag">🔥 连击 {{ u.streak }}</span>
          <span class="tag">✅ 累计 {{ u.totalClockIn }}</span>
          <span class="tag">🍪 {{ u.cookie }}</span>
        </div>
        <div class="acc-actions">
          <button class="btn ghost sm" :disabled="busy === u.id" @click="refresh(u)">刷新资料</button>
          <button class="btn ghost sm danger" @click="remove(u)">删除</button>
        </div>
      </div>
    </section>

    <p v-else class="empty rise">还没有账号，点右上角「录入」添加 👉</p>

    <transition name="toast">
      <div v-if="toast" class="toast" :class="toastType">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '../api/client.js';

const users = ref([]);
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
  users.value = data.list || [];
}
async function refresh(u) {
  busy.value = u.id;
  try {
    await api.post(`/users/${u.id}/refresh`);
    showToast('资料已刷新');
    await load();
  } catch (e) {
    showToast(e.response?.data?.message || '刷新失败', 'err');
  } finally {
    busy.value = '';
  }
}
async function remove(u) {
  if (!confirm(`确认删除账号「${u.nickname}」？`)) return;
  await api.delete(`/users/${u.id}`);
  showToast('已删除');
  await load();
}

onMounted(load);
</script>

<style scoped>
.acc {
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.acc:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
.acc-top {
  display: flex;
  align-items: center;
  gap: 12px;
}
.avatar {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-family: var(--font-display);
  font-size: 22px;
  color: #3a2a06;
  background: linear-gradient(135deg, #ffd06b, var(--gold));
}
.acc-meta {
  flex: 1;
}
.nm {
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 7px;
}
.acc-meta .sub {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 2px;
}
.acc-pts {
  text-align: right;
}
.acc-pts .display {
  font-size: 22px;
  color: var(--gold);
}
.acc-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin: 12px 0;
}
.acc-actions {
  display: flex;
  gap: 8px;
}
.btn.sm {
  padding: 9px 13px;
  font-size: 13px;
  border-radius: 11px;
}
.btn.danger {
  color: #ffb3ac;
  border-color: rgba(255, 90, 77, 0.4);
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
