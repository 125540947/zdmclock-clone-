// P3：前端 API 客户端契约测试（mock axios，无真实网络）
// 验证 client.js 各导出函数发出的 HTTP 方法 / 路径 / 负载，以及 login/setToken 的 token 管理。
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 共享的 axios 实例 spy：client.js 通过 axios.create() 拿到该实例
// vi.hoisted 使这些变量在 vi.mock 的 factory（被提升到文件顶部）之前初始化，避免 TDZ
const { post, get, put, del, instance } = vi.hoisted(() => {
  const post = vi.fn();
  const get = vi.fn();
  const put = vi.fn();
  const del = vi.fn();
  const instance = {
    defaults: { headers: { common: {} } },
    post,
    get,
    put,
    delete: del
  };
  return { post, get, put, del, instance };
});

// 在 import client.js 之前注册 axios mock（vi.mock 会被提升到文件顶部）
vi.mock('axios', () => ({
  __esModule: true,
  default: { create: () => instance },
  create: () => instance
}));

import {
  login,
  setToken,
  listBaoliao,
  createBaoliao,
  updateBaoliao,
  deleteBaoliao,
  submitBaoliao,
  refreshBaoliao
} from '../src/api/client.js';

describe('client.js 契约', () => {
  beforeEach(() => {
    post.mockReset();
    get.mockReset();
    put.mockReset();
    del.mockReset();
    localStorage.clear();
    delete instance.defaults.headers.common.Authorization;
  });

  it('login 调用 /auth/login 并在返回 token 时写入 localStorage 与 Authorization 头', async () => {
    post.mockResolvedValue({ data: { token: 'T123' } });
    const data = await login('user', 'pass');
    expect(post).toHaveBeenCalledWith('/auth/login', { username: 'user', password: 'pass' });
    expect(localStorage.getItem('zdm_token')).toBe('T123');
    expect(instance.defaults.headers.common.Authorization).toBe('Bearer T123');
    expect(data.token).toBe('T123');
  });

  it('login 无 token 时不设置 Authorization 头', async () => {
    post.mockResolvedValue({ data: {} });
    await login('u', 'p');
    expect(instance.defaults.headers.common.Authorization).toBeUndefined();
  });

  it('setToken 设置/清除 token 与 Authorization 头', () => {
    setToken('X');
    expect(localStorage.getItem('zdm_token')).toBe('X');
    expect(instance.defaults.headers.common.Authorization).toBe('Bearer X');
    setToken(null);
    expect(localStorage.getItem('zdm_token')).toBeNull();
    expect(instance.defaults.headers.common.Authorization).toBeUndefined();
  });

  it('listBaoliao 带 userId 拼接查询串，不带则不拼', async () => {
    get.mockResolvedValue({ data: [] });
    await listBaoliao('uid9');
    expect(get).toHaveBeenCalledWith('/baoliao?userId=uid9');
    await listBaoliao();
    expect(get).toHaveBeenCalledWith('/baoliao');
  });

  it('createBaoliao 走 POST /baoliao', async () => {
    post.mockResolvedValue({ data: { id: '1' } });
    const payload = { title: '好价', url: 'https://x' };
    await createBaoliao(payload);
    expect(post).toHaveBeenCalledWith('/baoliao', payload);
  });

  it('updateBaoliao 走 PUT /baoliao/:id', async () => {
    put.mockResolvedValue({ data: {} });
    await updateBaoliao('b1', { title: 'x' });
    expect(put).toHaveBeenCalledWith('/baoliao/b1', { title: 'x' });
  });

  it('deleteBaoliao 走 DELETE /baoliao/:id', async () => {
    del.mockResolvedValue({ data: {} });
    await deleteBaoliao('b1');
    expect(del).toHaveBeenCalledWith('/baoliao/b1');
  });

  it('submitBaoliao 走 POST /baoliao/:id/submit 并带 userId', async () => {
    post.mockResolvedValue({ data: {} });
    await submitBaoliao('b1', 'u2');
    expect(post).toHaveBeenCalledWith('/baoliao/b1/submit', { userId: 'u2' });
  });

  it('refreshBaoliao 走 POST /baoliao/refresh 并带 limit', async () => {
    post.mockResolvedValue({ data: {} });
    await refreshBaoliao(30);
    expect(post).toHaveBeenCalledWith('/baoliao/refresh', { limit: 30 });
  });
});
