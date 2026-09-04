// 零副作用验证：只调 generateProductComment（生成半程），不调 smzdm.doComment（不发帖）
// 用途：验证批次 39/40/41 话术收敛在真实数据 + 真实模型下的效果
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// db.json 在仓库根 data/（server/tools/ -> ../.. -> 仓库根）
const dbPath = path.resolve(__dirname, '../../data/db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

const { generateProductComment, productCommentIssues, hasUsableProductFact } = await import('../src/gptAdapter.js');

const baoliao = db.baoliao || [];
const gptCfg = db.settings?.gpt || {};
// provider = 页面保存的 AI 服务配置（apiKey/apiBase/model），taskRunner 走 API 时也用它
const provider = {
  apiKey: gptCfg.apiKey,
  apiBase: gptCfg.apiBase,
  model: gptCfg.model
};

// 取样：3 条有真实信息的 + 3 条占位标题
const real = baoliao.filter((b) => hasUsableProductFact(b));
const placeholder = baoliao.filter((b) => !hasUsableProductFact(b));
console.log(`[meta] baoliao=${baoliao.length} real=${real.length} placeholder=${placeholder.length}`);
console.log(`[meta] tone=${gptCfg.tone} prompt=${gptCfg.prompt ? '(set)' : '(empty)'} model via env`);

// 真实好价取 3 条（避开前 10 条可能已评过的，用带 price 的）
const realSamples = real.slice(0, 6).filter((b) => b.price).slice(0, 3);
const phSamples = placeholder.slice(0, 3);

const results = [];
async function run(tag, item) {
  try {
    const started = Date.now();
    const content = await generateProductComment({
      title: item.title,
      content: item.content,
      price: item.price,
      tone: gptCfg.tone,
      prompt: gptCfg.prompt,
      provider
    });
    const ms = Date.now() - started;
    const issues = productCommentIssues(content);
    results.push({ tag, id: item.id || item.articleId || '?', title: String(item.title || '').slice(0, 28), price: item.price || '', content, issues, ms });
    console.log(`\n[${tag}] ${results.length}/6  id=${item.id || item.articleId} (${ms}ms)`);
    console.log(`  title: ${String(item.title || '').slice(0, 28)} | price: ${item.price || '(空)'}`);
    console.log(`  content: ${content}`);
    console.log(`  issues: ${JSON.stringify(issues)}  ${issues.length ? '❌' : '✅ 通过'}`);
  } catch (e) {
    results.push({ tag, id: item.id || item.articleId || '?', error: String(e?.message || e).slice(0, 200) });
    console.log(`\n[${tag}] ERROR ${item.id || '?'}: ${String(e?.message || e).slice(0, 200)}`);
  }
}

console.log('=== 开始生成（真实模型调用，每条约 10-40s）===');
for (const b of realSamples) await run('REAL-真实好价', b);
for (const b of phSamples) await run('PLACE-占位标题', b);

// 汇总
console.log('\n========== 汇总 ==========');
const ok = results.filter((r) => !r.error && r.issues.length === 0);
const bad = results.filter((r) => !r.error && r.issues.length > 0);
const err = results.filter((r) => r.error);
console.log(`成功无问题: ${ok.length}/6`);
console.log(`生成但有问题: ${bad.length}/6`);
console.log(`生成失败: ${err.length}/6`);
console.log('DONE');
