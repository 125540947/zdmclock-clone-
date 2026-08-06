// 真机端点验证核心逻辑（P1-1）：被 CLI（tools/verifyRealMode.mjs）与
// 路由（routes/health.js 的 POST /api/health/verify）共用，避免重复实现。
//
// 设计原则：
//  - 默认「只读探测」：只验证 Cookie 有效性、签名、以及各端点的可达性与解析结构，
//    绝不调用会消耗抽奖次数/领取奖励的写接口（jsonp_draw / activity_task_receive /
//    ajax_participate / 实际签到的 POST），避免误消耗。
//  - withCheckin=true 才真正签一次到（每日一次，低风险），用于端到端验证签到链路。
//  - 所有网络探测都走 realAdapter / tasks_real 的真实实现（与线上一致），不 mock。
//
// runVerification({ cookie, withCheckin }) → results[]
//   每项：{ name, kind, status: 'PASS'|'FAIL'|'SKIP', detail, ms }

import { realAdapter, signFormData, appRequest, call } from './smzdm/realAdapter.js';
import { discoverActiveIds, getTestingActivityId } from './smzdm/tasks_real.js';

// 安全可达性探测：原站遗留端点（评论/收藏/点赞/爆料）走 www.smzdm.com + Cookie（无 app 签名）。
// 以「空 article_id / 空标题」POST，仅验证：URL 正确、方法正确、返回 JSON 结构（而非 404/HTML）。
// 不会真正发表评论/收藏/点赞/爆料（缺有效 article_id 时 smzdm 返回错误 JSON，不落库）。
const WWW = 'https://www.smzdm.com';

export async function runVerification({ cookie, withCheckin = false } = {}) {
  const results = [];
  const probe = async (name, kind, fn) => {
    const start = Date.now();
    try {
      const detail = await fn();
      results.push({ name, kind, status: 'PASS', detail, ms: Date.now() - start });
    } catch (e) {
      results.push({ name, kind, status: 'FAIL', detail: e?.message || String(e), ms: Date.now() - start });
    }
  };
  const probeReachability = async (name, path, body = { article_id: '' }) => {
    await probe(name, 'endpoint', async () => {
      const r = await call(path, { method: 'POST', cookie, body, base: WWW });
      if (typeof r !== 'object' || r === null) throw new Error('返回非 JSON（端点可能已变更或需登录态）');
      const ec = r.error_code ?? r.errorCode ?? r.code ?? '';
      const msg = r.error_msg ?? r.error_reason ?? r.msg ?? '';
      return `接口可达（空参数返回错误码=${ec || 'n/a'} ${msg ? '· ' + msg.slice(0, 24) : ''}），端点存活且返回 JSON`;
    });
  };

  // 1) 离线：签名算法是否能产出 32 位大写 MD5（不依赖网络）
  await probe('签名算法 signFormData', 'offline', () => {
    const r = signFormData({ sk: 'SK', token: 'TK' });
    if (!r.sign || !/^[0-9A-F]{32}$/.test(r.sign)) throw new Error('签名未生成或格式异常');
    return `sign=${r.sign}`;
  });

  // 2) Cookie 有效性 + 身份解析（GET /user/）
  await probe('账号身份 /user/', 'cookie', async () => {
    const u = await realAdapter.getUserInfo(cookie);
    if (!u.nickname && !u.smzdmId) throw new Error('返回空身份（Cookie 失效或端点变更）');
    return `昵称=${u.nickname || '-'} 等级=${u.level} 积分=${u.points}`;
  });

  // 3) robot/token（签名鉴权前置，每日任务/签到都要）
  await probe('robot/token 鉴权', 'auth', async () => {
    const t = await realAdapter.getRobotToken(cookie);
    if (!t) throw new Error('未返回 token');
    return `token=${String(t).slice(0, 6)}…（${String(t).length} 字符）`;
  });

  // 4) 每日任务 list_v2（只读，验证端点可达 + 结构解析，不领奖）
  await probe('每日任务 list_v2', 'endpoint', async () => {
    const list = await appRequest('/task/list_v2', { cookie, method: 'POST', data: {} });
    const rows = list?.data?.data?.rows || list?.data?.rows || [];
    return `接口可达，任务分组数=${rows.length}`;
  });

  // 5) 转盘 active_id 自动发现（只读抓专题页抽 hashId，不抽奖）
  await probe('转盘 active_id 自动发现', 'endpoint', async () => {
    const ids = await discoverActiveIds(cookie);
    if (!ids.length) throw new Error('未从内置专题页提取到 active_id（专题页可能改版）');
    return `命中 ${ids.length} 个: ${ids.join(', ')}`;
  });

  // 6) 众测 全民众测活动自动发现（只读，不领能量/不申请商品）
  await probe('众测 全民众测 activity_id', 'endpoint', async () => {
    const aid = await getTestingActivityId(cookie);
    if (!aid) throw new Error('未找到进行中的全民众测活动（可能暂未开启）');
    return `activity_id=${aid}`;
  });

  // 6b) 原站遗留端点（评论/收藏/点赞/爆料）：安全可达性探测（空参数 POST，不真正发表）
  await probeReachability('评论 ajax_post_comment', '/article/ajax_post_comment');
  await probeReachability('收藏 ajax_favorite', '/article/ajax_favorite');
  await probeReachability('点赞 ajax_vote', '/article/ajax_vote');
  await probeReachability('爆料 ajax_create', '/publish/articles/ajax_create', {
    title: '', link: '', price: '', category: '', content: ''
  });

  // 7) 签到（写操作）：默认跳过，避免重复签到
  if (withCheckin) {
    await probe('签到 /checkin（实签）', 'MUTATING', async () => {
      const r = await realAdapter.doClockIn(cookie);
      if (!r.success) throw new Error('签到返回失败');
      return r.message;
    });
  } else {
    results.push({
      name: '签到 /checkin（实签）',
      kind: 'MUTATING',
      status: 'SKIP',
      detail: '默认不执行（避免重复签到）。传 withCheckin=true 实签一次以端到端验证。',
      ms: 0
    });
  }

  return results;
}

export const WRITE_NOTE =
  '注：以下为「写操作」端点，本验证不主动调用以免消耗（仅验证其前置可达性）：\n' +
  '  · 转盘抽奖 jsonp_draw       —— 由「转盘 active_id 自动发现」保障；真正抽奖在定时任务中执行\n' +
  '  · 每日任务领奖 activity_task_receive —— 由「每日任务 list_v2」保障\n' +
  '  · 众测能量领取 / 商品申请     —— 由「众测 activity_id 自动发现」保障\n' +
  '  · 评论/收藏/点赞/爆料         —— 已做「安全可达性探测」（空参数 POST 验证端点存活，不真正发表）\n' +
  '  若这些前置探测 PASS，则实际运行通常不会因端点失效而失败。';
