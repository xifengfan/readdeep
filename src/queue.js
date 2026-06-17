// ================================================
// src/queue.js
// P2 读透 · Durable Object 异步任务队列（D8-2）
// 用途：让笔记生成在 Workers 后端跑完，前端切走不影响
// 模型：deepseek-v4-flash
// ================================================

import { callDeepSeek, streamDeepSeek, DEFAULT_MODEL, safeParseJson } from './lib/deepseek.js';

// 状态机
const STATUS = {
  PENDING: 'pending',     // 已入队，未开始
  RUNNING: 'running',     // 正在跑
  DONE: 'done',           // 完成
  FAILED: 'failed',       // 失败
};

const MAX_INPUT = 4000;

/**
 * Durable Object 类
 * 每个 taskId 对应一个 DO 实例（用 taskId 作为 DO name）
 */
export class WorkshopTaskDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.storage = state.storage;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // POST /run  - 入队并开始执行
    if (pathname === '/run' && request.method === 'POST') {
      const body = await request.json();
      // 启动后台执行（不 await，让 fetch 立即返回 taskId）
      this.state.waitUntil(this._execute(body));
      return new Response(JSON.stringify({
        ok: true,
        status: STATUS.PENDING,
        startedAt: Date.now(),
      }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    // GET /status - 查状态
    if (pathname === '/status' && request.method === 'GET') {
      const data = await this.storage.get('task');
      if (!data) {
        return new Response(JSON.stringify({ ok: false, error: 'task not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      return new Response(JSON.stringify({
        ok: true,
        status: data.status,
        result: data.result,
        error: data.error,
        elapsedMs: data.elapsedMs,
        startedAt: data.startedAt,
        finishedAt: data.finishedAt,
      }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  /**
   * 后台执行生成任务
   * 流程：拼 prompt → 调 DeepSeek → 存结果到 DO storage
   */
  async _execute(body) {
    const startedAt = Date.now();
    const { action, input, bookContext, difficulty = '入门', thinkingAnswers = null, chatHistory = null } = body;
    const apiKey = this.env.DEEPSEEK_API_KEY;

    // 1. 标记 running
    await this.storage.put('task', {
      status: STATUS.RUNNING,
      startedAt,
      action,
    });

    // 2. 拼 system prompt（复用 workshop.js 的 PROMPT_BUILDERS 逻辑，简化版）
    const systemPrompt = this._buildPrompt(action, { bookContext, difficulty, thinkingAnswers, chatHistory });

    // 3. maxTokens 配
    const maxTokens = action === 'share' ? 6000 : action === 'note' ? 4000 : action === 'quote' ? 1500 : 1200;

    // D12.13-C · 当 chatHistory 非空且 input 为空/过短 → 用 chatHistory 合成兜底 input（与 workshop.js 同步）
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

    try {
      // 4. 调 DeepSeek（非流式，DO 内部没浏览器 EventSource）
      const result = await callDeepSeek({
        apiKey,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: effectiveInput },
        ],
        model: DEFAULT_MODEL,
        maxTokens,
        temperature: 0.75,
        timeoutMs: 60000,
      });

      // 5. 解析（quote/share 是 JSON）
      let parsed = null;
      let parseError = null;
      if (action === 'quote' || action === 'share') {
        try { parsed = safeParseJson(result.content); } catch (e) { parseError = e.message; }
      }

      // 6. 存结果
      const finishedAt = Date.now();
      await this.storage.put('task', {
        status: STATUS.DONE,
        result: {
          ok: true,
          action,
          model: result.model,
          reply: result.content,
          parsed,
          parseError,
          usage: result.usage,
        },
        elapsedMs: finishedAt - startedAt,
        startedAt,
        finishedAt,
      });
    } catch (e) {
      const finishedAt = Date.now();
      await this.storage.put('task', {
        status: STATUS.FAILED,
        error: e.message || String(e),
        elapsedMs: finishedAt - startedAt,
        startedAt,
        finishedAt,
      });
    }
  }

  /**
   * 简化版 PROMPT_BUILDERS（与 workshop.js 同步）
   * D8-2 暂不复用 workshop.js 的导出（避免循环依赖）
   */
  _buildPrompt(action, ctx) {
    const ta = this._buildThinkingAnswersBlock(ctx.thinkingAnswers);
    const title = ctx.bookContext?.title || '未指定';
    const author = ctx.bookContext?.author || '佚名';
    const diff = ctx.difficulty || '入门';

    if (action === 'note') {
      const chatBlock = this._buildChatHistoryBlock(ctx.chatHistory);
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

【当前书】${title} · ${author}
【难度等级】${diff}
${ta}
${chatBlock}
${sourceGuidance}
`;
    }
    if (action === 'quote') {
      return `你是「金句提炼师」。
请从用户原文中提炼 3-5 句金句，输出 JSON 数组：
[
  { "quote": "原文金句（10-30 字）", "source": "出处/页码", "reflection": "100 字以内感悟" },
  ...
]

【当前书】${title}
${ta}
严格按 JSON 输出，不加 \`\`\`json\`\`\` 标记外的内容。
`;
    }
    if (action === 'optimize') {
      return `你是「笔记润色师」。
请基于用户笔记进行润色：
- 保留作者原意
- 优化表达（更精准、更克制）
- 删除冗余
- 风格：像主公在公众号/小红书写笔记
- 字数控制在原文的 90%-110%

【当前书】${title}
${ta}
`;
    }
    if (action === 'share') {
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

【当前书】${title} · ${author}
【难度等级】${diff}
${ta}
要求：
- 严格 JSON 输出
- 标题用 <b> 强调
- emoji 1-2 个/帧
- 字数严格按每帧 type 控制
`;
    }
    return '';
  }

  _buildChatHistoryBlock(chatHistory) {
    if (!Array.isArray(chatHistory) || chatHistory.length === 0) return '';
    const agentNameMap = { lead: '领读人', socrates: '苏格拉底', painter: '画师', quote: '金句捕手' };
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

  _buildThinkingAnswersBlock(thinkingAnswers) {
    if (!Array.isArray(thinkingAnswers) || thinkingAnswers.length === 0) return '';
    const lines = thinkingAnswers
      .filter(a => a && (a.answer || a.qText))
      .map(a => {
        const idx = a.qIndex != null ? `思考题 ${a.qIndex}` : '思考题';
        const q = a.qText ? `${a.qText}` : '（题面未记录）';
        const ans = a.answer ? String(a.answer).trim() : '（未答）';
        const ansSliced = ans.length > 300 ? ans.slice(0, 300) + '…' : ans;
        return `- ${idx}：${q}\n  主公答：${ansSliced}`;
      });
    if (lines.length === 0) return '';
    return `\n【主公本章思考题答案（必须引用 · 格式：「主公说：「...」」）】\n<thinking_answers>\n${lines.join('\n')}\n</thinking_answers>\n`;
  }
}
