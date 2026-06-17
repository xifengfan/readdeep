// ================================================
// src/chat.js
// P2 读透 · Worker 入口的 /api/chat 处理
// 用途：4 Agent 陪读对话
// 模型：deepseek-v4-flash
// ================================================

import { callDeepSeek, DEFAULT_MODEL } from './lib/deepseek.js';
import { AGENT_PROMPTS, AGENT_ROUTER, AGENT_LIST } from './lib/agents.js';
import { getChapterTitle } from './lib/chapters.js';

const MAX_HISTORY = 10;

function buildSystemPrompt(agent, bookContext, bookId, chapter) {
  const base = AGENT_PROMPTS[agent] || AGENT_PROMPTS.lead;
  // 章节上下文注入（2026-06-10 吕玲绮）：让 4 Agent 知道"我在第几章"
  // 优先用显式 bookId+chapter；否则尝试从 bookContext 兜底
  const effectiveBookId = bookId || bookContext?.bookId || '';
  const effectiveChapter = Number.isInteger(chapter)
    ? chapter
    : (Number.isInteger(bookContext?.chapter) ? bookContext.chapter : 0);
  const chapterBlock = (effectiveBookId !== '' || Number.isInteger(chapter) || Number.isInteger(bookContext?.chapter))
    ? `\n【当前章节】${getChapterTitle(effectiveBookId, effectiveChapter)}\n`
    : '';
  const bookBlock = bookContext
    ? `\n\n【当前书】\n书名：${bookContext.title}\n作者：${bookContext.author}\n简介：${bookContext.summary || '（无）'}\n`
    : '';
  // P1-B 修复（2026-06-09 吕玲绮）：主公本章思考题答案 → 让 4 Agent 能基于主公答案追问
  const thinkingBlock = buildThinkingBlock(bookContext);
  return base + chapterBlock + bookBlock + thinkingBlock;
}

function buildThinkingBlock(bookContext) {
  const ta = bookContext && bookContext.thinkingAnswers;
  if (!Array.isArray(ta) || ta.length === 0) return '';
  const lines = ta
    .filter(a => a && a.answer && a.answer.trim())
    .map(a => `Q${a.qIndex}: ${a.qText || '（本题）'}\nA${a.qIndex}: ${a.answer.trim()}`);
  if (lines.length === 0) return '';
  return `\n\n【主公本章思考题答案】\n${lines.join('\n')}\n`;
}

export async function chatHandler(request, env) {
  // GET 健康检查
  if (request.method === 'GET') {
    return new Response(JSON.stringify({
      ok: true,
      endpoint: '/api/chat',
      method: 'POST',
      model: DEFAULT_MODEL,
      agents: AGENT_LIST,
    }, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  // POST 对话
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return json({
      ok: false,
      code: 'MISSING_API_KEY',
      error: 'DEEPSEEK_API_KEY 未在 Cloudflare Dashboard 配置',
      hint: 'Workers 项目 → Settings → Variables and secrets 配 Key',
    }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, code: 'BAD_JSON', error: '请求体不是合法 JSON' }, 400);
  }

  const { bookId, agent = 'lead', userMessage, history = [], bookContext = null, chapter = null } = body;

  if (!userMessage || typeof userMessage !== 'string') {
    return json({ ok: false, code: 'EMPTY_MESSAGE', error: 'userMessage 不能为空' }, 400);
  }

  const agentKey = AGENT_ROUTER[agent] || 'lead';
  if (!AGENT_PROMPTS[agentKey]) {
    return json({
      ok: false,
      code: 'UNKNOWN_AGENT',
      error: `未知 agent: ${agent}，可选: ${Object.keys(AGENT_ROUTER).join(', ')}`,
    }, 400);
  }

  const systemPrompt = buildSystemPrompt(agentKey, bookContext, bookId, chapter);
  const recentHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY) : [];
  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentHistory.map(h => ({
      role: h.role === 'user' ? 'user' : 'assistant',
      content: String(h.content || ''),
    })),
    { role: 'user', content: userMessage },
  ];

  const startMs = Date.now();
  try {
    const result = await callDeepSeek({
      apiKey,
      messages,
      model: DEFAULT_MODEL,
      maxTokens: 1500,
      temperature: 0.75,
    });

    return json({
      ok: true,
      agent: agentKey,
      bookId: bookId || null,
      reply: result.content,
      model: result.model,
      usage: result.usage,
      elapsedMs: Date.now() - startMs,
    });
  } catch (e) {
    return json({
      ok: false,
      code: e.code || 'UNKNOWN_ERROR',
      error: e.message,
      detail: e.detail || null,
    }, e.status || 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
