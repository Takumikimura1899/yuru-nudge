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
      let cache;
      try {
        cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) return cached;
      } catch (error) {
        // キャッシュ層の障害時は cache 未取得のまま素通し（SW なしと同じ挙動に縮退）
        console.warn("[sw] cache read failed", error);
      }

      // try の外に置き、fetch 失敗はそのまま伝播させる（オフライン時に catch で
      // 再 fetch すると二重フェッチになるため）
      const res = await fetch(request);

      if (cache) {
        const contentType = res.headers.get("content-type") || "";
        if (res.ok && !res.redirected && !contentType.includes("text/html")) {
          // 書き込み失敗（クォータ超過等）で成功済みレスポンスの返却を巻き込まない
          const putPromise = cache.put(request, res.clone()).catch(() => {});
          try {
            event.waitUntil(putPromise);
          } catch {
            // 一部ブラウザ（旧 iOS Safari / WebView）は await 後の waitUntil 呼び出しで
            // InvalidStateError を投げる。取得済みレスポンスの返却を妨げないよう握りつぶす
          }
        }
      }

      return res;
    })(),
  );
});
