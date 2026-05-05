import { createMiddleware } from "@tanstack/react-start";
import { env } from "../env";
import { readSessionCookie } from "./session-cookie";

export const authMiddleware = createMiddleware().server(async ({ next, request }) => {
  const session = readSessionCookie(request.headers.get("cookie"));
  const header = request.headers.get("authorization");

  const okCookie = session !== null && session === env.API_SECRET_KEY;
  const okBearer = header === `Bearer ${env.API_SECRET_KEY}`;

  if (!okCookie && !okBearer) {
    return new Response("Unauthorized", { status: 401 });
  }
  return next({ context: { userId: env.APP_USER_ID } });
});
