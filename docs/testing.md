# テスト戦略

ゆるなっじでのテスト方針と実装パターン。
プロジェクト全体のテストの 4 つの柱・古典学派的方針は `~/.claude/CLAUDE.md` に書いてあるので、ここではそれを **このプロジェクトでどう適用するか** に絞る。

---

## 1. 基本方針（CLAUDE.md からの引き継ぎ要点）

| 柱                      | このプロジェクトでの優先度                                    |
| ----------------------- | ------------------------------------------------------------- |
| 1. 回帰に対する保護     | ◎ 高（壊れにくさが信頼の基礎）                                |
| 2. リファクタリング耐性 | ◎ 高（実装詳細を叩かず、振る舞いを叩く）                      |
| 3. 迅速なフィードバック | ○ そこそこ（Vite+ Vitest なら数百 ms。CI でも数秒で済むはず） |
| 4. 保守性               | ◎ 高（テストコードも実装と同じくらいレビューする）            |

**古典学派**：

- 振る舞いの単位（ユースケース・機能）でテストを書く
- 最終結果（戻り値、状態変化、外部出力）で検証
- **モックは外部依存（DB、外部 API）だけ**。内部クラスは実物を使う
- リファクタリング耐性を最大化するため、実装の中身は呼ばない

---

## 2. レイヤ別の戦略

### 2.1 単体テスト（ユニット）

**対象**：

- `src/server/middleware/*.ts` — request/function middleware
- `src/server/*.ts` — server fn のハンドラ部分
- ドメインロジック（Phase 2 以降の seed 選択、月次振り返り等）

**ツール**：Vitest（`vp test`、内部は `@voidzero-dev/vite-plus-test`）

**インポート規約**（重要）：

```ts
import { describe, expect, test, vi, beforeEach } from "vite-plus/test";
```

→ **`vitest` から直接 import しない**。Vite+ がラップしているため、生 vitest を入れたり import したりしない（[`AGENTS.md`](../AGENTS.md) 参照）。

**DB は必ずモック化**：

- 単体テストではインメモリ DB も使わない（DB 製品固有の挙動に依存し始めるとキリが無い）
- リポジトリ層的なクエリ構築の検証は、引数の検証で代替する
- 実 DB 動作は結合テスト（後述、現状未着手）で担保する

### 2.2 結合テスト（インテグレーション）

**対象**（将来）：

- Server fn → Kysely → 実 PostgreSQL の往復
- マイグレーションが期待通りスキーマを作るか
- 複数の middleware を chain したときの実挙動

**ツール候補**：Vitest の別 config で `supabase start` 済みのローカル DB に対して走らせる。

**現状**：未着手。Phase 2 で `mutterings` / `seeds` が増えたら導入を検討する。

### 2.3 ビジュアルリグレッション（VRT）

**対象**（将来）：

- ナッジー（SVG 羊）コンポーネントの 3 状態
- 主要画面の見た目

**ツール候補**：[`docs/design/detailed-design.md`](./design/detailed-design.md) の技術スタック通り **Storybook + reg-suit**。

**現状**：未着手。Phase 4（演出フェーズ）で導入する。

### 2.4 LLM 評価（LLM-as-judge）

**対象**（将来）：

- つぶやき分類の妥当性（seed / mood の分類精度）
- ナッジー応答の口調が NG ワード / トーンに違反していないか
- 未来予言の整合性

**ツール候補**：別 LLM にプロンプト＋出力を渡してスコアリング。

**現状**：未着手。Phase 2 終盤で導入を検討する。

---

## 3. 既存のテスト構成

### 3.1 ファイル一覧（Phase 1.5 時点）

```
src/server/middleware/
├── auth.ts
├── auth.test.ts        ← 13 ケース
├── session.ts
└── session.test.ts     ← 4 ケース
```

合計 17 ケース。`bun run test` で全部走る。

### 3.2 auth.test.ts のカバー範囲

| グループ                    | ケース数 | 内容                                               |
| --------------------------- | -------- | -------------------------------------------------- |
| Bearer ヘッダ               | 4        | 無し / 値違い / Bearer prefix なし / 正常          |
| app_session Cookie          | 4        | 値一致 / 他 Cookie 混在で一致 / 値違い / Cookie 空 |
| Cookie or Bearer の OR 判定 | 1        | Cookie 不一致でも Bearer 一致で通過                |
| HTTP 境界の判定             | 4        | pathname=/、/about、undefined、/\_serverFn/abc     |

### 3.3 session.test.ts のカバー範囲

| ケース                       | 内容                  |
| ---------------------------- | --------------------- |
| Cookie が無い                | Set-Cookie で発行する |
| 違う値の Cookie が来た       | 上書き発行する        |
| 既に正しい Cookie が来ている | 再発行しない          |
| 常に next() に委譲する       | 委譲確認              |

---

## 4. テストパターン

### 4.1 ファクトリ関数でテストデータを作る

ハードコードを避けて、デフォルト値 + 必要分だけオーバーライド：

```ts
const createMockProfile = (overrides = {}) => ({
  user_id: "test-user",
  intensity_level: "chill",
  created_at: new Date("2026-01-01"),
  ...overrides,
});

test("既存 profile を返す", async () => {
  const profile = createMockProfile({ intensity_level: "sharp" });
  // ...
});
```

### 4.2 module mock（env.ts のような副作用ある module）

`env.ts` はモジュール load 時に `process.env` を zod でバリデーションする。テストごとに異なる値を流したい：

```ts
import { describe, expect, test, vi } from "vite-plus/test";

vi.mock("../env", () => ({
  env: {
    API_SECRET_KEY: "test-secret",
    APP_USER_ID: "test-user",
  },
}));

const { authMiddleware } = await import("./auth");
```

> mock 宣言は import より上（vi.mock は hoisting される）。`await import()` でテスト対象を読むのは、mock を確実に効かせるため。

### 4.3 middleware の直接呼び出しでテスト

middleware は `createMiddleware().server(handler)` の形で、`.options.server` に handler 関数が入る：

```ts
const handler = authMiddleware.options.server!;

const next = vi.fn().mockResolvedValue({ context: {}, request: ..., pathname: "/" });
const result = await handler({ next, request, pathname: "/_serverFn/test", context: {} as never });

expect(next).toHaveBeenCalledWith({ context: { userId: "test-user" } });
```

middleware を **HTTP リクエスト経由** で叩くより、こうして関数として直接叩く方がテストとして安定する。

### 4.4 観測可能な結果で検証する

```ts
// △ よくない: 内部メソッドの呼び出し回数を検証
expect(authMiddleware.checkBearer).toHaveBeenCalled();

// ○ 良い: 結果（戻り値・next の呼ばれ方・throw）で検証
expect(result.status).toBe(401);
expect(next).not.toHaveBeenCalled();
```

実装の中身を変えても、振る舞いが同じならテストが落ちないように書く。

### 4.5 パラメータ化テスト

似たアサーションが並ぶときは `it.each` / `test.each` で集約：

```ts
test.each([
  ["Bearer wrong", 401],
  ["Bearer test-secret", 200],
  ["", 401],
])("Authorization='%s' は status=%d", async (auth, expectedStatus) => {
  // ...
});
```

---

## 5. テスト対象を選ぶ基準

書くテスト：

- 認証 / 認可（auth, session middleware） — セキュリティ
- 入力バリデーション（つぶやき 140 文字、status 値）— 不変条件
- ドメインロジック（seed 選択、棚卸し、mood ログ 30 件管理）— ビジネスルール
- LLM プロンプト構築（Phase 2）— 外部 API 呼び出しの引数

書かないテスト：

- React コンポーネントの細かい props（リファクタで簡単に壊れる）
- TanStack Router / Vite+ 自体（フレームワークを信頼する）
- DB 製品の挙動（Supabase / Postgres を信頼する）
- 自動生成コード（`db-types.ts`、`routeTree.gen.ts`）

---

## 6. テストの走らせ方

### 6.1 全部走らせる

```bash
bun run test
# = vp test run
```

### 6.2 特定ファイルだけ

```bash
bun run vp test run src/server/middleware/auth.test.ts
```

### 6.3 watch モード

```bash
bun run vp test
# run なしだと watch
```

### 6.4 pre-commit hook

`.vite-hooks/pre-commit` が `vp check --fix` を staged ファイルに対して走らせる。テスト自体は pre-commit で走らない（重いので意図的）。

---

## 7. CI でのテスト戦略（Phase 1.5 時点では未導入）

CI 導入時の想定：

```yaml
# .github/workflows/ci.yml の概念
- mise install # bun, supabase
- bun install
- supabase start # 結合テスト用に DB 起動（必要なら）
- bun run db:reset # 同上
- bun run check # fmt + lint + tsc
- bun run test # 単体テスト
- bun run build # ビルド確認
```

詳細は [`./deploy.md`](./deploy.md) §8 を参照。

---

## 8. アンチパターン

| やらないこと                                       | 理由                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `vitest` から直接 import                           | Vite+ がラップしているので生 vitest を呼ばない。`vite-plus/test` 経由にする |
| 単体テストで実 DB に繋ぐ                           | テスト間の独立性が壊れる、遅い、CI が複雑化                                 |
| 内部 helper の呼び出し回数を検証                   | リファクタで壊れる。観測可能な結果で検証                                    |
| ハードコードした big object をテストごとに繰り返す | ファクトリ関数にして overrides を渡す形に                                   |
| 1 つのテストで複数の振る舞いを検証                 | 失敗時に何が壊れたか分からなくなる。1 テスト 1 振る舞い                     |
| 「動いてるからテスト書かない」を恒常化             | 後で壊れたとき何が変わったか分からない。最低限ドメインルールはテストする    |
| LLM 出力をテストでバイナリ判定（==）               | LLM は確率的なので落ち続ける。LLM-as-judge やキーワードマッチで意味的に検証 |
