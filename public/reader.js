// ================================================
// reader.js
// P2 读透 · 陪读室前端逻辑
// 用途：4 Agent Tab 切换 + 调 /api/chat + 历史滚动
// 模型：deepseek-v4-flash（后端默认）
// v3.0 - 2026-06-08 15:43 全面修复（P1 教训 5 第 3 次重演）
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

let currentAgent = 'lead';
let chatHistory = [];
let currentBookId = null;
let currentBookContext = null;  // v2 2026-06-09：提升为模块作用域，sendMessage() 需用
let isSending = false;

// ========== 启动日志（验证脚本是否真加载）==========
console.log('%c[reader.js] 已加载 · v3.0 · 2026-06-08', 'color: #c1272d; font-weight: bold;');

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
  const clearBtn = document.getElementById('clear-chat');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      chatHistory = [];
      renderChat();
    });
  }

  // 6. 默认激活第一个 agent
  switchAgent('lead');
  
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
function switchAgent(agent) {
  if (!AGENT_NAME_MAP[agent]) {
    console.warn('[reader.js] 未知 agent:', agent);
    return;
  }
  currentAgent = agent;
  chatHistory = [];
  const nameEl = document.getElementById('current-agent-name');
  if (nameEl) nameEl.textContent = AGENT_NAME_MAP[agent];

  // 更新 Tab 高亮
  document.querySelectorAll('[data-agent]').forEach(tab => {
    const raw = tab.dataset.agent;
    const mapped = AGENT_PINYIN_MAP[raw] || raw;
    tab.classList.toggle('active', mapped === agent);
  });

  renderChat();
  addSystemMessage(`已切换到「${AGENT_NAME_MAP[agent]}」，开始陪读吧～`);
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
  chatHistory.push({ role: 'user', content: text });
  renderChat();
  input.value = '';

  // 2. 加 loading 气泡
  const loadingId = 'loading-' + Date.now();
  appendBubble('agent', '...', loadingId);

  // 3. 调 /api/chat
  try {
    const chapter = window.__readerState?.currentChapter ?? 0;
    // P1-B 修复（2026-06-09 吕玲绮）：拼主公本章思考题答案到 bookContext
    const thinkingAnswers = getThinkingAnswers(currentBookId, chapter);
    const bookContextWithAnswers = currentBookContext
      ? { ...currentBookContext, thinkingAnswers }
      : { thinkingAnswers };
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookId: currentBookId,
        bookContext: bookContextWithAnswers,
        chapter,
        agent: currentAgent,
        userMessage: text,
        history: chatHistory.slice(0, -1),
      }),
    });
    const data = await r.json();

    // 移除 loading
    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) loadingEl.remove();

    if (data.ok) {
      console.log('[reader.js] 收到回复', data.elapsedMs + 'ms', data.usage);
      chatHistory.push({ role: 'assistant', content: data.reply });
      renderChat();
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
function renderChat() {
  const stream = document.getElementById('chat-stream');
  if (!stream) return;
  stream.innerHTML = '';
  chatHistory.forEach(msg => {
    appendBubble(msg.role === 'user' ? 'user' : 'agent', msg.content);
  });
  stream.scrollTop = stream.scrollHeight;
}

// ========== P1-B 修复（2026-06-09 吕玲绮）==========
// 取主公本章思考题答案（从 localStorage 读，按 chapter 分组）
// 返回 [{qIndex, qText, answer}]，供 sendMessage 拼进 bookContext
function getThinkingAnswers(bookId, chapter) {
  if (!bookId) return [];
  try {
    const raw = localStorage.getItem(`readdeep.thinkingAnswers.${bookId}`);
    if (!raw) return [];
    const all = JSON.parse(raw);
    const ch = all[chapter];
    if (!ch) return [];
    return Object.keys(ch)
      .map(k => ({ qIndex: Number(k), ...ch[k] }))
      .filter(a => a.answer && String(a.answer).trim())
      .sort((a, b) => a.qIndex - b.qIndex);
  } catch (e) {
    console.warn('[reader.js] 读思考题答案失败', e);
    return [];
  }
}

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
      return;
    }
    currentBookId = selected.value;
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
      currentBookId = sel.value;
      currentBookContext = {
        title: sel.dataset.title || sel.textContent,
        author: sel.dataset.author || '佚名',
        summary: sel.dataset.summary || '',
      };
    }
  }
}