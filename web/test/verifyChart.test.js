// P3 增补：自检结果可视化组件测试（纯组件，无需 mock API）
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import VerifyChart from '../src/components/VerifyChart.vue';

const sample = [
  { name: '签名算法 signFormData', kind: 'offline', status: 'PASS', detail: 'sign=ABC', ms: 0 },
  { name: '账号身份 /user/', kind: 'cookie', status: 'PASS', detail: '昵称=x', ms: 320 },
  { name: 'robot/token 鉴权', kind: 'auth', status: 'FAIL', detail: '未返回 token', ms: 150 },
  { name: '签到 /checkin（实签）', kind: 'MUTATING', status: 'SKIP', detail: '默认不执行', ms: 0 }
];

describe('VerifyChart 环形图', () => {
  it('为每个出现的状态渲染一段彩色弧', () => {
    const w = mount(VerifyChart, { props: { results: sample, failedCount: 1 } });
    const segs = w.findAll('svg circle').filter((c) => c.attributes('stroke'));
    expect(segs.length).toBe(3);
    const colors = segs.map((c) => c.attributes('stroke'));
    expect(colors).toContain('#7ce08f');
    expect(colors).toContain('#ff6b5e');
    expect(colors).toContain('#ffd06b');
  });

  it('圆心显示通过率与「n/total 通过」', () => {
    const w = mount(VerifyChart, { props: { results: sample, failedCount: 1 } });
    expect(w.text()).toContain('50%'); // 2/4 PASS
    expect(w.text()).toContain('2/4 通过');
  });
});

describe('VerifyChart 耗时条形图', () => {
  it('每个结果渲染一行，最大耗时条形为 100% 宽', () => {
    const w = mount(VerifyChart, { props: { results: sample, failedCount: 1 } });
    expect(w.findAll('.ep').length).toBe(4);
    const max = w
      .findAll('.ep-fill')
      .map((f) => f.attributes('style').replace(/\s/g, ''))
      .find((s) => s.includes('width:100%'));
    expect(max).toBeTruthy();
  });

  it('无结果时不渲染任何图表', () => {
    const w = mount(VerifyChart, { props: { results: [], failedCount: 0 } });
    expect(w.find('.donut').exists()).toBe(false);
    expect(w.findAll('.ep').length).toBe(0);
  });
});

describe('VerifyChart 异常提示', () => {
  it('failedCount>0 时给出告警文案', () => {
    const w = mount(VerifyChart, { props: { results: sample, failedCount: 1 } });
    expect(w.text()).toContain('1 项端点异常');
  });
});
