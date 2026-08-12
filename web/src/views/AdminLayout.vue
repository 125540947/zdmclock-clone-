<template>
  <div class="admin-shell">
    <header class="admin-bar">
      <button class="bar-btn" @click="goBack" title="返回前台">← 返回</button>
      <span class="bar-title">📊 管理后台</span>
      <button class="bar-btn exit" @click="logoutAdmin" title="退出后台（清除管理员权限并返回前台）">退出后台</button>
    </header>

    <nav class="admin-subnav">
      <router-link
        v-for="s in sections"
        :key="s.name"
        :to="{ name: s.name }"
        class="sub"
        active-class="on"
        >{{ s.icon }} {{ s.label }}</router-link
      >
    </nav>

    <main class="admin-body">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';

const router = useRouter();
const sections = [
  { name: 'admin', label: '总览', icon: '📊' },
  { name: 'admin-add', label: '录入账号', icon: '🔑' },
  { name: 'admin-manage', label: '运行台', icon: '🛠️' },
  { name: 'distribution', label: '签到分布', icon: '📈' },
  { name: 'update', label: '系统更新', icon: '⬆️' },
  { name: 'notify', label: '推送通知', icon: '🔔' }
];

function goBack() {
  router.push({ name: 'userclock' });
}

// 退出管理员权限：清掉 zdm_admin_token（仅影响后台访问与高危接口），
// 跳回前台。前端 isAdmin / 路由守卫会立即失效，需要再次「🔐 管理员」登录才能回后台。
function logoutAdmin() {
  localStorage.removeItem('zdm_admin_token');
  router.push({ name: 'userclock' });
}
</script>

<style scoped>
.admin-shell {
  min-height: 100vh;
  background: var(--bg);
}
.admin-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  background: rgba(20, 17, 15, 0.9);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--border);
}
.bar-title {
  flex: 1;
  text-align: center;
  font-weight: 600;
  font-size: 16px;
  font-family: var(--font-display);
}
.bar-btn {
  flex: 0 0 auto;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
  font-size: 13px;
  cursor: pointer;
}
.bar-btn.exit {
  color: var(--primary);
  border-color: var(--border-strong);
}
.bar-btn:active {
  transform: scale(0.96);
}

.admin-subnav {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  overflow-x: auto;
  border-bottom: 1px solid var(--border);
  -webkit-overflow-scrolling: touch;
}
.admin-subnav .sub {
  flex: 0 0 auto;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 13px;
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.2s, border-color 0.2s, background 0.2s;
}
.admin-subnav .sub.on {
  color: var(--primary);
  border-color: var(--primary);
  background: rgba(255, 208, 107, 0.12);
}

.admin-body {
  padding: 14px 14px calc(20px + env(safe-area-inset-bottom));
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
