// GPT 适配器 —— OpenAI 兼容的 /chat/completions 实现（零额外依赖，使用内置 fetch）
//
// 用途：为「GPT 自动回复」提供真实的大模型调用能力。
// 兼容任意 OpenAI 协议接口（OpenAI / DeepSeek / 通义 / 本地 Ollama 等），
// 只需在 .env 设置 GPT_API_BASE 与 GPT_API_KEY 指向对应服务。
//
// 注意：调用的是第三方大模型服务，费用由对应服务商按账单结算；
// 请仅在自有账号、充分知悉费用与风险的前提下启用。

import { config } from './config.js';

const TONE_PROMPT = {
  friendly: '用亲切友善、像朋友聊天的口吻',
  pro: '用专业客观、条理清晰的口吻',
  humor: '用幽默轻松、带点俏皮的口吻'
};

function buildSystemPrompt({ tone, prompt } = {}) {
  const toneText = TONE_PROMPT[tone] || TONE_PROMPT.friendly;
  const custom = prompt && String(prompt).trim() ? String(prompt).trim() : '';
  // 约束：简短、贴合好价社区、不编造不实信息、不诱导违规
  return (
    `你是「什么值得买」社区的一个热心用户，${toneText}回复别人的评论或私信。` +
    `要求：中文、不超过 60 字、自然口语化、不夸大、不违规、不泄露个人信息。` +
    (custom ? `\n额外要求：${custom}` : '')
  );
}

// 生成一条回复。text 为待回复的原文（评论/私信内容）。
export async function generateReply({ text, tone, prompt } = {}) {
  if (!config.gptEnabled) {
    throw new Error('服务端未配置 GPT_API_KEY，无法调用大模型');
  }
  const userText = (text && String(text).trim()) || '你好';
  const payload = {
    model: config.gptModel,
    temperature: 0.7,
    max_tokens: 200,
    messages: [
      { role: 'system', content: buildSystemPrompt({ tone, prompt }) },
      { role: 'user', content: `请针对下面这条内容生成回复：\n${userText}` }
    ]
  };
  const timeoutMs = Number(process.env.GPT_REQUEST_TIMEOUT || 20000);
  let resp;
  try {
    resp = await fetch(`${config.gptApiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.gptApiKey}`,
        Accept: 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new Error(`大模型请求超时（>${timeoutMs}ms），请检查网络或 GPT_API_BASE`);
    }
    throw new Error('大模型请求失败：' + (e?.message || '未知错误'));
  }
  if (!resp.ok) {
    let detail = '';
    try {
      const j = await resp.json();
      detail = j?.error?.message || JSON.stringify(j).slice(0, 120);
    } catch {
      /* 忽略解析失败 */
    }
    throw new Error(`大模型返回 HTTP ${resp.status}${detail ? '：' + detail : ''}`);
  }
  const json = await resp.json();
  const reply = json?.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error('大模型返回内容为空（请检查模型与参数）');
  return reply;
}
