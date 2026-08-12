// P0：签到时间调度纯函数测试（解析/分配/三种模式解析）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHM, fmtHM, windowMinutes, assignAutoCheckInTime, resolvedCheckInTime } from '../src/clockSchedule.js';

test('parseHM 合法/非法', () => {
  assert.deepEqual(parseHM('09:30'), { h: 9, mi: 30 });
  assert.deepEqual(parseHM('00:00'), { h: 0, mi: 0 });
  assert.deepEqual(parseHM('23:59'), { h: 23, mi: 59 });
  assert.equal(parseHM('24:00'), null); // 时越界
  assert.equal(parseHM('09:60'), null); // 分越界
  assert.equal(parseHM('9:3'), null); // 单数字分
  assert.equal(parseHM('abc'), null);
  assert.equal(parseHM(undefined), null);
});

test('fmtHM 补零', () => {
  assert.equal(fmtHM(9, 5), '09:05');
  assert.equal(fmtHM(0, 0), '00:00');
  assert.equal(fmtHM(23, 59), '23:59');
});

test('windowMinutes 含端点跨度', () => {
  assert.deepEqual(windowMinutes('08:00', '10:59'), { startMin: 480, endMin: 659, span: 180 });
  assert.equal(windowMinutes('09:00', '09:00').span, 1); // 单点
  assert.equal(windowMinutes('10:00', '08:00').span, 1); // end 早于 start → 退化为单点
});

test('assignAutoCheckInTime 确定性且在窗口内', () => {
  const cfg = { autoWindowStart: '08:00', autoWindowEnd: '10:59' };
  const a = assignAutoCheckInTime('u_abc', cfg);
  const b = assignAutoCheckInTime('u_abc', cfg);
  assert.equal(a, b); // 同一 id 稳定
  const p = parseHM(a);
  assert.ok(p.h * 60 + p.mi >= 480 && p.h * 60 + p.mi <= 659);
});

test('resolvedCheckInTime 三种模式', () => {
  const cfg = { defaultCheckInTime: '09:00', autoWindowStart: '08:00', autoWindowEnd: '10:59' };
  // manual 合法 → 用其时间
  assert.equal(resolvedCheckInTime({ schedMode: 'manual', checkInTime: '13:45' }, cfg), '13:45');
  // manual 非法 → 回退默认
  assert.equal(resolvedCheckInTime({ schedMode: 'manual', checkInTime: 'bad' }, cfg), '09:00');
  // 未知/遗留模式 → 按 auto 处理（哈希分配，落在窗口内）
  const t2 = resolvedCheckInTime({ schedMode: 'whatever', id: 'abc' }, cfg);
  const p2 = parseHM(t2);
  assert.ok(p2.h * 60 + p2.mi >= 480 && p2.h * 60 + p2.mi <= 659);
  // auto 有固化时间 → 用之
  assert.equal(resolvedCheckInTime({ schedMode: 'auto', checkInTime: '08:10', id: 'x' }, cfg), '08:10');
  // auto 无固化时间 → 按 id 哈希分配（在窗口内）
  const t = resolvedCheckInTime({ schedMode: 'auto', id: 'zzz' }, cfg);
  const p = parseHM(t);
  assert.ok(p.h * 60 + p.mi >= 480 && p.h * 60 + p.mi <= 659);
});

test('resolvedCheckInTime 缺省 schedMode 视为 auto', () => {
  const cfg = { defaultCheckInTime: '09:00', autoWindowStart: '08:00', autoWindowEnd: '10:59' };
  const t = resolvedCheckInTime({ id: 'qq' }, cfg);
  const p = parseHM(t);
  assert.ok(p.h * 60 + p.mi >= 480 && p.h * 60 + p.mi <= 659);
});
