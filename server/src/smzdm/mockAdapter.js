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
  },

  // 好价真实抓取（mock）：返回样例数据，便于在未启用 real 适配器时验证刷新→取文章→评论/生成 的完整链路
  async fetchBaoliao({ limit = 20 } = {}) {
    const n = Math.min(3, Math.max(1, Number(limit) || 3));
    const items = [];
    for (let i = 0; i < n; i++) {
      const id = 100000 + Math.floor(Math.random() * 899999);
      items.push({
        title: `【模拟好价】京东自营 商品${i + 1} 到手价 ¥${99 + i * 50}`,
        url: '',
        smzdmUrl: `https://www.smzdm.com/p/${id}`,
        price: String(99 + i * 50),
        content: `模拟抓取到的好价商品${i + 1}，可用于评论/收藏/点赞与 GPT 生成演示。`
      });
    }
    return { ok: true, items, page: 1 };
  }
};
