<template>
  <section class="card rise">
    <p class="card-title">📋 执行明细 <span class="muted" style="font-weight: 400">每天哪些任务做了 / 失败 / 原因</span></p>
    <div class="runs-toolbar">
      <div class="chips">
        <button class="chip" :class="{ active: rangeMode === 'day' && runsDate === todayStr }" @click="pickDay(todayStr)">今天</button>
        <button class="chip" :class="{ active: rangeMode === 'day' && runsDate === yesterdayStr }" @click="pickDay(yesterdayStr)">昨天</button>
        <button class="chip" :class="{ active: rangeMode === '7d' }" @click="pickRange('7d')">近 7 天</button>
        <button class="chip" :class="{ active: rangeMode === 'all' }" @click="pickRange('all')">全部</button>
      </div>
      <input type="date" v-model="runsDate" class="input" title="选择具体日期" @change="onDateInput" />
      <label class="chk"><input type="checkbox" v-model="runsFailOnly" @change="loadRuns" /> 仅失败</label>
      <span class="spacer" />
      <button class="btn ghost sm" :disabled="!runs.length" title="导出为 CSV（Excel 可直接打开，含 BOM）" @click="exportCsv">导出 CSV</button>
      <button class="btn ghost sm" :disabled="!runs.length" title="导出为 JSON（含 summary 与原始记录）" @click="exportJson">导出 JSON</button>
      <button class="btn ghost sm" :disabled="runsLoading" @click="loadRuns">
        {{ runsLoading ? '加载中…' : '刷新' }}
      </button>
    </div>
    <div v-if="runsSummary" class="runs-summary">
      <span class="pill" :class="{ ok: runsSummary.ok }">成功 {{ runsSummary.ok }}</span>
      <span class="pill" :class="{ bad: runsSummary.failed }">失败 {{ runsSummary.failed }}</span>
      <span class="pill" v-if="runsSummary.partial">部分 {{ runsSummary.partial }}</span>
      <span class="pill" v-if="runsSummary.skipped">跳过 {{ runsSummary.skipped }}</span>
      <span class="pill">共 {{ runsSummary.total }}</span>
    </div>
    <div v-if="runsError" class="runs-error">⚠️ {{ runsError }}</div>
    <div v-else-if="!runs.length" class="muted" style="margin-top: 10px">
      当前筛选条件下暂无执行记录（定时任务成功执行后会自动累计，手动运行也会计入）。
    </div>
    <div v-else class="runs-list">
      <div v-for="r in runs" :key="r.id" class="run-item" :class="runStatusClass(r)">
        <div class="run-head">
          <span class="run-name">{{ r.taskName || r.taskId }}</span>
          <span class="run-badge" :class="runStatusClass(r)">{{ runStatusText(r) }}</span>
          <span class="run-time">{{ runTimeLabel(r) }}</span>
        </div>
        <div v-for="(p, i) in r.perUser" :key="i" class="run-peruser">{{ p }}</div>
        <div v-if="r.message && (!r.perUser || !r.perUser.length)" class="run-message">{{ r.message }}</div>
        <div v-if="r.reasons && r.reasons.length" class="run-reasons">
          <div v-for="(rs, i) in r.reasons" :key="i" class="run-reason">
            <span class="reason-tag">{{ rs.action || '失败' }}</span>
            <span v-if="rs.articleId" class="reason-aid">文章 {{ rs.articleId }}</span>
            <span v-if="rs.user" class="reason-user">{{ rs.user }}</span>
            <span class="reason-msg">{{ rs.error_msg }}</span>
          </div>
        </div>
        <div v-if="r.details && r.details.length && r.type === 'comment'" class="run-details">
          <div class="run-details-title">回复详情</div>
          <div v-for="(d, i) in r.details" :key="i" class="run-detail" :class="{ bad: !d.ok }">
            <span class="detail-idx">{{ i + 1 }}.</span>
            <span class="detail-aid">文章 {{ d.articleId }}</span>
            <span class="detail-comment">「{{ d.comment || '（未生成）' }}」</span>
            <span v-if="!d.ok" class="detail-msg">失败：{{ d.message }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { getTaskRuns } from '../api/client.js';

const todayStr = ref(todayLocal());
const yesterdayStr = ref(dateMinusDays(1));
const runsDate = ref(todayStr.value);
// 'day'：按 runsDate 单日（走后端 date 过滤）；'7d'/'all'：拉全量后前端按日期过滤
const rangeMode = ref('day');
const runsFailOnly = ref(false);
const runs = ref([]);
const runsSummary = ref(null);
const runsLoading = ref(false);
const runsError = ref('');

function todayLocal() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function dateMinusDays(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function runTimeLabel(r) {
  const t = fmtTime(r.finishedAt);
  // 单日模式只显示时分；跨日模式补上日期便于区分
  if (rangeMode.value === 'day') return t;
  return `${r.date || ''} ${t}`.trim();
}
function runStatusClass(r) {
  if (r.skipped) return 'skip';
  if (r.ok) return r.partial ? 'partial' : 'ok';
  return 'bad';
}
function runStatusText(r) {
  if (r.skipped) return '跳过';
  if (r.ok) return r.partial ? '部分成功' : '成功';
  return '失败';
}
// 前端按当前列表重算摘要，保证跨日/全部模式下与展示一致（不依赖后端按单日聚合的 summary）
function computeSummary(list) {
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let partial = 0;
  for (const r of list) {
    if (r.skipped) skipped += 1;
    else if (!r.ok) failed += 1;
    else if (r.partial) {
      partial += 1;
      ok += 1;
    } else ok += 1;
  }
  return { ok, failed, partial, skipped, total: list.length };
}

function pickDay(d) {
  runsDate.value = d;
  rangeMode.value = 'day';
  loadRuns();
}
function pickRange(m) {
  rangeMode.value = m;
  loadRuns();
}
function onDateInput() {
  if (runsDate.value) rangeMode.value = 'day';
  loadRuns();
}

async function loadRuns() {
  runsLoading.value = true;
  runsError.value = '';
  try {
    const params = { fail: runsFailOnly.value ? 1 : undefined, limit: 1000 };
    if (rangeMode.value === 'day') params.date = runsDate.value;
    const data = await getTaskRuns(params);
    let list = Array.isArray(data.runs) ? data.runs : [];
    if (rangeMode.value === '7d') {
      const cutoff = dateMinusDays(6); // 含今天在内共 7 天
      list = list.filter((r) => r.date && r.date >= cutoff);
    }
    runs.value = list;
    runsSummary.value = computeSummary(list);
  } catch (e) {
    runsError.value = e.response?.data?.message || '加载失败';
    runs.value = [];
    runsSummary.value = null;
  } finally {
    runsLoading.value = false;
  }
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function exportTag() {
  if (rangeMode.value === 'day') return runsDate.value;
  if (rangeMode.value === '7d') return '近7天';
  return '全部';
}
function exportCsv() {
  const rows = [['日期', '时间', '任务', '状态', '账号明细', '失败原因']];
  for (const r of runs.value) {
    const reasons = (r.reasons || [])
      .map((x) => {
        const parts = [];
        if (x.action) parts.push(x.action);
        if (x.articleId) parts.push('文章' + x.articleId);
        if (x.user) parts.push('@' + x.user);
        if (x.error_msg) parts.push(x.error_msg);
        return parts.join(' ');
      })
      .join(' | ');
    rows.push([
      r.date,
      fmtTime(r.finishedAt),
      r.taskName || r.taskId,
      runStatusText(r),
      (r.perUser || []).join(' / '),
      reasons
    ]);
  }
  // BOM 头确保 Excel 正确识别 UTF-8 中文
  const csv = '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  downloadBlob(csv, `执行明细_${exportTag()}_${todayStr.value}.csv`, 'text/csv;charset=utf-8');
}
function exportJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    range: rangeMode.value,
    date: rangeMode.value === 'day' ? runsDate.value : null,
    failOnly: runsFailOnly.value,
    summary: runsSummary.value,
    runs: runs.value
  };
  downloadBlob(JSON.stringify(payload, null, 2), `执行明细_${exportTag()}_${todayStr.value}.json`, 'application/json');
}

defineExpose({ loadRuns });

onMounted(loadRuns);
</script>

<style scoped>
.runs-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.chips {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}
.chip {
  font-size: 13px;
  padding: 7px 13px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-dim);
  cursor: pointer;
  transition: all 0.15s ease;
}
.chip:hover {
  color: var(--text);
  border-color: var(--primary);
}
.chip.active {
  color: #fff;
  background: var(--primary);
  border-color: var(--primary);
}
.spacer {
  margin-left: auto;
}
.input {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 13px;
}
.chk {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-dim);
  cursor: pointer;
}
.runs-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.pill {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-dim);
  border: 1px solid var(--border);
}
.pill.ok {
  color: #78e08f;
  border-color: rgba(120, 224, 143, 0.4);
}
.pill.bad {
  color: #ffb3ac;
  border-color: rgba(255, 179, 172, 0.4);
}
.runs-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.run-item {
  border: 1px solid var(--border);
  border-left-width: 3px;
  border-radius: 12px;
  padding: 11px 13px;
  background: var(--surface-2);
}
.run-item.ok {
  border-left-color: #78e08f;
}
.run-item.bad {
  border-left-color: var(--primary);
}
.run-item.partial {
  border-left-color: var(--gold);
}
.run-item.skip {
  border-left-color: var(--text-faint);
}
.run-head {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}
.run-name {
  font-weight: 600;
  font-size: 14px;
}
.run-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-dim);
}
.run-badge.ok {
  color: #78e08f;
}
.run-badge.bad {
  color: #ffb3ac;
}
.run-badge.partial {
  color: var(--gold);
}
.run-badge.skip {
  color: var(--text-faint);
}
.run-time {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.run-peruser {
  font-size: 12.5px;
  color: var(--text-dim);
  margin-top: 6px;
}
.run-message {
  font-size: 12.5px;
  color: var(--text-dim);
  line-height: 1.55;
  margin-top: 6px;
  overflow-wrap: anywhere;
}
.run-reasons {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  border-top: 1px dashed var(--border);
  padding-top: 8px;
}
.run-reason {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: center;
  font-size: 12.5px;
}
.reason-tag {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(255, 179, 172, 0.15);
  color: #ffb3ac;
}
.reason-aid {
  color: var(--gold);
}
.reason-user {
  color: var(--text-dim);
}
.reason-msg {
  color: var(--text-dim);
}
.runs-error {
  color: #ffb3ac;
  font-size: 13px;
  margin-top: 10px;
}
.run-details {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px dashed var(--border);
  padding-top: 8px;
}
.run-details-title {
  font-size: 11px;
  color: var(--text-faint);
  letter-spacing: 0.04em;
  margin-bottom: 2px;
}
.run-detail {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: baseline;
  font-size: 12.5px;
  line-height: 1.5;
}
.run-detail.bad .detail-comment {
  color: #ffb3ac;
}
.detail-idx {
  color: var(--text-faint);
}
.detail-aid {
  color: var(--gold);
}
.detail-comment {
  color: var(--text);
  overflow-wrap: anywhere;
}
.detail-msg {
  color: #ffb3ac;
}
</style>
