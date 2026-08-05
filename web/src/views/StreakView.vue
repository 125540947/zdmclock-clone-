<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>连续签到</h1>
        <div class="sub">坚持每日签到，连击不断</div>
      </div>
    </header>

    <section class="card rise" style="animation-delay:.05s" v-if="users.length">
      <div class="sel">
        <label>账号</label>
        <select v-model="uid" @change="load" class="input">
          <option v-for="u in users" :key="u.id" :value="u.id">{{ u.nickname || '未命名' }}</option>
        </select>
      </div>

      <div class="streak-box pop">
        <div class="display big">{{ status.streak || 0 }}</div>
        <div class="lbl">当前连击（天）</div>
      </div>

      <div class="cal">
        <div v-for="c in status.calendar" :key="c.date" class="day" :class="{ on: c.checked }" :title="c.date">
          <span class="d">{{ c.date.slice(5).replace('-', '/') }}</span>
          <span class="dot"></span>
        </div>
      </div>
    </section>

    <div v-else class="card rise empty">暂无账号，先去录入 smzdm Cookie</div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '../api/client.js';

const users = ref([]);
const uid = ref('');
const status = ref({ streak: 0, calendar: [] });

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
    status.value = { streak: 0, calendar: [] };
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
.streak-box {
  text-align: center;
  padding: 10px 0 22px;
}
.streak-box .big {
  font-size: 72px;
  color: var(--gold);
  text-shadow: 0 10px 40px rgba(245, 185, 66, 0.35);
}
.streak-box .lbl {
  color: var(--text-dim);
  font-size: 14px;
  margin-top: 4px;
}
.cal {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
}
.day {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 2px;
  border-radius: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.day .d {
  font-size: 10px;
  color: var(--text-faint);
}
.day .dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--surface-strong);
  border: 1px solid var(--border-strong);
}
.day.on {
  background: var(--primary-soft);
  border-color: var(--primary);
}
.day.on .dot {
  background: var(--primary);
  border-color: transparent;
  box-shadow: 0 0 10px rgba(255, 90, 77, 0.7);
}
.day.on .d {
  color: var(--primary);
}
</style>
