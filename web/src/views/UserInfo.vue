<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>账号资料</h1>
        <div class="sub">来自 smzdm 的真实资料</div>
      </div>
      <button class="btn ghost sm" :disabled="busy" @click="load">刷新</button>
    </header>

    <section class="card rise" style="animation-delay:.05s" v-if="users.length && info">
      <div class="sel">
        <label>账号</label>
        <select v-model="uid" @change="load" class="input">
          <option v-for="u in users" :key="u.id" :value="u.id">{{ u.nickname || '未命名' }}</option>
        </select>
      </div>

      <div class="profile">
        <div class="avatar">{{ (info.nickname || '?').slice(0, 1) }}</div>
        <div class="pi">
          <div class="pn">{{ info.nickname || '—' }}</div>
          <div class="pd">ID：{{ info.smzdmId || '—' }}</div>
        </div>
      </div>

      <div class="grid">
        <div class="cell"><div class="cv gold-text">{{ info.points ?? '—' }}</div><div class="cl">金币</div></div>
        <div class="cell"><div class="cv">{{ info.level || '—' }}</div><div class="cl">等级</div></div>
        <div class="cell"><div class="cv">{{ info.vip ? 'VIP' : '普通' }}</div><div class="cl">会员</div></div>
      </div>
    </section>

    <div v-else-if="users.length" class="card rise empty">{{ busy ? '加载中…' : (err || '暂无资料') }}</div>
    <div v-else class="card rise empty">暂无账号，先去录入 smzdm Cookie</div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '../api/client.js';

const users = ref([]);
const uid = ref('');
const info = ref(null);
const busy = ref(false);
const err = ref('');

async function loadUsers() {
  const { data } = await api.get('/users');
  users.value = data.list || [];
  if (!uid.value && users.value[0]) uid.value = users.value[0].id;
  await load();
}
async function load() {
  if (!uid.value) return;
  busy.value = true;
  err.value = '';
  try {
    const { data } = await api.get('/users/' + uid.value + '/smzdm');
    info.value = data;
  } catch (e) {
    info.value = null;
    err.value = e.response?.data?.message || '拉取失败（mock 模式下为仿真数据）';
  } finally {
    busy.value = false;
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
.profile {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 18px;
}
.avatar {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: grid;
  place-items: center;
  font-size: 24px;
  font-weight: 700;
  background: linear-gradient(135deg, var(--primary), var(--gold));
  color: #fff;
}
.pi .pn {
  font-size: 18px;
  font-weight: 600;
}
.pi .pd {
  font-size: 12px;
  color: var(--text-dim);
  margin-top: 3px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.cell {
  text-align: center;
  padding: 16px 6px;
  border-radius: 12px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}
.cv {
  font-size: 20px;
  font-weight: 600;
}
.cl {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 5px;
}
</style>
