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
import { renderCardHandler } from './render-card.js';
import { summaryHandler } from './summary.js';
import { composeHandler } from './compose.js';
import { WorkshopTaskDO } from './queue.js';

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

// D8-2 · 暴露 DO 类（wrangler.toml 已声明 binding=GENERATION_QUEUE）
export { WorkshopTaskDO };

export default {
  /**
   * Worker fetch 入口
   * @param {Request} request
   * @param {object} env - Cloudflare bindings (DEEPSEEK_API_KEY, ASSETS, GENERATION_QUEUE)
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
    // D8-2 · 异步任务查状态（前端轮询用）
    // 路径：/api/workshop/status?taskId=xxx
    if (pathname === '/api/workshop/status') {
      return handleWorkshopStatus(request, env);
    }
    if (pathname === '/api/render-card') {
      return handleApi(renderCardHandler, request, env);
    }
    // D14.1 · 4 Agent 对话小结生成（替代旧 thinking-questions）
    if (pathname === '/api/summary') {
      return handleApi(summaryHandler, request, env);
    }
    // D14.2 · 画师/金句捕手 创作模式（基于对话生成作品，不改主对话）
    if (pathname === '/api/compose') {
      return handleApi(composeHandler, request, env);
    }
    if (false && pathname === '/api/debug') {
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
      console.log('[v4-2050] asset request: ' + pathname);
      try {
        // v4-2050: 直接拼 .html 后缀，绕开 assets binding 的 SPA 307 redirect
        // 这样我们的 overrideHTMLCacheControl 能真正控制响应头
        let asset;
        const p = pathname.split('?')[0];
        if (p === '/' || htmlRoutes.has(p + '.html')) {
          const realPath = p === '/' ? '/index.html' : p + '.html';
          const realRequest = new Request(
            new URL(realPath + (request.url.includes('?') ? request.url.substring(request.url.indexOf('?')) : ''), request.url),
            request
          );
          asset = await env.ASSETS.fetch(realRequest);
        } else {
          asset = await env.ASSETS.fetch(request);
        }
        console.log('[v4-2050] asset response: ' + pathname + ' status=' + (asset ? asset.status : 'null'));
        if (asset && asset.status !== 404) {
          // v4-2050: HTML 永远拿最新版（D12.15 主公反馈切页面要强制刷新）
          if (isHTMLPath(pathname)) {
            console.log('[v4-2050] HIT override for: ' + pathname);
            return overrideHTMLCacheControl(asset);
          }
          return asset;
        }
        // SPA fallback 到 index.html
        const fallback = await env.ASSETS.fetch(new URL('/index.html', request.url));
        if (fallback && fallback.status === 200) {
          return new Response(fallback.body, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store',  // v4-2050: SPA fallback HTML 也 no-store
              ...corsHeaders(),
            },
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

/**
 * D8-2 · 异步任务状态查询
 * 前端 GET /api/workshop/status?taskId=xxx → 转给对应 DO 实例
 */
async function handleWorkshopStatus(request, env) {
  const url = new URL(request.url);
  const taskId = url.searchParams.get('taskId');
  if (!taskId) {
    return new Response(JSON.stringify({ ok: false, code: 'MISSING_TASK_ID', error: 'taskId 不能为空' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
    });
  }
  if (!env.GENERATION_QUEUE) {
    return new Response(JSON.stringify({ ok: false, code: 'NO_DO_BINDING', error: 'GENERATION_QUEUE DO 未配置' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
    });
  }
  // 用 taskId 作为 DO name（每个任务一个 DO 实例）
  const id = env.GENERATION_QUEUE.idFromName(taskId);
  const stub = env.GENERATION_QUEUE.get(id);
  return stub.fetch(new Request('https://do/status', { method: 'GET' }));
}

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

// v4-2050: HTML 路径识别
const htmlRoutes = new Set(['/index.html', '/library.html', '/reader.html', '/book.html', '/workshop.html']);
function isHTMLPath(pathname) {
  if (!pathname) return false;
  const p = pathname.split('?')[0];
  return (
    p === '/' ||
    p.endsWith('.html') ||
    p.endsWith('.htm') ||
    htmlRoutes.has(p)
  );
}

// v4-2050: 覆盖 HTML 响应头，强制 no-store
function overrideHTMLCacheControl(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Cache-Control', 'no-store');
  newHeaders.set('Pragma', 'no-cache');
  newHeaders.set('X-P2-Override', 'no-store-v4');  // 调试标志
  console.log('[v4-2050] HTML cache override: ' + response.headers.get('Cache-Control') + ' -> no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
