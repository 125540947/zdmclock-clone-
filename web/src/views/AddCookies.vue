<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>录入账号</h1>
        <div class="sub">添加你的 smzdm Cookie 以启用自动化</div>
      </div>
    </header>

    <section class="card rise" style="animation-delay: 0.05s">
      <p class="muted" style="margin-top: 0">
        在浏览器登录 smzdm 后，从开发者工具 → Application → Cookies 复制
        <code>Cookie</code> 请求头完整内容粘贴到下方。数据仅存于本地 JSON 文件。
      </p>
      <div class="field">
        <label>昵称（可选）</label>
        <input v-model="nickname" class="input" placeholder="如：我的小号" />
      </div>
      <div class="field">
        <label>smzdmId（可选）</label>
        <input v-model="smzdmId" class="input" placeholder="留空将自动识别" />
      </div>
      <div class="field">
        <label>Cookie <span class="primary-text">*</span></label>
        <textarea v-model="cookie" class="textarea" placeholder="粘贴完整 Cookie 字符串…"></textarea>
      </div>
      <div class="field row" style="align-items:center; gap:10px;">
        <input id="autoRun" v-model="autoRun" type="checkbox" style="width:auto; transform:scale(1.2);" />
        <label for="autoRun" style="margin:0; cursor:pointer;">录入后自动跑任务（签到/互动等）</label>
      </div>
      <button class="btn block" :disabled="saving || !cookie" @click="submit">
        {{ saving ? '保存中…' : '保存账号' }}
      </button>
    </section>

    <transition name="toast">
      <div v-if="toast" class="toast" :class="toastType">{{ toast }}</div>
    </transition>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api/client.js';

const router = useRouter();
const nickname = ref('');
const smzdmId = ref('');
const cookie = ref('');
const autoRun = ref(true);
const saving = ref(false);
const toast = ref('');
const toastType = ref('ok');

function showToast(m, t = 'ok') {
  toast.value = m;
  toastType.value = t;
  setTimeout(() => (toast.value = ''), 2600);
}

async function submit() {
  saving.value = true;
  try {
    await api.post('/users', {
      nickname: nickname.value,
      smzdmId: smzdmId.value,
      cookie: cookie.value,
      autoRun: autoRun.value
    });
    showToast('账号已保存');
    setTimeout(() => router.push({ name: 'users' }), 900);
  } catch (e) {
    showToast(e.response?.data?.message || '保存失败', 'err');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
code {
  background: var(--surface-2);
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--gold);
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
  border: 1px solid var(--border-strong);
}
.toast.ok {
  border-color: rgba(120, 224, 143, 0.5);
  color: #b7f3c6;
}
.toast.err {
  border-color: rgba(255, 90, 77, 0.6);
  color: #ffb3ac;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 10px);
}
</style>
