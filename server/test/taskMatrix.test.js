import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCustomEndpointTask, getPath, renderBody, extractAsset, parseJsonp, CUSTOM_TYPES } from '../src/taskMatrix.js';

// 默认 SMZDM_ADAPTER=mock（无 requestRaw），自定义任务应返回 pendingCapture（绝不伪造成功）
function dbWithEndpoint(type, endpoint) {
  return {
    settings: { taskEndpoints: { [type]: endpoint } }
  };
}

test('未配置接口 → pendingCapture', async () => {
  const db = { settings: { taskEndpoints: {} } };
  const r = await runCustomEndpointTask({ type: 'lottery', name: '每日抽奖' }, db, { id: 'u1', cookie: 'c' });
  assert.equal(r.ok, false);
  assert.equal(r.pendingCapture, true);
});

test('mock 适配器下即便配置了接口也标 pendingCapture（不假跑）', async () => {
  const db = dbWithEndpoint('lottery', { endpoint: 'https://x/y', method: 'POST', body: {}, assetFields: {} });
  const r = await runCustomEndpointTask({ type: 'lottery', name: '每日抽奖' }, db, { id: 'u1', cookie: 'c' });
  assert.equal(r.pendingCapture, true);
});

test('getPath 读取嵌套路径', () => {
  assert.equal(getPath({ data: { gold: 5 } }, 'data.gold'), 5);
  assert.equal(getPath({ a: { b: { c: 9 } } }, 'a.b.c'), 9);
  assert.equal(getPath({ data: {} }, 'data.gold'), undefined);
  assert.equal(getPath(null, 'x'), undefined);
});

test('renderBody 支持对象与占位符替换', () => {
  assert.deepEqual(renderBody({ act: 'lottery', uid: '{{uid}}' }, { id: 'u99' }), { act: 'lottery', uid: 'u99' });
  assert.deepEqual(renderBody('{"k":1}', {}), { k: 1 });
  assert.equal(renderBody('a=1&b=2', {}), 'a=1&b=2');
  assert.equal(renderBody('', {}), undefined);
});

test('extractAsset 按映射提取增量', () => {
  const json = { data: { gold: 12, exp: 3, level: 'Lv.5' }, msg: 'ok' };
  const af = { gold: 'data.gold', exp: 'data.exp', level: 'data.level', message: 'msg' };
  const r = extractAsset(json, af);
  assert.equal(r.goldDelta, 12);
  assert.equal(r.expDelta, 3);
  assert.equal(r.levelAfter, 'Lv.5');
  assert.equal(r.message, 'ok');
});

test('CUSTOM_TYPES 含 6 个补全任务（含内置 dailyTasks）', () => {
  assert.deepEqual(
    [...CUSTOM_TYPES].sort(),
    ['crowdtest', 'dailyTasks', 'follow', 'lottery', 'share', 'turntable'].sort()
  );
});

test('内置真实策略：turntable 现已自动获取 active_id，缺参不再 need_param', async () => {
  const db = { settings: { taskEndpoints: {} } };
  const r = await runCustomEndpointTask({ type: 'turntable', name: '转盘抽奖' }, db, { id: 'u1', cookie: 'c' });
  // 不再报 need_param（运行时自动从专题页获取）；mock 下仅因无 requestRaw 而待配置
  assert.notEqual(r.error, 'need_param');
  assert.equal(r.pendingCapture, true);
});

test('内置真实策略：dailyTasks 在 mock 模式下仍标 pendingCapture（不假跑）', async () => {
  const db = { settings: { taskEndpoints: {} } };
  const r = await runCustomEndpointTask({ type: 'dailyTasks', name: '每日任务' }, db, { id: 'u1', cookie: 'c' });
  assert.equal(r.ok, false);
  assert.equal(r.pendingCapture, true);
});

test('内置真实策略：turntable 已填 params 后跳过 need_param（mock 下仅因无 requestRaw 而待配置）', async () => {
  const db = { settings: { taskEndpoints: { turntable: { params: { activeId: 'abc123' } } } } };
  const r = await runCustomEndpointTask({ type: 'turntable', name: '转盘抽奖' }, db, { id: 'u1', cookie: 'c' });
  // 不再报 need_param；mock 下因 requestRaw 不存在而 pendingCapture（真实模式会真正请求）
  assert.notEqual(r.error, 'need_param');
  assert.equal(r.pendingCapture, true);
});

test('parseJsonp 剥离函数外壳', () => {
  assert.deepEqual(parseJsonp('jQuery123({"error_code":0,"data":{}})'), { error_code: 0, data: {} });
  assert.deepEqual(parseJsonp('cb({"a":1})'), { a: 1 });
  assert.deepEqual(parseJsonp('{"plain":true}'), { plain: true });
  assert.throws(() => parseJsonp('not json at all'));
});
