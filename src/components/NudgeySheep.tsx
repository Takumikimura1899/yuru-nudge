export type NudgeyMood = "chill" | "sharp" | "happy";

/**
 * 画面下部に固定表示するナッジー（羊）のマスコット。設計書 §8.6 の3状態を
 * 1つの SVG 内の条件付き <g> で切り替える（通常/Sharpはメガネ、Happyは表情変化のみで
 * ボディ・牧草地は常に同じ）。
 */
export default function NudgeySheep({ mood, className }: { mood: NudgeyMood; className?: string }) {
  const isSharp = mood === "sharp";
  const isHappy = mood === "happy";

  return (
    <svg
      viewBox="0 0 120 120"
      role="img"
      aria-label="ナッジー"
      className={["block h-auto w-full", className].filter(Boolean).join(" ")}
    >
      {/* 牧草地（常時描画・固定） */}
      <g>
        <ellipse cx="60" cy="104" rx="54" ry="9" fill="var(--sand)" />
        <g stroke="var(--palm)" strokeWidth="2" strokeLinecap="round" fill="none">
          <path d="M20 103 q2 -8 4 0" />
          <path d="M36 105 q2 -8 4 0" />
          <path d="M60 106 q2 -8 4 0" />
          <path d="M84 105 q2 -8 4 0" />
          <path d="M99 103 q2 -8 4 0" />
        </g>
      </g>

      {/* 脚（常時描画） */}
      <g fill="var(--sea-ink-soft)">
        <rect x="34" y="80" width="8" height="16" rx="4" />
        <rect x="50" y="84" width="8" height="16" rx="4" />
        <rect x="64" y="84" width="8" height="16" rx="4" />
        <rect x="80" y="80" width="8" height="16" rx="4" />
      </g>

      {/* 耳（常時描画） */}
      <g fill="var(--chip-bg)" stroke="var(--line)" strokeWidth="1.5">
        <ellipse cx="26" cy="64" rx="8" ry="13" transform="rotate(-24 26 64)" />
        <ellipse cx="94" cy="64" rx="8" ry="13" transform="rotate(24 94 64)" />
      </g>

      {/* ボディ（もこもこ雲＝円の集合。常時描画） */}
      <g fill="var(--chip-bg)" stroke="var(--line)" strokeWidth="1.5">
        <ellipse cx="60" cy="58" rx="32" ry="24" />
        <circle cx="32" cy="50" r="14" />
        <circle cx="88" cy="50" r="14" />
        <circle cx="44" cy="32" r="15" />
        <circle cx="76" cy="32" r="15" />
        <circle cx="60" cy="27" r="16" />
      </g>

      {/* 顔（常時描画・パーツのみ mood で切替） */}
      <g>
        <ellipse
          cx="60"
          cy="68"
          rx="22"
          ry="17"
          fill="var(--foam)"
          stroke="var(--line)"
          strokeWidth="1.5"
        />

        {isHappy ? (
          <g data-testid="happy-face">
            <g stroke="var(--sea-ink)" strokeWidth="2.5" strokeLinecap="round" fill="none">
              <path d="M48 65 q4 6 8 0" />
              <path d="M64 65 q4 6 8 0" />
            </g>
            <g fill="var(--lagoon)" opacity="0.55">
              <circle cx="44" cy="74" r="4" />
              <circle cx="76" cy="74" r="4" />
            </g>
          </g>
        ) : (
          <g fill="var(--sea-ink)">
            <circle cx="52" cy="68" r="2.8" />
            <circle cx="68" cy="68" r="2.8" />
          </g>
        )}

        <path
          d="M56 78 q4 3 8 0"
          stroke="var(--sea-ink-soft)"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      </g>

      {/* メガネ（sharp のときだけ） */}
      {isSharp && (
        <g
          data-testid="glasses"
          stroke="var(--sea-ink)"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        >
          <circle cx="52" cy="68" r="7.5" fill="var(--foam)" fillOpacity="0.35" />
          <circle cx="68" cy="68" r="7.5" fill="var(--foam)" fillOpacity="0.35" />
          <line x1="59.5" y1="68" x2="60.5" y2="68" />
          <line x1="44.5" y1="65" x2="39" y2="61" />
          <line x1="75.5" y1="65" x2="81" y2="61" />
        </g>
      )}
    </svg>
  );
}
