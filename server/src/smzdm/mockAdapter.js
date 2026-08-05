// smzdm 适配器 —— MOCK 实现（默认）
// 仅做仿真，不发起任何对 smzdm 的真实网络请求，保证克隆后开箱即跑。
// 真实账号相关的金币、等级、签到结果均为随机/派生，仅用于演示数据流。

export const mockAdapter = {
  name: 'mock',

  async getUserInfo(cookie) {
    const seed = (cookie || 'guest').length || 1;
    return {
      smzdmId: 'smzdm_' + ((seed * 7919) % 999999).toString().padStart(6, '0'),
      nickname: '值得买用户' + (1000 + (seed % 9000)),
      points: 1000 + ((seed * 37) % 5000),
      level: 'Lv.' + (1 + (seed % 7)),
      vip: seed % 3 === 0,
      avatar: ''
    };
  },

  async doClockIn() {
    const points = 5 + Math.floor(Math.random() * 15);
    return {
      success: true,
      points,
      message: `签到成功，+${points} 金币`,
      continuity: 1
    };
  },

  async doComment(_cookie, opts = {}) {
    const count = Math.min(Math.max(1, Number(opts.count) || 1), 5);
    for (let i = 0; i < count; i++) await Promise.resolve(); // 模拟动作（无副作用，仅让计数真实）
    const art = opts.articleId ? `（文章 ${opts.articleId}）` : '';
    return { success: true, message: `评论成功 ×${count}${art}（模拟）`, count };
  },

  async doFavorite(_cookie, opts = {}) {
    const count = Math.min(Math.max(1, Number(opts.count) || 1), 5);
    for (let i = 0; i < count; i++) await Promise.resolve();
    const art = opts.articleId ? `（文章 ${opts.articleId}）` : '';
    return { success: true, message: `收藏成功 ×${count}${art}（模拟）`, count };
  },

  async doPoint(_cookie, opts = {}) {
    const count = Math.min(Math.max(1, Number(opts.count) || 1), 5);
    for (let i = 0; i < count; i++) await Promise.resolve();
    const art = opts.articleId ? `（文章 ${opts.articleId}）` : '';
    return { success: true, message: `点赞成功 ×${count}${art}（模拟）`, count };
  },

  async submitBaoliao(_cookie, payload = {}) {
    const id = Math.random().toString(36).slice(2, 8);
    return {
      success: true,
      message: `爆料「${payload.title || '好价'}」提交成功`,
      url: `https://www.smzdm.com/article/${id}`,
      points: 0
    };
  }
};
