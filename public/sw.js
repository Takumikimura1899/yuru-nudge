// 静的アセット（/assets/ 配下）のみを cache-first でキャッシュする最小 Service Worker。
// ナビゲーションと /assets/ 以外の non-GET・クロスオリジンリクエストには respondWith を
// 一切呼ばない（Cloudflare Access のログイン 302 フローに一切介入しないため）。
//
// 運用ルール: このファイルを変更したら CACHE_NAME をバンプすること
// （旧キャッシュは activate で自動削除される）。
const CACHE_NAME = "yuru-nudge-static-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/assets/")) return;

  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) return cached;

        const res = await fetch(request);
        const contentType = res.headers.get("content-type") || "";
        if (res.ok && !res.redirected && !contentType.includes("text/html")) {
          // 書き込み失敗（クォータ超過等）で成功済みレスポンスの返却を巻き込まない
          event.waitUntil(cache.put(request, res.clone()).catch(() => {}));
        }
        return res;
      } catch {
        // キャッシュ層の障害時は素通し（SW なしと同じ挙動に縮退）
        return fetch(request);
      }
    })(),
  );
});
