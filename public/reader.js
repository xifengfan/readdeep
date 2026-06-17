// ================================================
// reader.js
// P2 读透 · 陪读室前端逻辑
// 用途：4 Agent Tab 切换 + 调 /api/chat + 历史滚动
// 模型：deepseek-v4-flash（后端默认）
// v3.0 - 2026-06-08 15:43 全面修复（P1 教训 5 第 3 次重演）
// v3.1 - 2026-06-10 P2-I 修复：chatHistory 走 localStorage（key=readdeep.chatHistory.{bookId}）
//                 - 存储：全量带 agent 字段（4 Agent 共享一数组）
//                 - 渲染/发请求：按 currentAgent 过滤
//                 - 切换 agent 不清历史；切书 / 刷新 保留历史
// v3.3 - 2026-06-17 D14.1：删除思考题相关（UI/函数/接口）；新增"生成小结"按钮
//                 - 4 Agent 各 ≥1 轮解锁 → 调 /api/summary
//                 - 小结存 readdeep.summary.{bookId}.{chapter} → workshop 4 模板读它
//                 - 旧 localStorage key（readdeep.thinkingAnswers.*）保留，不动
// ================================================

// pinyin → agent id 映射（兼容旧 reader.html 的 data-agent）
const AGENT_PINYIN_MAP = {
  lingdu_ren: 'lead',
  sugeladuo: 'socrates',
  huashi: 'painter',
  jinjubushou: 'quote',
};

const AGENT_NAME_MAP = {
  lead: '领读人',
  socrates: '苏格拉底',
  painter: '画师',
  quote: '金句捕手',
};

// D7-1：首次欢迎气泡（localStorage 持久化）
const WELCOMED_AGENTS_KEY = 'readdeep.welcomedAgents';
function loadWelcomedAgents() {
  try { return JSON.parse(localStorage.getItem(WELCOMED_AGENTS_KEY) || '{}'); } catch { return {}; }
}
function saveWelcomedAgents(obj) {
  localStorage.setItem(WELCOMED_AGENTS_KEY, JSON.stringify(obj));
}

// D7-1：4 Agent 欢迎语（硬编码 · 主公调性 · 不端着）
const AGENT_WELCOMES = {
  lead: `📖 我是领读人，帮你拆章节结构和抓重点。
我适合问你："这一章讲什么？""作者想表达什么？"
回我一条具体问题试试。`,
  socrates: `🤔 我是苏格拉底，专门扎心追问。
我会说"反过来呢？""你这个假设真的对吗？"
别怕被我怼，我怼你是为了让你想清楚。`,
  painter: `🎨 我是画师，把抽象概念翻译成画面。
我会给你"做饭""带娃""通勤"的类比 + 方块图。
问"举个例子"或"画个图"我就在。`,
  quote: `✍️ 我是金句捕手，帮你挑一句今天能贴墙的话。
我会说"这句跟你的关系是 XX"，然后给个场景卡。
说"挑一句"或"给个场景卡"我就在。`,
};

let currentAgent = 'lead';
// v3.1 P2-I：chatHistory 改为"全量 + agent 字段"；渲染/发请求按 currentAgent 过滤
// 切 agent 不再清空（保留 4 Agent 各自的对话）；切书由 bookSelect change 处理
let chatHistory = [];
let currentBookId = null;
let currentBookContext = null;  // v2 2026-06-09：提升为模块作用域，sendMessage() 需用
let isSending = false;

// ========== P2-I · localStorage 持久化 ==========
// 存储：全量 [{ role, agent?, content, ts }]
// 渲染/发请求时：按 currentAgent 过滤出该 agent 的子集
const CHAT_HISTORY_KEY = (bookId) => `readdeep.chatHistory.${bookId}`;

function loadChatHistory(bookId) {
  if (!bookId) return [];
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY(bookId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('[reader.js] 读聊天历史失败', e);
    return [];
  }
}

function saveChatHistory(bookId, history) {
  if (!bookId) return;
  try {
    // 截断：单书最多保留 200 条（防 localStorage 爆掉）
    const arr = (history || []).slice(-200);
    localStorage.setItem(CHAT_HISTORY_KEY(bookId), JSON.stringify(arr));
  } catch (e) {
    console.warn('[reader.js] 存聊天历史失败', e);
  }
}

// 取"当前 agent 的对话子集"（用于渲染 + 发请求）
function chatHistoryForAgent(agent) {
  return chatHistory.filter(m => {
    if (agent === 'lead')   return m.agent === 'lead'   || (!m.agent && m.role !== 'user');
    if (agent === 'socrates') return m.agent === 'socrates';
    if (agent === 'painter')  return m.agent === 'painter';
    if (agent === 'quote')    return m.agent === 'quote';
    return true;
  });
}

// ========== 启动日志（验证脚本是否真加载）==========
console.log('%c[reader.js] 已加载 · v3.4 · 2026-06-17（+ D14.2 2 角色解锁 + UI 上下文 + tab 角标 + 创作按钮）', 'color: #c1272d; font-weight: bold;');

// ========== D14.1 · 生成小结按钮 + 状态管理 ==========
// 设计：
//   - 4 角色 chatHistory 各 ≥ 1 轮 → 启用 #generate-summary
//   - 切章节 → 重置启用状态（每章节独立计算）
//   - 章节小结存 localStorage（readdeep.summary.{bookId}.{chapter}）
//   - 切书时清掉当前可见的 summary card
// 模块作用域
let isGeneratingSummary = false;
let currentChapterForSummary = null;
const SUMMARY_KEY = (bookId, chapter) => `readdeep.summary.${bookId}.${chapter || 0}`;

/** 统计 4 Agent 各聊了几轮（agent 字段 + role=assistant 计数） */
function countChatsByAgent() {
  const counts = { lead: 0, socrates: 0, painter: 0, quote: 0 };
  (chatHistory || []).forEach(m => {
    if (m && m.role === 'assistant' && m.agent && counts[m.agent] !== undefined) {
      counts[m.agent]++;
    }
  });
  return counts;
}

/** D14.2 · 2 角色即可解锁：任意 2 角色聊过 ≥1 轮 → 启用按钮
 * （旧版要求 4 角色全到，主公 dogfooding 反馈太重——D14.2 荀彧建议 1 改）
 */
function updateSummaryButtonState() {
  const btn = document.getElementById('generate-summary');
  const metaEl = document.getElementById('summary-meta');
  if (!btn) return;
  if (!currentBookId) {
    btn.disabled = true;
    if (metaEl) metaEl.textContent = '请先选书';
    return;
  }
  const counts = countChatsByAgent();
  // D14.2：2 角色聊过即可（不再要求 4 角色全到）
  const metAgents = Object.entries(counts).filter(([_, n]) => n >= 1);
  const metCount = metAgents.length;
  const enough = metCount >= 2;
  btn.disabled = !enough;
  if (enough) {
    const names = metAgents.map(([k]) => AGENT_NAME_MAP[k] || k).join(' + ');
    if (metaEl) metaEl.textContent = `可生成 · ${names} 已聊过`;
  } else {
    const missing = Object.entries(counts).filter(([_, n]) => n < 1).map(([k]) => AGENT_NAME_MAP[k] || k);
    if (metaEl) metaEl.textContent = `还差（至少 2 角色聊过即可）：${missing.join(' / ')}`;
  }
}

/** 把生成的小结存到 localStorage（供 workshop 4 模板读） */
function saveSummaryToStorage(bookId, chapter, summary) {
  if (!bookId) return;
  try {
    localStorage.setItem(SUMMARY_KEY(bookId, chapter), summary || '');
  } catch (e) {
    console.warn('[reader.js] 存小结失败', e);
  }
}

/** 暴露给 workshop.html：读小结 */
window.__readerReadSummary = function (bookId, chapter) {
  try {
    return localStorage.getItem(SUMMARY_KEY(bookId, chapter)) || '';
  } catch (e) { return ''; }
};

/** 调 /api/summary 拿到小结 */
async function callSummaryApi(bookId, chapter) {
  // 组装 chatHistory（4 角色全量 → 限制最近 40 条）
  const history = (chatHistory || [])
    .slice(-40)
    .map(m => ({
      agent: m.agent,
      role: m.role,
      content: String(m.content || '').slice(0, 400),
    }));
  const currentBook = window.__readerState?.currentBook;
  const bookTitle = currentBook?.title || '当前书';
  const resp = await fetch('/api/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookId, chapter, bookTitle, chatHistory: history }),
  });
  return await resp.json();
}

/** 渲染小结到 #summary-card */
function renderSummaryCard(summary, generatedAt) {
  const card = document.getElementById('summary-card');
  const content = document.getElementById('summary-content');
  const status = document.getElementById('summary-status');
  if (!card || !content) return;
  content.textContent = summary;
  card.classList.remove('hidden');
  if (status && generatedAt) {
    const d = new Date(generatedAt);
    const ts = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    status.textContent = `生成于 ${ts}`;
  }
}

/** 隐藏小结卡片（章节切换时用） */
function hideSummaryCard() {
  const card = document.getElementById('summary-card');
  const loading = document.getElementById('summary-loading');
  if (card) card.classList.add('hidden');
  if (loading) loading.classList.add('hidden');
}

/** 点击"生成小结" */
async function handleGenerateSummary() {
  if (isGeneratingSummary) return;
  if (!currentBookId) return;
  const ch = window.__readerState?.currentChapter ?? 0;
  isGeneratingSummary = true;
  const btn = document.getElementById('generate-summary');
  const regenBtn = document.getElementById('regenerate-summary');
  const loading = document.getElementById('summary-loading');
  const card = document.getElementById('summary-card');
  if (btn) btn.disabled = true;
  if (regenBtn) regenBtn.disabled = true;
  if (loading) loading.classList.remove('hidden');
  if (card) card.classList.add('hidden');
  try {
    const data = await callSummaryApi(currentBookId, ch);
    if (data && data.ok && data.summary) {
      saveSummaryToStorage(currentBookId, ch, data.summary);
      renderSummaryCard(data.summary, data.generatedAt);
      if (typeof App !== 'undefined' && App.track) {
        App.track('summary_generate', { bookId: currentBookId, chapter: ch });
      }
    } else {
      const errMsg = `[${data?.code || 'ERROR'}] ${data?.error || '小结生成失败'}`;
      console.error('[reader.js] /api/summary 错误', data);
      alert(errMsg);
    }
  } catch (e) {
    console.error('[reader.js] /api/summary 网络错误', e);
    alert(`网络错误：${e.message}`);
  } finally {
    isGeneratingSummary = false;
    if (btn) btn.disabled = false;
    if (regenBtn) regenBtn.disabled = false;
    if (loading) loading.classList.add('hidden');
    updateSummaryButtonState();
  }
}

/** 绑定"生成小结"按钮 */
function initSummaryButton() {
  const btn = document.getElementById('generate-summary');
  if (btn) btn.addEventListener('click', handleGenerateSummary);
  const regenBtn = document.getElementById('regenerate-summary');
  if (regenBtn) regenBtn.addEventListener('click', handleGenerateSummary);
  const copyBtn = document.getElementById('copy-summary');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const content = document.getElementById('summary-content');
      if (!content) return;
      const text = content.textContent || '';
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = '✅ 已复制';
        setTimeout(() => { copyBtn.textContent = '📋 复制小结'; }, 2000);
      } catch (e) {
        console.warn('[reader.js] 复制失败', e);
      }
    });
  }
}

/** 章节变化时调用（reader.html 内嵌脚本触发） */
function onChapterChange(newChapter) {
  currentChapterForSummary = newChapter;
  hideSummaryCard();  // 切章节 → 隐藏上一章小结
  updateSummaryButtonState();
}
window.onChapterChange = onChapterChange;

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[reader.js] DOMContentLoaded 触发');

  // 1. 拿 bookId
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  currentBookId = params.get('book') || null;
  if (currentBookId) {
    console.log('[reader.js] 当前 bookId:', currentBookId);
  }

  // 1.1 P2-I 修复（2026-06-10 吕玲绮）：从 localStorage 加载聊天历史
  //  - bookId 已知时立即读，刷新也不丢
  //  - 渲染由 switchAgent 触发（init 末尾调用）
  if (currentBookId) {
    chatHistory = loadChatHistory(currentBookId);
    console.log(`[reader.js] 从 localStorage 读 ${chatHistory.length} 条历史`);
  }

  // 1.5 加载书库 + 监听 select 变化
  await initBookSelection();

  // 2. 加载 4 Agent 列表
  await loadAgentList();

  // 3. 绑定 Tab 点击
  document.querySelectorAll('[data-agent]').forEach(tab => {
    tab.addEventListener('click', () => {
      const raw = tab.dataset.agent;
      const agent = AGENT_PINYIN_MAP[raw] || raw;
      switchAgent(agent);
    });
  });

  // 4. 绑定发送按钮（真实 ID：chat-input / chat-send）
  const sendBtn = document.getElementById('chat-send');
  const input = document.getElementById('chat-input');
  if (sendBtn && input) {
    sendBtn.addEventListener('click', () => sendMessage());
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    console.log('%c[reader.js] ✅ 发送按钮已绑定 (chat-send + chat-input)', 'color: green; font-weight: bold;');
  } else {
    console.error('[reader.js] ❌ 找不到 chat-send / chat-input', {
      chatSend: !!sendBtn,
      chatInput: !!input,
    });
    // 提示用户（避免静默失败）
    addSystemMessage('⚠️ 陪读室初始化失败：找不到输入框。请刷新页面或联系开发者。', 'error');
  }

  // 5. 绑定清空按钮
  // v3.1 P2-I：只清"当前 agent"的历史，其他 agent 保留；清完立即 save
  const clearBtn = document.getElementById('clear-chat');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      chatHistory = chatHistory.filter(m => m.agent !== currentAgent);
      saveChatHistory(currentBookId, chatHistory);
      renderChat();
      updateSummaryButtonState();  // D14.1：清空后可能要禁用小结按钮
    });
  }

  // 6. 默认激活第一个 agent
  switchAgent('lead');

  // D7-1：试试问快捷按钮
  initTryAskButtons();

  // D14.1：绑定"生成小结"按钮 + 初始化按钮状态
  initSummaryButton();
  updateSummaryButtonState();

  // D14.2 改动 4：绑定"基于对话创作"按钮 + 复制/收起
  initComposeButtons();

  console.log('[reader.js] 初始化完成');
});

// ========== 加载 4 Agent 列表 ==========
async function loadAgentList() {
  try {
    const r = await fetch('/api/agents');
    const data = await r.json();
    if (data.ok) {
      console.log(`[reader.js] 加载 ${data.count} 个 Agent`, data.agents);
    }
  } catch (e) {
    console.warn('[reader.js] /api/agents 加载失败（后端可能未部署）：', e.message);
  }
}

// ========== 切换 Agent ==========
// v3.1 P2-I：切换 agent 不再清空 chatHistory（共享全量 + 渲染时按 agent 过滤）
function switchAgent(agent) {
  if (!AGENT_NAME_MAP[agent]) {
    console.warn('[reader.js] 未知 agent:', agent);
    return;
  }
  currentAgent = agent;
  const nameEl = document.getElementById('current-agent-name');
  if (nameEl) nameEl.textContent = AGENT_NAME_MAP[agent];

  // 更新 Tab 高亮 + aria-selected
  document.querySelectorAll('[data-agent]').forEach(tab => {
    const raw = tab.dataset.agent;
    const mapped = AGENT_PINYIN_MAP[raw] || raw;
    const isActive = mapped === agent;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });

  renderChat();

  // D7-1：首次切某 agent 触发欢迎气泡（取代原来的 addSystemMessage）
  const welcomed = loadWelcomedAgents();
  if (!welcomed[agent]) {
    const welcomeId = 'welcome-' + Date.now();
    appendBubble('agent', AGENT_WELCOMES[agent] || `我是${AGENT_NAME_MAP[agent]}～`, welcomeId);
    // 阶段 3：欢迎气泡加 .welcome class 触发滑入动画
    const welcomeEl = document.getElementById(welcomeId);
    if (welcomeEl) welcomeEl.classList.add('welcome');
    welcomed[agent] = true;
    saveWelcomedAgents(welcomed);
  }

  // 阶段 3：agent 切换转场（opacity 微动）
  const stream = document.getElementById('chat-stream');
  if (stream) {
    stream.style.opacity = '0.7';
    requestAnimationFrame(() => {
      stream.style.opacity = '1';
    });
  }

  // D14.2 改动 4：切 agent 时显隐"基于对话创作"按钮
  //   - painter / quote tab 才显示
  //   - lead / socrates tab 不显示
  updateComposeSectionVisibility();
}

// ========== D14.2 改动 4 · 创作模式按钮显隐 ==========
function updateComposeSectionVisibility() {
  const sec = document.getElementById('agent-compose-section');
  if (!sec) return;
  const show = (currentAgent === 'painter' || currentAgent === 'quote');
  sec.style.display = show ? 'flex' : 'none';
  // 顺手把"收起"按钮也清掉（避免切到 lead 后又看到上一次的创作）
  if (!show) hideComposeCard();
}

let isComposing = false;

/** 调 /api/compose 拿创作结果 */
async function callComposeApi(bookId, chapter, agent, history) {
  const resp = await fetch('/api/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bookId,
      chapter,
      agent,
      chatHistory: history,
    }),
  });
  return await resp.json();
}

function renderComposeCard(composition, agent, generatedAt) {
  const card = document.getElementById('compose-card');
  const content = document.getElementById('compose-card-content');
  const label = document.getElementById('compose-card-label');
  const status = document.getElementById('compose-card-status');
  if (!card || !content) return;
  content.textContent = composition;
  if (label) label.textContent = agent === 'painter' ? '🎨 画师视角创作' : '💎 金句捕手创作';
  if (status && generatedAt) {
    const d = new Date(generatedAt);
    const ts = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    status.textContent = `生成于 ${ts}`;
  }
  card.classList.remove('hidden');
}

function hideComposeCard() {
  const card = document.getElementById('compose-card');
  const loading = document.getElementById('compose-loading');
  if (card) card.classList.add('hidden');
  if (loading) loading.classList.add('hidden');
}

async function handleCompose(agent) {
  if (isComposing) return;
  if (!currentBookId) {
    alert('请先选书');
    return;
  }
  if (!SUPPORTED_COMPOSE_AGENTS.has(agent)) {
    console.warn('[reader.js] 创作模式不支持 agent:', agent);
    return;
  }
  const ch = window.__readerState?.currentChapter ?? 0;
  // 拼 chatHistory（全量 · /api/compose 会自己截断到 40 条）
  const history = (chatHistory || []).map(m => ({
    agent: m.agent,
    role: m.role,
    content: String(m.content || '').slice(0, 400),
  }));
  isComposing = true;
  const loading = document.getElementById('compose-loading');
  const card = document.getElementById('compose-card');
  if (loading) loading.classList.remove('hidden');
  if (card) card.classList.add('hidden');
  try {
    const data = await callComposeApi(currentBookId, ch, agent, history);
    if (data && data.ok && data.composition) {
      renderComposeCard(data.composition, data.agent || agent, data.generatedAt);
      if (typeof App !== 'undefined' && App.track) {
        App.track('compose_generate', { bookId: currentBookId, chapter: ch, agent });
      }
    } else {
      const errMsg = `[${data?.code || 'ERROR'}] ${data?.error || '创作失败'}`;
      console.error('[reader.js] /api/compose 错误', data);
      alert(errMsg);
    }
  } catch (e) {
    console.error('[reader.js] /api/compose 网络错误', e);
    alert(`网络错误：${e.message}`);
  } finally {
    isComposing = false;
    if (loading) loading.classList.add('hidden');
  }
}

const SUPPORTED_COMPOSE_AGENTS = new Set(['painter', 'quote']);

/** 绑定"基于对话创作"按钮（2 个）+ 复制 / 收起 */
function initComposeButtons() {
  const btnPainter = document.getElementById('compose-as-painter');
  const btnQuote = document.getElementById('compose-as-quote');
  if (btnPainter) btnPainter.addEventListener('click', () => handleCompose('painter'));
  if (btnQuote) btnQuote.addEventListener('click', () => handleCompose('quote'));
  const copyBtn = document.getElementById('compose-copy');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const content = document.getElementById('compose-card-content');
      if (!content) return;
      const text = content.textContent || '';
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = '✅ 已复制';
        setTimeout(() => { copyBtn.textContent = '📋 复制作品'; }, 2000);
      } catch (e) {
        console.warn('[reader.js] 复制创作失败', e);
      }
    });
  }
  const closeBtn = document.getElementById('compose-card-close');
  if (closeBtn) closeBtn.addEventListener('click', hideComposeCard);
}

// ========== 发送消息 ==========
async function sendMessage() {
  if (isSending) {
    console.log('[reader.js] 正在发送中，跳过');
    return;
  }
  const input = document.getElementById('chat-input');
  const stream = document.getElementById('chat-stream');
  if (!input || !stream) {
    console.error('[reader.js] 找不到 chat-input 或 chat-stream');
    return;
  }

  const text = input.value.trim();
  if (!text) {
    console.log('[reader.js] 空消息，跳过');
    return;
  }
  
  console.log('[reader.js] 发送消息:', text.substring(0, 30), 'agent:', currentAgent);

  isSending = true;
  const sendBtn = document.getElementById('chat-send');
  if (sendBtn) sendBtn.disabled = true;

  // 1. 渲染用户消息
  // v3.1 P2-I：用户消息也带 agent 字段（虽然 role=user，但便于 sendTime / 一致性）
  chatHistory.push({ role: 'user', agent: currentAgent, content: text, ts: Date.now() });
  saveChatHistory(currentBookId, chatHistory);
  renderChat();
  input.value = '';

  // 2. 加 loading 气泡
  const loadingId = 'loading-' + Date.now();
  appendBubble('agent', '...', loadingId);

  // 3. 调 /api/chat
  try {
    const chapter = window.__readerState?.currentChapter ?? 0;
    // D14.1：思考题已删，bookContext 不再拼 thinkingAnswers
    // v3.1 P2-I：发请求时只发"当前 agent"的历史（不是全量）
    const myHistory = chatHistoryForAgent(currentAgent).map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
    }));
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookId: currentBookId,
        bookContext: currentBookContext,
        chapter,
        agent: currentAgent,
        userMessage: text,
        history: myHistory.slice(0, -1),  // 去掉刚 push 的 user，等会儿 LLM 自己 echo
      }),
    });
    const data = await r.json();

    // 移除 loading
    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) loadingEl.remove();

    if (data.ok) {
      console.log('[reader.js] 收到回复', data.elapsedMs + 'ms', data.usage);
      // v3.1 P2-I：reply 消息带 agent 字段，便于 4 Agent 历史隔离
      chatHistory.push({ role: 'assistant', agent: currentAgent, content: data.reply, ts: Date.now() });
      saveChatHistory(currentBookId, chatHistory);
      renderChat();
      updateSummaryButtonState();  // D14.1：每收到一条回复都刷新小结按钮状态
    } else {
      const errMsg = `[${data.code || 'ERROR'}] ${data.error || '未知错误'}`;
      console.error('[reader.js] /api/chat 错误', data);
      addSystemMessage(errMsg, 'error');
    }
  } catch (e) {
    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) loadingEl.remove();
    console.error('[reader.js] 网络错误', e);
    addSystemMessage(`网络错误：${e.message}`, 'error');
  } finally {
    isSending = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ========== 渲染 ==========
// v3.1 P2-I：只渲染"当前 agent"的对话（其他 agent 切回来看得到）
// D14.2 改动 2：空状态不再用"默认欢迎气泡"误导用户（实际是 N 轮没聊），
// 改为"这是我第一次和 X 聊天 · 前面你和 Y 聊了 N 轮"上下文提示。
function renderChat() {
  const stream = document.getElementById('chat-stream');
  if (!stream) return;
  stream.innerHTML = '';
  const myMsgs = chatHistoryForAgent(currentAgent);
  if (myMsgs.length === 0) {
    // D14.2：空状态分支 —— 上下文提示 + 跳转到其他 agent 对话的按钮
    const welcome = AGENT_NAME_MAP[currentAgent] || 'AI';
    // 统计其他 agent 的对话数
    const otherChats = (chatHistory || []).filter(m => m && m.role === 'assistant' && m.agent && m.agent !== currentAgent);
    const agentStats = otherChats.reduce((acc, m) => {
      acc[m.agent] = (acc[m.agent] || 0) + 1;
      return acc;
    }, {});
    const sorted = Object.entries(agentStats)
      .filter(([_, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);

    const ctx = document.createElement('div');
    ctx.className = 'chat-bubble agent chat-context-hint';
    if (sorted.length === 0) {
      // 真·冷启动
      ctx.innerHTML = `你好！我是 <b>${welcome}</b>，选好书和章节后，把你的疑问或想讨论的内容发给我。`;
      stream.appendChild(ctx);
    } else {
      // D14.2：上下文提示（让用户知道"前面和谁聊过"）
      const statsText = sorted
        .slice(0, 4)
        .map(([k, n]) => `<b>${AGENT_NAME_MAP[k] || k}</b> 聊了 ${n} 轮`)
        .join(' + ');
      ctx.innerHTML = `这是我第一次和 <b>${welcome}</b> 聊天。<br/>前面你和 ${statsText}。要继续和${welcome}聊点什么吗？`;
      stream.appendChild(ctx);

      // D14.2：跳转到已聊过的 agent 的按钮（保留当前 agent 写入栈，仅"预览"）
      const jumpWrap = document.createElement('div');
      jumpWrap.className = 'chat-jump-buttons';
      jumpWrap.style.cssText = 'margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap;';
      sorted.slice(0, 4).forEach(([k]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'text-xs px-2 py-1 rounded border border-ink-300 text-ink-700 hover:bg-ink-100';
        btn.textContent = `看 ${AGENT_NAME_MAP[k] || k} 的对话`;
        btn.addEventListener('click', () => {
          switchAgent(k);
        });
        jumpWrap.appendChild(btn);
      });
      stream.appendChild(jumpWrap);
    }
    return;
  }
  myMsgs.forEach(msg => {
    appendBubble(msg.role === 'user' ? 'user' : 'agent', msg.content);
  });
  stream.scrollTop = stream.scrollHeight;
  // D14.2 改动 3：渲染后刷新 agent tab 角标
  renderAgentTabs();
}

// ========== D14.2 改动 3 · agent tab 角标 ==========
// 在每个 agent tab 内显示●已聊 N 轮小角标
function renderAgentTabs() {
  const counts = countChatsByAgent();
  // data-agent 原始值是拼音 (lingdu_ren / sugeladuo / huashi / jinjubushou)
  // AGENT_PINYIN_MAP 反向查 → agent id
  const reverseMap = {};
  for (const [py, id] of Object.entries(AGENT_PINYIN_MAP)) {
    reverseMap[id] = py;
  }
  document.querySelectorAll('[data-agent]').forEach(tab => {
    const raw = tab.dataset.agent;
    const agentId = AGENT_PINYIN_MAP[raw] || raw;
    const n = counts[agentId] || 0;
    let badge = tab.querySelector('.agent-tab-badge');
    if (n <= 0) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'agent-tab-badge';
      badge.setAttribute('aria-label', `已聊 ${n} 轮`);
      tab.appendChild(badge);
    }
    badge.textContent = `●已聊 ${n} 轮`;
    badge.setAttribute('aria-label', `已聊 ${n} 轮`);
  });
}

// D14.1 · 思考题已删：chatHistory 拼进 bookContext 的旧逻辑不再需要
// （sendMessage 不再调 getThinkingAnswers，改用 summary block）
// （函数体已删；保留占位说明）

function appendBubble(role, text, id = null) {
  const stream = document.getElementById('chat-stream');
  if (!stream) return;
  const div = document.createElement('div');
  div.className = `chat-bubble ${role}`;
  if (id) div.id = id;
  div.textContent = text;
  stream.appendChild(div);
  stream.scrollTop = stream.scrollHeight;
}

function addSystemMessage(text, type = 'info') {
  const stream = document.getElementById('chat-stream');
  if (!stream) return;
  const div = document.createElement('div');
  div.className = `system-msg ${type}`;
  div.textContent = text;
  stream.appendChild(div);
  setTimeout(() => div.remove(), 5000);
}


// ========== 加载书库 + 监听 select 变化 ==========
async function initBookSelection() {
  // v2 (2026-06-09 荀彧反向检查): 避免双填 #book-select
  // reader.html 内嵌脚本已 fill 下拉，reader.js 只负责挂事件 + 同步 currentBookContext
  const bookSelect = document.getElementById('book-select');
  if (!bookSelect) {
    console.warn('[reader.js] 找不到 #book-select');
    return;
  }
  // 如果内嵌脚本还没填，自己补填（独立入口页直接打开 reader.html 时）
  if (!bookSelect.dataset.filled) {
    // 等内嵌脚本最多 200ms（内嵌可能还在 await）
    for (let i = 0; i < 20 && !bookSelect.dataset.filled; i++) {
      await new Promise(r => setTimeout(r, 10));
    }
  }
  if (!bookSelect.dataset.filled) {
    try {
      const r = await fetch('/data/books.json');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      // 兼容两种格式：{books:[...]} 或直接 [...]
      const books = Array.isArray(data) ? data : (data.books || []);
      console.log('[reader.js] 独立加载 books.json:', books.length, '本');
      books.forEach(book => {
        const opt = document.createElement('option');
        opt.value = book.id;
        opt.textContent = book.title;
        opt.dataset.title = book.title;
        opt.dataset.author = book.author || '佚名';
        opt.dataset.summary = book.summary || '';
        bookSelect.appendChild(opt);
      });
      bookSelect.dataset.filled = '1';
      if (books.length > 0) {
        bookSelect.value = books[0].id;
      }
    } catch (e) {
      console.error('[reader.js] 独立加载 books.json 失败:', e);
      return;
    }
  }

  bookSelect.addEventListener('change', () => {
    const selected = bookSelect.options[bookSelect.selectedIndex];
    if (!selected || !selected.value) {
      currentBookContext = null;
      currentBookId = null;
      if (window.__readerState) window.__readerState.currentBook = null;
      // v3.1 P2-I：选"未指定"时清空当前 chatHistory（不写盘）
      chatHistory = [];
      renderChat();
      return;
    }
    const newBookId = selected.value;
    // v3.1 P2-I：切书时如果 bookId 变了，切换 localStorage key
    if (newBookId !== currentBookId) {
      currentBookId = newBookId;
      chatHistory = loadChatHistory(currentBookId);
      console.log(`[reader.js] 切书 → ${currentBookId}，载入 ${chatHistory.length} 条历史`);
      renderChat();
    }
    currentBookContext = {
      title: selected.dataset.title || selected.textContent,
      author: selected.dataset.author || '佚名',
      summary: selected.dataset.summary || '',
    };
    console.log('[reader.js] 选了书:', currentBookContext);
  });

  // 初始化 context（取当前已选书）
  if (bookSelect.value) {
    const sel = bookSelect.options[bookSelect.selectedIndex];
    if (sel && sel.value) {
      // v3.1 P2-I：bookSelect 初始值时的 bookId 取 sel.value（覆盖 URL hash 的值）
      //   真实 bookId 来自 reader.html 内嵌脚本 ?id=... 处理后的下拉
      if (sel.value !== currentBookId) {
        currentBookId = sel.value;
        chatHistory = loadChatHistory(currentBookId);
        console.log(`[reader.js] 初始 bookId=${currentBookId}，载入 ${chatHistory.length} 条历史`);
      }
      currentBookContext = {
        title: sel.dataset.title || sel.textContent,
        author: sel.dataset.author || '佚名',
        summary: sel.dataset.summary || '',
      };
    }
  }

  // v3.1 P2-I 兼容内嵌脚本 ?id=...：如果内嵌脚本已设过 currentBook，以它为准
  // 内嵌脚本的 loadBook() 会设 window.__readerState.currentBook.id 但不触发 change 事件
  // 我们的 init 跑在内嵌脚本前/后不确定，统一在这里同步
  const stateBookId = window.__readerState?.currentBook?.id;
  if (stateBookId && stateBookId !== currentBookId) {
    currentBookId = stateBookId;
    chatHistory = loadChatHistory(currentBookId);
    console.log(`[reader.js] 跟随内嵌脚本 ?id=... 同步到 ${currentBookId}，载入 ${chatHistory.length} 条历史`);
  }
}

// P2 · 2026-06-10 主公 dogfooding 修复：切章节时清空 chatHistory（仅当前 agent）
// 暴露给 reader.html 的 chapterSelectEl change handler 调用
// - 根因：原 chatHistory 按 bookId 隔离但 **不按 chapter 隔离**——切章节后 LLM 看到之前章节对话被误导
// - 修复：切章节时清掉当前 agent 的历史（其他 3 个 agent 保留）
// - 立即 save 到 localStorage，下次切回不会复活
window.__p2ClearChatForCurrentAgent = function () {
  if (!currentBookId) return;
  chatHistory = chatHistory.filter(m => m.agent !== currentAgent);
  saveChatHistory(currentBookId, chatHistory);
  renderChat();
  console.log(`[reader.js] 切章节清空 ${currentAgent} 历史 (bookId=${currentBookId}, 剩 ${chatHistory.length} 条)`);
};

// D7-1/D7-2 v2：试试问快捷按钮 — 点击后填到输入框 + focus（不自动发送）
// v2：试试问已移出 agent-card button（sibling），stopPropagation 无害 NOP
function initTryAskButtons() {
  document.querySelectorAll('.try-ask-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // 不触发父按钮（v2 已是 sibling · 无害保留）
      const askText = btn.dataset.ask;
      const input = document.getElementById('chat-input');
      if (input && askText) {
        input.value = askText;
        input.focus();
        // 阶段 3：输入框脉冲动画
        input.classList.add('chat-input-pulse');
        setTimeout(() => input.classList.remove('chat-input-pulse'), 300);
      }
    });
  });
}
