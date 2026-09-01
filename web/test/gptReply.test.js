import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const m = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }
}));

vi.mock('../src/api/client.js', () => ({
  default: m.api,
  api: m.api
}));

import GptReply from '../src/views/GptReply.vue';

function configResponse(overrides = {}) {
  return {
    data: {
      config: {
        enabled: false,
        target: 'comment',
        tone: 'friendly',
        prompt: '',
        apiBase: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        configured: false,
        hasApiKey: false,
        hasSavedApiKey: false,
        keySource: 'none',
        ...overrides
      }
    }
  };
}

beforeEach(() => {
  m.api.get.mockReset();
  m.api.post.mockReset();
  m.api.put.mockReset();
  m.api.delete.mockReset();
  localStorage.clear();
  m.api.get.mockImplementation((url) => {
    if (url === '/gpt/config') return Promise.resolve(configResponse());
    if (url === '/gpt/status') return Promise.resolve({ data: { configured: false, keySource: 'none' } });
    if (url === '/tasks') return Promise.resolve({ data: { list: [] } });
    if (url === '/gpt/drafts') return Promise.resolve({ data: { items: [] } });
    return Promise.resolve({ data: {} });
  });
  m.api.put.mockResolvedValue(configResponse());
});

describe('AI 模型与自动评论配置', () => {
  it('展示服务商、接口地址、模型和密钥配置入口', async () => {
    const wrapper = mount(GptReply);
    await flushPromises();

    expect(wrapper.text()).toContain('AI 模型配置');
    expect(wrapper.find('[data-test="provider-preset"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="api-base"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="model"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="api-key"]').attributes('type')).toBe('password');
    expect(wrapper.text()).toContain('尚未配置密钥');
  });

  it('选择第三方服务商会自动填写对应接口和模型', async () => {
    const wrapper = mount(GptReply);
    await flushPromises();

    await wrapper.find('[data-test="provider-preset"]').setValue('deepseek');
    expect(wrapper.find('[data-test="api-base"]').element.value).toBe('https://api.deepseek.com');
    expect(wrapper.find('[data-test="model"]').element.value).toBe('deepseek-v4-flash');

    await wrapper.find('[data-test="provider-preset"]').setValue('qwen');
    expect(wrapper.find('[data-test="api-base"]').element.value).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1'
    );
    expect(wrapper.find('[data-test="model"]').element.value).toBe('qwen-plus');
  });

  it('支持 OpenRouter 和手工填写的自定义兼容接口', async () => {
    const wrapper = mount(GptReply);
    await flushPromises();

    await wrapper.find('[data-test="provider-preset"]').setValue('openrouter');
    expect(wrapper.find('[data-test="api-base"]').element.value).toBe('https://openrouter.ai/api/v1');
    expect(wrapper.find('[data-test="model"]').element.value).toBe('openrouter/auto');

    await wrapper.find('[data-test="api-base"]').setValue('https://ai.example.com/v1');
    expect(wrapper.find('[data-test="provider-preset"]').element.value).toBe('custom');
  });

  it('保存页面填写的兼容接口、模型和密钥', async () => {
    m.api.put.mockResolvedValue(configResponse({
      apiBase: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      configured: true,
      hasApiKey: true,
      hasSavedApiKey: true,
      keySource: 'saved'
    }));
    const wrapper = mount(GptReply);
    await flushPromises();

    await wrapper.find('[data-test="api-base"]').setValue('https://api.deepseek.com/v1');
    await wrapper.find('[data-test="model"]').setValue('deepseek-chat');
    await wrapper.find('[data-test="api-key"]').setValue('sk-test-secret');
    await wrapper.find('[data-test="save-provider"]').trigger('click');
    await flushPromises();

    expect(m.api.put).toHaveBeenCalledWith('/gpt/config', {
      apiBase: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-test-secret'
    });
    expect(wrapper.text()).toContain('已配置（网页保存）');
    expect(wrapper.find('[data-test="api-key"]').element.value).toBe('');
  });

  it('已有密钥时留空保存不会发送密钥字段', async () => {
    m.api.get.mockImplementation((url) => {
      if (url === '/gpt/config') return Promise.resolve(configResponse({
        configured: true,
        hasApiKey: true,
        hasSavedApiKey: true,
        keySource: 'saved'
      }));
      if (url === '/gpt/status') return Promise.resolve({ data: { configured: true, keySource: 'saved' } });
      if (url === '/tasks') return Promise.resolve({ data: { list: [] } });
      if (url === '/gpt/drafts') return Promise.resolve({ data: { items: [] } });
      return Promise.resolve({ data: {} });
    });
    const wrapper = mount(GptReply);
    await flushPromises();
    await wrapper.find('[data-test="save-provider"]').trigger('click');
    await flushPromises();

    const payload = m.api.put.mock.calls[0][1];
    expect(payload.apiKey).toBeUndefined();
  });
});
