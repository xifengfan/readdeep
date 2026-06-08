// ================================================
// api/agents.js
// P2 读透 · 4 Agent 列表端点
// 用途：前端 reader.html 加载时调用，渲染 4 Agent Tab
// ================================================

import { AGENT_LIST } from './lib/agents.js';

export async function onRequestGet() {
  return new Response(JSON.stringify({
    ok: true,
    agents: AGENT_LIST,
    count: AGENT_LIST.length,
  }, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
