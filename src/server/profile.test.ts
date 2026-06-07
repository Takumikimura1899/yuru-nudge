import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { Kysely } from "kysely";
import type { DB } from "./db-types";

vi.mock("./env", () => ({
  env: {
    APP_USER_ID: "test-user",
    API_SECRET_KEY: "test-secret",
    DATABASE_URL: "postgresql://test",
  },
}));

const { setIntensity, updateIntensityInput } = await import("./profile");

const createMockProfile = (overrides = {}) => ({
  user_id: "test-user",
  intensity_level: "sharp",
  created_at: new Date("2026-06-07T00:00:00Z"),
  ...overrides,
});

const createMockDb = () => {
  const db: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["updateTable", "set", "where", "returningAll"]) {
    db[method] = vi.fn().mockReturnThis();
  }
  db.executeTakeFirstOrThrow = vi.fn();
  return db;
};

const asDb = (db: ReturnType<typeof createMockDb>) => db as unknown as Kysely<DB>;

describe("updateIntensityInput（バリデーション）", () => {
  test.each(["chill", "sharp"] as const)("%s を受理する", (intensity) => {
    expect(updateIntensityInput.parse({ intensity })).toEqual({ intensity });
  });

  test.each([
    { name: "未知の値", intensity: "loud" },
    { name: "空文字", intensity: "" },
  ])("$name は拒否する", ({ intensity }) => {
    expect(() => updateIntensityInput.parse({ intensity })).toThrow();
  });
});

describe("setIntensity", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  test("対象ユーザーの intensity_level を更新し、更新後の行を返す", async () => {
    const updated = createMockProfile({ intensity_level: "sharp" });
    db.executeTakeFirstOrThrow.mockResolvedValue(updated);

    const result = await setIntensity(asDb(db), {
      userId: "test-user",
      intensity: "sharp",
    });

    expect(result).toEqual(updated);
    expect(db.updateTable).toHaveBeenCalledWith("profiles");
    expect(db.set).toHaveBeenCalledWith({ intensity_level: "sharp" });
    expect(db.where).toHaveBeenCalledWith("user_id", "=", "test-user");
  });
});
