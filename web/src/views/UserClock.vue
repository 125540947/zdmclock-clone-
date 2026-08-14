<template>
  <div class="clock-page">
    <Teleport v-if="headerTarget" :to="headerTarget">
      <label v-if="users.length" class="user-picker" aria-label="选择签到账号">
        <AppIcon name="user" :size="20" />
        <select v-model="userId" @change="loadStatus">
          <option v-for="u in users" :key="u.id" :value="u.id">{{ u.nickname }}</option>
        </select>
      </label>
    </Teleport>

    <header class="page-head clock-head rise">
      <div>
        <h1 class="mobile-title">每日签到</h1>
        <div class="sub">{{ today }} · 坚持就有收获</div>
      </div>
      <label v-if="users.length" class="user-picker mobile-picker" aria-label="选择签到账号">
        <AppIcon name="user" :size="18" />
        <select v-model="userId" @change="loadStatus">
          <option v-for="u in users" :key="u.id" :value="u.id">{{ u.nickname }}</option>
        </select>
      </label>
    </header>

    <template v-if="initialLoading">
      <section class="hero skeleton-panel" aria-label="正在加载签到信息" aria-busy="true">
        <div class="skeleton streak-skeleton">18</div>
        <div class="skeleton metric-skeleton"></div>
        <div class="skeleton metric-skeleton"></div>
        <div class="skeleton cta-skeleton"></div>
      </section>
      <section class="calendar-section skeleton-panel" aria-label="正在加载签到日历" aria-busy="true">
        <div class="skeleton title-skeleton"></div>
        <div class="skeleton calendar-skeleton"></div>
      </section>
    </template>

    <template v-else>
      <section v-if="users.length" class="hero rise" style="animation-delay: 0.04s">
        <div class="streak-block">
          <div class="display big">{{ status.streak }}</div>
          <div class="hero-label">连续签到（天）</div>
        </div>

        <div class="metric points-metric">
          <AppIcon name="points" :size="39" weight="duotone" />
          <div>
            <strong>{{ status.points }}</strong>
            <span>金币</span>
          </div>
        </div>

        <div class="metric total-metric">
          <AppIcon name="check" :size="38" weight="duotone" />
          <div>
            <span>累计</span>
            <strong>{{ status.total }}</strong>
            <span>次</span>
          </div>
        </div>

        <button
          class="btn clock-button"
          :class="{ loading, completed: status.todayChecked, pulse: !status.todayChecked && !loading }"
          :disabled="loading || status.todayChecked"
          @click="doClock"
        >
          <AppIcon :name="status.todayChecked ? 'check' : 'calendar-check'" :size="21" weight="bold" />
          <span v-if="loading">签到中…</span>
          <span v-else-if="status.todayChecked">今日已签到</span>
          <span v-else>立即签到 · 领取金币</span>
        </button>
      </section>

      <section v-if="users.length" class="calendar-section rise" style="animation-delay: 0.09s">
        <div class="calendar-title">
          <AppIcon name="calendar" :size="25" />
          <h2>近 30 天打卡</h2>
        </div>
        <div class="cal" role="list" aria-label="近 30 天签到记录">
          <div
            v-for="d in status.calendar"
            :key="d.date"
            class="cal-day"
            :class="{ on: d.checked, today: d.date === today }"
            :title="d.date + (d.checked ? ' +' + d.points : '')"
            role="listitem"
          >
            <span class="dot" aria-hidden="true"></span>
            <span class="dnum">{{ dayNum(d.date) }}</span>
          </div>
        </div>
        <div class="cal-legend">
          <span><i class="lg on"></i> 已签到</span>
          <span><i class="lg"></i> 未签到</span>
          <span><i class="lg ring"></i> 今天</span>
        </div>
      </section>

      <section v-if="!users.length" class="empty-state rise">
        <span class="empty-icon"><AppIcon name="user" :size="36" /></span>
        <h2>还没有账号</h2>
        <p>先到「账号」页录入 smzdm Cookie，即可开始每日签到。</p>
        <button class="btn ghost" @click="$router.push({ name: 'addCookies' })">去录入账号</button>
      </section>
    </template>

    <transition name="toast">
      <div v-if="toast" class="toast" :class="toastType" role="status">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '../api/client.js';
import { useToast } from '../composables/useToast.js';
import AppIcon from '../components/AppIcon.vue';

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
const initialLoading = ref(true);
const headerTarget = ref(null);
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
  if (!userId.value) return;
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
  headerTarget.value = document.querySelector('#app-header-actions');
  await loadUsers();
  await loadStatus();
  initialLoading.value = false;
});
</script>

<style scoped>
.clock-page {
  width: 100%;
}
.clock-head {
  margin-bottom: 21px;
}
.mobile-title {
  display: none;
}
.user-picker {
  width: fit-content;
  max-width: 210px;
  min-height: 44px;
  padding: 0 7px 0 13px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--border);
  border-radius: 14px;
  color: var(--text-dim);
  background: var(--surface);
  transition: border-color 0.2s ease, background-color 0.2s ease;
}
.user-picker:hover,
.user-picker:focus-within {
  border-color: var(--border-strong);
  background: var(--surface-2);
}
.user-picker select {
  min-width: 86px;
  min-height: 42px;
  padding: 0 26px 0 3px;
  border: 0;
  background: transparent;
  box-shadow: none;
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
}
.mobile-picker {
  display: none;
}

.hero {
  display: grid;
  grid-template-columns: 33.5% 24% 21.5% 21%;
  align-items: center;
  gap: 0;
  min-height: 190px;
  padding: 0 0 50px;
  border-bottom: 1px solid var(--border);
}
.streak-block {
  display: flex;
  align-items: flex-end;
  gap: 22px;
  min-width: 0;
}
.display.big {
  flex: 0 0 auto;
  font-size: clamp(108px, 11vw, 150px);
  background: linear-gradient(145deg, #ffc06a 8%, #ff6e55 80%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 16px 28px rgba(255, 98, 87, 0.11));
}
.hero-label {
  padding-bottom: 19px;
  color: var(--text);
  font-size: clamp(18px, 2vw, 25px);
  line-height: 1.25;
  white-space: nowrap;
}
.metric {
  min-height: 82px;
  padding: 0 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 15px;
  border-left: 1px solid var(--border);
  font-variant-numeric: tabular-nums;
}
.metric > div {
  display: flex;
  align-items: baseline;
  gap: 8px;
  white-space: nowrap;
}
.metric strong {
  font-size: clamp(27px, 2.8vw, 38px);
  line-height: 1;
  letter-spacing: -0.035em;
}
.metric span {
  color: var(--text-dim);
  font-size: 16px;
}
.points-metric {
  color: var(--gold);
}
.points-metric span {
  color: var(--gold);
}
.total-metric svg {
  color: var(--success);
}
.clock-button {
  min-height: 86px;
  margin-left: 0;
  padding-inline: 24px;
  border-radius: 17px;
  font-size: clamp(14px, 1.45vw, 18px);
  white-space: nowrap;
}
.clock-button.completed {
  color: #2b2008;
  background: linear-gradient(135deg, #ffd36d, var(--gold));
}

.calendar-section {
  padding-top: 40px;
}
.calendar-title {
  display: flex;
  align-items: center;
  gap: 13px;
  margin-bottom: 38px;
}
.calendar-title svg {
  color: var(--primary);
}
.calendar-title h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 560;
}
.cal {
  display: grid;
  grid-template-columns: repeat(10, minmax(48px, 1fr));
  column-gap: 34px;
  row-gap: 36px;
}
.cal-day {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 11px;
  color: var(--text-faint);
}
.cal-day .dot {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 2px solid var(--border);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.025);
  transition: transform 0.22s var(--ease-out), border-color 0.22s ease, box-shadow 0.22s ease;
}
.cal-day:hover .dot {
  transform: translateY(-3px);
  border-color: var(--border-strong);
}
.cal-day.on .dot {
  color: rgba(255, 255, 255, 0.85);
  border-color: transparent;
  background: linear-gradient(145deg, #ffa55d, #ff5b50);
  box-shadow: 0 9px 20px -10px rgba(255, 91, 80, 0.95);
}
.cal-day.today .dot {
  border-color: var(--gold);
  background: transparent;
  box-shadow: 0 0 0 4px rgba(245, 188, 68, 0.08);
}
.cal-day.today {
  color: var(--text);
  font-weight: 650;
}
.dnum {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.cal-legend {
  display: flex;
  gap: 24px;
  margin-top: 42px;
  color: var(--text-dim);
  font-size: 13px;
}
.cal-legend span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.cal-legend .lg {
  width: 13px;
  height: 13px;
  display: inline-block;
  border: 2px solid var(--border-strong);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.025);
}
.cal-legend .lg.on {
  border: none;
  background: linear-gradient(145deg, #ffa55d, #ff5b50);
}
.cal-legend .lg.ring {
  border-color: var(--gold);
  background: transparent;
}

.empty-state {
  max-width: 520px;
  margin: 80px auto 0;
  padding: 48px 30px;
  text-align: center;
}
.empty-icon {
  width: 72px;
  height: 72px;
  margin: 0 auto 18px;
  display: grid;
  place-items: center;
  border-radius: 22px;
  color: var(--primary);
  background: var(--primary-soft);
}
.empty-state h2 {
  margin: 0 0 8px;
  font-size: 22px;
}
.empty-state p {
  margin: 0 auto 22px;
  color: var(--text-dim);
  line-height: 1.65;
}

.skeleton-panel {
  pointer-events: none;
}
.streak-skeleton {
  width: 200px;
  height: 110px;
}
.metric-skeleton {
  width: 150px;
  height: 58px;
  justify-self: center;
}
.cta-skeleton {
  height: 82px;
  margin-left: 0;
}
.title-skeleton {
  width: 180px;
  height: 28px;
  margin-bottom: 40px;
}
.calendar-skeleton {
  width: 100%;
  height: 210px;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 32px;
  z-index: 50;
  max-width: min(420px, calc(100vw - 32px));
  padding: 13px 18px;
  border: 1px solid var(--border-strong);
  border-radius: 13px;
  color: var(--text);
  background: rgba(25, 23, 21, 0.94);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(16px);
  transform: translateX(-50%);
  font-size: 13px;
}
.toast.ok {
  border-color: rgba(107, 216, 135, 0.42);
  color: #baf5c8;
}
.toast.err {
  border-color: rgba(255, 98, 87, 0.45);
  color: var(--danger-text);
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s ease, transform 0.25s var(--ease-out);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}

@media (max-width: 1080px) {
  .hero {
    grid-template-columns: 1.15fr 0.9fr 0.9fr;
    row-gap: 24px;
  }
  .clock-button {
    grid-column: 1 / -1;
    min-height: 58px;
    margin: 0;
  }
  .cal {
    column-gap: 18px;
  }
}

@media (max-width: 900px) {
  .clock-head {
    align-items: center;
    margin-bottom: 24px;
  }
  .mobile-title,
  .mobile-picker {
    display: flex;
  }
  .mobile-picker {
    max-width: 132px;
  }
  .hero {
    grid-template-columns: 1fr auto;
    min-height: 0;
    padding: 10px 0 28px;
    row-gap: 20px;
  }
  .streak-block {
    gap: 13px;
  }
  .display.big {
    font-size: clamp(76px, 25vw, 104px);
  }
  .hero-label {
    padding-bottom: 10px;
    font-size: 15px;
  }
  .metric {
    min-height: 0;
    padding: 8px 0;
    justify-content: flex-start;
    border: 0;
  }
  .metric svg {
    width: 25px;
    height: 25px;
  }
  .metric strong {
    font-size: 21px;
  }
  .metric span {
    font-size: 12px;
  }
  .points-metric {
    grid-column: 1;
  }
  .total-metric {
    grid-column: 2;
  }
  .clock-button {
    grid-column: 1 / -1;
    min-height: 56px;
    border-radius: 15px;
    font-size: 15px;
  }
  .calendar-section {
    padding-top: 28px;
  }
  .calendar-title {
    margin-bottom: 24px;
  }
  .cal {
    grid-template-columns: repeat(10, 1fr);
    gap: 18px 5px;
  }
  .cal-day {
    gap: 6px;
  }
  .cal-day .dot {
    width: 27px;
    height: 27px;
    border-width: 1.5px;
  }
  .cal-day .dot svg {
    width: 13px;
    height: 13px;
  }
  .dnum {
    font-size: 10px;
  }
  .cal-legend {
    gap: 15px;
    margin-top: 25px;
    font-size: 11.5px;
  }
  .toast {
    bottom: calc(84px + env(safe-area-inset-bottom));
  }
  .skeleton-panel.hero {
    display: grid;
  }
  .streak-skeleton {
    width: 130px;
    height: 88px;
  }
  .metric-skeleton {
    width: 90px;
    height: 30px;
  }
  .cta-skeleton {
    grid-column: 1 / -1;
    height: 56px;
    margin: 0;
  }
}

@media (max-width: 360px) {
  .user-picker {
    padding-left: 9px;
  }
  .mobile-picker {
    max-width: 118px;
  }
  .cal {
    gap-inline: 3px;
  }
  .cal-day .dot {
    width: 25px;
    height: 25px;
  }
}
</style>
