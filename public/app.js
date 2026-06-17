/* ================================================
 * 读透（ReadDeep）· app.js
 * D1 版本：5 埋点 + 路由 + 工具函数
 * D2 by 吕玲绮：接 Serverless API
 * D5 部署到 Vercel
 * ================================================ */

(function (global) {
  'use strict';

  // ---- 存储 Key ----
  const KEY_TRACK = 'readdeep.track';     // 埋点日志（数组）
  const KEY_PROGRESS = 'readdeep.progress'; // 阅读进度 { bookId: chapterIndex }
  const KEY_NOTES = 'readdeep.notes';     // 用户笔记草稿

  // ---- 5 大埋点事件 ----
  const EVENTS = {
    book_select: 'book_select',        // 选书（从书库点入详情）
    chapter_read: 'chapter_read',      // 进陪读室（开始读某章）
    agent_chat: 'agent_chat',          // 与 Agent 对话
    note_generate: 'note_generate',    // 生成笔记（4 模板任一）
    book_share: 'book_share',          // 分享/导出
  };

  // ---- AI 后端配置（D4 by 吕玲绮） ----
  // 走自建路线：Vercel Serverless Function + DeepSeek API
  // 部署到 Vercel 后，相对路径 '/api/agent' 会自动指向 Serverless Function
  const AI_CONFIG = {
    endpoint: '/api/agent',                      // D2 由鲁肃接
    timeoutMs: 30000,                            // 与服务端 maxDuration 对齐
  };

  // ============================================================
  // 工具：localStorage 安全读写
  // ============================================================
  function lsGet(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      console.warn('[lsGet] 解析失败', key, e);
      return fallback;
    }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { console.warn('[lsSet] 写入失败', key, e); return false; }
  }

  // ============================================================
  // 埋点系统（5 事件 + 通用 page_view）
  // ============================================================
  /**
   * @param {string} event   事件名
   * @param {object} payload 事件属性
   * @example App.track('book_select', { bookId: 'pd-001' })
   */
  function track(event, payload) {
    const entry = {
      event,
      payload: payload || {},
      ts: new Date().toISOString(),
      ua: navigator.userAgent.slice(0, 80),
    };
    const log = lsGet(KEY_TRACK, []);
    log.push(entry);
    // 限制单端最多保留 1000 条
    if (log.length > 1000) log.splice(0, log.length - 1000);
    lsSet(KEY_TRACK, log);

    if (global.console && console.debug) {
      console.debug('[track]', event, payload);
    }
  }

  function getTrackLog() { return lsGet(KEY_TRACK, []); }
  function clearTrackLog() { lsSet(KEY_TRACK, []); }

  // ============================================================
  // 阅读进度
  // ============================================================
  function getProgress(bookId) {
    const all = lsGet(KEY_PROGRESS, {});
    return all[bookId] || { chapterIndex: 0, updatedAt: null };
  }
  function setProgress(bookId, chapterIndex) {
    const all = lsGet(KEY_PROGRESS, {});
    all[bookId] = { chapterIndex, updatedAt: new Date().toISOString() };
    lsSet(KEY_PROGRESS, all);
  }

  // ============================================================
  // 笔记草稿
  // ============================================================
  function getNotes() { return lsGet(KEY_NOTES, []); }
  function saveNote(note) {
    const all = getNotes();
    note.id = note.id || ('note_' + Date.now());
    note.createdAt = note.createdAt || new Date().toISOString();
    all.push(note);
    const _ok = lsSet(KEY_NOTES, all);
    if (!_ok && typeof window !== 'undefined' && window.showToast) {
      window.showToast('⚠️ localStorage 写入失败（隐私模式？quota 满？）', 'error');
    }
    return note;
  }

  // ============================================================
  // 路由辅助
  // ============================================================
  function getQueryParam(name) {
    const params = new URLSearchParams(location.search);
    return params.get(name);
  }

  // ============================================================
  // 4 Agent 调用（D4 by 吕玲绮 · 接 DeepSeek）
  // ============================================================
  /**
   * @param {'lingdu_ren'|'sugeladuo'|'huashi'|'jinjubushou'} agentKey Agent 标识
   * @param {string} bookId  当前在读的书
   * @param {string} chapter 当前章节
   * @param {string} input   用户输入
   * @param {Array}  history 对话历史 [{role:'user'|'agent', text:''}]
   * @returns {Promise<{ok: boolean, data?: any, error?: string, message?: string, elapsedMs?: number, cost?: number}>}
   */
  async function callAgent(agentKey, bookId, chapter, input, history) {
    if (!agentKey) return { ok: false, error: 'INVALID_AGENT', message: '未指定 Agent' };
    if (!input || !input.trim()) return { ok: false, error: 'INVALID_INPUT', message: '请输入内容' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_CONFIG.timeoutMs);

    let resp;
    try {
      resp = await fetch(AI_CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent: agentKey,
          bookId,
          chapter,
          input: input.trim(),
          history: history || [],
        }),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        return { ok: false, error: 'TIMEOUT', message: '请求超时，请稍后重试' };
      }
      console.error('[callAgent] 网络错误', e);
      return { ok: false, error: 'NETWORK_ERROR', message: '请稍后重试' };
    }
    clearTimeout(timer);

    let json;
    try {
      json = await resp.json();
    } catch (e) {
      console.error('[callAgent] 响应非 JSON', e);
      return { ok: false, error: 'BAD_RESPONSE', message: '请稍后重试' };
    }

    if (!resp.ok || !json.ok) {
      return {
        ok: false,
        error: json.error || 'API_ERROR',
        message: json.message || '请稍后重试',
        status: resp.status,
      };
    }

    return {
      ok: true,
      data: json.data,
      elapsedMs: json.elapsedMs || 0,
      cost: json.cost || 0,
    };
  }

  // ============================================================
  // Mock Agent 回复（D1 占位 · D4 接真 API）
  // ============================================================
  const AGENT_MOCKS = {
    lingdu_ren: (input) => `【领读人·墨黑】\n\n你好，我是领读人。关于"${input.slice(0, 20)}"，让我先帮你梳理一下这段内容的背景与核心脉络。\n\n（D4 阶段将接 DeepSeek API · 走 Vercel Serverless）`,
    sugeladuo: (input) => `【苏格拉底·米黄】\n\n你说"${input.slice(0, 20)}"，我想反问你 3 个问题：\n1. 你怎么知道这是真的？\n2. 它的反面是什么？\n3. 如果它是错的，谁会受益？`,
    huashi: (input) => `【画师·朱砂】\n\n为"${input.slice(0, 20)}"我准备了一张概念图：\n\n   [核心] → [分支 1]\n             → [分支 2]\n   \n（D5 阶段由鲁班出真实 Excalidraw SVG）`,
    jinjubushou: (input) => `【金句捕手·墨色】\n\n从你提到的内容里，我会提炼金句。\n\n（提示：D2 已接 DeepSeek API · reader.js 接管了真 API 调用；如看到此 mock，说明后端 /api/chat 未响应 · 请检查 DEEPSEEK_API_KEY）`,
  };

  async function callAgentMock(agentKey, input) {
    // D1 占位：250ms 模拟网络延迟
    await new Promise(r => setTimeout(r, 250));
    const fn = AGENT_MOCKS[agentKey] || AGENT_MOCKS.lingdu_ren;
    return { ok: true, data: { reply: fn(input || '欢迎') }, elapsedMs: 250, cost: 0 };
  }

  // ============================================================
  // 暴露全局 App
  // ============================================================
  const App = {
    // 元数据
    EVENTS,
    AI_CONFIG,
    AGENTS: ['lingdu_ren', 'sugeladuo', 'huashi', 'jinjubushou'],
    AGENT_NAMES: {
      lingdu_ren: '领读人',
      sugeladuo: '苏格拉底',
      huashi: '画师',
      jinjubushou: '金句捕手',
    },
    AGENT_EMOJI: {
      lingdu_ren: '📖',
      sugeladuo: '🤔',
      huashi: '🎨',
      jinjubushou: '✍️',
    },
    // 工具
    track, getTrackLog, clearTrackLog,
    getProgress, setProgress,
    getNotes, saveNote,
    getQueryParam,
    // AI
    callAgent, callAgentMock,
    // 初始化
    init() {
      // 各页面 DOMContentLoaded 时会主动调 App.track('page_view', ...)
    },
  };

  global.App = App;

})(window);
