import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("../env", () => ({
  env: {
    API_SECRET_KEY: "test-secret",
    APP_USER_ID: "test-user",
  },
}));

const { sessionMiddleware } = await import("./session");

const handler = sessionMiddleware.options.server!;

const runWith = async (cookie?: string) => {
  const headers = new Headers();
  if (cookie !== undefined) headers.set("cookie", cookie);
  const request = new Request("http://localhost/", { headers });
  const response = new Response("ok");
  const next = vi.fn().mockResolvedValue({
    context: {},
    request,
    pathname: "/",
    response,
  });
  const result = (await handler({
    next,
    request,
    pathname: "/",
    context: {} as never,
  })) as { response: Response };
  return { result, next };
};

describe("sessionMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("Cookie が無ければ Set-Cookie で発行する", async () => {
    const { result } = await runWith();
    const setCookie = result.response.headers.get("set-cookie");
    expect(setCookie).toMatch(/app_session=test-secret/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
  });

  test("値が違う Cookie が来たら上書き発行する", async () => {
    const { result } = await runWith("app_session=stale");
    const setCookie = result.response.headers.get("set-cookie");
    expect(setCookie).toMatch(/app_session=test-secret/);
  });

  test("既に正しい Cookie が来ていれば再発行しない", async () => {
    const { result } = await runWith("app_session=test-secret");
    expect(result.response.headers.get("set-cookie")).toBeNull();
  });

  test("常に next() に委譲する", async () => {
    const { next } = await runWith();
    expect(next).toHaveBeenCalledOnce();
  });
});
