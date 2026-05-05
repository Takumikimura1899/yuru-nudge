import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("../env", () => ({
  env: {
    API_SECRET_KEY: "test-secret",
    APP_USER_ID: "test-user",
  },
}));

const { authMiddleware } = await import("./auth");

const handler = authMiddleware.options.server!;

const callMiddleware = (authorization?: string) => {
  const next = vi
    .fn()
    .mockResolvedValue({ context: {}, request: new Request("http://x"), pathname: "/" });
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  const request = new Request("http://localhost/_serverFn/test", { headers });
  return {
    next,
    result: handler({
      next,
      request,
      pathname: "/_serverFn/test",
      context: {} as never,
    }),
  };
};

describe("authMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("Bearer ヘッダがないと 401", async () => {
    const { next, result } = callMiddleware();
    const response = (await result) as Response;
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("Bearer の値が違うと 401", async () => {
    const { next, result } = callMiddleware("Bearer wrong");
    const response = (await result) as Response;
    expect(response.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("Bearer prefix がないと 401", async () => {
    const { next, result } = callMiddleware("test-secret");
    const response = (await result) as Response;
    expect(response.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("正しい Bearer なら next に userId を注入して通過", async () => {
    const { next } = callMiddleware("Bearer test-secret");
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith({ context: { userId: "test-user" } });
  });
});
