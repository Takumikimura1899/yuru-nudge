import { SheepEars, SheepFace, SheepGlasses, SheepWool, type NudgeyMood } from "./nudgey/parts";

/**
 * チャット吹き出し用のミニ顔アバター（表示サイズ約28px想定）。左下常設のナッジー
 * （NudgeySheep）と同じパーツ・固定色を使い「同一人物」に見せる。跳ねアニメーションや
 * メガネ着脱の AnimatePresence は持たない静的コンポーネント（happy は表情変化のみ）。
 * viewBox は本体（0 0 120 120）と同じ座標系のまま、脚・牧草地を除いた上半身だけを
 * 切り出したもの。範囲は stroke の張り出し込みで耳・毛が欠けない正方形
 * （x: 15.7〜104.3, y: 9.8〜86.3 を含む 90×90。表示先の h-7 w-7 と比率が一致）。
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
    <svg viewBox="15 3 90 90" {...ariaProps} className={svgClassName}>
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
