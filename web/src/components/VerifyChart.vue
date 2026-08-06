<script setup>
import { computed } from 'vue';

// 真机端点自检结果可视化：
//  - 环形图：PASS / FAIL / SKIP 三项状态占比，圆心显示通过率
//  - 响应耗时条形图：各端点的真实网络耗时（ms），按比例着色
// 纯 SVG + CSS，零第三方依赖，契合深色暖调主题。
const props = defineProps({
  results: { type: Array, default: () => [] },
  failedCount: { type: Number, default: 0 },
  nickname: { type: String, default: '' }
});

const ORDER = ['PASS', 'FAIL', 'SKIP'];
const COLORS = { PASS: '#7ce08f', FAIL: '#ff6b5e', SKIP: '#ffd06b' };
const LABELS = { PASS: '通过', FAIL: '失败', SKIP: '跳过' };

const total = computed(() => props.results.length);
const counts = computed(() => {
  const c = { PASS: 0, FAIL: 0, SKIP: 0 };
  for (const r of props.results) if (c[r.status] != null) c[r.status]++;
  return c;
});

// 环形图几何
const R = 54;
const STROKE = 14;
const CIRC = 2 * Math.PI * R;
const segments = computed(() => {
  let acc = 0;
  const out = [];
  for (const s of ORDER) {
    const n = counts.value[s];
    if (!n) continue;
    const len = (n / total.value) * CIRC;
    out.push({ status: s, len, gap: CIRC - len, offset: -acc, color: COLORS[s] });
    acc += len;
  }
  return out;
});

const passRate = computed(() =>
  total.value ? Math.round((counts.value.PASS / total.value) * 100) : 0
);
const overallColor = computed(() =>
  counts.value.FAIL > 0 ? COLORS.FAIL : COLORS.PASS
);

// 耗时条形图：仅取真实联网探测（ms>0），按最大值归一化
const maxMs = computed(() =>
  Math.max(1, ...props.results.filter((r) => r.ms > 0).map((r) => r.ms))
);
const bars = computed(() =>
  props.results.map((r) => ({
    ...r,
    width: r.ms > 0 ? Math.max(4, Math.round((r.ms / maxMs.value) * 100)) : 0
  }))
);

function kindLabel(k) {
  return (
    {
      offline: '离线',
      cookie: '身份',
      auth: '鉴权',
      endpoint: '端点',
      MUTATING: '写操作'
    }[k] || k
  );
}
</script>

<template>
  <div v-if="total" class="vchart">
    <!-- 环形图 + 图例 -->
    <div class="donut-wrap">
      <svg viewBox="0 0 140 140" class="donut" role="img" aria-label="自检状态分布">
        <circle cx="70" cy="70" :r="R" class="track" :stroke-width="STROKE" fill="none" />
        <g transform="rotate(-90 70 70)">
          <circle
            v-for="seg in segments"
            :key="seg.status"
            cx="70"
            cy="70"
            :r="R"
            fill="none"
            :stroke="seg.color"
            :stroke-width="STROKE"
            :stroke-dasharray="`${seg.len} ${seg.gap}`"
            :stroke-dashoffset="seg.offset"
            stroke-linecap="butt"
          />
        </g>
        <text x="70" y="66" class="d-num" :fill="overallColor">{{ passRate }}%</text>
        <text x="70" y="86" class="d-sub">{{ counts.PASS }}/{{ total }} 通过</text>
      </svg>

      <ul class="legend">
        <li v-for="s in ORDER" :key="s">
          <span class="lg-dot" :style="{ background: COLORS[s] }"></span>
          <span class="lg-name">{{ LABELS[s] }}</span>
          <span class="lg-val">{{ counts[s] }}</span>
        </li>
      </ul>
    </div>

    <p v-if="failedCount" class="vnote warn">
      ⚠ 有 {{ failedCount }} 项端点异常，真实运行可能因该链路失败。
    </p>
    <p v-else-if="counts.SKIP" class="vnote">
      ✓ 全部连通；{{ counts.SKIP }} 项写操作按安全策略默认跳过。
    </p>
    <p v-else class="vnote ok">✓ 全部端点通过自检。</p>

    <!-- 各端点耗时条形图 -->
    <div class="bars">
      <div v-for="b in bars" :key="b.name" class="ep">
        <div class="ep-top">
          <span class="dot" :style="{ background: COLORS[b.status] }"></span>
          <span class="ep-name">{{ b.name }}</span>
          <span class="ep-kind">{{ kindLabel(b.kind) }}</span>
          <span class="ep-ms">{{ b.ms ? b.ms + ' ms' : '—' }}</span>
        </div>
        <div class="ep-bar">
          <div
            class="ep-fill"
            :style="{ width: b.width + '%', background: COLORS[b.status] }"
          ></div>
        </div>
        <div class="ep-detail">{{ b.detail }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vchart {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.donut-wrap {
  display: flex;
  align-items: center;
  gap: 16px;
}
.donut {
  width: 124px;
  height: 124px;
  flex: none;
}
.track {
  stroke: var(--surface-strong);
}
.d-num {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 600;
  text-anchor: middle;
}
.d-sub {
  font-size: 11px;
  fill: var(--text-dim);
  text-anchor: middle;
}
.legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}
.legend li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.lg-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.lg-name {
  color: var(--text-dim);
  flex: 1;
}
.lg-val {
  font-family: var(--font-display);
  font-weight: 600;
  color: var(--text);
}
.vnote {
  font-size: 12.5px;
  line-height: 1.5;
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.vnote.ok {
  color: #b7f3c6;
  border-color: rgba(120, 224, 143, 0.3);
}
.vnote.warn {
  color: #ffb3ac;
  border-color: rgba(255, 90, 77, 0.35);
}
.bars {
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.ep-top {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: none;
}
.ep-name {
  font-weight: 500;
  color: var(--text);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ep-kind {
  font-size: 11px;
  color: var(--text-faint);
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  flex: none;
}
.ep-ms {
  font-family: var(--font-display);
  font-size: 12px;
  color: var(--text-dim);
  flex: none;
}
.ep-bar {
  height: 6px;
  border-radius: 999px;
  background: var(--surface-strong);
  overflow: hidden;
  margin: 5px 0 3px;
}
.ep-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}
.ep-detail {
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
