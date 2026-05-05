export const SESSION_COOKIE_NAME = "app_session";

export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return null;
}

export function buildSessionCookie(value: string): string {
  return [
    `${SESSION_COOKIE_NAME}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=31536000",
  ].join("; ");
}
