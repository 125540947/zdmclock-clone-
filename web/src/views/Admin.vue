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
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '../api/client.js';

const stats = ref({
  users: 0,
  tasks: 0,
  enabledTasks: 0,
  totalClocks: 0,
  todayClocks: 0,
  adapter: 'mock',
  recent: []
});

async function load() {
  const { data } = await api.get('/admin/stats');
  stats.value = data;
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
</style>
