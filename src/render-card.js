// ================================================
// src/render-card.js
// P2 读透 · 单帧 PNG 渲染网关（D 方案·回退文本路径）
// 用途：把 workshop.html 小红书 share 模板的 6 帧 JSON 原本应转成 PNG；D 方案下只回吐文本
// 模型：不调 LLM
// 端点：POST /api/render-card
//   - 入参：{ card: { frame, type, title, subtitle?, text?, quote?, attribution?, imageQuery?, theme?, style? } }
//   - 出参：{ ok: true, frame: N, dataUri: null, fallback: 'text', textBody: '<文本>', note: '...' }
// 现状（D2-0-1 dogfooding 阶段）：PNG 渲染链路已禁用（CF Workers 无 OS 进程）
//   前端检测到 dataUri === null 即用 textBody 渲染降级 UI
//   D5+ 阶段：迁移到 Cloudflare Containers / Browser Rendering，再恢复 PNG 渲染
// ================================================

/**
 * D 方案·回退文本路径
 * 不再 spawn 子进程、不再写临时文件、不再调本地 Guizang 渲染器。
 * 直接把 card 的核心文本回吐给前端，前端用 .card-fallback 降级 UI 显示。
 * 接口签名 (request, env) 保持不变，路由层 /index.js 不用改。
 */
export async function renderCardHandler(request, env) {
  // GET 健康检查（保留，便于 wrangler dev 探活）
  if (request.method === 'GET') {
    return json({
      ok: true,
      endpoint: '/api/render-card',
      method: 'POST',
      mode: 'D-fallback',
      hint: 'D2-0-1 dogfooding 阶段：PNG 渲染已禁用，前端用 textBody 降级显示。POST { card: {...} }',
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, code: 'BAD_JSON', error: '请求体不是合法 JSON' }, 400);
  }

  const card = (body && body.card) || {};
  if (typeof card !== 'object' || Array.isArray(card)) {
    return json({ ok: false, code: 'MISSING_CARD', error: '缺少 card 字段或类型不正确' }, 400);
  }

  // 早期返回 fallback —— D2-0-1 dogfooding 阶段 PNG 渲染未启用
  // D5+ 启动 CF Container / Browser Rendering 后，此处替换为真实渲染调用
  const textBody = card.text || card.quote || card.subtitle || card.title || '';
  return json({
    ok: true,
    frame: Number(card.frame) || 1,
    dataUri: null,          // 关键：告诉前端用 fallback
    fallback: 'text',       // 关键：标识用文本降级
    textBody,
    note: 'D2-0-1 dogfooding 阶段 PNG 渲染已禁用·D5+ 启动 CF Container',
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
