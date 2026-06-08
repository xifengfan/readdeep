// ================================================
// api/chat.js
// P2 读透 · D2.1 陪读室 Serverless
// 用途：4 Agent 陪读对话端点
// 路由：POST /api/chat { bookId, agent, userMessage, history }
// 依赖：lib/deepseek.js, lib/prompts.js, lib/agents.js
// 模型：deepseek-v4-flash（默认）
// ================================================

import { callDeepSeek, DEFAULT_MODEL } from './lib/deepseek.js';
import { AGENT_PROMPTS, AGENT_ROUTER } from './lib/agents.js';

const MAX_HISTORY = 10;  // 最多保留 10 轮上下文

/**
 * 拼装 system prompt（4 Agent 人设 + 书籍上下文）
 */
function buildSystemPrompt(agent, bookContext) {
  const base = AGENT_PROMPTS[agent] || AGENT_PROMPTS.lead;  // 兜底为领读人
  const bookBlock = bookContext
    ? `\n\n【当前书】\n书名：${bookContext.title}\n作者：${bookContext.author}\n简介：${bookContext.summary || '（无）'}\n`
    : '';
  return base + bookBlock;
}

/**
 * 主入口：CF Pages Functions 接收 POST 请求
 */
export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.DEEPSEEK_API_KEY;
  const startMs = Date.now();

  // 1. 健康检查：key 是否配
  if (!apiKey) {
    return jsonResponse({
      ok: false,
      code: 'MISSING_API_KEY',
      error: 'DEEPSEEK_API_KEY 未在 Cloudflare Dashboard 配置',
      hint: '请主公去 Pages 项目 → Settings → Environment variables 配 Key',
    }, 503);
  }

  // 2. 解析请求
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ ok: false, code: 'BAD_JSON', error: '请求体不是合法 JSON' }, 400);
  }

  const {
    bookId,
    agent = 'lead',
    userMessage,
    history = [],
    bookContext = null,
  } = body;

  // 3. 参数校验
  if (!userMessage || typeof userMessage !== 'string') {
    return jsonResponse({ ok: false, code: 'EMPTY_MESSAGE', error: 'userMessage 不能为空' }, 400);
  }

  if (!AGENT_ROUTER[agent]) {
    return jsonResponse({
      ok: false,
      code: 'UNKNOWN_AGENT',
      error: `未知 agent: ${agent}，可选: ${Object.keys(AGENT_ROUTER).join(', ')}`,
    }, 400);
  }

  // 4. 拼装 messages（system + 历史 + 当前）
  const systemPrompt = buildSystemPrompt(agent, bookContext);
  const recentHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY) : [];
  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentHistory.map(h => ({
      role: h.role === 'user' ? 'user' : 'assistant',
      content: String(h.content || ''),
    })),
    { role: 'user', content: userMessage },
  ];

  // 5. 调 DeepSeek
  try {
    const result = await callDeepSeek({
      apiKey,
      messages,
      model: DEFAULT_MODEL,
      maxTokens: 1500,
      temperature: 0.75,
    });

    const elapsed = Date.now() - startMs;
    return jsonResponse({
      ok: true,
      agent,
      bookId: bookId || null,
      reply: result.content,
      model: result.model,
      usage: result.usage,
      elapsedMs: elapsed,
    });
  } catch (e) {
    return jsonResponse({
      ok: false,
      code: e.code || 'UNKNOWN_ERROR',
      error: e.message,
      detail: e.detail || null,
      stack: e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : null,
    }, e.status || 500);
  }
}

/**
 * GET /api/chat 健康检查 + 使用说明
 */
export async function onRequestGet() {
  return jsonResponse({
    ok: true,
    endpoint: '/api/chat',
    method: 'POST',
    body: {
      bookId: '书 ID（可选）',
      agent: 'lead | socrates | painter | quote (领读人|苏格拉底|画师|金句捕手)',
      userMessage: '用户消息（必填）',
      history: '[{role, content}] 历史对话（可选）',
      bookContext: '{title, author, summary} 书籍上下文（可选）',
    },
    model: DEFAULT_MODEL,
    status: 'ready',
    hint: 'GET 仅为健康检查，请用 POST 发起对话',
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
