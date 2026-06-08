// ================================================
// src/index.js
// P2 读透 · Cloudflare Workers 入口
// 架构：Workers + Workers Assets（static）
// 路由：
//   - /api/chat  → chatHandler
//   - /api/agents → agentsHandler
//   - 其他        → static asset (SPA fallback)
// 模型：deepseek-v4-flash
// ================================================

import { chatHandler } from './chat.js';
import { agentsHandler } from './agents.js';
import { workshopHandler } from './workshop.js';

// 静态资源兜底
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export default {
  /**
   * Worker fetch 入口
   * @param {Request} request
   * @param {object} env - Cloudflare bindings (DEEPSEEK_API_KEY, ASSETS)
   * @param {object} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    // API 路由
    if (pathname === '/api/chat') {
      return handleApi(chatHandler, request, env);
    }
    if (pathname === '/api/agents') {
      return handleApi(agentsHandler, request, env);
    }
    if (pathname === '/api/workshop') {
      return handleApi(workshopHandler, request, env);
    }
    if (pathname === '/api/debug') {
      // 临时调试：返回 import 状态
      const debugInfo = {
        ok: true,
        timestamp: Date.now(),
        imports: {
          chatHandler: typeof chatHandler,
          agentsHandler: typeof agentsHandler,
          workshopHandler: typeof workshopHandler,
        },
        staticImports: 'all loaded',
      };
      return new Response(JSON.stringify(debugInfo, null, 2), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
      });
    }
    if (pathname === '/api/health') {
      return new Response(JSON.stringify({
        ok: true,
        model: 'deepseek-v4-flash',
        agents: 4,
        ts: Date.now(),
      }, null, 2), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
      });
    }

    // 静态资源：用 Workers Assets (env.ASSETS) · 但 /api/ 路径必须走 handleApi
    if (env.ASSETS && !pathname.startsWith('/api/')) {
      try {
        // 尝试原路径
        const asset = await env.ASSETS.fetch(request);
        if (asset && asset.status !== 404) {
          return asset;
        }
        // SPA fallback 到 index.html
        const fallback = await env.ASSETS.fetch(new URL('/index.html', request.url));
        if (fallback && fallback.status === 200) {
          return new Response(fallback.body, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders() },
          });
        }
      } catch (e) {
        // 继续到 404
      }
    }

    // 404 兜底
    return new Response(JSON.stringify({
      ok: false,
      code: 'NOT_FOUND',
      path: pathname,
      hint: '静态资源在 public/，API 在 /api/*',
    }, null, 2), {
      status: 404,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
    });
  },
};

async function handleApi(handler, request, env) {
  try {
    const response = await handler(request, env);
    // 加 CORS
    const newHeaders = new Headers(response.headers);
    for (const [k, v] of Object.entries(corsHeaders())) {
      newHeaders.set(k, v);
    }
    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  } catch (e) {
    console.error('API handler error:', e);
    return new Response(JSON.stringify({
      ok: false,
      code: e.code || 'INTERNAL_ERROR',
      error: e.message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
    });
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
