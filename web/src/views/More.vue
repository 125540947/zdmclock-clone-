<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>全部模块</h1>
        <div class="sub">路由地图 · 已还原为真实页面</div>
      </div>
    </header>

    <section class="card rise" style="animation-delay:0.05s">
      <p class="card-title">✅ 已还原页面（完整实现）</p>
      <div class="grid">
        <button v-for="p in built" :key="p.name" class="mod" @click="$router.push({ name: p.name })">
          <span class="mi">{{ p.icon }}</span>
          <span class="mn">{{ p.label }}</span>
        </button>
      </div>
    </section>

    <p class="foot">自动任务已支持定时调度（cron），在「自动任务」中启用的任务会按计划自动执行。</p>
  </div>
</template>

<script setup>
const built = [
  { name: 'userclock', label: '每日签到', icon: '📅' },
  { name: 'clock', label: '签到中心', icon: '🗓️' },
  { name: 'userclock2', label: '连续签到', icon: '🔥' },
  { name: 'userclock3', label: '积分总览', icon: '💰' },
  { name: 'userinfo', label: '账号资料', icon: '🪪' },
  { name: 'addCookies', label: '录入账号', icon: '🔑' },
  { name: 'users', label: '我的账号', icon: '👤' },
  { name: 'history', label: '签到记录', icon: '📜' },
  { name: 'tasks', label: '自动任务', icon: '⚙️' },
  { name: 'comment', label: '自动评论', icon: '💬' },
  { name: 'favorite', label: '自动收藏', icon: '⭐' },
  { name: 'point', label: '自动点赞', icon: '👍' },
  { name: 'baoliao', label: '好价爆料', icon: '📣' },
  { name: 'gptReply', label: 'GPT 回复', icon: '🤖' },
  { name: 'notify', label: '推送通知', icon: '🔔' },
  { name: 'assets', label: '资产仪表盘', icon: '📈' },
  { name: 'update', label: '系统更新', icon: '⬆️' },
  { name: 'manage', label: '运行台', icon: '🛠️' },
  { name: 'admin', label: '管理后台', icon: '📊' }
];
</script>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.mod {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 6px;
  border-radius: 14px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  cursor: pointer;
  font-family: var(--font-body);
  transition: transform 0.15s, border 0.2s, background 0.2s;
}
.mod:active {
  transform: scale(0.96);
}
.mod:hover {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.mod.ghost {
  background: transparent;
}
.mod .mi {
  font-size: 22px;
}
.mod .mn {
  font-size: 12px;
  color: var(--text-dim);
  text-align: center;
}
.foot {
  font-size: 12px;
  color: var(--text-faint);
  text-align: center;
  line-height: 1.6;
}
</style>
