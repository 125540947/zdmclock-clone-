<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>资产仪表盘</h1>
        <div class="sub">模块 A（任务执行）自动落账 · 此处读取共享资产账本</div>
      </div>
      <div class="range">
        <button v-for="d in ranges" :key="d" :class="['chip', days === d && 'on']" @click="setDays(d)">{{ d }}天</button>
        <button class="btn ghost sm" :disabled="busy" @click="load">刷新</button>
      </div>
    </header>

    <!-- 全局合计卡片 -->
    <section class="cards rise" style="animation-delay:.05s" v-if="summary">
      <div class="c gold">
        <div class="v">{{ fmt(summary.totals.gold) }}</div>
        <div class="l">金币总计</div>
        <div class="d" :class="todayTotal.gold >= 0 ? 'up' : 'down'">今日 {{ signed(todayTotal.gold) }}</div>
      </div>
      <div class="c silver">
        <div class="v">{{ fmt(summary.totals.silver) }}</div>
        <div class="l">碎银总计</div>
        <div class="d" :class="todayTotal.silver >= 0 ? 'up' : 'down'">今日 {{ signed(todayTotal.silver) }}</div>
      </div>
      <div class="c exp">
        <div class="v">{{ fmt(summary.totals.exp) }}</div>
        <div class="l">经验总计</div>
        <div class="d" :class="todayTotal.exp >= 0 ? 'up' : 'down'">今日 {{ signed(todayTotal.exp) }}</div>
      </div>
    </section>

    <!-- 每日收益曲线 -->
    <section class="card rise" style="animation-delay:.1s">
      <div class="card-title">每日收益（金币 / 经验）</div>
      <div v-if="daily.length" class="chart">
        <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="line">
          <!-- 网格 -->
          <line v-for="g in gridY" :key="'g'+g" :x1="padL" :x2="W-padR" :y1="g" :y2="g" class="grid" />
          <!-- 金币线 -->
          <polyline :points="goldPoints" class="ln gold" />
          <!-- 经验线 -->
          <polyline :points="expPoints" class="ln exp" />
        </svg>
        <div class="legend">
          <span class="dot gold"></span>金币日增量
          <span class="dot exp"></span>经验日增量
        </div>
      </div>
      <div v-else class="empty">暂无账本数据，运行签到/任务后会自动累计</div>
    </section>

    <!-- 任务贡献 -->
    <section class="card rise" style="animation-delay:.15s">
      <div class="card-title">任务贡献（最近 {{ days }} 天）</div>
      <div v-if="byTask.length" class="bars">
        <div v-for="t in byTask" :key="t.taskType" class="bar-row">
          <div class="bn">{{ t.taskName }}</div>
          <div class="track">
            <div class="fill gold" :style="{ width: pct(t.goldDelta, maxGold) + '%' }"></div>
          </div>
          <div class="bv">+{{ fmt(t.goldDelta) }}金 / +{{ fmt(t.expDelta) }}经验 · {{ t.count }}次</div>
        </div>
      </div>
      <div v-else class="empty">暂无任务贡献数据</div>
    </section>

    <!-- 每用户资产 -->
    <section class="card rise" style="animation-delay:.2s" v-if="summary">
      <div class="card-title">各账号资产</div>
      <div v-for="u in summary.users" :key="u.id" class="urow">
        <div class="un">
          {{ u.nickname }}
          <span v-if="u.cookieExpired" class="tag danger">🍪 Cookie 失效</span>
        </div>
        <div class="ustat">
          <span>金 {{ fmt(u.assets.gold) }}</span>
          <span>银 {{ fmt(u.assets.silver) }}</span>
          <span>经验 {{ fmt(u.assets.exp) }}</span>
          <span v-if="u.assets.level">Lv.{{ u.assets.level }}</span>
          <span class="muted">连击 {{ u.streak }} · 累计 {{ u.totalClockIn }}天</span>
          <span class="muted">今日 +{{ fmt(u.today.gold) }}金</span>
        </div>
      </div>
    </section>

    <!-- 最近账本 -->
    <section class="card rise" style="animation-delay:.25s">
      <div class="card-title">最近账本</div>
      <div v-if="ledger.length" class="ledger">
        <div v-for="e in ledger" :key="e.id" class="lrow">
          <span class="lt">{{ e.date }} · {{ e.nickname }}</span>
          <span class="lmsg">{{ e.taskName }}：{{ e.message || '—' }}</span>
          <span class="ld" :class="(e.goldDelta||0) >= 0 ? 'up' : 'down'">
            {{ e.goldDelta ? signed(e.goldDelta)+'金' : '' }}{{ e.expDelta ? ' '+signed(e.expDelta)+'经验' : '' }}
          </span>
        </div>
      </div>
      <div v-else class="empty">暂无记录</div>
    </section>

    <transition name="toast">
      <div v-if="toast" class="toast" :class="toastType">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useToast } from '../composables/useToast.js';
import {
  getAssetsSummary,
  getAssetsDaily,
  getAssetsByTask,
  getAssetsLedger
} from '../api/client.js';

const ranges = [7, 30, 90];
const days = ref(30);
const busy = ref(false);
const summary = ref(null);
const daily = ref([]);
const byTask = ref([]);
const ledger = ref([]);
const { toast, toastType, showToast } = useToast();

// SVG 折线图尺寸
const W = 340, H = 150, padL = 8, padR = 8, padT = 12, padB = 18;

function fmt(n) {
  return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}
function signed(n) {
  const v = Number(n || 0);
  return (v >= 0 ? '+' : '') + fmt(v);
}
function pct(v, max) {
  if (!max) return 0;
  return Math.max(2, Math.min(100, Math.round((Math.abs(Number(v || 0)) / max) * 100)));
}

const todayTotal = computed(() => {
  const t = summary.value?.totals;
  // 取当日各用户 today 之和
  const users = summary.value?.users || [];
  // P2-6：无当日数据的用户 today 可能为 null，加可选链 + 默认值避免 NaN/报错
  const g = users.reduce((a, u) => a + (u.today?.gold ?? 0), 0);
  const s = users.reduce((a, u) => a + (u.today?.silver ?? 0), 0);
  const e = users.reduce((a, u) => a + (u.today?.exp ?? 0), 0);
  return { gold: g, silver: s, exp: e };
});

const maxGold = computed(() => Math.max(1, ...byTask.value.map((t) => Math.abs(t.goldDelta || 0))));

// 折线点：把每日 goldDelta / expDelta 映射到 SVG 坐标（含负值，以 0 线居中）
const gridY = computed(() => [padT, H / 2, H - padB]);
const goldPoints = computed(() => buildLine(daily.value.map((d) => d.goldDelta)));
const expPoints = computed(() => buildLine(daily.value.map((d) => d.expDelta)));

function buildLine(values) {
  if (!values.length) return '';
  const n = values.length;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  return values
    .map((v, i) => {
      const x = padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
      const y = padT + innerH - ((v - min) / span) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function setDays(d) {
  days.value = d;
  load();
}

async function load() {
  busy.value = true;
  try {
    const [s, dl, bt, lg] = await Promise.all([
      getAssetsSummary(),
      getAssetsDaily(days.value),
      getAssetsByTask(days.value),
      getAssetsLedger(50)
    ]);
    summary.value = s;
    daily.value = dl.series || [];
    byTask.value = bt.items || [];
    ledger.value = lg.list || [];
  } catch (e) {
    showToast(e.response?.data?.message || '加载失败', 'err');
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>

<style scoped>
.range {
  display: flex;
  gap: 6px;
  align-items: center;
}
.chip {
  padding: 5px 10px;
  font-size: 11px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-dim);
  cursor: pointer;
}
.chip.on {
  background: var(--primary-soft);
  border-color: var(--primary);
  color: var(--primary);
}
.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 14px;
}
.c {
  text-align: center;
  padding: 16px 6px;
  border-radius: 14px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.c .v {
  font-size: 26px;
  font-weight: 700;
}
.c.gold .v { color: var(--gold); }
.c.silver .v { color: #cfd8e3; }
.c.exp .v { color: var(--primary); }
.c .l { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
.c .d { font-size: 11px; margin-top: 4px; }
.up { color: #79e08f; }
.down { color: #ff8b80; }
.card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 14px;
}
.card-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}
.chart .line {
  width: 100%;
  height: 150px;
  display: block;
}
.grid { stroke: var(--border); stroke-width: 1; }
.ln { fill: none; stroke-width: 2; }
.ln.gold { stroke: var(--gold); }
.ln.exp { stroke: var(--primary); }
.legend {
  display: flex;
  gap: 14px;
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 6px;
}
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
.dot.gold { background: var(--gold); }
.dot.exp { background: var(--primary); }
.bars { display: flex; flex-direction: column; gap: 10px; }
.bar-row .bn { font-size: 12px; margin-bottom: 4px; }
.track {
  height: 10px;
  border-radius: 999px;
  background: var(--surface-strong);
  overflow: hidden;
}
.fill.gold { height: 100%; background: linear-gradient(90deg, var(--gold), var(--primary)); border-radius: 999px; }
.bv { font-size: 11px; color: var(--text-dim); margin-top: 3px; }
.urow {
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.urow:last-child { border-bottom: none; }
.un { font-size: 13px; font-weight: 600; }
.ustat {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: var(--text);
  margin-top: 4px;
}
.ustat .muted { color: var(--text-faint); }
.tag.danger {
  font-size: 10px;
  color: #ff8b80;
  border: 1px solid rgba(255, 90, 77, 0.5);
  border-radius: 999px;
  padding: 1px 7px;
  margin-left: 6px;
}
.ledger { display: flex; flex-direction: column; gap: 8px; }
.lrow {
  display: flex;
  flex-direction: column;
  font-size: 11px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--border);
}
.lrow:last-child { border-bottom: none; }
.lt { color: var(--text-faint); }
.lmsg { color: var(--text-dim); margin: 2px 0; }
.ld { font-weight: 600; }
.empty {
  font-size: 12px;
  color: var(--text-faint);
  text-align: center;
  padding: 18px 0;
}
.btn.sm { padding: 6px 10px; font-size: 11px; border-radius: 9px; }
.toast {
  position: fixed; left: 50%; bottom: 100px; transform: translateX(-50%);
  z-index: 50; padding: 12px 18px; border-radius: 12px; font-size: 14px;
  background: rgba(20, 17, 15, 0.92); border: 1px solid var(--border-strong);
}
.toast.ok { border-color: rgba(120, 224, 143, 0.5); color: #b7f3c6; }
.toast.err { border-color: rgba(255, 90, 77, 0.6); color: #ffb3ac; }
.toast-enter-active, .toast-leave-active { transition: opacity 0.3s, transform 0.3s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 10px); }
</style>
