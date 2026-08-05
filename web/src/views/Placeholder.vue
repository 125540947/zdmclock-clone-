<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>模块占位</h1>
        <div class="sub">/pages/smzdm/{{ name }}</div>
      </div>
      <button class="btn ghost" @click="$router.push('/more')">返回</button>
    </header>

    <section class="card rise placeholder" style="animation-delay: 0.05s">
      <div class="ph-ico">🧩</div>
      <h2>{{ name }}</h2>
      <p class="muted">
        该模块在逆向分析中确认存在（原站路由），当前为<strong>骨架占位页</strong>。
        路由已声明，可在 <code>web/src/views/</code> 下新建对应页面并接入
        <code>server/src/routes/</code> 的接口后补全功能。
      </p>
      <div class="hint">
        <div class="row"><span class="l"><span class="t">适配方向</span></span><span class="tag">待实现</span></div>
        <div class="row"><span class="l"><span class="t">数据来源</span></span><span class="tag">smzdm 适配器</span></div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
const route = useRoute();
const name = computed(() => route.params.name || 'unknown');
</script>

<style scoped>
.placeholder {
  text-align: center;
}
.ph-ico {
  font-size: 52px;
  margin-bottom: 6px;
}
.placeholder h2 {
  font-family: var(--font-display);
  font-size: 24px;
  margin: 4px 0 12px;
}
.placeholder code {
  background: var(--surface-2);
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--gold);
}
.placeholder .hint {
  margin-top: 18px;
  text-align: left;
}
</style>
