// ================================================
// src/compose.js
// P2 读透 · 基于对话的"创作模式"端点（D14.2 · 2026-06-17）
// 用途：基于 4 Agent × 主公完整对话，调对应 agent 的"创作模式"生成作品
//       - painter: 一段画师视角的场景/分镜描述（300-500 字）
//       - quote: 3-5 句金句 + 解读（每句 50-100 字）
// 端点：POST /api/compose
// 模型：deepseek-v4-flash
// 边界：
//   - 不动 AGENT_PROMPTS（主对话模式 prompt）
//   - 不动 chatHistory 数据结构
//   - 平行于 /api/chat：只走 COMPOSE_PROMPTS（创作模式 prompt）
// ================================================

import { callDeepSeek, DEFAULT_MODEL } from './lib/deepseek.js';
import { COMPOSE_PROMPTS, AGENT_ROUTER } from './lib/agents.js';

const MAX_HISTORY_ITEMS = 40;    // 取最近 40 条对话（4 Agent × 主公）
const MAX_OUTPUT_TOKENS = 1500;  // 500-800 字场景 / 5 句金句 ≈ 500-700 字

const SUPPORTED_AGENTS = new Set(['painter', 'quote']);

/**
 * 拼创作模式 system prompt
 * 输入：
 *   - agent: 'painter' | 'quote'
 *   - bookTitle: 书名
 *   - chapter: 章节索引（0-based）
 *   - chatHistory: [{ agent, role, content }, ...]
 * 输出：拼好的 system prompt（含 COMPOSE_PROMPT + 章节/对话上下文）
 */
function buildComposePrompt(agent, bookTitle, chapter, chatHistory) {
  const composeBase = COMPOSE_PROMPTS[agent];
  if (!composeBase) return null;

  const title = bookTitle || '当前书';
  const chapterLabel = `第 ${(Number(chapter) || 0) + 1} 章`;

  // 把对话历史拍平成可读文本
  const agentNameMap = {
    lead: '领读人',
    socrates: '苏格拉底',
    painter: '画师',
    quote: '金句捕手',
  };
  const lines = (Array.isArray(chatHistory) ? chatHistory : [])
    .slice(-MAX_HISTORY_ITEMS)
    .filter(h => h && h.content && String(h.content).trim())
    .map(h => {
      const who = h.role === 'user'
        ? '主公'
        : (agentNameMap[h.agent] || h.agent || '陪读');
      const c = String(h.content).slice(0, 300);
      return `${who}: ${c}`;
    });

  if (lines.length === 0) {
    return null;  // 空对话 → 不让 LLM 凭空写
  }

  return `${composeBase}

【当前章节】《${title}》·${chapterLabel}

【对话历史】（按时间顺序 · 共 ${lines.length} 条）：
${lines.join('\n')}

请基于以上真实对话，输出你的创作。
`;
}

export async function composeHandler(request, env) {
  // GET 健康检查
  if (request.method === 'GET') {
    return json({
      ok: true,
      endpoint: '/api/compose',
      method: 'POST',
      model: DEFAULT_MODEL,
      supportedAgents: Array.from(SUPPORTED_AGENTS),
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return json({
      ok: false,
      code: 'MISSING_API_KEY',
      error: 'DEEPSEEK_API_KEY 未在 Cloudflare Dashboard 配置',
    }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, code: 'BAD_JSON', error: '请求体不是合法 JSON' }, 400);
  }

  const { bookId, chapter, bookTitle, agent, chatHistory = [] } = body || {};

  // 校验 bookId
  if (!bookId || typeof bookId !== 'string') {
    return json({ ok: false, code: 'MISSING_BOOK_ID', error: 'bookId 不能为空' }, 400);
  }

  // 校验 agent（仅 painter / quote 支持）
  const agentKey = AGENT_ROUTER[agent] || agent;
  if (!SUPPORTED_AGENTS.has(agentKey)) {
    return json({
      ok: false,
      code: 'UNSUPPORTED_AGENT',
      error: `创作模式仅支持 agent: ${Array.from(SUPPORTED_AGENTS).join(', ')}`,
      got: agent,
    }, 400);
  }

  // 校验 chatHistory
  if (!Array.isArray(chatHistory)) {
    return json({ ok: false, code: 'BAD_HISTORY', error: 'chatHistory 必须是数组' }, 400);
  }

  // 至少要聊过（>= 2 条）才让创作；少于 2 条时直接拒（前端可据此提示"先聊几句"）
  const validCount = chatHistory.filter(h => h && h.content && String(h.content).trim()).length;
  if (validCount < 2) {
    return json({
      ok: false,
      code: 'INSUFFICIENT_HISTORY',
      error: '对话太少（< 2 条），请先跟 4 角色各聊几句',
    }, 400);
  }

  const chapterIdx = Number.isInteger(chapter) ? chapter : 0;
  const prompt = buildComposePrompt(agentKey, bookTitle, chapterIdx, chatHistory);
  if (!prompt) {
    return json({ ok: false, code: 'EMPTY_HISTORY', error: 'chatHistory 为空' }, 400);
  }

  try {
    const result = await callDeepSeek({
      apiKey,
      messages: [
        { role: 'system', content: prompt },
      ],
      model: DEFAULT_MODEL,
      maxTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.75,
      timeoutMs: 30000,
    });

    const composition = String(result.content || '').trim();
    if (!composition) {
      return json({
        ok: false,
        code: 'EMPTY_LLM_OUTPUT',
        error: 'LLM 返回空内容',
        usage: result.usage,
      }, 502);
    }

    return json({
      ok: true,
      agent: agentKey,
      composition,
      generatedAt: Date.now(),
      bookId,
      chapter: chapterIdx,
      usage: result.usage,
      model: result.model,
    });
  } catch (e) {
    return json({
      ok: false,
      code: e.code || 'UNKNOWN_ERROR',
      error: e.message || 'LLM 调用失败',
    }, e.status || 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
