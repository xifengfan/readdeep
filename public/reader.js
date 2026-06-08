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
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookId: currentBookId,
        bookContext: currentBookContext,
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
  try {
    const r = await fetch('/data/books.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const books = await r.json();
    console.log('[reader.js] 加载 books.json:', books.length, '本');

    const bookSelect = document.getElementById('book-select');
    const chapterSelect = document.getElementById('chapter-select');
    if (!bookSelect) {
      console.warn('[reader.js] 找不到 #book-select');
      return;
    }

    books.forEach(book => {
      const opt = document.createElement('option');
      opt.value = book.id;
      opt.textContent = book.title;
      opt.dataset.title = book.title;
      opt.dataset.author = book.author || '佚名';
      opt.dataset.summary = book.summary || '';
      bookSelect.appendChild(opt);
    });

    bookSelect.addEventListener('change', () => {
      const selected = bookSelect.options[bookSelect.selectedIndex];
      if (!selected || !selected.value) {
        currentBookContext = null;
        currentBookId = null;
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

    if (books.length > 0) {
      bookSelect.value = books[0].id;
      bookSelect.dispatchEvent(new Event('change'));
    }
  } catch (e) {
    console.error('[reader.js] 加载 books.json 失败:', e);
  }
}