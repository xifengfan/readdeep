// ================================================
// src/agents.js
// P2 读透 · Worker 入口的 /api/agents 处理
// ================================================

import { AGENT_LIST } from './lib/agents.js';

export async function agentsHandler(request, env) {
  return new Response(JSON.stringify({
    ok: true,
    agents: AGENT_LIST,
    count: AGENT_LIST.length,
  }, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
