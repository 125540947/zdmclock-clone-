<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>全部模块</h1>
        <div class="sub">集中管理签到、账号与自动化工具</div>
      </div>
    </header>

    <section class="card module-card rise" style="animation-delay: 0.05s">
      <div class="module-heading">
        <AppIcon name="compass" :size="23" />
        <div>
          <h2>功能导航</h2>
          <p>选择要进入的模块</p>
        </div>
      </div>

      <div class="grid">
        <button v-for="p in visibleBuilt" :key="p.name" class="mod" @click="$router.push({ name: p.name })">
          <span class="mi"><AppIcon :name="p.icon" :size="25" /></span>
          <span class="mn">{{ p.label }}</span>
        </button>
      </div>
    </section>

    <p class="foot">自动任务支持 cron 定时调度；启用后会按照设定计划运行。</p>
  </div>
</template>

<script setup>
import { ref, inject, computed } from 'vue';
import AppIcon from '../components/AppIcon.vue';

const isAdmin = inject('isAdmin', ref(false));
const built = [
  { name: 'userclock', label: '每日签到', icon: 'calendar-check' },
  { name: 'clock', label: '签到中心', icon: 'calendar' },
  { name: 'userclock2', label: '连续签到', icon: 'fire' },
  { name: 'userclock3', label: '积分总览', icon: 'points' },
  { name: 'userinfo', label: '账号资料', icon: 'identity' },
  { name: 'addCookies', label: '录入账号', icon: 'key' },
  { name: 'users', label: '我的账号', icon: 'user' },
  { name: 'history', label: '签到记录', icon: 'history' },
  { name: 'tasks', label: '自动任务', icon: 'tasks' },
  { name: 'comment', label: '自动评论', icon: 'comment' },
  { name: 'favorite', label: '自动收藏', icon: 'favorite' },
  { name: 'point', label: '自动点赞', icon: 'like' },
  { name: 'baoliao', label: '好价爆料', icon: 'baoliao' },
  { name: 'gptReply', label: 'GPT 回复', icon: 'robot' },
  { name: 'assets', label: '资产仪表盘', icon: 'chart' },
  { name: 'admin', label: '管理后台', icon: 'admin', requiresAdmin: true }
];
const visibleBuilt = computed(() => built.filter((p) => !p.requiresAdmin || isAdmin.value));
</script>

<style scoped>
.module-card {
  padding: 26px;
}
.module-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 22px;
}
.module-heading > svg {
  color: var(--primary);
}
.module-heading h2 {
  margin: 0;
  font-size: 18px;
}
.module-heading p {
  margin: 3px 0 0;
  color: var(--text-faint);
  font-size: 12px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.mod {
  min-height: 118px;
  padding: 16px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 11px;
  border: 1px solid var(--border);
  border-radius: 16px;
  color: var(--text);
  background: var(--surface-2);
  cursor: pointer;
  transition: transform 0.2s var(--ease-out), border-color 0.2s ease, background-color 0.2s ease;
}
.mod:hover {
  transform: translateY(-3px);
  border-color: rgba(255, 98, 87, 0.45);
  background: var(--primary-soft);
}
.mod:active {
  transform: translateY(0) scale(0.98);
}
.mi {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 14px;
  color: var(--primary);
  background: rgba(255, 255, 255, 0.025);
}
.mn {
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}
.foot {
  margin: 18px 0 0;
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}

@media (max-width: 900px) {
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .module-card {
    padding: 18px;
  }
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 9px;
  }
  .mod {
    min-height: 98px;
    padding: 12px 6px;
  }
  .mi {
    width: 40px;
    height: 40px;
  }
  .mn {
    font-size: 11.5px;
  }
}
</style>
