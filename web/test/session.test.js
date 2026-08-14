// M-17：补齐前端会话状态驱动的单元测试。
// H-01 修复后，登录浮层与后台入口显隐由 session.loggedIn / session.isAdmin 响应式驱动
// （而非读取 HttpOnly Cookie 或明文 token），本测试锁定该驱动逻辑不被回归破坏。
import { test, expect, beforeEach } from 'vitest';
import { session, applySession } from '../src/api/session.js';

beforeEach(() => {
  session.loggedIn = false;
  session.isAdmin = false;
  session.ready = false;
});

test('applySession 注入登录态：loggedIn/isAdmin/ready 全部置位', () => {
  applySession({ loggedIn: true, isAdmin: true });
  expect(session.loggedIn).toBe(true);
  expect(session.isAdmin).toBe(true);
  expect(session.ready).toBe(true);
});

test('applySession 空对象：标记 ready 但默认非登录', () => {
  applySession({});
  expect(session.ready).toBe(true);
  expect(session.loggedIn).toBe(false);
  expect(session.isAdmin).toBe(false);
});

test('applySession(undefined)：不修改既有状态（H-01 防 reload 误删令牌的防线）', () => {
  session.loggedIn = true;
  session.isAdmin = true;
  session.ready = true;
  applySession(undefined);
  expect(session.loggedIn).toBe(true);
  expect(session.isAdmin).toBe(true);
  expect(session.ready).toBe(true);
});
