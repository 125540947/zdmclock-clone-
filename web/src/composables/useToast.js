// 全局 Toast 组合式（P2-4 重构）：消除各页面重复的 showToast 定义。
// 使用模块级单例状态——同时只有一个路由页挂载，互不干扰；
// 各页面模板继续用 <div v-if="toast"> 绑定同名 ref，无需改动模板。
import { ref } from 'vue';

const toast = ref('');
const toastType = ref('ok');
let hideTimer = null;

export function useToast() {
  function showToast(message, type = 'ok') {
    toast.value = message;
    toastType.value = type;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      toast.value = '';
    }, 2600);
  }
  return { toast, toastType, showToast };
}
