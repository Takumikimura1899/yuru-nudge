import { createMiddleware } from "@tanstack/react-start";
import { env } from "../env";
import { readSessionCookie } from "./session-cookie";

const SERVER_FN_PATH_PREFIX = "/_serverFn/";

export const authMiddleware = createMiddleware().server(async ({ next, request, pathname }) => {
  // SSR ページ描画 / loader からの直接呼び出しは HTTP 境界を越えないため auth を要求しない。
  // HTTP 経由の server fn 呼び出し（クライアントナビゲーションや外部クライアント）のみ検証する。
  // pathname が undefined のケースは TanStack Start が server-side 直接呼び出し時に発生するため、
  // 「HTTP 境界に達していない」と見なす。
  const isHttpServerFnCall = pathname?.startsWith(SERVER_FN_PATH_PREFIX) ?? false;
  if (!isHttpServerFnCall) {
    return next({ context: { userId: env.APP_USER_ID } });
  }

  const session = readSessionCookie(request.headers.get("cookie"));
  const header = request.headers.get("authorization");
  const okCookie = session !== null && session === env.API_SECRET_KEY;
  const okBearer = header === `Bearer ${env.API_SECRET_KEY}`;

  if (!okCookie && !okBearer) {
    return new Response("Unauthorized", { status: 401 });
  }
  return next({ context: { userId: env.APP_USER_ID } });
});
