import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signFormData } from '../src/smzdm/realAdapter.js';
import {
  extractReward,
  parseJsonp,
  extractHashId,
  discoverActiveIds,
  getTestingActivityId,
  doTurntable,
  doCrowdtest,
  doFollow,
  doShare,
  doDailyTasks,
  parseDailyTaskList,
  getRecommendedFollowUsers
} from '../src/smzdm/tasks_real.js';

test('signFormData：按键字母排序 + 追加 key + md5 大写', () => {
  const out = signFormData({ sk: 'SK', token: 'TK' });
  const keys = Object.keys(out).filter((k) => k !== 'sign').sort();
  // 公共参数 + 业务参数齐全
  for (const k of ['weixin', 'basic_v', 'f', 'v', 'time', 'sk', 'token']) {
    assert.ok(k in out, `缺少 ${k}`);
  }
  // sign 是 32 位大写十六进制
  assert.match(out.sign, /^[0-9A-F]{32}$/);
  // 自洽：sign 等于对排序串联 + key 的 md5
  const signData = keys.map((k) => `${k}=${String(out[k]).replace(/\s+/g, '')}`).join('&');
  const expected = crypto.createHash('md5').update(`${signData}&key=apr1$AwP!wRRT$gJ/q.X24poeBInlUJC`).digest('hex').toUpperCase();
  assert.equal(out.sign, expected);
});

test('extractReward：从奖励文案近似提取金币/碎银/经验', () => {
  assert.deepEqual(extractReward('恭喜获得<strong>5</strong>金币'), { gold: 5, silver: 0, exp: 0 });
  assert.deepEqual(extractReward('获得10碎银子奖励'), { gold: 0, silver: 10, exp: 0 });
  assert.deepEqual(extractReward('经验+20点'), { gold: 0, silver: 0, exp: 20 });
  const mix = extractReward('获得3金币、5碎银、经验+8');
  assert.equal(mix.gold, 3);
  assert.equal(mix.silver, 5);
  assert.equal(mix.exp, 8);
});

test('parseJsonp：剥离回调外壳取内部 JSON', () => {
  assert.deepEqual(parseJsonp('jQuery123_169({ "a": 1, "b": "x" })'), { a: 1, b: 'x' });
  assert.deepEqual(parseJsonp('{"c":2}'), { c: 2 }); // 无外壳直接解析
});

test('extractHashId：从转义/未转义 JSON 与表单值提取 active_id', () => {
  assert.equal(extractHashId('var x={\\"hashId\\":\\"ABC123\\"}'), 'ABC123');
  assert.equal(extractHashId('{"hashId":"DEF456"}'), 'DEF456');
  assert.equal(extractHashId('<input name="lottery_activity_id" value="GHI789">'), 'GHI789');
  assert.equal(extractHashId('no id here'), null);
});

test('discoverActiveIds：遍历内置专题页抽取 hashId（注入 fetcher 避免联网）', async () => {
  const fetcher = async (url) => {
    if (url.includes('bwrzf5')) return 'a \\"hashId\\":\\"ABC123\\" b';
    return 'c \\"hashId\\":\\"DEF456\\" d';
  };
  const ids = await discoverActiveIds('cookie', fetcher);
  assert.deepEqual(ids.sort(), ['ABC123', 'DEF456']);
});

test('doTurntable 自动模式：无参时从专题页获取 active_id 并抽奖', async () => {
  const fetcher = async (url) => {
    if (url.startsWith('https://m.smzdm.com/topic')) return '{"hashId":"TID999"}';
    return 'jQuery123({"error_code":0,"error_msg":"抽奖完成"})';
  };
  const r = await doTurntable('cookie', { call: fetcher });
  assert.equal(r.success, true);
  assert.match(r.message, /抽奖完成/);
});

test('doTurntable 自动模式：专题页无法获取 active_id 时抛错（绝不伪造成功）', async () => {
  const fetcher = async () => 'no hashId here';
  await assert.rejects(() => doTurntable('cookie', { call: fetcher }), /未能自动获取/);
});

test('doCrowdtest 自动模式：无 crowd_id 时跑全民众测能量任务', async () => {
  const fetcher = async (url) => {
    if (url.includes('ajax_get_activity_id')) return { data: { activity_id: 'ACT1' } };
    if (url.includes('ajax_get_activity_info')) {
      return { data: { activity_task: { default_list: [{ task_id: 't1' }, { task_id: 't2' }] } } };
    }
    if (url.includes('ajax_activity_task_receive')) return { error_code: 0, data: { reward_msg: '能量+10' } };
    return {};
  };
  const r = await doCrowdtest('cookie', { call: fetcher });
  assert.equal(r.success, true);
  assert.match(r.message, /全民众测能量任务/);
});

test('doCrowdtest 自动模式：无进行中活动时软跳过（不计入失败）', async () => {
  const fetcher = async () => ({ data: {} });
  const r = await doCrowdtest('cookie', { call: fetcher });
  assert.equal(r.success, true);
  assert.equal(r.softSkip, true);
  assert.match(r.message, /暂无可参与的活动|未开启|无进行中活动/);
});

test('doCrowdtest 自动模式：来源错误按平台限制跳过，且明确不是 Cookie 失效', async () => {
  const fetcher = async () => ({ error_code: 12, error_msg: '来源错误' });
  const r = await doCrowdtest('cookie', { call: fetcher });
  assert.equal(r.success, true);
  assert.equal(r.softSkip, true);
  assert.equal(r.skipReason, 'app_source_required');
  assert.match(r.message, /仅允许.*App|平台拒绝/);
  assert.match(r.message, /非 Cookie 失效/);
});

test('doCrowdtest 自动模式：非来源限制的接口错误仍计为失败', async () => {
  const fetcher = async () => ({ error_code: 500, error_msg: '系统繁忙' });
  await assert.rejects(() => doCrowdtest('cookie', { call: fetcher }), /系统繁忙/);
});

test('doCrowdtest 显式 crowd_id：走 ajax_participate 申请路径', async () => {
  const fetcher = async (url) => {
    if (url.includes('ajax_participate')) return { error_code: 0, error_msg: '申请成功' };
    return {};
  };
  const r = await doCrowdtest('cookie', { crowdId: 'C123', call: fetcher });
  assert.equal(r.success, true);
  assert.match(r.message, /申请成功/);
});

test('getTestingActivityId：注入 fetcher 抽取 activity_id（避免联网）', async () => {
  const fetcher = async () => ({ data: { activity_id: 'ACT_X' } });
  assert.equal(await getTestingActivityId('cookie', fetcher), 'ACT_X');
  const empty = async () => ({ data: {} });
  assert.equal(await getTestingActivityId('cookie', empty), null);
});

// ---- follow / share（内置真实端点，注入 reqFn 避免联网） ----

test('doFollow 关注用户：target 命中即成功', async () => {
  const req = async (path, opts) => {
    assert.match(path, /\/dingyue\/create$/);
    assert.equal(opts.data.type, 'user');
    assert.equal(opts.data.keyword, 'alice');
    assert.equal(opts.data.is_from_task, '0');
    return { error_code: 0, error_msg: '关注成功' };
  };
  const r = await doFollow('cookie', { target: 'alice', type: 'user' }, req);
  assert.equal(r.success, true);
  assert.match(r.message, /关注成功/);
});

test('getRecommendedFollowUsers 读取并规范化未关注与已关注达人', async () => {
  const users = await getRecommendedFollowUsers('cookie', async (path, opts) => {
    assert.equal(path, '/dy/user/dingyue/tuijian_search');
    assert.equal(opts.base, 'https://dingyue-api.smzdm.com');
    assert.deepEqual(opts.data, { type: 'user' });
    return { error_code: 0, data: { rows: [
      { type: 'user', keyword_id: '1001', keyword: '达人甲', is_follow: '0' },
      { type: 'user', smzdm_id: '1002', nickname: '达人乙', is_follow: '1' },
      { type: 'tag', keyword_id: '88', keyword: '栏目' }
    ] } };
  });
  assert.deepEqual(users, [
    { id: '1001', name: '达人甲', isFollow: false },
    { id: '1002', name: '达人乙', isFollow: true }
  ]);
});

test('doFollow 关注品牌：走 user_action 端点且 action=dingyue_lanmu_add', async () => {
  const req = async (path, opts) => {
    assert.match(path, /user_action$/);
    const p = JSON.parse(opts.data.params);
    assert.equal(p.type, 'brand');
    assert.equal(opts.data.action, 'dingyue_lanmu_add');
    return { error_code: 0, error_msg: '关注品牌成功' };
  };
  const r = await doFollow('cookie', { target: 'BRAND1', type: 'brand' }, req);
  assert.equal(r.success, true);
});

test('doFollow 缺 target 抛错', async () => {
  await assert.rejects(() => doFollow('cookie', {}, async () => ({})), /关注需要 target/);
});

test('doShare：三步流程均成功则拼接奖励文案', async () => {
  const req = async (path) => {
    if (path.includes('complete_share_rule')) return { error_code: 0, error_msg: '分享完成' };
    if (path.includes('daily_reward')) return { error_code: 0, data: { reward_msg: '每日+1' } };
    if (path.includes('callback')) return { error_code: 0, error_msg: '回调成功' };
    return { error_code: 1 };
  };
  const r = await doShare('cookie', { articleId: '12345' }, req);
  assert.equal(r.success, true);
  assert.equal(r.count, 3);
  assert.match(r.message, /分享完成/);
});

test('doShare 缺 articleId 抛错', async () => {
  await assert.rejects(() => doShare('cookie', {}, async () => ({})), /分享需要 articleId/);
});

test('parseDailyTaskList 汇总所有活动分组及待领阶段奖励', () => {
  const parsed = parseDailyTaskList({ data: { data: { rows: [
    { cell_data: {
      activity_id: 'a1', activity_name: '累计奖励', activity_reward_status: 1,
      activity_task: { default_list_v2: [
        { task_list: [{ task_id: 't1' }] },
        { task_list: [{ task_id: 't2' }] }
      ] }
    } }
  ] } } });
  assert.deepEqual(parsed.tasks.map((t) => t.task_id), ['t1', 't2']);
  assert.deepEqual(parsed.activities, [{ id: 'a1', name: '累计奖励' }]);
});

test('doDailyTasks 每日读取、完成浏览任务、刷新后领取任务及阶段奖励', async () => {
  let listCalls = 0;
  let tokenCalls = 0;
  const calls = [];
  const task = (status) => ({
    task_id: 't_view', task_name: '浏览好文', task_status: status,
    task_event_type: 'interactive.view.article', task_even_num: 1,
    article_id: '12345', channel_id: '76'
  });
  const listResponse = (tasks, phase = false) => ({ data: { data: { rows: [{ cell_data: {
    activity_id: phase ? 'phase1' : '',
    activity_name: '累计阶段奖',
    activity_reward_status: phase ? 1 : 0,
    activity_task: { default_list_v2: [{ task_list: tasks }] }
  } }] } } });
  const request = async (path, opts) => {
    calls.push({ path, data: opts?.data });
    if (path === '/task/list_v2') {
      listCalls++;
      return listCalls === 1
        ? listResponse([task(2), { task_id: 't_ready', task_name: '现成奖励', task_status: 3 }])
        : listResponse([task(3), { task_id: 't_ready', task_status: 4 }], true);
    }
    if (path === '/task/event_view_article_sync') return { error_code: 0 };
    if (path === '/task/activity_task_receive') return { error_code: 0, data: { reward_msg: `奖励-${opts.data.task_id}` } };
    if (path === '/task/activity_receive') return { error_code: 0, data: { reward_msg: '阶段奖励到账' } };
    throw new Error('unexpected path: ' + path);
  };
  const result = await doDailyTasks('cookie', {
    request,
    getToken: async () => { tokenCalls++; return 'robot-token'; }
  });
  assert.equal(result.success, true);
  assert.equal(result.discovered, 2);
  assert.equal(result.completed.length, 1);
  assert.equal(result.rewards.length, 3);
  assert.equal(tokenCalls, 1);
  assert.equal(listCalls, 2);
  assert.ok(calls.some((x) => x.path === '/task/event_view_article_sync' && x.data.article_id === '12345'));
  assert.match(result.message, /读取 2 项，完成 1 项，领取 3 项/);
  assert.match(result.message, /完成明细：浏览好文（浏览 1 篇）/);
  assert.match(result.message, /领取明细：奖励-t_ready；奖励-t_view；阶段奖励到账/);
});

test('doDailyTasks 在汇总中列出每个跳过项和失败项的名称及原因', async () => {
  let listCalls = 0;
  const viewTask = (id, name) => ({
    task_id: id,
    task_name: name,
    task_status: 2,
    task_event_type: 'interactive.view.article',
    task_even_num: 1,
    article_id: id === 't_fail' ? '999' : '123',
    channel_id: '76'
  });
  const initialTasks = [
    viewTask('t_ok', '成功浏览'),
    {
      task_id: 't_publish', task_name: '发布爆料', task_status: 2,
      task_event_type: 'publish.baoliao_new'
    },
    {
      task_id: 't_follow', task_name: '关注达人', task_status: 2,
      task_event_type: 'interactive.follow.user', task_redirect_url: {}
    },
    viewTask('t_fail', '失败浏览')
  ];
  const listResponse = (tasks) => ({ data: { data: { rows: [{ cell_data: {
    activity_task: { default_list_v2: [{ task_list: tasks }] }
  } }] } } });
  const request = async (path, opts) => {
    if (path === '/task/list_v2') {
      listCalls++;
      return listCalls === 1
        ? listResponse(initialTasks)
        : listResponse(initialTasks.map((task) => (
          task.task_id === 't_ok' ? { ...task, task_status: 3 } : task
        )));
    }
    if (path === '/task/event_view_article_sync') {
      return opts.data.task_id === 't_fail'
        ? { error_code: 500, error_msg: '系统繁忙' }
        : { error_code: 0 };
    }
    if (path === '/task/activity_task_receive') {
      return { error_code: 0, data: { reward_msg: '成功领取 10经验' } };
    }
    throw new Error('unexpected path: ' + path);
  };

  const result = await doDailyTasks('cookie', {
    request,
    getToken: async () => 'robot-token'
  });

  assert.equal(result.success, false);
  assert.equal(result.completed.length, 1);
  assert.equal(result.rewards.length, 1);
  assert.equal(result.skipped.length, 2);
  assert.deepEqual(result.failed, ['失败浏览：系统繁忙']);
  assert.match(result.message, /读取 4 项，完成 1 项，领取 1 项，跳过 2 项，失败 1 项/);
  assert.match(result.message, /完成明细：成功浏览（浏览 1 篇）/);
  assert.match(result.message, /领取明细：成功领取 10经验/);
  assert.match(result.message, /跳过明细：发布爆料：暂不支持的活动类型：publish\.baoliao_new/);
  assert.match(result.message, /关注达人：任务未提供可关注对象/);
  assert.match(result.message, /失败明细：失败浏览：系统繁忙/);
});

test('doDailyTasks 推荐达人任务读取真实达人 ID，完成后取消关注恢复状态', async () => {
  let listCalls = 0;
  const calls = [];
  const task = (status) => ({
    task_id: 't_follow',
    task_name: '达人关注推荐',
    task_status: status,
    task_event_type: 'interactive.follow.user',
    task_even_num: 3,
    task_finished_num: 0,
    task_redirect_url: { link_type: 'guanzhu', link_val: '83', sub_type: 'search_user' }
  });
  const listResponse = (status) => ({ data: { data: { rows: [{ cell_data: {
    activity_task: { default_list_v2: [{ task_list: [task(status)] }] }
  } }] } } });
  const request = async (path, opts) => {
    calls.push({ path, data: opts?.data });
    if (path === '/task/list_v2') {
      listCalls++;
      return listResponse(listCalls === 1 ? 2 : 3);
    }
    if (path === '/dy/user/dingyue/tuijian_search') {
      return { error_code: 0, data: { rows: [
        { type: 'user', keyword_id: 'u1', is_follow: '0' },
        { type: 'user', keyword_id: 'u2', is_follow: '1' },
        { type: 'user', keyword_id: 'u3', is_follow: '0' },
        { type: 'user', keyword_id: 'u4', is_follow: '0' }
      ] } };
    }
    if (path === '/dingyue/create' || path === '/dingyue/destroy') return { error_code: 0 };
    if (path === '/task/activity_task_receive') {
      return { error_code: 0, data: { reward_msg: '成功领取 5经验' } };
    }
    throw new Error('unexpected path: ' + path);
  };

  const result = await doDailyTasks('cookie', {
    request,
    getToken: async () => 'robot-token',
    wait: async () => {}
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.failed, []);
  assert.match(result.message, /完成明细：达人关注推荐（关注并恢复 3 位推荐达人）/);
  assert.match(result.message, /领取明细：成功领取 5经验/);
  const creates = calls.filter((item) => item.path === '/dingyue/create');
  const destroys = calls.filter((item) => item.path === '/dingyue/destroy');
  assert.deepEqual(creates.map((item) => item.data.keyword), ['u1', 'u3', 'u4']);
  assert.deepEqual(destroys.map((item) => item.data.keyword), ['u1', 'u3', 'u4']);
});
