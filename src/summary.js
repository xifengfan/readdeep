// ================================================
// src/summary.js
// P2 读透 · 4 Agent 对话小结生成（D14.1 · 2026-06-17）
// 用途：基于"4 Agent × 主公"完整对话生成 500-800 字小结
// 端点：POST /api/summary
// 模型：deepseek-v4-flash
// 边界：
//   - 不改 4 agent prompt（不动 lead/socrates/painter/quote.md）
//   - 不改 books.json / 不动章层 md
//   - 不替代 thinking.js（已被删除）
// 替代关系：本端点生成的小结存到 localStorage（readdeep.summary.{bookId}）
//           → workshop 4 模板生成时读它做 input（替代旧的 thinkingAnswers）
// ================================================

import { callDeepSeek, DEFAULT_MODEL } from './lib/deepseek.js';

const MAX_HISTORY_ITEMS = 40;   // 取最近 40 条对话（4 Agent × 主公，每角色最多 10 轮）
const MAX_OUTPUT_TOKENS = 2000; // 500-800 字小结 + 余量

/**
 * 拼 system prompt：4 Agent 对话总结助手
 * 输入：
 *   - bookTitle: 书名（用于上下文）
 *   - chapter: 章节索引（0-based）
 *   - chatHistory: [{ agent, role, content }, ...]
 * 输出：
 *   - 500-800 字 Markdown 文本
 *     1) 一段总览（用户的核心思考）
 *     2) 4 角色各 1 段要点（领读人/苏格拉底/画师/金句捕手）
 */
function buildSummaryPrompt(bookTitle, chapter, chatHistory) {
  const title = bookTitle || '当前书';
  const chapterLabel = `第 ${(Number(chapter) || 0) + 1} 章`;

  // 把 agent 字段映射到中文名 + 截断单条 200 字（防爆 prompt）
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
      const c = String(h.content).slice(0, 200);
      return `${who}: ${c}`;
    });

  if (lines.length === 0) {
    return null;  // 空对话 → 不让 LLM 凭空写
  }

  return `你是「读透（ReadDeep）」的 4 Agent 对话总结助手。基于主公与 4 位陪读（领读人 / 苏格拉底 / 画师 / 金句捕手）的真实对话，生成 500-800 字的章节小结。

**当前章节**：《${title}》·${chapterLabel}

**对话历史**（按时间顺序 · ${lines.length} 条）：
${lines.join('\n')}

**输出结构**（严格 5 段 · 500-800 字）：

【第 1 段 · 总览】（80-150 字）
- 主公本章核心思考是什么？用 1 句话先点出来。
- 主公从「不清楚」到「有点想法」的轨迹，1-2 句话带过。

【第 2 段 · 领读人 · 结构拆解】（80-150 字）
- 领读人拆了哪几个重点段落？
- 引了哪句原句？
- 主公接住了哪个引导问题？

【第 3 段 · 苏格拉底 · 追问链】（80-150 字）
- 苏格拉底追了哪几层「为什么」？
- 暴露了主公哪个盲点？
- 主公最后怎么回应的？

【第 4 段 · 画师 · 场景翻译】（80-150 字）
- 画师把哪段抽象概念翻译成了什么场景？
- 给了什么生活类比？
- 哪个分镜描写最让主公有画面感？

【第 5 段 · 金句捕手 · 落地金句】（80-150 字）
- 金句捕手最后挑了哪一句？
- 这句的"生活化落地"是什么？
- 主公拿到这句会贴哪里 / 怎么用？

**硬要求**：
- 总字数 500-800 字（含段落标题）
- 严格按上面 5 段结构写，段间用空行分隔
- 引用主公原话时用「主公说：「...」」格式
- 引用 4 角色原话时直接引（用「领读人：」「苏格拉底：」等）
- 不写"愿你"、不说教、不给鸡汤
- 不出现 markdown 符号（# 标题 / ** 加粗 / - 列表 / > 引用）
- 不写"我们今天学到了"这种结尾
- 不出现"小结""总结"这种 meta 字眼
`;
}

export async function summaryHandler(request, env) {
  // GET 健康检查
  if (request.method === 'GET') {
    return json({
      ok: true,
      endpoint: '/api/summary',
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

  const { bookId, chapter, bookTitle, chatHistory = [] } = body || {};

  // 校验 bookId（最小必要参数）
  if (!bookId || typeof bookId !== 'string') {
    return json({ ok: false, code: 'MISSING_BOOK_ID', error: 'bookId 不能为空' }, 400);
  }

  // 校验 chatHistory
  if (!Array.isArray(chatHistory)) {
    return json({ ok: false, code: 'BAD_HISTORY', error: 'chatHistory 必须是数组' }, 400);
  }

  // 至少要聊过（>= 2 条）才出小结；少于 2 条时直接拒（前端可据此提示"先聊几句"）
  const validCount = chatHistory.filter(h => h && h.content && String(h.content).trim()).length;
  if (validCount < 2) {
    return json({
      ok: false,
      code: 'INSUFFICIENT_HISTORY',
      error: '对话太少（< 2 条），请先跟 4 角色各聊几句',
    }, 400);
  }

  const chapterIdx = Number.isInteger(chapter) ? chapter : 0;
  const prompt = buildSummaryPrompt(bookTitle, chapterIdx, chatHistory);
  if (!prompt) {
    return json({ ok: false, code: 'EMPTY_HISTORY', error: 'chatHistory 为空' }, 400);
  }

  try {
    const result = await callDeepSeek({
      apiKey,
      messages: [
        { role: 'system', content: '你是结构化输出助手，只输出严格按 5 段格式的小结，无 markdown 标题符号。' },
        { role: 'user', content: prompt },
      ],
      model: DEFAULT_MODEL,
      maxTokens: MAX_OUTPUT_TOKENS,
      temperature: 0.7,  // 中等：让小结有"人话"感但又不飘
      timeoutMs: 30000,
    });

    const summary = String(result.content || '').trim();
    if (!summary) {
      return json({
        ok: false,
        code: 'EMPTY_LLM_OUTPUT',
        error: 'LLM 返回空内容',
        usage: result.usage,
      }, 502);
    }

    return json({
      ok: true,
      summary,
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
