<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>签到分布</h1>
        <div class="sub">按时间段查看各时段待签到账号与活跃情况</div>
      </div>
      <button class="btn ghost sm" :disabled="loading" @click="reload">↻ 刷新</button>
    </header>

    <!-- 汇总 -->
    <section class="summary rise" style="animation-delay: 0.05s">
      <div class="stat">
        <div class="display">{{ data?.totalUsers ?? '—' }}</div>
        <div class="lbl">账号总数</div>
      </div>
      <div class="stat">
        <div class="display primary-text">{{ data?.totalScheduled ?? '—' }}</div>
        <div class="lbl">已排期签到</div>
      </div>
      <div class="stat">
        <div class="display ok-text">{{ data?.totalCheckedIn ?? '—' }}</div>
        <div class="lbl">今日已签</div>
      </div>
      <div class="stat">
        <div class="display warn-text">{{ (data?.totalScheduled ?? 0) - (data?.totalCheckedIn ?? 0) }}</div>
        <div class="lbl">待签到</div>
      </div>
    </section>

    <!-- 控制区 -->
    <section class="card rise" style="animation-delay: 0.1s">
      <div class="ctrl">
        <div class="seg">
          <button class="seg-btn" :class="{ active: mode === 'hour' }" @click="setMode('hour')">按小时</button>
          <button class="seg-btn" :class="{ active: mode === 'custom' }" @click="setMode('custom')">自定义区间</button>
        </div>
        <template v-if="mode === 'custom'">
          <label class="field">
            间隔(分钟)
            <input type="number" min="1" max="1440" v-model.number="bucketMinutes" @change="reload" />
          </label>
          <label class="field">
            起始
            <input type="time" step="60" v-model="start" />
          </label>
          <label class="field">
            结束
            <input type="time" step="60" v-model="end" />
          </label>
        </template>
        <button class="btn sm" :disabled="loading" @click="reload">查询</button>
      </div>
      <p class="hint">
        系统自动分配的窗口为 {{ data?.autoWindowStart || '08:00' }}~{{ data?.autoWindowEnd || '10:59' }}；
        默认时间 {{ data?.defaultCheckInTime || '09:00' }}。绿色部分为「今日已签到」账号。
      </p>
    </section>

    <!-- 时段柱状分布 -->
    <section class="card rise" style="animation-delay: 0.15s">
      <p class="card-title">📊 各时段签到账号分布</p>
      <div v-if="data && data.buckets.length" class="bars">
        <div v-for="b in data.buckets" :key="b.slot" class="bar-row">
          <div class="bar-label" @click="toggle(b.slot)">
            {{ b.slot }}<span class="muted">~{{ b.slotEnd }}</span>
          </div>
          <div class="bar-track" @click="toggle(b.slot)">
            <div
              class="bar-fill"
              :style="{ width: barWidth(b) + '%' }"
              :class="{ empty: b.scheduledCount === 0 }"
            >
              <div
                class="bar-done"
                :style="{ width: (b.scheduledCount ? (b.checkedInCount / b.scheduledCount) * 100 : 0) + '%' }"
              ></div>
            </div>
            <span class="bar-num">
              {{ b.scheduledCount }}<span class="muted"> (✓{{ b.checkedInCount }})</span>
            </span>
          </div>
          <transition name="fade">
            <div v-if="expanded[b.slot]" class="acc-list">
              <div v-if="!b.accounts.length" class="empty sm">本时段无账号</div>
              <div v-for="a in b.accounts" :key="a.id" class="acc-item">
                <span class="nm">{{ a.nickname }}</span>
                <span class="tag" :class="modeClass(a.schedMode)">{{ modeText(a.schedMode) }}</span>
                <span class="muted">{{ a.checkInTime }}</span>
                <span class="tag" :class="a.todayChecked ? 'on' : 'off'">
                  {{ a.todayChecked ? '已签' : '未签' }}
                </span>
                <span class="muted">🔥{{ a.streak }} · 💰{{ a.points }}</span>
              </div>
            </div>
          </transition>
        </div>
      </div>
      <p v-else class="empty">暂无数据</p>
    </section>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { getClockDistribution } from '../api/client.js';

const mode = ref('hour');
const bucketMinutes = ref(60);
const start = ref('');
const end = ref('');
const data = ref(null);
const loading = ref(false);
const expanded = reactive({});

const maxCount = computed(() => {
  if (!data.value || !data.value.buckets.length) return 1;
  return Math.max(1, ...data.value.buckets.map((b) => b.scheduledCount));
});

function barWidth(b) {
  return Math.round((b.scheduledCount / maxCount.value) * 100);
}
function modeText(m) {
  return { auto: '系统自动', manual: '手动', default: '系统默认' }[m] || m;
}
function modeClass(m) {
  return { auto: 'on', manual: 'gold', default: 'off' }[m] || 'off';
}
function toggle(slot) {
  expanded[slot] = !expanded[slot];
}
function setMode(m) {
  mode.value = m;
  reload();
}

async function reload() {
  loading.value = true;
  try {
    const params = { mode: mode.value };
    if (mode.value === 'custom') {
      params.bucketMinutes = bucketMinutes.value;
      if (start.value) params.start = start.value;
      if (end.value) params.end = end.value;
    }
    const { data: d } = await getClockDistribution(params);
    data.value = d;
  } catch (e) {
    // 静默失败，保留旧数据
  } finally {
    loading.value = false;
  }
}

onMounted(reload);
</script>

<style scoped>
.summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.stat {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 8px;
  text-align: center;
}
.stat .display {
  font-size: 24px;
  font-family: var(--font-display);
}
.stat .lbl {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 3px;
}
.ctrl {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
.field {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--text-dim);
  gap: 4px;
}
.field input {
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
}
.seg {
  display: flex;
  gap: 6px;
}
.seg-btn {
  padding: 9px 14px;
  font-size: 13px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
}
.seg-btn.active {
  border-color: var(--primary);
  color: var(--primary);
  background: rgba(255, 208, 107, 0.1);
}
.hint {
  font-size: 12px;
  color: var(--text-dim);
  margin: 10px 0 0;
  line-height: 1.5;
}
.bars {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.bar-row {
  display: grid;
  grid-template-columns: 92px 1fr;
  align-items: center;
  gap: 10px;
}
.bar-label {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  user-select: none;
}
.bar-label .muted {
  font-size: 11px;
  margin-left: 3px;
}
.bar-track {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.bar-fill {
  flex: 1;
  height: 22px;
  background: linear-gradient(90deg, rgba(255, 208, 107, 0.35), rgba(255, 169, 64, 0.25));
  border-radius: 7px;
  overflow: hidden;
  min-width: 4px;
}
.bar-fill.empty {
  background: rgba(255, 255, 255, 0.05);
}
.bar-done {
  height: 100%;
  background: linear-gradient(90deg, #5fd17e, #36b85a);
  border-radius: 7px 0 0 7px;
}
.bar-num {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.acc-list {
  grid-column: 1 / -1;
  margin-top: 4px;
  padding: 8px 10px;
  border-left: 2px solid var(--border);
  background: rgba(255, 255, 255, 0.02);
  border-radius: 0 8px 8px 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.acc-item {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
}
.acc-item .nm {
  font-weight: 600;
}
.muted {
  color: var(--text-dim);
  font-size: 12px;
}
.empty.sm {
  font-size: 12px;
}

/* 标签复用全局 .tag 风格，这里补充颜色态 */
.tag.gold {
  color: var(--gold);
  border-color: rgba(255, 208, 107, 0.4);
}
.ok-text {
  color: #5fd17e;
}
.warn-text {
  color: #ffce6b;
}
.primary-text {
  color: var(--primary);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
