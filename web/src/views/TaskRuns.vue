<template>
  <div>
    <header class="page-head rise">
      <div>
        <h1>执行明细</h1>
        <div class="sub">每天任务做了什么 / 哪些失败 / 失败原因</div>
      </div>
    </header>

    <TaskRunsPanel />
  </div>
</template>

<script setup>
import TaskRunsPanel from '../components/TaskRunsPanel.vue';
</script>
