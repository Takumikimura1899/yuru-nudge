import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("../env", () => ({
  env: {
    API_SECRET_KEY: "test-secret",
    APP_USER_ID: "test-user",
  },
}));

const { authMiddleware } = await import("./auth");

const handler = authMiddleware.options.server!;

const callMiddleware = (headers: Record<string, string>) => {
  const next = vi
    .fn()
    .mockResolvedValue({ context: {}, request: new Request("http://x"), pathname: "/" });
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

  describe("Bearer ヘッダ", () => {
    test("無いと 401", async () => {
      const { next, result } = callMiddleware({});
      const response = (await result) as Response;
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    test("値が違うと 401", async () => {
      const { next, result } = callMiddleware({ authorization: "Bearer wrong" });
      expect(((await result) as Response).status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    test("Bearer prefix がないと 401", async () => {
      const { next, result } = callMiddleware({ authorization: "test-secret" });
      expect(((await result) as Response).status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    test("正しい値なら通過", async () => {
      const { next } = callMiddleware({ authorization: "Bearer test-secret" });
      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith({ context: { userId: "test-user" } });
    });
  });

  describe("app_session Cookie", () => {
    test("値が一致すれば通過", async () => {
      const { next } = callMiddleware({ cookie: "app_session=test-secret" });
      expect(next).toHaveBeenCalledOnce();
      expect(next).toHaveBeenCalledWith({ context: { userId: "test-user" } });
    });

    test("他の Cookie に紛れていても通過", async () => {
      const { next } = callMiddleware({
        cookie: "foo=bar; app_session=test-secret; baz=qux",
      });
      expect(next).toHaveBeenCalledOnce();
    });

    test("値が違うと 401", async () => {
      const { next, result } = callMiddleware({ cookie: "app_session=wrong" });
      expect(((await result) as Response).status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    test("Cookie が空だと 401", async () => {
      const { next, result } = callMiddleware({ cookie: "" });
      expect(((await result) as Response).status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  test("Cookie と Bearer どちらか一方が正しければ通過", async () => {
    const { next } = callMiddleware({
      cookie: "app_session=wrong",
      authorization: "Bearer test-secret",
    });
    expect(next).toHaveBeenCalledOnce();
  });
});
