// 系统更新页测试（vitest + @vue/test-utils）：mock client.js，验证状态渲染、
// 检查更新、立即更新三条交互链路。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const m = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  getUpdateStatus: vi.fn(),
  checkUpdateRepo: vi.fn(),
  applyUpdateRepo: vi.fn()
}));

vi.mock('../src/api/client.js', () => ({
  default: m.api,
  api: m.api,
  getUpdateStatus: m.getUpdateStatus,
  checkUpdateRepo: m.checkUpdateRepo,
  applyUpdateRepo: m.applyUpdateRepo
}));

import Update from '../src/views/Update.vue';

beforeEach(() => {
  m.getUpdateStatus.mockResolvedValue({
    channel: 'native',
    branch: 'main',
    commitShort: 'abc123d',
    commitMsg: 'feat: base',
    dirty: false,
    supported: true,
    isRepo: true,
    hasRemote: true
  });
  m.checkUpdateRepo.mockResolvedValue({ ok: true, behind: 2, ahead: 0, remoteCommit: 'def789' });
  m.applyUpdateRepo.mockResolvedValue({ ok: true, willRestart: true, log: ['done'] });
});

describe('Update 系统更新页', () => {
  it('挂载后展示当前版本信息', async () => {
    const w = mount(Update);
    await flushPromises();
    expect(w.text()).toContain('系统更新');
    expect(w.text()).toContain('abc123d');
  });

  it('点击「检查更新」显示落后提交数', async () => {
    const w = mount(Update);
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text() === '检查更新');
    expect(btn).toBeTruthy();
    await btn.trigger('click');
    await flushPromises();
    expect(m.checkUpdateRepo).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('有 2 个新提交可更新');
  });

  it('点击「立即更新」触发 apply 并显示重启提示', async () => {
    const w = mount(Update);
    await flushPromises();
    const btn = w.findAll('button').find((b) => b.text() === '立即更新');
    expect(btn).toBeTruthy();
    await btn.trigger('click');
    await flushPromises();
    expect(m.applyUpdateRepo).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('更新完成，服务即将重启');
  });
});
