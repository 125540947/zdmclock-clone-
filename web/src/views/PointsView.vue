<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>积分总览</h1>
        <div class="sub">金币与签到成长</div>
      </div>
    </header>

    <section class="card rise" style="animation-delay:.05s" v-if="users.length">
      <div class="sel">
        <label>账号</label>
        <select v-model="uid" @change="load" class="input">
          <option v-for="u in users" :key="u.id" :value="u.id">{{ u.nickname || '未命名' }}</option>
        </select>
      </div>

      <div class="pts pop">
        <div class="display big gold-text">{{ status.points || 0 }}</div>
        <div class="lbl">金币</div>
      </div>

      <div class="stat-row">
        <div class="stat">
          <div class="sv">{{ status.total || 0 }}</div>
          <div class="sl">累计签到（天）</div>
        </div>
        <div class="stat">
          <div class="sv">{{ levelLabel }}</div>
          <div class="sl">等级</div>
        </div>
        <div class="stat">
          <div class="sv">{{ status.streak || 0 }}</div>
          <div class="sl">当前连击</div>
        </div>
      </div>

      <div class="prog">
        <div class="ptxt">距下一等级还需 {{ need }} 金币</div>
        <div class="bar"><div class="fill" :style="{ width: pct + '%' }"></div></div>
      </div>
    </section>

    <div v-else class="card rise empty">暂无账号，先去录入 smzdm Cookie</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '../api/client.js';

const users = ref([]);
const uid = ref('');
const status = ref({ points: 0, total: 0, streak: 0 });

// 简单的等级映射（按金币区间，仅展示用）
const LEVELS = [0, 500, 1500, 3500, 7000, 15000, 30000];
const levelLabel = computed(() => {
  const p = status.value.points || 0;
  let lv = 1;
  for (let i = 0; i < LEVELS.length; i++) if (p >= LEVELS[i]) lv = i + 1;
  return 'Lv.' + lv;
});
const need = computed(() => {
  const p = status.value.points || 0;
  const next = LEVELS.find((x) => x > p);
  return next ? next - p : 0;
});
const pct = computed(() => {
  const p = status.value.points || 0;
  const idx = LEVELS.filter((x) => x <= p).length - 1;
  const lo = LEVELS[idx] ?? 0;
  const hi = LEVELS[idx + 1] ?? lo + 1;
  return Math.max(4, Math.min(100, Math.round(((p - lo) / (hi - lo)) * 100)));
});

async function loadUsers() {
  const { data } = await api.get('/users');
  users.value = data.list || [];
  if (!uid.value && users.value[0]) uid.value = users.value[0].id;
  await load();
}
async function load() {
  if (!uid.value) return;
  try {
    const { data } = await api.get('/clock/status?userId=' + uid.value);
    status.value = data;
  } catch {
    status.value = { points: 0, total: 0, streak: 0 };
  }
}
onMounted(loadUsers);
</script>

<style scoped>
.sel {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}
.sel label {
  font-size: 13px;
  color: var(--text-dim);
}
.sel .input {
  flex: 1;
}
.pts {
  text-align: center;
  padding: 6px 0 20px;
}
.pts .big {
  font-size: 64px;
}
.pts .lbl {
  color: var(--text-dim);
  font-size: 14px;
}
.stat-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 18px;
}
.stat {
  text-align: center;
  padding: 14px 6px;
  border-radius: 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.stat .sv {
  font-size: 22px;
  font-weight: 600;
}
.stat .sl {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 4px;
}
.prog .ptxt {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 8px;
}
.bar {
  height: 10px;
  border-radius: 999px;
  background: var(--surface-strong);
  overflow: hidden;
}
.fill {
  height: 100%;
  background: linear-gradient(90deg, var(--gold), var(--primary));
  border-radius: 999px;
  transition: width 0.5s ease;
}
</style>
