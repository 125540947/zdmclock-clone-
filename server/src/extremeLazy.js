// 偷懒-极端 · 一键全自动流水线
//
// 把整个工作流串成一条线：签到 → 刷新好价 → GPT 生成 → 互动(评/藏/赞) → 抽奖/转盘/众测/每日任务/关注/分享
// 用户只需点一次「开始极端偷懒」，后续全部自动跑完。
//
// 数据互通（A → B）：每步成功结果写入资产账本（assetLedger），资产仪表盘实时可见。

import { load, persist, withWriteLock, mergeBaoliao, genId } from './store.js';
import { runTask } from './taskRunner.js';
import { smzdm } from './smzdm/adapter.js';
import { generateReply } from './gptAdapter.js';
import { applyAssetEffect, taskNameOf } from './assetLedger.js';
import { notify } from './notifier.js';
import { normalizeArticleId } from './smzdm/articleId.js';
import { removeTags, extractReward } from './smzdm/parse.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const JITTER_MIN = 600;
const JITTER_MAX = 1800;

function jitter() {
  return JITTER_MIN + Math.floor(Math.random() * (JITTER_MAX - JITTER_MIN + 1));
}

// 收集文章 ID 列表（与 taskRunner.collectArticleIds 统一用 normalizeArticleId，
// 避免极端懒人流水线与其他路径对同一文章抽出不同 ID 导致互动/分享定位错乱）
function collectArticleIds(db) {
  const ids = [];
  for (const item of db.baoliao || []) {
    const raw = item.smzdmUrl || item.url || '';
    if (!raw) continue;
    const aid = normalizeArticleId(raw);
    if (aid && !ids.includes(aid)) ids.push(aid);
  }
  return ids;
}

export async function runExtremeLazy(opts = {}) {
  const db = load();
  const logs = [];
  const results = { steps: [], totalOk: 0, totalFail: 0 };

  function log(msg) {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    logs.push(`[${ts}] ${msg}`);
  }

  function stepResult(name, ok, detail) {
    const r = { name, ok, detail: detail || '' };
    results.steps.push(r);
    if (ok) results.totalOk++;
    else results.totalFail++;
    return r;
  }

  // 与 resolveUsers 自动路径一致：仅对「已开启自动跑（autoRun!==false）」的账号执行，
  // 录入时未勾选自动跑的账号不参与极端懒人全自动流水线。
  const users = db.users.filter((u) => u.cookie && u.autoRun !== false);
  if (!users.length) {
    return { ok: false, message: '请先添加 smzdm 账号', logs: ['没有可用账号（需要录入 Cookie）'] };
  }

  // ===== Step 1: 签到 =====
  log('>>> 第 1 步：签到（所有账号）');
  let clockOk = 0, clockFail = 0;
  for (const user of users) {
    try {
      const r = await runTask(
        { type: 'clock', name: '每日签到' },
        db,
        { userId: user.id }
      );
      if (r.ok) {
        clockOk++;
        log(`  ✓ ${user.nickname || user.id}：签到成功`);
      } else {
        clockFail++;
        log(`  ✗ ${user.nickname || user.id}：${r.message}`);
      }
    } catch (e) {
      clockFail++;
      log(`  ✗ ${user.nickname || user.id}：异常 ${e.message}`);
    }
    await sleep(jitter());
  }
  stepResult('签到', clockFail === 0, `${clockOk} 成功 / ${clockFail} 失败`);

  // ===== Step 2: 刷新好价 =====
  log('>>> 第 2 步：刷新好价列表');
  let fetchCount = 0;
  try {
    const r = await runTask(
      { type: 'fetch', name: '刷新好价', limit: 20 },
      db,
      {}
    );
    if (r.ok) {
      fetchCount = r.result?.count || 0;
      log(`  ✓ 抓取完成：新增 ${fetchCount} 条`);
    } else {
      log(`  ✗ 抓取失败：${r.message}`);
    }
  } catch (e) {
    log(`  ✗ 抓取异常：${e.message}`);
  }
  stepResult('刷新好价', fetchCount > 0 || db.baoliao.length > 0, `爆料箱共 ${db.baoliao.length} 条`);

  // ===== Step 3: GPT 批量生成（若启用）=====
  log('>>> 第 3 步：GPT 批量生成评论');
  let gptGen = 0, gptPosted = 0;
  if (db.settings?.gpt?.enabled && db.baoliao.length > 0) {
    try {
      const r = await runTask(
        { type: 'gpt', name: 'GPT 批量生成', source: 'baoliao', autoPost: !!db.settings.gpt.autoPost, limit: 5 },
        db,
        {}
      );
      if (r.ok) {
        gptGen = r.result?.count || 0;
        // 计算已自动发布的条数
        if (db.gptDrafts) {
          gptPosted = db.gptDrafts.filter((d) => d.status === 'posted').length;
        }
        log(`  ✓ 生成 ${gptGen} 条评论草稿，自动发布 ${gptPosted} 条`);
      } else {
        log(`  ✗ GPT 生成失败：${r.message}`);
      }
    } catch (e) {
      log(`  ✗ GPT 异常：${e.message}`);
    }
  } else if (!db.settings?.gpt?.enabled) {
    log('  ⊘ GPT 未启用，跳过');
  } else {
    log('  ⊘ 好价列表为空，跳过');
  }
  stepResult('GPT生成', gptGen >= 0, `生成 ${gptGen} 条`);

  // ===== Step 4: 互动（评论/收藏/点赞）=====
  const articleIds = collectArticleIds(db);
  const engagementTypes = [
    { type: 'comment', name: '自动评论', emoji: '💬' },
    { type: 'favorite', name: '自动收藏', emoji: '⭐' },
    { type: 'point', name: '自动点赞', emoji: '👍' }
  ];

  for (const action of engagementTypes) {
    log(`>>> 第 4 步：${action.emoji} ${action.name}`);
    if (!articleIds.length) {
      log('  ⊘ 没有可用文章 ID（请先刷新好价或手动指定文章）');
      stepResult(action.name, false, '无可用文章');
      continue;
    }

    // 找到或创建对应任务配置
    const taskTypeMap = { comment: 't_comment', favorite: 't_favorite', point: 't_point' };
    const existingTask = db.tasks.find((t) => t.id === taskTypeMap[action.type]);
    const taskConfig = existingTask || {
      id: taskTypeMap[action.type],
      type: action.type,
      name: action.name,
      articleSource: 'baoliao'
    };

    try {
      const r = await runTask(taskConfig, db, { articleSource: 'baoliao' });
      if (r.ok) {
        const count = r.result?.count || 0;
        log(`  ✓ ${action.emoji} 完成：${r.message || count + ' 次动作'}`);
        stepResult(action.name, true, r.message || `${count} 次`);
      } else {
        log(`  ✗ ${action.emoji} 失败：${r.message}`);
        stepResult(action.name, false, r.message);
      }
    } catch (e) {
      log(`  ✗ ${action.emoji} 异常：${e.message}`);
      stepResult(action.name, false, e.message);
    }
    await sleep(jitter());
  }

  // ===== Step 5: 抽奖 / 转盘 / 众测 / 每日任务 / 关注 / 分享 =====
  const autoTasks = [
    { type: 'lottery', name: '每日抽奖', emoji: '🎰' },
    { type: 'turntable', name: '转盘抽奖', emoji: '🎡' },
    { type: 'crowdtest', name: '全民众测', emoji: '🧪' },
    { type: 'dailyTasks', name: '每日任务', emoji: '📋' },
    { type: 'follow', name: '自动关注', emoji: '➕' },
    { type: 'share', name: '自动分享', emoji: '🔗' }
  ];

  log('>>> 第 5 步：抽奖/转盘/众测/每日任务/关注/分享');
  for (const at of autoTasks) {
    const existingTask = db.tasks.find((t) => t.type === at.type);
    if (!existingTask || !existingTask.enabled) {
      log(`  ⊘ ${at.emoji} ${at.name}：未启用，跳过`);
      stepResult(at.name, true, '未启用，跳过');
      continue;
    }
    try {
      const r = await runTask(existingTask, db, {});
      if (r.ok) {
        log(`  ✓ ${at.emoji} ${at.name}：${r.message || '完成'}`);
        stepResult(at.name, true, r.message || '完成');
      } else {
        log(`  ✗ ${at.emoji} ${at.name}：${r.message}`);
        stepResult(at.name, false, r.message);
      }
    } catch (e) {
      log(`  ✗ ${at.emoji} ${at.name}：异常 ${e.message}`);
      stepResult(at.name, false, e.message);
    }
    await sleep(jitter());
  }

  // ===== 汇总 =====
  const allOk = results.totalFail === 0;
  const summary =
    `极端偷懒完成：${results.totalOk} 步成功 / ${results.totalFail} 步失败` +
    (fetchCount > 0 ? `，本次新增好价 ${fetchCount} 条` : '') +
    (gptGen > 0 ? `，GPT 生成 ${gptGen} 条` : '');

  log(`>>> 完成！${summary}`);

  // 通知
  const title = allOk ? '✅ 极端偷懒完成' : `⚠️ 极端偷懒完成（${results.totalFail} 步有异常）`;
  notify(db, { title, message: summary }).catch(() => {});

  return {
    ok: allOk,
    message: summary,
    logs,
    results
  };
}
