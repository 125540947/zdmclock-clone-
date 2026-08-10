<template>
  <div>
    <!-- 顶部 -->
    <header class="page-head rise">
      <div>
        <h1>每日签到</h1>
        <div class="sub">{{ today }} · 坚持就有收获</div>
      </div>
      <select v-if="users.length" v-model="userId" class="user-pick" @change="loadStatus">
        <option v-for="u in users" :key="u.id" :value="u.id">{{ u.nickname }}</option>
      </select>
    </header>

    <!-- 英雄区：连续签到 -->
    <section class="card hero rise" style="animation-delay: 0.05s">
      <div class="hero-grid">
        <div class="streak">
          <div class="display big">{{ status.streak }}</div>
          <div class="hero-label">连续签到（天）</div>
        </div>
        <div class="hero-side">
          <div class="chip gold">
            <span class="ico">🪙</span>{{ status.points }} 金币
          </div>
          <div class="chip">
            <span class="ico">✅</span>累计 {{ status.total }} 次
          </div>
        </div>
      </div>

      <button
        class="btn block"
        :class="{ pulse: !status.todayChecked, gold: status.todayChecked }"
        :disabled="loading || status.todayChecked"
        @click="doClock"
      >
        <span v-if="loading">签到中…</span>
        <span v-else-if="status.todayChecked">今日已签到 ✓</span>
        <span v-else>立即签到 · 领取金币</span>
      </button>
    </section>

    <!-- 签到日历 -->
    <section class="card rise" style="animation-delay: 0.1s">
      <p class="card-title">📆 近 30 天打卡</p>
      <div class="cal">
        <div
          v-for="d in status.calendar"
          :key="d.date"
          class="cal-day"
          :class="{ on: d.checked, today: d.date === today }"
          :title="d.date + (d.checked ? ' +' + d.points : '')"
        >
          <span class="dot"></span>
          <span class="dnum">{{ dayNum(d.date) }}</span>
        </div>
      </div>
      <div class="cal-legend muted">
        <span><i class="lg on"></i> 已签到</span>
        <span><i class="lg"></i> 未签到</span>
        <span><i class="lg ring"></i> 今天</span>
      </div>
    </section>

    <p v-if="!users.length" class="empty rise">
      还没有 smzdm 账号，先去「账号」页录入 Cookie 吧 👉
    </p>

    <!-- 轻提示 -->
    <transition name="toast">
      <div v-if="toast" class="toast" :class="toastType">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '../api/client.js';
import { useToast } from '../composables/useToast.js';

// F5 修复：前端"今天"改用本地日期，与后端 localDateStr 同基准，
// 避免北京 00:00–08:00 期间 UTC 与本地错位导致"今日已签到"视觉矛盾
function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const today = ref(localToday());
const users = ref([]);
const userId = ref('');
const status = ref({ streak: 0, points: 0, total: 0, todayChecked: false, calendar: [] });
const loading = ref(false);
const { toast, toastType, showToast } = useToast();


function dayNum(ds) {
  return Number(ds.slice(8));
}

async function loadUsers() {
  try {
    const { data } = await api.get('/users');
    users.value = data.list || [];
    if (users.value.length && !userId.value) userId.value = users.value[0].id;
  } catch (e) {
    showToast('加载账号失败：' + (e.response?.data?.message || e.message), 'err');
  }
}

async function loadStatus() {
  try {
    const { data } = await api.get('/clock/status', { params: { userId: userId.value } });
    status.value = data;
  } catch (e) {
    showToast('加载签到状态失败', 'err');
  }
}

async function doClock() {
  loading.value = true;
  try {
    const { data } = await api.post('/clock/do', { userId: userId.value });
    if (data.ok) {
      showToast(`签到成功！+${data.record.points} 金币`, 'ok');
      await loadStatus();
    }
  } catch (e) {
    showToast(e.response?.data?.message || '签到失败', 'err');
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadUsers();
  await loadStatus();
});
</script>

<style scoped>
.user-pick {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 10px;
  padding: 7px 10px;
  font-size: 13px;
  font-family: var(--font-body);
}
.hero-grid {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.display.big {
  font-size: 64px;
  background: linear-gradient(135deg, #ffd06b, var(--primary));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero-label {
  font-size: 13px;
  color: var(--text-dim);
  margin-top: 2px;
}
.hero-side {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  padding: 7px 11px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.chip.gold {
  color: #3a2a06;
  background: var(--gold-soft);
  border-color: transparent;
}
.chip .ico {
  font-size: 14px;
}

.cal {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 8px 4px;
}
.cal-day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}
.cal-day .dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--surface-2);
  border: 1px solid var(--border);
  transition: all 0.2s;
}
.cal-day.on .dot {
  background: linear-gradient(135deg, #ffd06b, var(--primary));
  border-color: transparent;
  box-shadow: 0 0 12px -2px rgba(255, 90, 77, 0.7);
}
.cal-day.today .dot {
  border-color: var(--gold);
  border-width: 2px;
}
.cal-day .dnum {
  font-size: 10px;
  color: var(--text-faint);
}
.cal-day.on .dnum {
  color: var(--text-dim);
}
.cal-legend {
  display: flex;
  gap: 16px;
  margin-top: 14px;
}
.cal-legend i.lg {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--surface-2);
  border: 1px solid var(--border);
  vertical-align: -2px;
  margin-right: 4px;
}
.cal-legend i.lg.on {
  background: linear-gradient(135deg, #ffd06b, var(--primary));
  border-color: transparent;
}
.cal-legend i.lg.ring {
  border-color: var(--gold);
  border-width: 2px;
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
  font-weight: 500;
  background: rgba(20, 17, 15, 0.92);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow);
  backdrop-filter: blur(10px);
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
