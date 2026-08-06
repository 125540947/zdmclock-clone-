// P3 增补：Users 视图「🔍 自检」流程 → 触发 verifyReal 并渲染可视化图表
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const m = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  updateUser: vi.fn(),
  getClockDistribution: vi.fn(),
  checkCookies: vi.fn(),
  verifyReal: vi.fn()
}));

vi.mock('../src/api/client.js', () => ({
  default: m.api,
  api: m.api,
  updateUser: m.updateUser,
  getClockDistribution: m.getClockDistribution,
  checkCookies: m.checkCookies,
  verifyReal: m.verifyReal
}));

import Users from '../src/views/Users.vue';

beforeEach(() => {
  m.api.get.mockResolvedValue({ data: { list: [] } });
  m.api.post.mockResolvedValue({ data: {} });
  m.api.put.mockResolvedValue({ data: {} });
  m.api.delete.mockResolvedValue({ data: {} });
  m.getClockDistribution.mockResolvedValue({});
  m.verifyReal.mockResolvedValue({ results: [], failedCount: 0 });
});

describe('Users 一键自检', () => {
  it('点击「🔍 自检」调用 verifyReal 并渲染环形图', async () => {
    const results = [
      { name: '签名算法 signFormData', kind: 'offline', status: 'PASS', detail: 'sign=ABC', ms: 0 },
      { name: '账号身份 /user/', kind: 'cookie', status: 'PASS', detail: '昵称=x', ms: 300 }
    ];
    m.api.get.mockResolvedValueOnce({ data: { list: [{ id: 'a1', nickname: 'Bob', cookie: 'ck' }] } });
    m.getClockDistribution.mockResolvedValue({});
    m.verifyReal.mockResolvedValue({ results, failedCount: 0 });

    const w = mount(Users);
    await flushPromises();

    const verifyBtn = w.findAll('button').find((b) => b.text() === '🔍 自检');
    expect(verifyBtn).toBeTruthy();

    await verifyBtn.trigger('click');
    await flushPromises();

    expect(m.verifyReal).toHaveBeenCalledWith('a1');
    expect(w.findAll('.ep').length).toBe(2);
    expect(w.text()).toContain('100%'); // 2/2 PASS
  });
});
