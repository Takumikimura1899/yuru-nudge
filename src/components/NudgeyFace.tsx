import { SheepEars, SheepFace, SheepGlasses, SheepWool, type NudgeyMood } from "./nudgey/parts";

/**
 * チャット吹き出し用のミニ顔アバター（表示サイズ約28px想定）。左下常設のナッジー
 * （NudgeySheep）と同じパーツ・固定色を使い「同一人物」に見せる。跳ねアニメーションや
 * メガネ着脱の AnimatePresence は持たない静的コンポーネント（happy は表情変化のみ）。
 * viewBox は本体（0 0 120 120）と同じ座標系のまま、脚・牧草地を除いた上半身だけを
 * 切り出したもの。
 *
 * decorative=true のときは支援技術から読み上げられない装飾画像として描画する
 * （aria-hidden を付け、role/aria-label は出さない）。吹き出し本文にも同じ内容が
 * テキストで存在するチャット内アバター（NudgeyAvatar）向け。
 */
export default function NudgeyFace({
  mood,
  className,
  decorative = false,
}: {
  mood: NudgeyMood;
  className?: string;
  decorative?: boolean;
}) {
  const svgClassName = ["block", className].filter(Boolean).join(" ");
  const ariaProps = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": "ナッジー" } as const);

  return (
    <svg viewBox="24 10 72 78" {...ariaProps} className={svgClassName}>
      <SheepEars strokeWidth={2.5} />
      <SheepWool strokeWidth={2.5} />
      <SheepFace mood={mood} strokeWidth={2.5} happyFaceTestId="avatar-happy-face" />
      {mood === "sharp" && (
        <g data-testid="avatar-glasses">
          <SheepGlasses strokeWidth={2.5} />
        </g>
      )}
    </svg>
  );
}
