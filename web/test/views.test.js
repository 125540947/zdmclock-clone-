// P3：关键视图测试（@vue/test-utils + jsdom，mock ../api/client.js 避免真实请求）
// 覆盖三个代表性页面：签到中心(交互触发请求)、连续签到(数据渲染)、好价爆料(表单+列表)。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

// vi.hoisted 返回单一对象 m，使 mock 变量在 vi.mock 的 factory（被提升到文件顶部）之前初始化，避免 TDZ。
// 工厂内只引用 m.*（不与 client.js 的导出名冲突），确保组件拿到的是同一个 vi.fn 实例。
const m = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  listBaoliao: vi.fn(),
  createBaoliao: vi.fn(),
  deleteBaoliao: vi.fn(),
  submitBaoliao: vi.fn(),
  refreshBaoliao: vi.fn()
}));

// ClockCenter/StreakView 用 `import api from`（default），Baoliao 用 named 导入，两者都要提供
vi.mock('../src/api/client.js', () => ({
  default: m.api,
  api: m.api,
  listBaoliao: m.listBaoliao,
  createBaoliao: m.createBaoliao,
  deleteBaoliao: m.deleteBaoliao,
  submitBaoliao: m.submitBaoliao,
  refreshBaoliao: m.refreshBaoliao
}));

import ClockCenter from '../src/views/ClockCenter.vue';
import StreakView from '../src/views/StreakView.vue';
import Baoliao from '../src/views/Baoliao.vue';

beforeEach(() => {
  // 默认所有请求安全 resolve，避免未预期的抛错中断渲染。
  // 注意数据层数：api.* 是 axios 实例方法，返回 `{ data: ... }`（axios 风格）；
  // 而 listBaoliao 等命名函数内部已 `return data`，故它们的 mock 直接返回业务对象（无外层 data）。
  m.api.get.mockResolvedValue({ data: { list: [], items: [] } });
  m.api.post.mockResolvedValue({ data: {} });
  m.api.put.mockResolvedValue({ data: {} });
  m.api.delete.mockResolvedValue({ data: {} });
  m.listBaoliao.mockResolvedValue({ items: [] });
  m.createBaoliao.mockResolvedValue({});
  m.deleteBaoliao.mockResolvedValue({});
  m.submitBaoliao.mockResolvedValue({ result: { message: '' } });
  m.refreshBaoliao.mockResolvedValue({ fetched: 0, added: 0 });
});

describe('ClockCenter 签到中心', () => {
  it('挂载后渲染账号列表，点击签到触发 /clock/do', async () => {
    m.api.get
      .mockResolvedValueOnce({ data: { list: [{ id: 'a1', nickname: 'Bob', streak: 2 }] } })
      .mockResolvedValueOnce({ data: { todayChecked: false, streak: 5 } });

    const wrapper = mount(ClockCenter);
    await flushPromises();

    expect(wrapper.text()).toContain('Bob');
    expect(wrapper.text()).toContain('未签到');

    const signBtn = wrapper.findAll('button').find((b) => b.text() === '签到');
    expect(signBtn).toBeTruthy();

    m.api.post.mockResolvedValueOnce({ data: { record: { points: 5 } } });
    await signBtn.trigger('click');
    await flushPromises();

    expect(m.api.post).toHaveBeenCalledWith('/clock/do', { userId: 'a1' });
  });

  it('今日已签时按钮显示 ✓ 且禁用', async () => {
    m.api.get
      .mockResolvedValueOnce({ data: { list: [{ id: 'a1', nickname: 'Bob', streak: 2 }] } })
      .mockResolvedValueOnce({ data: { todayChecked: true, streak: 5 } });

    const wrapper = mount(ClockCenter);
    await flushPromises();

    expect(wrapper.text()).toContain('今日已签');
    const signBtn = wrapper.findAll('button').find((b) => b.text() === '✓');
    expect(signBtn).toBeTruthy();
    expect(signBtn.attributes('disabled')).toBeDefined();
  });
});

describe('StreakView 连续签到', () => {
  it('渲染连击数与日历格子', async () => {
    m.api.get
      .mockResolvedValueOnce({ data: { list: [{ id: 's1', nickname: 'Sam' }] } })
      .mockResolvedValueOnce({
        data: {
          streak: 7,
          calendar: [
            { date: '2026-08-01', checked: true },
            { date: '2026-08-02', checked: false }
          ]
        }
      });

    const wrapper = mount(StreakView);
    await flushPromises();

    expect(wrapper.text()).toContain('7');
    expect(wrapper.text()).toContain('Sam');
    expect(wrapper.findAll('.day').length).toBe(2);
  });

  it('无账号时提示先录入', async () => {
    m.api.get.mockResolvedValue({ data: { list: [] } });
    const wrapper = mount(StreakView);
    await flushPromises();
    expect(wrapper.text()).toContain('暂无账号');
  });
});

describe('Baoliao 好价爆料', () => {
  it('渲染爆料列表并展示状态徽标', async () => {
    m.api.get.mockResolvedValue({ data: { list: [] } });
    // listBaoliao 返回的是业务 data 本身（无外层 data），故直接给 { items: [...] }
    m.listBaoliao.mockResolvedValue({
      items: [{ id: 'b1', title: '好价A', status: 'draft', url: 'https://a.com', smzdmUrl: 'https://b.com' }]
    });

    const wrapper = mount(Baoliao);
    await flushPromises();

    expect(wrapper.text()).toContain('好价A');
    expect(wrapper.text()).toContain('草稿');
  });

  it('填写标题并保存触发 createBaoliao', async () => {
    m.api.get.mockResolvedValue({ data: { list: [] } });
    m.listBaoliao.mockResolvedValue({ items: [] });

    const wrapper = mount(Baoliao);
    await flushPromises();

    await wrapper.find('input').setValue('新好价标题');
    await wrapper.find('button.block').trigger('click');
    await flushPromises();

    expect(m.createBaoliao).toHaveBeenCalledTimes(1);
    const arg = m.createBaoliao.mock.calls[0][0];
    expect(arg.title).toBe('新好价标题');
  });

  it('删除按钮触发 deleteBaoliao', async () => {
    m.api.get.mockResolvedValue({ data: { list: [] } });
    m.listBaoliao.mockResolvedValue({ items: [{ id: 'b1', title: '好价A', status: 'draft' }] });

    const wrapper = mount(Baoliao);
    await flushPromises();

    const delBtn = wrapper.findAll('button.mini').find((b) => b.text() === '删除');
    expect(delBtn).toBeTruthy();
    await delBtn.trigger('click');
    await flushPromises();

    expect(m.deleteBaoliao).toHaveBeenCalledWith('b1');
  });
});
