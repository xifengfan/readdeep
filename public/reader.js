// ================================================
// reader.js
// P2 读透 · 陪读室前端逻辑
// 用途：4 Agent Tab 切换 + 调 /api/chat + 历史滚动
// 模型：deepseek-v4-flash（后端默认）
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
let chatHistory = [];  // [{role, content}]
let currentBookId = null;  // 由 book.html 跳转时带过来

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
  // 1. 拿 bookId（从 URL hash 或 query）
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  currentBookId = params.get('book') || null;
  if (currentBookId) {
    console.log('[reader] 当前 bookId:', currentBookId);
  }

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

  // 4. 绑定发送按钮
  const sendBtn = document.getElementById('send-message');
  const input = document.getElementById('user-input');
  if (sendBtn && input) {
    sendBtn.addEventListener('click', () => sendMessage());
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
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
});

// ========== 加载 4 Agent 列表 ==========
async function loadAgentList() {
  try {
    const r = await fetch('/api/agents');
    const data = await r.json();
    if (data.ok) {
      console.log(`[reader] 加载 ${data.count} 个 Agent`, data.agents);
    }
  } catch (e) {
    console.warn('[reader] /api/agents 加载失败（后端可能未部署）：', e.message);
  }
}

// ========== 切换 Agent ==========
function switchAgent(agent) {
  if (!AGENT_NAME_MAP[agent]) {
    console.warn('[reader] 未知 agent:', agent);
    return;
  }
  currentAgent = agent;
  chatHistory = [];  // 切换 agent 时清空
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
  const input = document.getElementById('user-input');
  const stream = document.getElementById('chat-stream');
  if (!input || !stream) return;

  const text = input.value.trim();
  if (!text) return;

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
        agent: currentAgent,
        userMessage: text,
        history: chatHistory.slice(0, -1),  // 排除刚 push 的 userMessage
      }),
    });
    const data = await r.json();

    // 移除 loading
    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) loadingEl.remove();

    if (data.ok) {
      chatHistory.push({ role: 'assistant', content: data.reply });
      renderChat();
    } else {
      const errMsg = `[${data.code || 'ERROR'}] ${data.error || '未知错误'}`;
      addSystemMessage(errMsg, 'error');
      console.error('[reader] /api/chat 错误', data);
    }
  } catch (e) {
    const loadingEl = document.getElementById(loadingId);
    if (loadingEl) loadingEl.remove();
    addSystemMessage(`网络错误：${e.message}`, 'error');
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
