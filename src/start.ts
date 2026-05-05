import { createStart } from "@tanstack/react-start";
import { sessionMiddleware } from "./server/middleware/session";

export const startInstance = createStart(() => ({
  requestMiddleware: [sessionMiddleware],
}));
