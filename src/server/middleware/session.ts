import { createMiddleware } from "@tanstack/react-start";
import { env } from "../env";
import { buildSessionCookie, readSessionCookie } from "./session-cookie";

export const sessionMiddleware = createMiddleware().server(async ({ next, request }) => {
  const result = await next();

  const existing = readSessionCookie(request.headers.get("cookie"));
  if (existing !== env.API_SECRET_KEY) {
    result.response.headers.append("Set-Cookie", buildSessionCookie(env.API_SECRET_KEY));
  }
  return result;
});
