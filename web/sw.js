/* Service Worker：把引擎运行时缓存到本地，二次访问（含离线）秒开。
 *
 * 策略（刻意最小化，别加戏）：
 * - 只处理**同源** GET /pyodide/* 的请求 —— 引擎的 wasm / stdlib / wheel，
 *   合计约 20MB，缓存一次就一直有效（内容按 ?v 不变，文件名固定）。
 * - cache-first：命中直接回；未命中拉网络并顺手写进缓存。
 * - 其它请求（页面本身、带 ?v 的 JS）一律不拦截，交给浏览器 HTTP 缓存。
 *
 * 注意：SW 只在 https（或 localhost）下生效；两个部署渠道都满足。
 */
const CACHE = "la-pyodide-v1";

self.addEventListener("install", () => {
  // 不做 precache：首访本来就是下载这些文件，运行时缓存即可。
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.includes("/pyodide/")) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const resp = await fetch(req);
      // 只缓存成功响应；sw.js 本身 / manifest.json 也走这里，没问题。
      if (resp && resp.ok) cache.put(req, resp.clone());
      return resp;
    }).catch(() => fetch(req))
  );
});
