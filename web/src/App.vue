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

  <!-- 全局登录浮层：未登录或凭证失效（401）时弹出 -->
  <div v-if="needsLogin" class="login-mask">
    <div class="login-card">
      <div class="login-logo">🛠️</div>
      <h2 class="login-title">zdmclock 管理登录</h2>
      <p class="login-sub">登录后可管理账号、任务与系统更新</p>
      <div class="field">
        <label>管理员账号</label>
        <input
          v-model="username"
          class="input"
          type="text"
          autocomplete="username"
          placeholder="admin"
          @keyup.enter="doLogin"
        />
      </div>
      <div class="field">
        <label>密码</label>
        <input
          v-model="password"
          class="input"
          type="password"
          autocomplete="current-password"
          placeholder="部署时生成的 ADMIN_PASSWORD"
          @keyup.enter="doLogin"
        />
      </div>
      <button class="btn block" :disabled="busy" @click="doLogin">
        {{ busy ? '登录中…' : '登 录' }}
      </button>
      <p v-if="err" class="login-err">{{ err }}</p>
      <p class="login-hint">账号默认 <b>admin</b>；密码为部署时生成并提示的那串（在 VPS 的 deploy 输出里，或 .env 的 ADMIN_PASSWORD）。</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { login } from './api/client.js';

const nav = [
  { name: 'userclock', label: '签到', icon: '📅' },
  { name: 'tasks', label: '任务', icon: '⚙️' },
  { name: 'users', label: '账号', icon: '👤' },
  { name: 'admin', label: '后台', icon: '📊' },
  { name: 'more', label: '更多', icon: '🧭' },
  { name: 'lazy', label: '偷懒', icon: '🚀' }
];

const needsLogin = ref(!localStorage.getItem('zdm_token'));
const username = ref('admin');
const password = ref('');
const busy = ref(false);
const err = ref('');

function onUnauthorized() {
  needsLogin.value = true;
  password.value = '';
  err.value = '';
}

async function doLogin() {
  if (busy.value) return;
  busy.value = true;
  err.value = '';
  try {
    const data = await login(username.value.trim(), password.value);
    if (data && data.token) {
      // 登录成功：刷新页面，让各页面用新 token 重新拉取数据
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

onMounted(() => window.addEventListener('zdm:unauthorized', onUnauthorized));
onBeforeUnmount(() => window.removeEventListener('zdm:unauthorized', onUnauthorized));
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

/* 登录浮层 */
.login-mask {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(10, 8, 7, 0.82);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.login-card {
  width: 100%;
  max-width: 360px;
  background: var(--bg-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 26px 22px 22px;
  box-shadow: var(--shadow);
  animation: pop 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.login-logo {
  font-size: 38px;
  text-align: center;
}
.login-title {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 21px;
  text-align: center;
  margin: 6px 0 2px;
}
.login-sub {
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
  margin: 0 0 18px;
}
.login-err {
  color: var(--primary);
  font-size: 13px;
  text-align: center;
  margin: 12px 0 0;
}
.login-hint {
  color: var(--text-faint);
  font-size: 11.5px;
  line-height: 1.6;
  margin: 14px 0 0;
  text-align: center;
}
.login-hint b {
  color: var(--text-dim);
}
</style>
