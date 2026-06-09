// ================================================
// src/workshop.js
// P2 读透 · 笔记工坊 Serverless
// 用途：4 模板生成（note/quote/optimize/share）
// 模型：deepseek-v4-flash
// 端点：POST /api/workshop
//   - action=note       笔记生成（书摘/章节）
//   - action=quote      金句提炼
//   - action=optimize   润色改写
//   - action=share      小红书 6 帧图文文案
// ================================================

import { callDeepSeek, DEFAULT_MODEL } from './lib/deepseek.js';
// 删 WORKSHOP_PROMPTS import（避免依赖）

const MAX_INPUT = 4000;  // 用户原文最长 4000 字

/**
 * 4 个 action 的 system prompt 模板
 */
const PROMPT_BUILDERS = {
  note: (ctx) => `你是「读透笔记工坊」的笔记助手。
请根据用户提供的原文，生成一份"读透读书笔记"。

【硬性字数约束】**严格 1500-2500 字 · 超出扣分 · 不够扣分**。
若超过 2500 字，输出将被截断 · 请主动收束。
字数控制技巧：
- 5 段结构化笔记，每段 220-320 字（紧凑不堆砌）
- 章节摘要 150 字
- 金句感悟每条 25 字
- 总字数 ≈ 1500-2300 字之间最稳，留 200 字 buffer

【内容结构】
- 一句话核心观点（30 字以内）
- 5 段结构化笔记（每段 220-320 字），段首可加小标题
- 1 个章节摘要（150 字）
- 3 个金句提炼（每条含：原文 20-30 字 + 出处 + 25 字感悟）
- 1 个行动建议（"今天就可以尝试"）
- 1 个延伸思考问题

【当前书】${ctx.bookContext?.title || '未指定'} · ${ctx.bookContext?.author || '佚名'}
【难度等级】${ctx.difficulty || '入门'}

风格：克制 + 实用 + 不堆砌名词 + 不说教。
`,

  quote: (ctx) => `你是「金句提炼师」。
请从用户原文中提炼 3-5 句金句，输出 JSON 数组：
[
  { "quote": "原文金句（10-30 字）", "source": "出处/页码", "reflection": "100 字以内感悟" },
  ...
]

【当前书】${ctx.bookContext?.title || '未指定'}
严格按 JSON 输出，不加 \`\`\`json\`\`\` 标记外的内容。
`,

  optimize: (ctx) => `你是「笔记润色师」。
请基于用户笔记进行润色：
- 保留作者原意
- 优化表达（更精准、更克制）
- 删除冗余
- 风格：像主公在公众号/小红书写笔记
- 字数控制在原文的 90%-110%

【当前书】${ctx.bookContext?.title || '未指定'}
`,

  share: (ctx) => `你是「小红书图文生成师」。
基于用户的笔记/原文，生成小红书 6 帧图文文案（caiji-xhs-writer v2.2 范式）：

输出 JSON 数组（6 帧）：
[
  { "frame": 1, "type": "封面", "title": "10-15 字大字", "subtitle": "10-20 字副标", "tip": "小图标" },
  { "frame": 2, "type": "痛点", "text": "60-80 字场景描述" },
  { "frame": 3, "type": "金句", "quote": "原文 20-30 字", "attribution": "—— 出处" },
  { "frame": 4, "type": "方法", "text": "3 步方法，每步 30-40 字" },
  { "frame": 5, "type": "行动", "text": "今天就能做的 1 件事" },
  { "frame": 6, "type": "金句收尾", "quote": "升华金句 15-25 字" }
]

【当前书】${ctx.bookContext?.title || '未指定'} · ${ctx.bookContext?.author || '佚名'}
【难度等级】${ctx.difficulty || '入门'}

要求：
- 严格 JSON 输出
- 标题用 <b> 强调
- emoji 1-2 个/帧
- 字数严格按每帧 type 控制
`,
};

const VALID_ACTIONS = ['note', 'quote', 'optimize', 'share'];

export async function workshopHandler(request, env) {
  // GET 健康检查
  if (request.method === 'GET') {
    return new Response(JSON.stringify({
      ok: true,
      endpoint: '/api/workshop',
      method: 'POST',
      actions: VALID_ACTIONS,
      model: DEFAULT_MODEL,
    }, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
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

  const { action, input, bookContext = null, difficulty = '入门' } = body;

  // 1. 校验 action
  if (!VALID_ACTIONS.includes(action)) {
    return json({
      ok: false,
      code: 'UNKNOWN_ACTION',
      error: `未知 action: ${action}，可选: ${VALID_ACTIONS.join(', ')}`,
    }, 400);
  }

  // 2. 校验 input
  if (!input || typeof input !== 'string') {
    return json({ ok: false, code: 'EMPTY_INPUT', error: 'input 不能为空' }, 400);
  }
  if (input.length > MAX_INPUT) {
    return json({
      ok: false,
      code: 'INPUT_TOO_LONG',
      error: `input 太长（${input.length} > ${MAX_INPUT}）`,
    }, 400);
  }

  // 3. 拼 system prompt
  const ctx = { bookContext, difficulty };
  const systemPrompt = PROMPT_BUILDERS[action](ctx);

  // 4. 调 DeepSeek
  const startMs = Date.now();
  try {
    const result = await callDeepSeek({
      apiKey,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ],
      model: DEFAULT_MODEL,
      maxTokens: action === 'share' ? 2000 : action === 'note' ? 2800 : action === 'quote' ? 1500 : 1200,
      temperature: 0.75,
    });

    // 5. quote 和 share 是 JSON 模式，尝试解析
    let parsed = null;
    let parseError = null;
    if (action === 'quote' || action === 'share') {
      try {
        // 简单 JSON 提取（deepseek.js 的 safeParseJson 是 ESM 导出）
        const fence = result.content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        const jsonText = fence ? fence[1] : result.content;
        parsed = JSON.parse(jsonText);
      } catch (e) {
        parseError = e.message;
      }
    }

    return json({
      ok: true,
      action,
      model: result.model,
      reply: result.content,
      parsed,  // JSON 模式时返回解析后的对象（前端可直接用）
      parseError,  // 解析失败时返回错误
      usage: result.usage,
      elapsedMs: Date.now() - startMs,
    });
  } catch (e) {
    return json({
      ok: false,
      code: e.code || 'UNKNOWN_ERROR',
      error: e.message,
    }, e.status || 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
