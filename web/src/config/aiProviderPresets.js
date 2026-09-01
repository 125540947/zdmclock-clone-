export const AI_PROVIDER_PRESETS = Object.freeze([
  {
    id: 'openai',
    label: 'OpenAI',
    apiBase: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: 'OpenAI 官方兼容接口'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    apiBase: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    hint: '默认使用速度较快的 DeepSeek V4 Flash'
  },
  {
    id: 'qwen',
    label: '通义千问（阿里云百炼）',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    hint: '使用阿里云百炼 OpenAI 兼容接口'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    apiBase: 'https://openrouter.ai/api/v1',
    model: 'openrouter/auto',
    hint: '可将模型改成 provider/model，统一调用多家模型'
  },
  {
    id: 'custom',
    label: '自定义兼容接口',
    apiBase: '',
    model: '',
    hint: '适用于硅基流动、本地模型及其他 OpenAI 兼容服务'
  }
]);

export function identifyAiProvider(apiBase) {
  const normalized = String(apiBase || '').trim().replace(/\/+$/, '').toLowerCase();
  const matched = AI_PROVIDER_PRESETS.find((item) => (
    item.id !== 'custom' && item.apiBase.replace(/\/+$/, '').toLowerCase() === normalized
  ));
  return matched?.id || 'custom';
}
