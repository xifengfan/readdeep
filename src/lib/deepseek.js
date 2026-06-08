// ================================================
// api/lib/deepseek.js
// P2 读透 · Cloudflare Pages Functions
// 用途：DeepSeek API 客户端封装
// 默认模型：deepseek-v4-flash（主公 openclaw.json 2026-06-08 验证）
// 备选模型：deepseek-v4-pro（长文/复杂任务）
// 兼容：deepseek-chat / deepseek-reasoner（OpenAI 兼容）
// 特性：超时控制 + 错误归一化 + JSON 解析容错
// ================================================

const DEEPSEEK_BASE = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-v4-flash';  // P2 主公指定
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * 调用 DeepSeek Chat Completion
 * @param {object} opts
 * @param {string} opts.apiKey   - DeepSeek API Key（从环境变量 DEEPSEEK_API_KEY 读取）
 * @param {string} opts.prompt   - 用户 prompt（已拼好模板的完整文本）
 * @param {string} [opts.model]  - 模型名，默认 'deepseek-v4-flash'
 * @param {number} [opts.timeoutMs] - 超时毫秒，默认 30000
 * @param {number} [opts.maxTokens] - 最大 token 数
 * @param {number} [opts.temperature] - 温度
 * @param {boolean} [opts.stream] - 是否流式
 * @returns {Promise<{content: string, usage: object, model: string, raw: object}>}
 */
async function callDeepSeek(opts) {
  const {
    apiKey,
    prompt,
    model = DEFAULT_MODEL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxTokens = 2048,
    temperature = 0.7,
    stream = false,
    messages,  // 可选：多轮对话
  } = opts || {};

  if (!apiKey) {
    const err = new Error('DEEPSEEK_API_KEY 未配置');
    err.code = 'MISSING_API_KEY';
    throw err;
  }
  if (!prompt && !messages) {
    const err = new Error('prompt 或 messages 至少需一个');
    err.code = 'EMPTY_PROMPT';
    throw err;
  }

  // 构造 messages（优先用传入的，否则把 prompt 包成单轮）
  const finalMessages = messages || [{ role: 'user', content: prompt }];

  // 构造 AbortController 用于超时控制
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let resp;
  try {
    resp = await fetch(DEEPSEEK_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: finalMessages,
        max_tokens: maxTokens,
        temperature,
        stream,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      const err = new Error(`DeepSeek API 超时（${timeoutMs}ms）`);
      err.code = 'TIMEOUT';
      throw err;
    }
    const err = new Error(`DeepSeek API 网络错误：${e.message}`);
    err.code = 'NETWORK_ERROR';
    err.cause = e;
    throw err;
  }
  clearTimeout(timer);

  if (!resp.ok) {
    let detail = '';
    try {
      const body = await resp.text();
      detail = body.slice(0, 500);
    } catch (_) {}
    const err = new Error(`DeepSeek API 返回 ${resp.status}：${detail || resp.statusText}`);
    err.code = 'API_ERROR';
    err.status = resp.status;
    err.detail = detail;
    throw err;
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    const err = new Error('DeepSeek API 响应非 JSON');
    err.code = 'PARSE_ERROR';
    err.cause = e;
    throw err;
  }

  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    const err = new Error('DeepSeek API 响应结构异常：缺少 choices[0].message');
    err.code = 'BAD_RESPONSE';
    err.raw = data;
    throw err;
  }

  return {
    content: data.choices[0].message.content || '',
    usage: data.usage || {},
    model: data.model || model,
    raw: data,
  };
}

/**
 * 从模型输出中"尽可能稳"地提取 JSON
 * 策略：先剥 ```json ... ```，再剥首尾非 JSON 字符，最后 JSON.parse
 * @param {string} text
 * @returns {any}
 */
function safeParseJson(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('safeParseJson: 输入不是字符串');
  }

  // 1. 尝试匹配 ```json ... ``` 代码块
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) {
    try { return JSON.parse(fence[1]); } catch (_) { /* fall through */ }
  }

  // 2. 尝试匹配第一个 [ 或 { 到最后一个 ] 或 }
  const firstBracket = text.search(/[\[{]/);
  const lastBracket = Math.max(text.lastIndexOf(']'), text.lastIndexOf('}'));
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    const candidate = text.slice(firstBracket, lastBracket + 1);
    try { return JSON.parse(candidate); } catch (_) { /* fall through */ }
  }

  // 3. 原始字符串直接尝试
  try { return JSON.parse(text); } catch (_) { /* fall through */ }

  throw new Error('safeParseJson: 无法从模型输出中提取 JSON');
}

export {
  callDeepSeek,
  safeParseJson,
  DEEPSEEK_BASE,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
};
