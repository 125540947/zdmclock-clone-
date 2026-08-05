<template>
  <div class="app-shell">
    <router-view v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
  </div>

  <nav class="bottom-nav">
    <router-link
      v-for="n in nav"
      :key="n.name"
      :to="{ name: n.name }"
      class="nav-item"
      active-class="active"
    >
      <span class="ico">{{ n.icon }}</span>
      <span class="lb">{{ n.label }}</span>
    </router-link>
  </nav>
</template>

<script setup>
const nav = [
  { name: 'userclock', label: '签到', icon: '📅' },
  { name: 'tasks', label: '任务', icon: '⚙️' },
  { name: 'users', label: '账号', icon: '👤' },
  { name: 'admin', label: '后台', icon: '📊' },
  { name: 'more', label: '更多', icon: '🧭' }
];
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.bottom-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  justify-content: space-around;
  padding: 10px 8px calc(10px + env(safe-area-inset-bottom));
  background: rgba(20, 17, 15, 0.72);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border-top: 1px solid var(--border);
}
.nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  text-decoration: none;
  color: var(--text-faint);
  font-size: 11px;
  transition: color 0.2s;
}
.nav-item .ico {
  font-size: 20px;
  filter: grayscale(0.4);
  transition: transform 0.2s, filter 0.2s;
}
.nav-item.active {
  color: var(--primary);
}
.nav-item.active .ico {
  filter: none;
  transform: translateY(-2px) scale(1.08);
}
</style>
