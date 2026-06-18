/**
 * P2-readdeep · Service Worker
 * 读透 ReadDeep · AI 陪读 PWA
 *
 * 作者：吕玲绮（Coder Agent）
 * 缓存版本：p2-cache-v9-20260618-fixsw  ← bump: D15.1 sw.js 加 try/catch 防御，让浏览器拉新 sw.js
 * 部署：Cloudflare Pages（静态）
 *
 * 缓存策略总览：
 *   - 5 个 HTML 入口      → 网络优先，失败回退缓存（内容会改）
 *   - JS/CSS 静态资源     → 缓存优先（不常改）
 *   - /data/books.json    → 网络优先，失败回退缓存（增书时要新）
 *   - /data/books/pd-*.md → 缓存优先（30 本固定）
 *   - /data/chapters/lunyu → 缓存优先（20 章固定）
 *   - /images/covers/**   → 缓存优先，按需填充（不预缓存 70+ 图）
 *   - /api/*              → 仅网络，永不缓存（永远要新数据）
 */

const CACHE_VERSION = 'p2-cache-v9-20260618-fixsw';

// 多个命名缓存，按资源类型隔离
// 原因：不同策略的资源放在同一缓存里，清理/调试都麻烦
const CACHES = {
  CORE:     `${CACHE_VERSION}-core`,      // 5 HTML + JS/CSS + manifest
  RUNTIME:  `${CACHE_VERSION}-runtime`,   // 数据文件（books.json / pd-*.md / lunyu）
  COVERS:   `${CACHE_VERSION}-covers`,    // 封面图（按需）
};

/**
 * 预缓存清单：保证 PWA 冷启动有壳
 * 不放图片：70+ 张封面会爆首次加载
 * 不放 30 本 pd-*.md：内容是按用户访问动态加载的
 * 不放 lunyu 20 章：同上
 * 不放 /api/*：仅网络
 */
const PRECACHE_URLS = [
  // 5 个 HTML 入口（manifest.json 的 start_url 是 library.html）
  '/',
  '/index.html',
  '/library.html',
  '/book.html',
  '/reader.html',
  '/workshop.html',
  // 关键静态资源
  '/app.js',
  '/reader.js',
  '/style.css',
  '/tokens.css',
  // manifest（standalone 启动需要）
  '/manifest.json',
  // books.json：让 library 离线也能看到书单
  '/data/books.json',
  // 关键图标（App 图标在 iOS/Android 启动时可能需要）
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ============================================================
// install：预缓存关键资源
// ============================================================
self.addEventListener('install', (event) => {
  console.log(`[SW ${CACHE_VERSION}] install`);
  event.waitUntil(
    caches.open(CACHES.CORE)
      .then((cache) => {
        console.log('[SW] 预缓存核心资源...');
        // addAll 是原子操作：任一失败全部回滚
        // 这是故意的——预缓存必须全成功，缺壳的 PWA 不可接受
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => {
        console.log('[SW] 预缓存完成');
        // 强制当前 SW 立即进入 activated 状态，跳过 waiting
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[SW] 预缓存失败:', err);
      })
  );
});

// ============================================================
// activate：清理旧版本缓存 + 接管页面
// ============================================================
self.addEventListener('activate', (event) => {
  console.log(`[SW ${CACHE_VERSION}] activate`);
  event.waitUntil(
    (async () => {
      // 1. 清理旧版本缓存
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => {
            // 保留当前版本的所有缓存，删除其他所有
            return !name.startsWith(CACHE_VERSION);
          })
          .map((name) => {
            console.log(`[SW] 删除旧缓存: ${name}`);
            return caches.delete(name);
          })
      );

      // 2. 立即接管所有未受控页面（不等刷新）
      await self.clients.claim();
      console.log('[SW] 已接管所有页面');
    })()
  );
});

// ============================================================
// fetch：路由分发
// ============================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 0. 只处理 GET 请求（POST/PUT 等不应被 SW 拦截）
  if (request.method !== 'GET') {
    return;
  }

  // 1. 跳过非同源请求（如 CDN、外链图床），让浏览器直接走网络
  //    P2-readdeep 部署在 Cloudflare Pages，单一 origin，所有资源都应同源
  if (url.origin !== self.location.origin) {
    return;
  }

  // 1.5 关键：navigate 请求拦截但带 fallback
  // 原因：wrangler dev --local 模式会 SPA fallback（307 重定向），
  //       SW 拦截后即使 redirect: 'follow' 仍会出 ERR_FAILED
  //       联网：网络优先，失败用缓存
  //       脱机：直接从缓存读 library.html（manifest 的 start_url）
  if (request.mode === 'navigate') {
    event.respondWith(navigateFallback(request));
    return;
  }

  // 2. /api/* → 仅网络，永不缓存（避坑关键）
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkOnly(request));
    return;
  }

  // 3. 5 个 HTML 入口 → network-only（v4 起不缓存）
  //    主公体验需要：每次刷新都拿到最新版
  //    HTML 才几 KB，不缓存完全 OK，APIs/数据另走 RUNTIME 缓存
  if (isHTMLEntry(url.pathname)) {
    event.respondWith(networkOnly(request));
    return;
  }

  // 4. /data/books.json → 网络优先，失败用缓存
  //    增书时要新，但离线时也要能看老书单
  if (url.pathname === '/data/books.json') {
    event.respondWith(cacheFirst(request, CACHES.RUNTIME));
    return;
  }

  // 5. /data/books/pd-*.md 和 /data/chapters/**/*.md → 缓存优先
  //    30 本书 + 20 章论语，内容固定，命中缓存秒开
  if (
    url.pathname.startsWith('/data/books/pd-') ||
    url.pathname.startsWith('/data/chapters/')
  ) {
    event.respondWith(cacheFirst(request, CACHES.RUNTIME));
    return;
  }

  // 6. /images/covers/** → 缓存优先（按需填充，dynamic cache）
  //    关键：不要在 install 时 addAll 70+ 张图，会爆首次加载
  if (url.pathname.startsWith('/images/covers/')) {
    event.respondWith(cacheFirst(request, CACHES.COVERS));
    return;
  }

  // 7. /icons/** → 缓存优先（图标基本不改）
  if (url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, CACHES.CORE));
    return;
  }

  // 8. JS/CSS 静态资源 → 缓存优先
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, CACHES.CORE));
    return;
  }

  // 9. 其他（manifest.json、favicon 等）→ 缓存优先
  event.respondWith(cacheFirst(request, CACHES.CORE));
});

// ============================================================
// 缓存策略实现
// ============================================================

/**
 * 网络优先 → 失败回退缓存
 * 适用：HTML 入口、books.json
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    // 显式指定 redirect: "follow"：避免 wrangler dev 307 重定向导致 SW 失败
    // 但保留原始 request 的 mode（navigate 请求必须以 navigate mode 处理）
    const networkResponse = await fetch(request, { redirect: 'follow', mode: request.mode });
    // 只缓存"非重定向"的 200 响应（避开 wrangler dev 307 redirect 响应被缓存后导致 SW 失败）
    if (networkResponse && networkResponse.ok && !networkResponse.redirected) {
      // 克隆一份再 cache.put：response body 是 stream，只能读一次
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    // 网络失败（离线/DNS 失败/超时）→ 用缓存
    console.warn(`[SW] 网络失败，回退缓存: ${request.url}`);
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    // 缓存也没有 → 返回友好错误页
    return offlineFallback(request);
  }
}

/**
 * 缓存优先 → 失败走网络
 * 适用：JS/CSS/MD/封面图
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    // 命中缓存 → 后台异步更新（stale-while-revalidate 思想）
    // 但本项目 SW 不强求 SWR，简单 cache-first 也够用
    return cachedResponse;
  }
  try {
    // 显式指定 redirect: "follow"：避免 wrangler dev 307 重定向导致 SW 失败
    // 但保留原始 request 的 mode（避免 navigate 请求被以 cors mode 处理）
    const networkResponse = await fetch(request, { redirect: 'follow', mode: request.mode });
    // 同样避开重定向响应被缓存（避免 SW 后续返回 307 给浏览器报 redirect mode 错误）
    if (networkResponse && networkResponse.ok && !networkResponse.redirected) {
      // 按需缓存：用户访问时才进 cache，不预热
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.warn(`[SW] 网络+缓存都失败: ${request.url}`);
    return offlineFallback(request);
  }
}

/**
 * 仅网络：用于 /api/* 和 5 个 HTML 入口
 * 失败直接抛错，不缓存、不回退
 *
 * D15.1 修复：包 try/catch 防御性兜底
 *  - 旧逻辑：fetch 失败抛 unhandled rejection，DevTools 红线
 *    `Uncaught (in promise) TypeError: Failed to fetch at networkOnly (sw.js:259:10)`
 *  - 新逻辑：fetch 失败返回 503 Response，调用方无需 try/catch 也能正常工作
 *  - 不改 fetch 策略（不缓存、不回退），仅补防御层
 */
async function networkOnly(request) {
  try {
    // 显式指定 redirect: "follow"：避免 wrangler dev 307 重定向导致 SW 失败
    // 但保留原始 request 的 mode
    return await fetch(request, { redirect: 'follow', mode: request.mode });
  } catch (err) {
    console.warn('[sw] networkOnly fetch failed:', request.url, err);
    return new Response('Offline', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

// ============================================================
// navigate 专用：联网走网络，脱机回退到 library.html
// 简单版：Python 服务器无重定向，无需处理
// 修复（D10 by 卧龙）：强制联网优先 + 缓存只用"裸路径"作 key
// 避免 query string（?id=xxx）导致缓存命中错误页
// ============================================================
async function navigateFallback(request) {
  const cache = await caches.open(CACHES.CORE);
  const url = new URL(request.url);

  // D14.6 撤销 D14.5 修复 C：恢复 v6 的"裸路径缓存 + 联网验证"逻辑
  //  - 背景：D14.5 修复 C 引入「带 query 直走 network」导致 reader.html?id=... 取不到 summary（页面被旧缓存卡住）
  //  - 正确做法：始终用「裸路径」作 cache key，fetch 用原 URL 带 query
  //  - 这样 context 依赖 URL 参数的页面（reader/workshop）既能命中缓存，又拿得到最新 HTML

  // 第 1 步：尝试从缓存拿该 URL（仅裸路径命中，忽略 query string）
  // 防止 ?id=xxx 命中了无 id 的 book.html 缓存
  const bareRequest = new Request(url.origin + url.pathname, { method: 'GET' });
  let cached = await cache.match(bareRequest);
  if (cached) {
    // 联网验证（如果失败才返回缓存）
    try {
      const networkResponse = await fetch(request, { redirect: 'follow', mode: 'navigate', cache: 'no-store' });
      if (networkResponse && networkResponse.ok) {
        cache.put(bareRequest, networkResponse.clone());
        return networkResponse;
      }
    } catch (_) { /* 走兜底 */ }
    return cached;
  }

  // 第 2 步：缓存没有，走网络
  try {
    const networkResponse = await fetch(request, { redirect: 'follow', mode: 'navigate' });
    if (networkResponse && networkResponse.ok) {
      cache.put(bareRequest, networkResponse.clone());
      return networkResponse;
    }
    throw new Error(`HTTP ${networkResponse ? networkResponse.status : 'no response'}`);
  } catch (err) {
    // 第 3 步：脱机或网络失败 → 回退到 library.html
    console.warn(`[SW] navigate 失败，回退缓存: ${request.url}, err: ${err.message}`);
    const fallback = await cache.match('/library.html') || await cache.match('./library.html');
    if (fallback) return fallback;
    return new Response(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>离线</title></head>' +
      '<body style="font-family:sans-serif;padding:40px;text-align:center;">' +
      '<h1>🚧 离线模式</h1>' +
      '<p>请联网后重试</p>' +
      '</body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 判断是否是 5 个 HTML 入口
 */
function isHTMLEntry(pathname) {
  return (
    pathname === '/' ||
    pathname === '/index.html' ||
    pathname === '/library.html' ||
    pathname === '/book.html' ||
    pathname === '/reader.html' ||
    pathname === '/workshop.html'
  );
}

/**
 * 判断是否是 JS/CSS 静态资源
 */
function isStaticAsset(pathname) {
  return /\.(js|css)$/.test(pathname);
}

/**
 * 离线兜底：返回一个友好的 JSON / HTML 错误响应
 * 避免 fetch reject 导致页面彻底崩溃
 */
async function offlineFallback(request) {
  const url = new URL(request.url);
  // 导航请求（HTML）→ 返回离线提示
  if (request.mode === 'navigate' || isHTMLEntry(url.pathname)) {
    const cache = await caches.open(CACHES.CORE);
    // 优先用 index.html 兜底（library.html 才是 PWA start_url）
    const fallback = await cache.match('./library.html')
                  || await cache.match('./index.html')
                  || await cache.match('./');
    if (fallback) {
      return fallback;
    }
    return new Response(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>离线</title></head>' +
      '<body style="font-family:sans-serif;padding:40px;text-align:center;">' +
      '<h1>🚧 当前离线</h1>' +
      '<p>读透的缓存未能命中，请联网后刷新。</p>' +
      '</body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
  // 其他资源（图片/MD/JSON）→ 返回空响应 + 503
  return new Response(
    JSON.stringify({ error: 'offline', message: '当前离线，资源未缓存' }),
    { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
  );
}

// ============================================================
// message：支持页面主动控制 SW（备用，预留给未来"清除缓存"按钮）
// ============================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n))))
        .then(() => event.source.postMessage({ type: 'CACHES_CLEARED' }))
    );
  }
});
