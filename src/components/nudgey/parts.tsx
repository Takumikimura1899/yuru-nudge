export type NudgeyMood = "chill" | "sharp" | "happy";

/**
 * ナッジー（羊）の SVG パーツ群。NudgeySheep（本体・跳ねアニメーション付き）と
 * NudgeyFace（チャット用ミニ顔アバター）の両方から参照される共有モジュール。
 * 色はすべて styles.css の --nudgey-* 固定値を参照し、テーマ（ライト/ダーク）に
 * 左右されないようにする。座標系は本体 viewBox="0 0 120 120" に揃えている。
 */

/** 耳（左右2つの楕円）。 */
export function SheepEars({ strokeWidth = 1.5 }: { strokeWidth?: number }) {
  return (
    <g fill="var(--nudgey-body)" stroke="var(--nudgey-line)" strokeWidth={strokeWidth}>
      <ellipse cx="26" cy="64" rx="8" ry="13" transform="rotate(-24 26 64)" />
      <ellipse cx="94" cy="64" rx="8" ry="13" transform="rotate(24 94 64)" />
    </g>
  );
}

/** ボディ（もこもこ雲＝楕円+円5個の集合）。 */
export function SheepWool({ strokeWidth = 1.5 }: { strokeWidth?: number }) {
  return (
    <g fill="var(--nudgey-body)" stroke="var(--nudgey-line)" strokeWidth={strokeWidth}>
      <ellipse cx="60" cy="58" rx="32" ry="24" />
      <circle cx="32" cy="50" r="14" />
      <circle cx="88" cy="50" r="14" />
      <circle cx="44" cy="32" r="15" />
      <circle cx="76" cy="32" r="15" />
      <circle cx="60" cy="27" r="16" />
    </g>
  );
}

/**
 * 顔（ベース楕円 + mood 別の表情）。strokeWidth は顔ベース楕円の線幅を指定する。
 * happy 口・鼻口はベースとの太さの比（+1 / +0.5）を保って追従させる
 * （デフォルト値 1.5 のとき、現行どおり happy 口 2.5・鼻口 2 になる）。
 */
export function SheepFace({
  mood,
  strokeWidth = 1.5,
  happyFaceTestId = "happy-face",
}: {
  mood: NudgeyMood;
  strokeWidth?: number;
  happyFaceTestId?: string;
}) {
  const isHappy = mood === "happy";

  return (
    <g>
      <ellipse
        cx="60"
        cy="68"
        rx="22"
        ry="17"
        fill="var(--nudgey-face)"
        stroke="var(--nudgey-line)"
        strokeWidth={strokeWidth}
      />

      {isHappy ? (
        <g data-testid={happyFaceTestId}>
          <g
            stroke="var(--nudgey-ink)"
            strokeWidth={strokeWidth + 1}
            strokeLinecap="round"
            fill="none"
          >
            <path d="M48 65 q4 6 8 0" />
            <path d="M64 65 q4 6 8 0" />
          </g>
          <g fill="var(--nudgey-cheek)" opacity="0.55">
            <circle cx="44" cy="74" r="4" />
            <circle cx="76" cy="74" r="4" />
          </g>
        </g>
      ) : (
        <g fill="var(--nudgey-ink)">
          <circle cx="52" cy="68" r="2.8" />
          <circle cx="68" cy="68" r="2.8" />
        </g>
      )}

      <path
        d="M56 78 q4 3 8 0"
        stroke="var(--nudgey-ink-soft)"
        strokeWidth={strokeWidth + 0.5}
        strokeLinecap="round"
        fill="none"
      />
    </g>
  );
}

/**
 * メガネ（レンズ2つ + ブリッジ + つる）。着脱アニメーションや data-testid は
 * 利用側（motion.g でラップする箇所）で付与する。
 */
export function SheepGlasses({ strokeWidth = 2 }: { strokeWidth?: number }) {
  return (
    <g stroke="var(--nudgey-ink)" strokeWidth={strokeWidth} strokeLinecap="round" fill="none">
      <circle cx="52" cy="68" r="7.5" fill="var(--nudgey-face)" fillOpacity="0.35" />
      <circle cx="68" cy="68" r="7.5" fill="var(--nudgey-face)" fillOpacity="0.35" />
      <line x1="59.5" y1="68" x2="60.5" y2="68" />
      <line x1="44.5" y1="65" x2="39" y2="61" />
      <line x1="75.5" y1="65" x2="81" y2="61" />
    </g>
  );
}
