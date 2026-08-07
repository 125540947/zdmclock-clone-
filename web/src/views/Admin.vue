<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>管理后台</h1>
        <div class="sub">服务运行概览</div>
      </div>
      <span class="tag" :class="stats.adapter === 'real' ? 'on' : 'off'">
        适配器：{{ stats.adapter }}
      </span>
    </header>

    <div v-if="stats.adapter !== 'real'" class="warn-banner">
      ⚠️ 当前为 <b>模拟模式（mock）</b>：签到 / 任务只写库、<b>不会真实请求 smzdm</b>，
      所以"看起来签了其实没签"。请到「运行台」或服务端 <code>.env</code> 设置
      <code>SMZDM_ADAPTER=real</code> 并重启服务后才会真正签到。
    </div>

    <section class="stats rise" style="animation-delay: 0.05s">
      <div class="stat">
        <div class="display">{{ stats.users }}</div>
        <div class="lbl">账号</div>
      </div>
      <div class="stat">
        <div class="display">{{ stats.enabledTasks }}/{{ stats.tasks }}</div>
        <div class="lbl">启用任务</div>
      </div>
      <div class="stat">
        <div class="display gold-text">{{ stats.totalClocks }}</div>
        <div class="lbl">累计签到</div>
      </div>
      <div class="stat">
        <div class="display primary-text">{{ stats.todayClocks }}</div>
        <div class="lbl">今日签到</div>
      </div>
    </section>

    <section class="card rise" style="animation-delay: 0.1s">
      <p class="card-title">🕘 最近活动</p>
      <div v-if="stats.recent.length">
        <div v-for="r in stats.recent" :key="r.id" class="row">
          <div class="l">
            <span class="t">{{ r.date }}</span>
            <span class="d">{{ r.nickname }}</span>
          </div>
          <div class="gold-text display">+{{ r.points }}</div>
        </div>
      </div>
      <p v-else class="empty">暂无活动</p>
    </section>

    <section class="card rise" style="animation-delay: 0.15s">
      <p class="card-title">📈 运营分析</p>
      <button class="btn block" @click="$router.push({ name: 'distribution' })">
        查看签到时间分布 →
      </button>
      <p class="hint">按小时或自定义时段统计各时段待签到账号数、已签到数与账号清单，掌握签到分布与活跃情况。</p>
    </section>

    <section class="card rise" style="animation-delay: 0.2s">
      <p class="card-title">🛡️ 风控与安全（反封号）</p>
      <label class="row2">
        <span>启用保守模式（随机等待 + 失败熔断 + 失效停签）</span>
        <input type="checkbox" v-model="risk.enabled" />
      </label>
      <div class="grid2">
        <label>最小随机等待(ms)<input type="number" min="0" v-model.number="risk.preDelayMinMs" :disabled="!risk.enabled" /></label>
        <label>最大随机等待(ms)<input type="number" min="0" v-model.number="risk.preDelayMaxMs" :disabled="!risk.enabled" /></label>
        <label>熔断阈值(连续失败)<input type="number" min="1" v-model.number="risk.circuitFailures" :disabled="!risk.enabled" /></label>
        <label>熔断冷却(分钟)<input type="number" min="1" v-model.number="circuitCooldownMin" :disabled="!risk.enabled" /></label>
        <label>自适应降频步长(ms)<input type="number" min="0" v-model.number="risk.adaptiveStepMs" :disabled="!risk.enabled" /></label>
        <label>额外等待上限(ms)<input type="number" min="0" v-model.number="risk.maxExtraMs" :disabled="!risk.enabled" /></label>
      </div>
      <p class="hint">
        保守模式在每次签到前加入人类化随机等待、登录失效自动停签并告警、连续失败自动熔断降温，降低被 smzdm 风控识别 / 封号的概率。
        也可在 .env 用 <code>ZDM_TZ</code> / <code>CATCHUP_GRACE_MIN</code> / <code>RISK_*</code> 调整时区、补签宽限与风控参数（当前时区：{{ tz }}）。
      </p>
      <p v-if="riskMsg" class="risk-msg" :class="riskMsgType">{{ riskMsg }}</p>
      <button class="btn block" :disabled="riskSaving" @click="saveRisk">
        {{ riskSaving ? '保存中…' : '保存风控设置' }}
      </button>
    </section>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import api, { getRiskSettings, saveRiskSettings } from '../api/client.js';

const stats = ref({
  users: 0,
  tasks: 0,
  enabledTasks: 0,
  totalClocks: 0,
  todayClocks: 0,
  adapter: 'mock',
  recent: []
});

const tz = ref('local');
const risk = reactive({
  enabled: true,
  preDelayMinMs: 200,
  preDelayMaxMs: 1500,
  circuitFailures: 5,
  circuitCooldownMs: 1800000,
  adaptiveStepMs: 2000,
  maxExtraMs: 60000
});
const circuitCooldownMin = ref(30);
const riskSaving = ref(false);
const riskMsg = ref('');
const riskMsgType = ref('ok');

async function load() {
  const { data } = await api.get('/admin/stats');
  stats.value = data;
  try {
    const r = await getRiskSettings();
    tz.value = r.tz || 'local';
    Object.assign(risk, r.settings || {});
    circuitCooldownMin.value = Math.round((risk.circuitCooldownMs || 0) / 60000) || 30;
  } catch {
    /* 风控接口不可用不影响概览 */
  }
}

async function saveRisk() {
  riskSaving.value = true;
  riskMsg.value = '';
  try {
    const settings = { ...risk, circuitCooldownMs: Math.max(1, circuitCooldownMin.value) * 60000 };
    const { data } = await saveRiskSettings(settings);
    Object.assign(risk, data.settings || {});
    circuitCooldownMin.value = Math.round((risk.circuitCooldownMs || 0) / 60000) || 30;
    riskMsg.value = '风控设置已保存';
    riskMsgType.value = 'ok';
  } catch (e) {
    riskMsg.value = e.response?.data?.message || '保存失败';
    riskMsgType.value = 'err';
  } finally {
    riskSaving.value = false;
  }
}
onMounted(load);
</script>

<style scoped>
.stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.stat {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px;
  text-align: center;
}
.stat .display {
  font-size: 34px;
}
.stat .lbl {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 4px;
}
.btn.block {
  width: 100%;
  padding: 14px;
  font-size: 15px;
  border-radius: 12px;
  border: 1px solid var(--primary);
  color: var(--primary);
  background: rgba(255, 208, 107, 0.08);
  cursor: pointer;
}
.hint {
  font-size: 12px;
  color: var(--text-dim);
  margin: 10px 0 0;
  line-height: 1.5;
}
.row2 {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  margin-bottom: 12px;
}
.row2 input[type='checkbox'] {
  width: 20px;
  height: 20px;
  accent-color: var(--primary);
}
.grid2 {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.grid2 label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-dim);
}
.grid2 input {
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
}
.grid2 input:disabled {
  opacity: 0.5;
}
.risk-msg {
  font-size: 13px;
  margin: 10px 0 0;
  padding: 9px 12px;
  border-radius: 10px;
}
.risk-msg.ok {
  color: #b7f3c6;
  background: rgba(120, 224, 143, 0.12);
}
.risk-msg.err {
  color: #ffb3ac;
  background: rgba(255, 90, 77, 0.12);
}
</style>
