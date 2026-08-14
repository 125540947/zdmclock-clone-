<template>
  <header v-if="!inAdmin" class="app-header">
    <router-link :to="{ name: 'userclock' }" class="app-brand" aria-label="返回每日签到">
      <AppIcon name="calendar-check" :size="27" weight="duotone" />
      <span>{{ headerTitle }}</span>
    </router-link>

    <nav class="top-nav" aria-label="主导航">
      <router-link
        v-for="n in visibleNav"
        :key="n.name"
        :to="{ name: n.name }"
        class="nav-item"
        active-class="active"
      >
        <AppIcon :name="n.icon" :size="21" />
        <span class="lb">{{ n.label }}</span>
      </router-link>
    </nav>

    <div id="app-header-actions" class="app-header-actions"></div>
  </header>

  <main class="app-shell">
    <router-view v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
  </main>

  <nav v-if="!inAdmin" class="bottom-nav" aria-label="移动端主导航">
    <router-link
      v-for="n in visibleNav"
      :key="n.name"
      :to="{ name: n.name }"
      class="nav-item"
      active-class="active"
    >
      <AppIcon class="ico" :name="n.icon" :size="22" />
      <span class="lb">{{ n.label }}</span>
    </router-link>
  </nav>

  <button v-if="openMode && !needsLogin && !inAdmin" class="admin-entry" @click="openAdminLogin">
    <AppIcon name="key" :size="16" />
    管理员
  </button>

  <div v-if="needsLogin" class="login-mask">
    <div class="login-card">
      <div class="login-logo"><AppIcon name="wrench" :size="34" weight="duotone" /></div>
      <h2 class="login-title">{{ adminMode ? '管理员登录' : 'zdmclock 管理登录' }}</h2>
      <p class="login-sub">{{ adminMode ? '输入 ADMIN_TOKEN 以执行改删 / 系统更新' : '登录后可管理账号、任务与系统更新' }}</p>
      <form @submit.prevent="doLogin">
        <div class="field">
          <label>管理员账号</label>
          <input
            v-model="username"
            class="input"
            type="text"
            autocomplete="username"
            placeholder="admin"
            :disabled="adminMode"
          />
        </div>
        <div class="field">
          <label>{{ adminMode ? '管理员 Token' : '密码' }}</label>
          <input
            v-model="password"
            class="input"
            type="password"
            autocomplete="current-password"
            :placeholder="adminMode ? 'ADMIN_TOKEN' : '部署时生成的 ADMIN_PASSWORD'"
          />
        </div>
        <button type="submit" class="btn block" :class="{ loading: busy }" :disabled="busy">
          {{ busy ? '登录中…' : (adminMode ? '以管理员身份进入' : '登 录') }}
        </button>
      </form>
      <p v-if="err" class="login-err" role="alert">{{ err }}</p>
      <p class="login-hint">{{ adminMode ? '请输入 .env 中的 ADMIN_TOKEN；仅管理员本人使用，普通访客请勿进入。' : '账号默认 admin；密码为部署时生成并提示的那串（在 VPS 的 deploy 输出里，或 .env 的 ADMIN_PASSWORD）。' }}</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, provide, computed } from 'vue';
import { useRoute } from 'vue-router';
import { login, getAuthConfig } from './api/client.js';
import { session } from './api/session.js';
import AppIcon from './components/AppIcon.vue';

const nav = [
  { name: 'userclock', label: '签到', icon: 'calendar-check' },
  { name: 'tasks', label: '任务', icon: 'tasks' },
  { name: 'users', label: '账号', icon: 'user' },
  { name: 'admin', label: '后台', icon: 'admin', requiresAdmin: true },
  { name: 'more', label: '更多', icon: 'more' }
];

const needsLogin = ref(true);
const username = ref('admin');
const password = ref('');
const busy = ref(false);
const err = ref('');
const openMode = ref(false);
const adminMode = ref(false);
const isAdmin = computed(() => session.isAdmin);
provide('openMode', openMode);
provide('isAdmin', isAdmin);
const route = useRoute();
const inAdmin = computed(() => !!route.meta.adminArea);
const headerTitle = computed(() => (route.name === 'userclock' ? '每日签到' : '值得买助手'));
const visibleNav = computed(() => nav.filter((n) => !n.requiresAdmin || isAdmin.value));

function onUnauthorized() {
  needsLogin.value = true;
  password.value = '';
  err.value = '';
}

function openAdminLogin() {
  adminMode.value = true;
  username.value = 'admin';
  password.value = '';
  needsLogin.value = true;
}

async function doLogin() {
  if (busy.value) return;
  busy.value = true;
  err.value = '';
  const u = adminMode.value ? 'admin' : username.value.trim();
  try {
    const data = await login(u, password.value);
    // #190 / H-01：后端不再在响应体回显明文 token，登录是否成功以 /auth/config 下发的会话态为准
    // （login() 内部已刷新 session.loggedIn / session.isAdmin）。
    if (session.loggedIn) {
      if (adminMode.value && !session.isAdmin) {
        err.value = '管理员 Token 不正确，或未在 .env 配置 ADMIN_TOKEN';
        return;
      }
      window.location.reload();
      return;
    }
    err.value = '登录失败，请重试';
  } catch (e) {
    err.value = (e && e.response && e.response.data && e.response.data.message) || '账号或密码错误';
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  window.addEventListener('zdm:unauthorized', onUnauthorized);
  try {
    const cfg = await getAuthConfig();
    openMode.value = !!(cfg && cfg.openMode);
    const noAuthNeeded = cfg.openMode || cfg.trustProxyAuth || !cfg.requireAuth;
    if (noAuthNeeded) {
      needsLogin.value = false;
      if (cfg.openMode || cfg.trustProxyAuth) {
        try {
          await login('open', '');
        } catch {
          /* 开放模式下即便登录失败也不挡路，后端会直接放行 */
        }
      }
    } else {
      needsLogin.value = !session.loggedIn;
    }
  } catch {
    /* 配置接口异常时维持默认行为（默认显示登录浮层） */
  }
});
onBeforeUnmount(() => window.removeEventListener('zdm:unauthorized', onUnauthorized));
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.app-header {
  position: sticky;
  top: 32px;
  z-index: 35;
  width: min(1398px, calc(100% - 88px));
  min-height: 86px;
  margin: 32px auto 0;
  padding: 12px 18px 12px 28px;
  display: grid;
  grid-template-columns: minmax(190px, 1fr) auto minmax(190px, 1fr);
  align-items: center;
  gap: 20px;
  background: rgba(22, 20, 19, 0.9);
  border: 1px solid var(--border);
  border-radius: 22px;
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}
.app-brand {
  display: inline-flex;
  align-items: center;
  gap: 11px;
  color: var(--text);
  text-decoration: none;
  font-size: 21px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.app-brand svg {
  color: var(--primary);
}
.top-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 16px;
}
.app-header-actions {
  min-width: 0;
  display: flex;
  justify-content: flex-end;
}
.bottom-nav {
  display: none;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  border-top: 1px solid var(--border);
}
.nav-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 52px;
  padding: 0 21px;
  border-radius: 13px;
  text-decoration: none;
  color: var(--text-dim);
  font-size: 16px;
  font-weight: 550;
  transition: color 0.2s ease, background-color 0.2s ease, transform 0.2s ease;
}
.nav-item:hover {
  color: var(--text);
  background: var(--surface-hover);
}
.nav-item.active {
  position: relative;
  color: var(--text);
  background: var(--surface-2);
}
.top-nav .nav-item.active::after {
  content: '';
  position: absolute;
  left: 34%;
  right: 34%;
  bottom: -13px;
  height: 3px;
  border-radius: 999px;
  background: var(--primary);
}
.nav-item.active svg {
  color: var(--primary);
}
.nav-item:active {
  transform: scale(0.97);
}

.admin-entry {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 32;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 13px;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: rgba(20, 17, 15, 0.88);
  color: var(--text-dim);
  font: 600 12px var(--font-body);
  backdrop-filter: blur(10px);
  cursor: pointer;
  transition: color 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}
.admin-entry:hover {
  color: var(--text);
  border-color: var(--primary);
}
.admin-entry:active {
  transform: scale(0.96);
}

.login-mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(8, 7, 6, 0.84);
  backdrop-filter: blur(14px);
}
.login-card {
  width: 100%;
  max-width: 380px;
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  border-radius: 22px;
  padding: 28px 24px 24px;
  box-shadow: var(--shadow-lg);
  animation: pop 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.login-logo {
  display: grid;
  place-items: center;
  color: var(--primary);
}
.login-title {
  font-weight: 700;
  font-size: 22px;
  text-align: center;
  margin: 10px 0 4px;
}
.login-sub {
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
  margin: 0 0 20px;
}
.login-err {
  color: var(--danger-text);
  font-size: 13px;
  text-align: center;
  margin: 12px 0 0;
}
.login-hint {
  color: var(--text-faint);
  font-size: 11.5px;
  line-height: 1.65;
  margin: 15px 0 0;
  text-align: center;
}

@media (max-width: 900px) {
  .app-header {
    display: none;
  }
  .bottom-nav {
    display: flex;
    justify-content: space-around;
    padding: 8px max(10px, env(safe-area-inset-right)) calc(8px + env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left));
    background: rgba(17, 15, 14, 0.94);
    box-shadow: 0 -12px 32px rgba(0, 0, 0, 0.24);
    backdrop-filter: blur(18px);
  }
  .bottom-nav .nav-item {
    flex: 1;
    min-width: 0;
    min-height: 50px;
    padding: 5px 4px;
    flex-direction: column;
    gap: 3px;
    border-radius: 12px;
    font-size: 11px;
  }
  .bottom-nav .nav-item.active {
    background: var(--primary-soft);
    color: var(--primary);
  }
  .admin-entry {
    right: 12px;
    bottom: calc(72px + env(safe-area-inset-bottom));
  }
}

@media (prefers-reduced-motion: reduce) {
  .fade-enter-active,
  .fade-leave-active {
    transition: none;
  }
}
</style>
