// QA 独立验收测试（批次 39：自动评论话术收敛）
//
// 立场：不复用工程师已跑过的路径，从"用户会遇到的输入"反推验证。
// 本文件刻意不引入 mock.module（避免污染同进程后续文件），
// 对外部 IO 一律用可还原的 globalThis.fetch / smzdm.doComment 打桩，并在 finally 中复位。
//
// 覆盖：
//   A. 根因端到端复核（真实走 /api/baoliao/bulk 导入，不含任何假设）
//   B. 误伤回归：正常口语评论不得被判「语气带质问或嘲讽」
//   C. 拦截有效性：线上攻击性样本 + 变体必被拦截
//   D. 已知缺陷登记（skip，待工程师修复后翻转断言）
//   E. runEngagement 占位标题逐篇跳过
//   F. runGptBatch 占位标题跳过 + autoPost 下不发布
//   G. 占位标题不得进入大模型请求体
//   H. isRetriableCommentError 放宽后的重试预算量化
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = path.join(os.tmpdir(), 'zdm-qa-tone-' + process.pid + '-' + Date.now());
process.env.GPT_API_KEY = 'qa-test-key'; // 使 config.gptEnabled=true，评论链路可达
process.env.CLOCK_STAGGER_MS = '0';
process.env.CLOCK_STAGGER_JITTER_MS = '0';

const { productCommentIssues, isPlaceholderTitle, hasUsableProductFact, buildProductCommentPrompt } =
  await import('../src/gptAdapter.js');
const { runTask, isRetriableCommentError } = await import('../src/taskRunner.js');
const { load } = await import('../src/store.js');
const { config } = await import('../src/config.js');
const { smzdm } = await import('../src/smzdm/adapter.js');
const { createApp } = await import('../src/index.js');

config.riskEnabled = false; // 关闭人类化随机等待，保持用例快速且确定

const RUDE = '语气带质问或嘲讽';
const realFetch = globalThis.fetch;

// ---------------- 通用工具 ----------------

// 把拟人化延迟清零；返回还原函数
function silenceDelays() {
  const keys = [
    'engagementDelayMinMs',
    'engagementDelayMaxMs',
    'engagementDelayLongProbability',
    'engagementDelayLongMaxMs',
    'engagementQueueEnabled'
  ];
  const prev = {};
  for (const k of keys) prev[k] = config[k];
  config.engagementDelayMinMs = 0;
  config.engagementDelayMaxMs = 0;
  config.engagementDelayLongProbability = 0;
  config.engagementDelayLongMaxMs = 0;
  config.engagementQueueEnabled = false;
  return () => {
    for (const k of keys) config[k] = prev[k];
  };
}

// 打桩大模型：每次调用返回固定文案，并记录请求体，用于断言"什么被喂给了模型"
function stubLlm(text) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url: String(url || ''), body });
    return { ok: true, json: async () => ({ choices: [{ message: { content: text } }] }) };
  };
  return {
    calls,
    llmCalls: () => calls.filter((c) => c.body.includes('商品资料')).length,
    bodiesIncluding: (needle) => calls.filter((c) => c.body.includes(needle)).length
  };
}

// 打桩 smzdm 评论动作：记录实际发出去的内容
function stubDoComment() {
  const posted = [];
  const orig = smzdm.doComment;
  smzdm.doComment = async (cookie, opts) => {
    posted.push({ articleId: opts.articleId, content: opts.content });
    return { count: 1, message: '评论成功', articleId: opts.articleId };
  };
  return { posted, restore: () => { smzdm.doComment = orig; } };
}

function freshDb(baoliao, extra = {}) {
  return {
    users: [{ id: 'u1', cookie: 'c' }],
    baoliao,
    settings: { gpt: { enabled: true, tone: 'friendly', prompt: '' } },
    gptDrafts: [],
    ...extra
  };
}

// =====================================================================
// A. 根因端到端复核：只粘贴链接导入 → 占位标题 → 旧守卫失效
// =====================================================================
const app = createApp();
config.requireAuth = false; // 与 baoliao.test.js 一致：开放模式形态
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = 'http://localhost:' + server.address().port;

test('A1 根因复核：只粘贴链接导入的好价确实是「占位标题 + 空正文 + 空价格」', async () => {
  const db = load();
  db.baoliao = [];

  const res = await fetch(base + '/api/baoliao/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'https://www.smzdm.com/p/180074206' })
  });
  assert.equal(res.status, 200, '批量导入应成功');
  const body = await res.json();
  assert.equal(body.added, 1, '应新增 1 条');

  const entry = load().baoliao.find((x) => x.smzdmUrl === 'https://www.smzdm.com/p/180074206');
  assert.ok(entry, '应在 db.baoliao 中找到导入的条目');

  // 1) 占位标题回填（根因前提）
  assert.equal(entry.title, '文章 180074206', '标题应为导入侧回填的占位「文章 <id>」');
  // 2) 正文与价格为空
  assert.equal(String(entry.content || '').trim(), '', '正文应为空');
  assert.equal(String(entry.price || '').trim(), '', '价格应为空');
  // 3) 旧守卫 !title && !content && !price 因 title 非空而失效（这就是线上漏过的原因）
  assert.equal(!entry.title && !entry.content && !entry.price, false, '旧守卫必须不触发，否则根因不成立');
  // 4) 新判定认为无可用信息
  assert.equal(hasUsableProductFact(entry), false, '新判定：占位标题 + 空正文空价格 = 无可用信息');
  assert.equal(isPlaceholderTitle(entry.title), true);
});

after(() => {
  server.close();
  globalThis.fetch = realFetch;
});

// =====================================================================
// B. 误伤回归：正常口语评论不得被判「语气带质问或嘲讽」
//    （样本覆盖：温和反问 / 轻微调侃 / 具体信息 / 个人情绪 / 省略口语词 /
//      自嘲 / 疑问 / 吐槽商品本身 / 口头禅 / 正向惊讶）
// =====================================================================
const NORMAL_COMMENTS = [
  // —— 用户点名"必须保留"的参照样本 ——
  '299这价蔡司1.67还带钛架，商家不会算错账吧？',
  '这价拿Z7Pro？比我上周看的便宜快两百块',
  // —— 温和反问 ——
  '这价格还要啥自行车',
  '这个价是叠加券后的吗',
  'emm，这玩意儿值这个价吗',
  '这价格是认真的吗',
  // —— 轻微调侃（针对商品/商家，非发布者）——
  '商家这是亏本赚吆喝吧',
  '商家不会是标错价了吧',
  '赠品比主件还香，离谱',
  // —— 带具体信息 ——
  '1.67非球面加钛架，299确实少见',
  '同款上周519，这周直接腰斩',
  '比狗东便宜三十，可以',
  '库存就三件，手慢无',
  '比拼多多贵五块，但省心',
  // —— 个人情绪 / 自嘲 ——
  '心动了但钱包不同意',
  '又没忍住下单了，这个月要吃土',
  '凑单凑得我头大，最后还是买了',
  'emmm这价有点上头',
  '看不懂参数，反正便宜',
  // —— 吐槽商品本身 ——
  '这配色一言难尽，但价格真香',
  '这牌子我踩过雷，大家谨慎点',
  '这牌子售后一般，但便宜这么多可以忍',
  '有点智商税的意思，不过喜欢就买',
  // —— 省略 / 口语词 / 口头禅 ——
  '刚需，冲了',
  '刚下单，坐等到货',
  '老用户表示这价史低',
  '这波不亏，蹲到了',
  '看完只想说一句，真香',
  '别的不说，就冲这赠品也值',
  '感觉双十一还能再等等',
  '第一次见这个价，先观望下',
  '没啥可挑的，这个价位就这样',
  '要啥没啥，胜在便宜',
  '这价格让我有点不敢相信',
  '我怀疑标错价了，但不敢问',
  '买了不吃亏，买不了上当，哈哈',
  // —— 临界样本「39块还整优惠券，累不累啊」的"非冲"改写版（证明只收敛那一种说法）——
  '39块还整优惠券，搞得我还得算半天'
];

test(`B1 误伤回归：${NORMAL_COMMENTS.length} 条正常口语评论均不得命中「语气带质问或嘲讽」`, () => {
  const falsePositives = [];
  for (const s of NORMAL_COMMENTS) {
    const issues = productCommentIssues(s);
    if (issues.includes(RUDE)) falsePositives.push(s);
  }
  assert.deepEqual(falsePositives, [], `以下正常评论被误报为攻击性：\n - ${falsePositives.join('\n - ')}`);
});

test('B2 误伤回归：上述正常样本整体通过全部自然度检查（issues 为空数组）', () => {
  // 比 B1 更严：不仅不被判"冲"，也不应触发超长 / 多句 / AI 腔等既有规则
  const flagged = NORMAL_COMMENTS.map((s) => [s, productCommentIssues(s)]).filter(([, i]) => i.length);
  assert.deepEqual(
    flagged.map(([s, i]) => `${s} -> ${i.join('、')}`),
    [],
    '正常样本不应触发任何自然度问题'
  );
});

// =====================================================================
// C. 拦截有效性
// =====================================================================
const AGGRESSIVE_CAUGHT = [
  // —— 线上实证的三条攻击性样本（必须拦截）——
  '啥正文都不给，就甩个长文章id糊弄人呢？',
  '啥内容啥价格都不说，就给个编号糊弄谁呢？',
  '啥信息都没有就挂个文章ID，这是卖啥啊？',
  // —— 工程师收敛的临界样本 ——
  '39块还整优惠券，累不累啊',
  // —— 与线上样本同构的其他说法（必须仍有规则命中，靠「啥…都…」「凭什么」等兜住）——
  '啥都不说就发个链接，逗我呢',
  '商家凭什么卖这么贵',
  '啥也没有，就一光秃秃的链接',
  '啥都没写，就标了个价'
  // —— 批次 41 已删除：'纯纯搞笑呢这价格'（"搞笑呢"是高频正向惊讶，规则放宽后不再拦截）——
];

test(`C1 拦截有效性：${AGGRESSIVE_CAUGHT.length} 条攻击性/质问式样本全部命中「语气带质问或嘲讽」`, () => {
  const missed = [];
  for (const s of AGGRESSIVE_CAUGHT) {
    const issues = productCommentIssues(s);
    if (!issues.includes(RUDE)) missed.push(s);
  }
  assert.deepEqual(missed, [], `以下攻击性样本未被拦截：\n - ${missed.join('\n - ')}`);
});

test('C2 提示词已固化语气边界（禁止质问/嘲讽/数落发布者）', () => {
  const p = buildProductCommentPrompt({ tone: 'friendly', prompt: '' });
  for (const word of ['糊弄', '逗我呢', '骗谁呢', '这是卖啥', '累不累', '凭什么']) {
    assert.ok(p.includes(word), `提示词应点名禁用「${word}」`);
  }
  assert.ok(p.includes('质问'), '提示词应出现「质问」');
  assert.ok(p.includes('嘲讽'), '提示词应出现「嘲讽」');
  assert.ok(p.includes('数落'), '提示词应出现「数落」');
  // 旧版"信息不足就自然追问一句"是诱导质问的元凶，必须已被替换
  assert.ok(!p.includes('自然追问'), '旧版「自然追问」引导应已被移除');
  assert.ok(p.includes('陈述句'), '信息不足时应引导为陈述句反应');
});

// =====================================================================
// D. 已知缺陷登记（skip）：修复后删除 skip 即可翻转断言
// =====================================================================

// 误伤：以下都是正常、不针对发布者的口语表达。
// 共性：把「啥…不…」「卖啥…」「搞笑…」「开什么玩笑」「就给个编号」用于**正向惊讶/自我表达**。
// 批次 41 已通过收窄 RUDE_COMMENT_PATTERNS 全部修复，flip skip 验证零误伤。
const FALSE_POSITIVES_KNOWN = [
  '啥也不说了，这价直接冲', // 热情下单，非质问（靠移除「啥…也…」分支）
  '啥也不说了，冲就完事',
  '啥也不说了兄弟们冲',
  '什么意思，比上个月还便宜', // 惊讶于便宜，非质问（批次 40 已修）
  '什么意思，居然还包邮',
  '没看懂什么意思，求科普', // 真诚求问
  '卖啥不重要，便宜就行', // 客观陈述，质问「这是卖啥/到底卖啥/卖啥啊/？」才命中
  '搞笑呢，这价格像白送', // 正向惊讶，批次 41 移除「搞笑(?:吗|呢)」
  '开什么玩笑，这价也太香了', // 正向惊讶，批次 41 移除「开什么玩笑」
  '就给个编号也不影响我下单' // 批次 41 移除「就给个编号」
];

test('D1 误伤清零：10 条正向/中性口语评论均不命中「语气带质问或嘲讽」', () => {
  const wrong = [];
  for (const s of FALSE_POSITIVES_KNOWN) {
    if (productCommentIssues(s).includes(RUDE)) wrong.push(s);
  }
  assert.deepEqual(wrong, [], '这些正常评论不应被判为攻击性');
});

// 覆盖缺口：换个说法就能绕过。当前 RUDE_COMMENT_PATTERNS 主要覆盖「啥X不Y」这一形状，
// 通用嘲讽/贬损说法几乎都不在覆盖内。批次 41 已补 4 个低风险短语（谁给的勇气/也好意思/标题党/侮辱智商）。
//
// 已移除（靠 prompt 层 + 重试兜底，标注于下）：
//   - 「就这？」单独使用 → 「这价…就这？」是常见正向惊讶，单独拦会误伤
//   - 「啥玩意儿」       → 「这玩意儿这么便宜」可作正向，单独拦会误伤
//   - 「发个寂寞」       → 与「发个链接」/「发个图」太近，单独拦会误伤
//   - 「写清楚点会死吗」→ 「会死吗」在「这便宜不入手会死吗」是正向
const AGGRESSIVE_MISSED = [
  '这也能叫爆料？', // 批次 40 已加
  '谁给的勇气标这个价', // 批次 41 新加
  '怕不是把人当傻子', // 批次 40 已加
  '这也好意思发出来', // 批次 41 新加（从「就这？也好意思发出来」拆出，去掉易误伤的「就这？」）
  '标题党吧', // 批次 41 新加（从「啥玩意儿，标题党吧」拆出，去掉易误伤的「啥玩意儿」）
  '这是在侮辱智商吗' // 批次 41 新加
];

test('D2 覆盖缺口闭合：6 条攻击性说法全部命中「语气带质问或嘲讽」', () => {
  const missed = AGGRESSIVE_MISSED.filter((s) => !productCommentIssues(s).includes(RUDE));
  assert.deepEqual(missed, [], '这些攻击性说法应被拦截');
});

// 第三条生成链路（每日任务 interactive.comment）未套 hasUsableProductFact 守卫。
// 批次 41 已修复：tasks_real.js 的 performDailyTask 在 interactive.comment 分支对
// !hasUsableProductFact(article) 的条目跳过——不调 generateComment、不 doComment，
// 且不致整个每日任务失败（performDailyTask 改返回 "无可用商品信息…"）。
test('D3 每日任务 interactive.comment 同样跳过占位标题条目', async () => {
  const { doDailyTasks } = await import('../src/smzdm/tasks_real.js');
  const calls = [];
  const posted = [];
  const listResp = {
    error_code: 0,
    data: {
      rows: [
        {
          cell_data: {
            activity_task: {
              default_list_v2: [
                {
                  task_list: [
                    {
                      task_id: 't1',
                      task_name: '去评论',
                      task_event_type: 'interactive.comment',
                      task_status: '2',
                      task_even_num: 1,
                      task_finished_num: 0
                    }
                  ]
                }
              ]
            }
          }
        }
      ]
    }
  };
  await doDailyTasks('cookie', {
    request: async () => listResp,
    adapter: {
      doComment: async (cookie, opts) => {
        posted.push(opts.articleId);
        return { count: 1, message: 'ok' };
      }
    },
    // 只粘贴链接导入产生的条目：占位标题 + 空正文 + 空价格
    articles: [{ smzdmUrl: 'https://www.smzdm.com/p/180074206', title: '文章 180074206', content: '', price: '' }],
    gpt: { enabled: true, tone: 'friendly', prompt: '' },
    generateComment: async (arg) => {
      calls.push(arg);
      return '这个价我先观望下';
    },
    getToken: async () => 'token',
    wait: async () => {}
  });
  assert.equal(calls.length, 0, '占位标题条目不应调用大模型（当前会调用，故本用例 skip）');
  assert.deepEqual(posted, [], '占位标题条目不应发布评论');
});

// =====================================================================
// E. runEngagement：占位标题逐篇跳过
// =====================================================================
test('E1 runEngagement：占位标题篇跳过，同批正常篇照常评论（逐篇而非整批失败）', async () => {
  const restoreDelays = silenceDelays();
  const db = freshDb([
    { smzdmUrl: 'https://x/p/180074206', title: '文章 180074206', content: '', price: '' },
    { smzdmUrl: 'https://x/p/200', title: '蔡司1.67钛架', content: '小巧便携', price: '299 元' }
  ]);
  const llm = stubLlm('这个尺寸放办公桌挺合适。');
  const comment = stubDoComment();
  try {
    const r = await runTask({ type: 'comment', articleSource: 'baoliao', limit: 5, name: '评论' }, db, {});

    // 1) 两篇都被处理（逐篇，不是整批中断）
    assert.equal(r.result.details.length, 2, '两篇都应产出执行详情');
    const placeholderDetail = r.result.details.find((d) => d.articleId === '180074206');
    const normalDetail = r.result.details.find((d) => d.articleId === '200');
    assert.ok(placeholderDetail, '占位条目应有详情');
    assert.ok(normalDetail, '正常条目应有详情');

    // 2) 占位篇失败且原因可读可操作
    assert.equal(placeholderDetail.ok, false);
    assert.match(placeholderDetail.message, /商品信息不足/, '失败原因应说明信息不足');
    assert.match(placeholderDetail.message, /文章ID占位标题/, '失败原因应点明占位标题');
    assert.match(placeholderDetail.message, /补全标题或价格/, '失败原因应给出可操作建议');

    // 3) 正常篇照常成功
    assert.equal(normalDetail.ok, true);
    assert.equal(normalDetail.comment, '这个尺寸放办公桌挺合适。');

    // 4) 只为正常篇调用过一次大模型（占位篇没浪费调用）
    assert.equal(llm.llmCalls(), 1, '只应为 1 篇正常条目调用大模型');

    // 5) 占位篇绝不会发出任何评论
    assert.equal(comment.posted.length, 1, '只应发出 1 条评论');
    assert.equal(comment.posted[0].articleId, '200', '发出的评论应属于正常条目');
    assert.ok(!comment.posted.some((p) => p.articleId === '180074206'), '占位条目不得发出评论');

    // 6) 汇总信息可读
    assert.match(r.message, /成功 1 篇/);
    assert.match(r.message, /商品信息不足/);
  } finally {
    comment.restore();
    globalThis.fetch = realFetch;
    restoreDelays();
  }
});

test('E2 runEngagement：占位标题但有价格时不跳过（守卫不应过度拦截）', async () => {
  const restoreDelays = silenceDelays();
  const db = freshDb([
    { smzdmUrl: 'https://x/p/180074206', title: '文章 180074206', content: '', price: '299 元' }
  ]);
  assert.equal(hasUsableProductFact(db.baoliao[0]), true, '有价格即视为有可用信息');
  const llm = stubLlm('299这个价我先观望下。');
  const comment = stubDoComment();
  try {
    const r = await runTask({ type: 'comment', articleSource: 'baoliao', limit: 5, name: '评论' }, db, {});
    assert.equal(r.ok, true, '有可用信息时应正常评论');
    assert.equal(llm.llmCalls(), 1);
    assert.equal(comment.posted.length, 1);
  } finally {
    comment.restore();
    globalThis.fetch = realFetch;
    restoreDelays();
  }
});

// =====================================================================
// F. runGptBatch：占位标题跳过 + autoPost 下不发布
// =====================================================================
test('F1 runGptBatch：占位标题条目跳过，autoPost 下不发布任何内容', async () => {
  const db = freshDb([
    { id: 'b1', smzdmUrl: 'https://x/p/180074206', title: '文章 180074206', content: '', price: '' },
    { id: 'b2', smzdmUrl: 'https://x/p/200', title: '蔡司1.67钛架', content: '小巧便携', price: '299 元' }
  ]);
  const llm = stubLlm('这个尺寸放办公桌挺合适。');
  const comment = stubDoComment();
  try {
    const r = await runTask({ type: 'gpt', limit: 5, autoPost: true, name: 'GPT' }, db, {});
    assert.equal(r.ok, true, '有一条成功即整体成功');
    assert.equal(r.result.count, 1, '只应生成 1 条草稿');

    // 占位条目被记为失败，原因可读
    assert.match(r.message, /商品信息不足/);
    assert.match(r.message, /文章ID占位标题/);

    // 只为正常条目调用大模型
    assert.equal(llm.llmCalls(), 1);

    // 只发布正常条目，且发布内容是模型产出的正常评论
    assert.equal(comment.posted.length, 1, '占位条目不得被发布');
    assert.equal(comment.posted[0].articleId, '200');
    assert.equal(comment.posted[0].content, '这个尺寸放办公桌挺合适。');

    // 草稿只落 1 条
    const newDrafts = db.gptDrafts.filter((d) => d.content === '这个尺寸放办公桌挺合适。');
    assert.equal(newDrafts.length, 1);
  } finally {
    comment.restore();
    globalThis.fetch = realFetch;
  }
});

test('F2 runGptBatch：全部条目都是占位标题时不发布任何内容且给出明确失败', async () => {
  const db = freshDb([
    { id: 'b1', smzdmUrl: 'https://x/p/180074206', title: '文章 180074206', content: '', price: '' },
    { id: 'b2', smzdmUrl: 'https://x/p/180074207', title: '文章 180074207', content: '', price: '' }
  ]);
  const llm = stubLlm('这个价我先观望下');
  const comment = stubDoComment();
  try {
    const r = await runTask({ type: 'gpt', limit: 5, autoPost: true, name: 'GPT' }, db, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'gpt_all_failed');
    assert.equal(llm.llmCalls(), 0, '不应为纯占位条目调用大模型');
    assert.equal(comment.posted.length, 0, '不应发布任何内容');
    assert.match(r.message, /商品信息不足/);
  } finally {
    comment.restore();
    globalThis.fetch = realFetch;
  }
});

// =====================================================================
// G. 占位标题不得进入大模型请求体
// =====================================================================
test('G1 占位标题按「未提供」传给模型，裸文章 ID 不出现在任何请求体中', async () => {
  const db = freshDb([
    { smzdmUrl: 'https://x/p/180074206', title: '文章 180074206', content: '蔡司镜片现货', price: '' }
  ]);
  const llm = stubLlm('蔡司这个价还行，观望下。');
  const comment = stubDoComment();
  const restoreDelays = silenceDelays();
  try {
    await runTask({ type: 'comment', articleSource: 'baoliao', limit: 5, name: '评论' }, db, {});
    assert.equal(llm.llmCalls(), 1);
    const body = llm.calls.find((c) => c.body.includes('商品资料')).body;
    assert.ok(body.includes('商品标题：未提供'), '占位标题应替换为「未提供」');
    assert.ok(!body.includes('180074206'), '裸文章 ID 不得出现在喂给模型的资料里');
    assert.ok(body.includes('商品正文：蔡司镜片现货'), '真实正文应保留');
  } finally {
    comment.restore();
    globalThis.fetch = realFetch;
    restoreDelays();
  }
});

test('G2 非占位标题保持原样透传（不得误伤真实标题）', async () => {
  const db = freshDb([
    { smzdmUrl: 'https://x/p/200', title: '文章 同款对比：三款降噪耳机横评', content: '', price: '299 元' }
  ]);
  const llm = stubLlm('横评写得挺细，299这个价可以看看。');
  const comment = stubDoComment();
  const restoreDelays = silenceDelays();
  try {
    await runTask({ type: 'comment', articleSource: 'baoliao', limit: 5, name: '评论' }, db, {});
    const body = llm.calls.find((c) => c.body.includes('商品资料')).body;
    assert.ok(body.includes('商品标题：文章 同款对比'), '真实标题（含"文章"二字）必须原样透传');
    assert.ok(!body.includes('商品标题：未提供'), '真实标题不得被误判为占位');
  } finally {
    comment.restore();
    globalThis.fetch = realFetch;
    restoreDelays();
  }
});

// =====================================================================
// H. isRetriableCommentError 放宽后的重试预算量化
// =====================================================================
test('H1 自然度检查失败现可重试，但重试预算仍封顶为 2（最多 3 次尝试 / 6 次大模型调用）', async () => {
  const restoreDelays = silenceDelays();
  // 固定返回一条必然被 RUDE 命中的评论，逼出「生成 → 重写 → 判失败 → 重试」全链路
  const db = freshDb([
    { smzdmUrl: 'https://x/p/200', title: '蔡司1.67钛架', content: '小巧便携', price: '299 元' }
  ]);
  const llm = stubLlm('啥正文都不给，就甩个长文章id糊弄人呢？');
  const comment = stubDoComment();
  try {
    const r = await runTask({ type: 'comment', articleSource: 'baoliao', limit: 5, name: '评论' }, db, {});
    assert.equal(r.ok, false, '模型持续产出冲话术时任务应最终失败');
    assert.match(r.message, /商品信息不足|糊弄人呢|自然度检查/);
    // 每次尝试 = 1 次生成 + 1 次重写 = 2 次；maxCommentRetry=2 → 共 3 次尝试
    assert.equal(llm.llmCalls(), 6, '重试预算应封顶：3 次尝试 × 2 次调用 = 6 次');
    assert.equal(comment.posted.length, 0, '冲话术不得被发布');
  } finally {
    comment.restore();
    globalThis.fetch = realFetch;
    restoreDelays();
  }
});

test('H2 确定性跳过不触发重试（占位标题篇只失败一次）', async () => {
  const restoreDelays = silenceDelays();
  const db = freshDb([
    { smzdmUrl: 'https://x/p/180074206', title: '文章 180074206', content: '', price: '' }
  ]);
  assert.equal(isRetriableCommentError('商品信息不足（仅有文章ID占位标题），已跳过该篇以免生成无意义评论；请补全标题或价格'), false);
  const llm = stubLlm('这个价我先观望下');
  const comment = stubDoComment();
  try {
    await runTask({ type: 'comment', articleSource: 'baoliao', limit: 5, name: '评论' }, db, {});
    assert.equal(llm.llmCalls(), 0, '确定性跳过不应消耗任何大模型调用');
  } finally {
    comment.restore();
    globalThis.fetch = realFetch;
    restoreDelays();
  }
});
