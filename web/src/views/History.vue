<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>签到记录</h1>
        <div class="sub">共 {{ total }} 条 · 最近优先</div>
      </div>
    </header>

    <section class="card rise" style="animation-delay: 0.05s">
      <div v-if="list.length" class="hist">
        <div v-for="r in list" :key="r.id" class="row">
          <div class="l">
            <span class="t">{{ r.date }}</span>
            <span class="d">{{ r.nickname }}</span>
          </div>
          <div class="gold-text display">+{{ r.points }}</div>
        </div>
      </div>
      <p v-else class="empty">暂无签到记录，去签到页打卡吧 📅</p>
    </section>

    <transition name="toast">
      <div v-if="toast" class="toast err">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '../api/client.js';

const list = ref([]);
const total = ref(0);
const toast = ref('');

async function load() {
  try {
    const { data } = await api.get('/clock/history', { params: { pageSize: 50 } });
    list.value = data.list;
    total.value = data.total;
  } catch (e) {
    toast.value = '加载失败';
    setTimeout(() => (toast.value = ''), 2400);
  }
}
onMounted(load);
</script>

<style scoped>
.hist .display {
  font-size: 20px;
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 100px;
  transform: translateX(-50%);
  z-index: 50;
  padding: 12px 18px;
  border-radius: 12px;
  font-size: 14px;
  background: rgba(20, 17, 15, 0.92);
  border: 1px solid rgba(255, 90, 77, 0.6);
  color: #ffb3ac;
}
</style>
