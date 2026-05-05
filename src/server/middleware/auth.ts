import { createMiddleware } from "@tanstack/react-start";
import { env } from "../env";

export const authMiddleware = createMiddleware().server(async ({ next, request }) => {
  const header = request.headers.get("authorization");
  if (header !== `Bearer ${env.API_SECRET_KEY}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return next({ context: { userId: env.APP_USER_ID } });
});
