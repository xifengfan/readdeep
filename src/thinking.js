// ================================================
// src/thinking.js
// P2 读透 · 动态思考题生成（D12.13-A · 2026-06-16）
// 用途：LLM 根据"当前章节 + 用户历史对话"动态生成 3-5 个针对本章的思考题
// 端点：POST /api/thinking-questions
// 模型：deepseek-v4-flash
// 边界：不改 4 agent prompt / 不改 books.json / 不改章层 md
// ================================================

import { callDeepSeek, DEFAULT_MODEL, safeParseJson } from './lib/deepseek.js';

const MAX_HISTORY_ITEMS = 6;   // 取最近 6 条对话作为上下文（防爆 prompt）
const MAX_OUTPUT_TOKENS = 1200; // 3-5 题 + JSON 余量足够

/**
 * 拼 system prompt：动态思考题生成器
 * 硬要求：引用原文字句 / 不是"你怎么看"废话 / 立刻能动手
 * 数量：3-5 个（未聊 → 3 / 聊深 → 5）
 * 角度：背景/质疑/应用/对比/延伸/二阶反思
 */
function buildThinkingPrompt(bookTitle, chapterTitle, history) {
  const ctx = `《${bookTitle || '未指定'}》·${chapterTitle || '当前章节'}`;
  // 截断 + 转义：每条历史只取前 100 字，避免 prompt 爆
  const recentHistory = (Array.isArray(history) ? history : [])
    .slice(-MAX_HISTORY_ITEMS)
    .map(h => {
      const role = h.role === 'user' ? '主公' : '陪读';
      const c = String(h.content || '').slice(0, 100);
      return `${role}: ${c}`;
    })
    .join('\n');
  const historyBlock = recentHistory
    ? `\n**对话历史**（最近 ${MAX_HISTORY_ITEMS} 条）：\n${recentHistory}\n`
    : '\n**对话历史**：（暂无，主公刚进入本章）\n';
  // 数量决策：未聊过 → 3 / 聊得深（>=4 条）→ 5
  const historyLen = Array.isArray(history) ? history.length : 0;
  const countHint = historyLen >= 4 ? 5 : 3;
  return `你是"思考题生成器"，为主公生成 3-5 个针对当前章节的思考题。

**硬要求**：
- 必须引用原文中至少 1-2 个具体字句（用引号「」或""标出）
- 不能是"你怎么看"这种正确废话
- 必须能立刻让主公动手想、动手写
- 数量：${countHint} 个（最少 3，最多 5）
- 一题一角度：背景 / 质疑 / 应用 / 对比 / 延伸 / 二阶反思
- 语气直接，像主编给作者下题，不像老师给学生出题

**当前章节**：${ctx}
${historyBlock}

**输出格式**（严格 JSON 数组，无 markdown 代码块、无任何额外文字）：
[
  { "qIndex": 1, "qText": "..." },
  { "qIndex": 2, "qText": "..." },
  { "qIndex": 3, "qText": "..." }
]
`;
}

export async function thinkingHandler(request, env) {
  // GET 健康检查
  if (request.method === 'GET') {
    return json({
      ok: true,
      endpoint: '/api/thinking-questions',
      method: 'POST',
      model: DEFAULT_MODEL,
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

  const { bookId, chapter, bookTitle, chapterTitle, history = [] } = body || {};

  // 校验 bookId（最小必要参数）
  if (!bookId || typeof bookId !== 'string') {
    return json({ ok: false, code: 'MISSING_BOOK_ID', error: 'bookId 不能为空' }, 400);
  }

  // history 必须是数组
  if (!Array.isArray(history)) {
    return json({ ok: false, code: 'BAD_HISTORY', error: 'history 必须是数组' }, 400);
  }

  // chapter 非强制，但用于日志/章节标题 fallback
  const chapterIdx = Number.isInteger(chapter) ? chapter : 0;
  const effectiveChapterTitle = chapterTitle || `第 ${chapterIdx + 1} 章`;

  const prompt = buildThinkingPrompt(bookTitle, effectiveChapterTitle, history);

  try {
    const result = await callDeepSeek({
      apiKey,
      messages: [
        { role: 'system', content: '你是结构化输出助手，只输出严格 JSON 数组，无 markdown。' },
        { role: 'user', content: prompt },
      ],
      model: DEFAULT_MODEL,
      maxTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.85,  // 高一点：题目要多样、不雷同
      timeoutMs: 25000,
    });

    // 解析 JSON
    let parsed = null;
    let parseError = null;
    try {
      parsed = safeParseJson(result.content);
    } catch (e) {
      parseError = e.message;
    }

    // 容错：解析失败 / 不是数组 → 返回空数组 + 错误
    if (!Array.isArray(parsed)) {
      return json({
        ok: false,
        code: 'BAD_LLM_OUTPUT',
        error: parseError || 'LLM 输出不是合法数组',
        raw: result.content.slice(0, 500),
        usage: result.usage,
      }, 502);
    }

    // 过滤 + 修正：保留 qIndex + qText 字段，qIndex 缺失时按数组顺序补
    const questions = parsed
      .map((q, i) => ({
        qIndex: Number.isInteger(q?.qIndex) ? q.qIndex : (i + 1),
        qText: String(q?.qText || '').trim(),
      }))
      .filter(q => q.qText.length > 0);

    // 兜底：questions 为空时返回硬编码 3 题（让前端永远能渲染）
    if (questions.length === 0) {
      return json({
        ok: true,
        questions: FALLBACK_QUESTIONS,
        fallback: true,
        hint: 'LLM 输出无有效题目，已 fallback',
        usage: result.usage,
      });
    }

    // 截断到 5 个
    const finalQuestions = questions.slice(0, 5);

    return json({
      ok: true,
      questions: finalQuestions,
      count: finalQuestions.length,
      usage: result.usage,
    });
  } catch (e) {
    // 网络/超时/API 错误 → 返回 fallback 让前端能渲染
    return json({
      ok: true,
      questions: FALLBACK_QUESTIONS,
      fallback: true,
      error: e.message,
      code: e.code || 'UNKNOWN_ERROR',
      hint: 'LLM 调用失败，已 fallback 到默认思考题',
    }, 200);  // 用 200 让前端把 fallback 视为"成功但用兜底"
  }
}

// 兜底：3 个通用思考题（章节无关）
const FALLBACK_QUESTIONS = [
  { qIndex: 1, qText: '这一章的核心主张是什么？你能用 1 句话概括吗？' },
  { qIndex: 2, qText: '作者为什么这样论证？如果是你，会怎么写？' },
  { qIndex: 3, qText: '这章的观点，跟你过去读过的哪本书 / 哪个观点冲突或呼应？' },
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
