import { createRouter, createWebHashHistory } from 'vue-router';
import { session } from '../api/session.js';
import UserClock from '../views/UserClock.vue';
import AddCookies from '../views/AddCookies.vue';
import Users from '../views/Users.vue';
import History from '../views/History.vue';
import Tasks from '../views/Tasks.vue';
import Manage from '../views/Manage.vue';
import Admin from '../views/Admin.vue';
import AdminLayout from '../views/AdminLayout.vue';
import ClockDistribution from '../views/ClockDistribution.vue';
import More from '../views/More.vue';
import Placeholder from '../views/Placeholder.vue';
// 新增真实页面
import ClockCenter from '../views/ClockCenter.vue';
import StreakView from '../views/StreakView.vue';
import PointsView from '../views/PointsView.vue';
import UserInfo from '../views/UserInfo.vue';
import TaskCenter from '../views/TaskCenter.vue';
import Baoliao from '../views/Baoliao.vue';
import GptReply from '../views/GptReply.vue';
import Notify from '../views/Notify.vue';
import AssetsView from '../views/AssetsView.vue';
import Update from '../views/Update.vue';
import TaskRuns from '../views/TaskRuns.vue';

const routes = [
  { path: '/', redirect: '/userclock' },
  { path: '/userclock', name: 'userclock', component: UserClock, meta: { title: '每日签到', icon: '📅' } },
  { path: '/addCookies', name: 'addCookies', component: AddCookies, meta: { title: '录入账号', icon: '🔑' } },
  { path: '/users', name: 'users', component: Users, meta: { title: '我的账号', icon: '👤' } },
  { path: '/history', name: 'history', component: History, meta: { title: '签到记录', icon: '📜' } },
  { path: '/tasks', name: 'tasks', component: Tasks, meta: { title: '自动任务', icon: '⚙️' } },
  { path: '/manage', name: 'manage', component: Manage, meta: { title: '运行台', icon: '🛠️' } },
  {
    path: '/admin',
    component: AdminLayout,
    meta: { requiresAdmin: true, adminArea: true },
    children: [
      // 总览（管理员概览）
      { path: '', name: 'admin', component: Admin, meta: { title: '总览', icon: '📊' } },
      // 录入账号：开放模式匿名自助录入（requiresAdmin 显式覆盖为 false），同时保留顶层 /addCookies
      { path: 'add', name: 'admin-add', component: AddCookies, meta: { title: '录入账号', icon: '🔑', requiresAdmin: false } },
      // 以下为运维/管理员专属，普通界面的用户页（账号/任务/爆料/智能启动调度）已移出后台，避免重复入口
      { path: 'manage', name: 'admin-manage', component: Manage, meta: { title: '运行台', icon: '🛠️' } },
      { path: 'distribution', name: 'distribution', component: ClockDistribution, meta: { title: '签到分布', icon: '📈' } },
      { path: 'update', name: 'update', component: Update, meta: { title: '系统更新', icon: '⬆️' } },
      { path: 'notify', name: 'notify', component: Notify, meta: { title: '推送通知', icon: '🔔' } }
    ]
  },
  { path: '/more', name: 'more', component: More, meta: { title: '全部模块', icon: '🧭' } },

  // 真实页面（原占位路由）
  { path: '/clock', name: 'clock', component: ClockCenter, meta: { title: '签到中心', icon: '🗓️' } },
  { path: '/userclock2', name: 'userclock2', component: StreakView, meta: { title: '连续签到', icon: '🔥' } },
  { path: '/userclock3', name: 'userclock3', component: PointsView, meta: { title: '积分总览', icon: '💰' } },
  { path: '/userinfo', name: 'userinfo', component: UserInfo, meta: { title: '账号资料', icon: '🪪' } },
  {
    path: '/comment',
    name: 'comment',
    component: TaskCenter,
    props: { taskId: 't_comment', title: '自动评论', icon: '💬', desc: '自动对好价内容发表评论' }
  },
  {
    path: '/favorite',
    name: 'favorite',
    component: TaskCenter,
    props: { taskId: 't_favorite', title: '自动收藏', icon: '⭐', desc: '自动收藏感兴趣的内容' }
  },
  {
    path: '/point',
    name: 'point',
    component: TaskCenter,
    props: { taskId: 't_point', title: '自动点赞', icon: '👍', desc: '自动为内容点赞' }
  },
  { path: '/baoliao', name: 'baoliao', component: Baoliao, meta: { title: '好价爆料', icon: '📣' } },
  { path: '/gptReply', name: 'gptReply', component: GptReply, meta: { title: 'AI 模型', icon: '🤖' } },
  { path: '/notify', redirect: '/admin/notify' },
  { path: '/assets', name: 'assets', component: AssetsView, meta: { title: '资产仪表盘', icon: '📈' } },
  { path: '/taskruns', name: 'taskruns', component: TaskRuns, meta: { title: '执行明细', icon: 'history' } },
  { path: '/update', redirect: '/admin/update' },

  // 长尾变体重定向到就近真实页
  { path: '/commentArticle', redirect: '/comment' },
  { path: '/commentTask', redirect: '/comment' },
  { path: '/commentArticleTask', redirect: '/comment' },
  { path: '/commentDel', redirect: '/comment' },
  { path: '/favoriteArticle', redirect: '/favorite' },
  { path: '/favoriteTask', redirect: '/favorite' },
  { path: '/favoriteArticleTask', redirect: '/favorite' },
  { path: '/pointArticle', redirect: '/point' },
  { path: '/pointTask', redirect: '/point' },
  { path: '/pointArticleTask', redirect: '/point' },
  { path: '/adminPannel', redirect: '/admin' },

  { path: '/p/:name', name: 'placeholder', component: Placeholder },
  { path: '/:pathMatch(.*)*', redirect: '/userclock' }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

// 专用后台访问控制：标记 requiresAdmin 的路由仅管理员可进入。
// #190：判定依据改为后端下发的 session.isAdmin（HttpOnly Cookie 不可被 JS 读取，故前端不持有明文令牌）。
// 非管理员（含开放模式匿名访客）访问管理路由一律重定向到首页，既看不到入口也进不去。
// 注：session 在 /api/auth/config 解析完成后才就绪；未就绪前（如首屏直访 /admin）先放行，
// 由后端 requireAdmin 兜底鉴权，避免把合法管理员误挡在门外。
router.beforeEach((to) => {
  if (to.meta && to.meta.requiresAdmin && session.ready && !session.isAdmin) {
    return { name: 'userclock' };
  }
  return true;
});

export default router;
