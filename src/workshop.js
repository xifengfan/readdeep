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

import { callDeepSeek, streamDeepSeek, DEFAULT_MODEL, safeParseJson } from './lib/deepseek.js';
// 删 WORKSHOP_PROMPTS import（避免依赖）

const MAX_INPUT = 4000;  // 用户原文最长 4000 字

/**
 * 4 个 action 的 system prompt 模板
 * v2 · 2026-06-10 衔接缺口修复：ctx 含 thinkingAnswers，拼到 system prompt 头部
 *   - 让 4 个 action（note/quote/optimize/share）都能引用主公答过的思考题关键话
 *   - 借鉴 reader.js 的 REF 注入（主公原话 + 来源）模式
 */
const PROMPT_BUILDERS = {
  note: (ctx) => {
    const ta = buildThinkingAnswersBlock(ctx.thinkingAnswers);
    // D12.13-C · 2026-06-16：对话历史拼到 prompt 末尾；chatHistory 非空时调低对原文要求
    const chatBlock = buildChatHistoryBlock(ctx.chatHistory);
    const hasChat = Array.isArray(ctx.chatHistory) && ctx.chatHistory.length > 0;
    const sourceGuidance = hasChat
      ? `**生成要求（聊天驱动模式）**：
- 笔记主轴 = 主公在对话中的**观点、争辩、追问、改变**（不是原文复述）
- 思考题答案作为**辅轴**（贴在主轴之后补证据）
- 至少 3 条笔记来自「主公说过的话」，而不是「原文摘录」
- 原文字句作为**事实支撑**，不是主体；最多 3-5 处引用
- 主公原话引用格式：「主公说：「...」」`
      : `**生成要求（原文驱动模式）**：
- 笔记主轴 = 原文+思考题答案
- 靠主公原话带观点、靠思考题补反思`;
    return `主公调性：说人话 / 别端着 / 不卖课 / 真用过 / 敢拍胸脯 / 不绕弯子 / 看完就能用。
笔记版加强：克制、实用、不堆名词、不说教——像主公自己写的，不像教科书。

你是「读透笔记工坊」的笔记助手，把书籍内容转化成有价值的笔记。

**必做**：引用书中**原句**（如「学而时习之」），引用思考题答案里主公说过的关键话（用「主公说：「...」」格式），不自己编。**严格 1500-2500 字**，不足扣分、超过也扣分，AI 主动收束。结构：一句话核心观点（30 字内）+ 5 段笔记（每段 220-320 字）+ 章节摘要（150 字）+ 3 个金句（原文 20-30 字 + 出处 + 25 字感悟）+ 1 个行动建议（今天就能试）+ 1 个延伸思考。

**必避**：不堆术语、不写"愿你"、不给心灵鸡汤、不说教、不写四字成语。

**输出格式**：严禁任何 markdown 格式符号（**加粗** / # 标题 / > 引用 / - 列表 / 1. 编号）。段间空行带节奏，重点靠句子本身的重音词带出。

【当前书】${ctx.bookContext?.title || '未指定'} · ${ctx.bookContext?.author || '佚名'}
【难度等级】${ctx.difficulty || '入门'}
${ta}
${chatBlock}
${sourceGuidance}
`;
  },

  quote: (ctx) => {
    const ta = buildThinkingAnswersBlock(ctx.thinkingAnswers);
    return `你是「金句提炼师」。
请从用户原文中提炼 3-5 句金句，输出 JSON 数组：
[
  { "quote": "原文金句（10-30 字）", "source": "出处/页码", "reflection": "100 字以内感悟" },
  ...
]

【当前书】${ctx.bookContext?.title || '未指定'}
${ta}
严格按 JSON 输出，不加 \`\`\`json\`\`\` 标记外的内容。
`;
  },

  optimize: (ctx) => {
    const ta = buildThinkingAnswersBlock(ctx.thinkingAnswers);
    return `你是「笔记润色师」。
请基于用户笔记进行润色：
- 保留作者原意
- 优化表达（更精准、更克制）
- 删除冗余
- 风格：像主公在公众号/小红书写笔记
- 字数控制在原文的 90%-110%

【当前书】${ctx.bookContext?.title || '未指定'}
${ta}
`;
  },

  share: (ctx) => {
    const ta = buildThinkingAnswersBlock(ctx.thinkingAnswers);
    return `你是「小红书图文生成师」。
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
${ta}
要求：
- 严格 JSON 输出
- 标题用 <b> 强调
- emoji 1-2 个/帧
- 字数严格按每帧 type 控制
`;
  },
};

/**
 * D12.13-C · 2026-06-16：把主公陪读历史拼成 <chat_history> 块
 * 输入: chatHistory = [{ role, agent?, content, ts }] | undefined | null
 * - 取最近 12 条（太多会爆 prompt）
 * - role=user → "主公"；role=assistant → agentName（lead/socrates/painter/quote → 中文名） || "陪读"
 * - 单条 content 截断 200 字
 */
function buildChatHistoryBlock(chatHistory) {
  if (!Array.isArray(chatHistory) || chatHistory.length === 0) return '';
  const agentNameMap = {
    lead: '领读人',
    socrates: '苏格拉底',
    painter: '画师',
    quote: '金句捕手',
  };
  const lines = chatHistory
    .slice(-12)
    .filter(h => h && h.content && String(h.content).trim())
    .map(h => {
      const who = h.role === 'user' ? '主公' : (agentNameMap[h.agent] || h.agentName || '陪读');
      const c = String(h.content).slice(0, 200);
      return `${who}: ${c}`;
    });
  if (lines.length === 0) return '';
  return `\n【主公本章陪读对话和想法（至少 3 条笔记从这提炼，格式：「主公说：「...」」）】\n<chat_history>\n${lines.join('\n')}\n</chat_history>\n`;
}

/**
 * v2 · 2026-06-10 衔接缺口修复：把主公思考题答案拼成 <thinking_answers> 块
 * 输入: thinkingAnswers = [{ qIndex, qText, answer }] | undefined | null
 * 输出: 拼好的字符串（空时返回空串，让 prompt 中间不会出现空块）
 */
function buildThinkingAnswersBlock(thinkingAnswers) {
  if (!Array.isArray(thinkingAnswers) || thinkingAnswers.length === 0) return '';
  // 每条：qIndex / qText / answer 都可能缺，做容错 + 截断（防超长 prompt）
  const lines = thinkingAnswers
    .filter(a => a && (a.answer || a.qText))
    .map(a => {
      const idx = a.qIndex != null ? `思考题 ${a.qIndex}` : '思考题';
      const q = a.qText ? `${a.qText}` : '（题面未记录）';
      const ans = a.answer ? String(a.answer).trim() : '（未答）';
      // 单条答案截断 300 字（防爆 prompt）
      const ansSliced = ans.length > 300 ? ans.slice(0, 300) + '…' : ans;
      return `- ${idx}：${q}\n  主公答：${ansSliced}`;
    });
  if (lines.length === 0) return '';
  return `\n【主公本章思考题答案（必须引用 · 格式：「主公说：「...」」）】\n<thinking_answers>\n${lines.join('\n')}\n</thinking_answers>\n`;
}

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

  const { action, input, bookContext = null, difficulty = '入门', thinkingAnswers = null, chatHistory = null, stream = false, async: asyncMode = false } = body;

  // 1. 校验 action
  if (!VALID_ACTIONS.includes(action)) {
    return json({
      ok: false,
      code: 'UNKNOWN_ACTION',
      error: `未知 action: ${action}，可选: ${VALID_ACTIONS.join(', ')}`,
    }, 400);
  }

  // 2. 校验 input
  // D12.13-C · 2026-06-16：当 chatHistory 非空时放宽 input 校验（"从对话生成想法笔记"按钮场景）
  // - 有效 input：非空字符串
  // - 放宽条件：chatHistory 中至少 4 条有效对话
  const hasUsableChat = Array.isArray(chatHistory) && chatHistory.filter(h => h && h.content && String(h.content).trim()).length >= 4;
  if (!input || typeof input !== 'string') {
    if (hasUsableChat) {
      // input 为空但有聊天历史 → 允许通过，后续会用 chatHistory 合成 effectiveInput
      console.log('[workshop] input 为空但 chatHistory 有效（>=4 条），用对话生成笔记');
    } else {
      return json({ ok: false, code: 'EMPTY_INPUT', error: 'input 不能为空（chatHistory 也为空）' }, 400);
    }
  }
  if (input && input.length > MAX_INPUT) {
    return json({
      ok: false,
      code: 'INPUT_TOO_LONG',
      error: `input 太长（${input.length} > ${MAX_INPUT}）`,
    }, 400);
  }

  // D8-2 · 异步模式：入 Durable Object 队列，立即返回 taskId
  if (asyncMode) {
    if (!env.GENERATION_QUEUE) {
      return json({
        ok: false,
        code: 'NO_DO_BINDING',
        error: 'GENERATION_QUEUE DO 未配置',
      }, 503);
    }
    // 生成 taskId（用 crypto.randomUUID）
    const taskId = crypto.randomUUID();
    const id = env.GENERATION_QUEUE.idFromName(taskId);
    const stub = env.GENERATION_QUEUE.get(id);
    // 转给 DO 入队并启动后台执行
    const doReq = new Request('https://do/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, input, bookContext, difficulty, thinkingAnswers, chatHistory }),
    });
    // 同步等待 DO 启动（DO 内部用 waitUntil 异步执行）
    const doResp = await stub.fetch(doReq);
    const doData = await doResp.json();
    return json({
      ok: true,
      taskId,
      status: doData.status || 'pending',
      pollUrl: `/api/workshop/status?taskId=${taskId}`,
    });
  }

  // 3. 拼 system prompt
  // v2 · 2026-06-10 衔接缺口修复：thinkingAnswers 注入到 ctx，PROMPT_BUILDERS 负责拼到 system prompt 头部
  // D12.13-C · 2026-06-16：chatHistory 也注入到 ctx（note prompt 会拼对话历史段）
  const ctx = { bookContext, difficulty, thinkingAnswers, chatHistory };
  const systemPrompt = PROMPT_BUILDERS[action](ctx);

  // D12.13-C · 当 chatHistory 非空且 input 为空/过短 → 用 chatHistory 合成兜底 input
  // 这样前端"从对话生成想法笔记"按钮可以 input="" 直接打过来
  let effectiveInput = input;
  if (Array.isArray(chatHistory) && chatHistory.length > 0 && (!input || input.trim().length < 10)) {
    const agentNameMap = { lead: '领读人', socrates: '苏格拉底', painter: '画师', quote: '金句捕手' };
    const convoBlock = chatHistory
      .slice(-12)
      .filter(h => h && h.content && String(h.content).trim())
      .map(h => {
        const who = h.role === 'user' ? '主公' : (agentNameMap[h.agent] || h.agentName || '陪读');
        return `${who}: ${String(h.content).slice(0, 200)}`;
      })
      .join('\n');
    const titleLine = bookContext?.title ? `《${bookContext.title}》${bookContext.chapter || ''}陪读对话` : '本章陪读对话';
    effectiveInput = `请基于以下主公与陪读的对话，生成一篇主公风格的想法笔记（笔记主轴 = 主公在对话中的观点、争辩、追问、改变）。\n\n【对话记录】\n${convoBlock}\n\n【背景】${titleLine}`;
  }

  // 4. 调 DeepSeek（stream 与非 stream 分支）
  // v3 · 2026-06-11 非流式 note content=0 bug 修复
  //   - note maxTokens 从 2800 → 4000（real 推理耗 324-1380 tokens + 1500-2500 字内容）
  //   - note 非流式 timeoutMs 从 30000 → 60000（real 耗时 30-40s，30s timeout 在边缘）
  //   - 不动流式路径（streamDeepSeek 自带 90s timeout, stream 实测 27.93s ✅）
  const maxTokens = action === 'share' ? 6000 : action === 'note' ? 4000 : action === 'quote' ? 1500 : 1200;
  const noteSlow = action === 'note' && !stream;  // 仅非流式 note
  const commonOpts = {
    apiKey,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: effectiveInput },
    ],
    model: DEFAULT_MODEL,
    maxTokens,
    temperature: 0.75,
  };
  // 非流式 note 单独加 long timeout（stream 路径用 streamDeepSeek 自带 90s）
  if (noteSlow) commonOpts.timeoutMs = 60000;

  // P2-H · 流式分支（D6 下午）
  if (stream) {
    try {
      const sseStream = await streamDeepSeek(commonOpts);
      return new Response(sseStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    } catch (e) {
      // 流式初始化错误（API Key / 网络）→ 降级为 SSE 错误事件
      const errBody = `data: {"error":"${(e.message || '流式启动失败').replace(/"/g, '\\"')}"}\n\ndata: [DONE]\n\n`;
      return new Response(errBody, {
        status: e.status || 500,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });
    }
  }

  // 非流式路径（原有行为）
  const startMs = Date.now();
  try {
    const result = await callDeepSeek(commonOpts);

    // 5. quote 和 share 是 JSON 模式，尝试解析
    // v3 · 2026-06-10 parseError 修复：用 deepseek.js 的 safeParseJson（自带容错）
    // - 优先匹配 ```json ... ``` 围栏
    // - 失败则截取第一个 [ 或 { 到最后一个 ] 或 } 之间
    // - 最后裸字符串 parse
    // 修复前（line 197 maxTokens=2000）→ 6 帧 JSON 被截断 → JSON.parse 报 "Unexpected end of JSON input"
    // 修复 v2（maxTokens=4000）→ 短 input OK，长 input + reasoning 后仍被截断到 0
    // 修复 v3（maxTokens=6000）→ 6 帧 JSON + reasoning 余量充足
    let parsed = null;
    let parseError = null;
    if (action === 'quote' || action === 'share') {
      try {
        parsed = safeParseJson(result.content);
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
