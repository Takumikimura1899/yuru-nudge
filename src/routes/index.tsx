import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import ChatTimeline from "../components/chat/ChatTimeline";
import IntensityToggle from "../components/chat/IntensityToggle";
import MutterForm from "../components/chat/MutterForm";
import { toMessages, useChat } from "../components/chat/useChat";
import NudgeySheep, { type NudgeyMood } from "../components/NudgeySheep";
import { normalizeIntensity } from "../server/ai/constants";
import { getTimeline } from "../server/mutterings";
import { getProfile } from "../server/profile";

export const Route = createFileRoute("/")({
  component: App,
  // タネ袋シートからの手動ナッジ依頼は URL search param で受ける（設計書 §9.1）。シートは
  // Header（__root）配下でチャット状態と親子関係がなく、Context・イベントバス・lift は
  // 規約で導入禁止のため、Router の URL 状態を橋渡しに使う
  validateSearch: (search: Record<string, unknown>): { nudge?: "manual" } =>
    search.nudge === "manual" ? { nudge: "manual" } : {},
  loader: async () => {
    const [profile, timeline] = await Promise.all([getProfile(), getTimeline()]);
    return { profile, timeline };
  },
});

function App() {
  const { profile, timeline } = Route.useLoaderData();
  const {
    messages,
    intensity,
    thinking,
    celebrating,
    send,
    changeIntensity,
    react,
    keep,
    discard,
    reviveParent,
    declineParent,
    requestManualNudge,
  } = useChat({
    initialMessages: toMessages(timeline),
    initialIntensity: normalizeIntensity(profile.intensity_level),
  });

  const { nudge } = Route.useSearch();
  const navigate = useNavigate();
  // 手動ナッジ: param を検知したら1回だけサーバーへ依頼し、即座に URL から消す（リロードや
  // ブラウザバックでの再発火を防ぐ）。StrictMode の二重実行は ref でガードし、param が消えたら
  // リセットして次のボタン押下（再び param が付く）に備える
  const manualNudgeRequestedRef = useRef(false);
  useEffect(() => {
    if (nudge !== "manual") {
      manualNudgeRequestedRef.current = false;
      return;
    }
    if (manualNudgeRequestedRef.current) return;
    manualNudgeRequestedRef.current = true;
    void requestManualNudge();
    void navigate({ to: "/", search: {}, replace: true });
  }, [nudge]);

  const mood: NudgeyMood = celebrating ? "happy" : normalizeIntensity(intensity);

  return (
    <>
      <main className="page-wrap px-4 pb-8 pt-14">
        <section className="island-shell rise-in flex flex-col gap-6 rounded-[2rem] px-5 py-8 sm:px-8 sm:py-10">
          <div className="flex items-center justify-between gap-3">
            <p className="island-kicker m-0">ゆるなっじ</p>
            <IntensityToggle value={intensity} onChange={changeIntensity} />
          </div>

          <ChatTimeline
            messages={messages}
            thinking={thinking}
            mood={mood}
            onReact={react}
            onKeep={keep}
            onDiscard={discard}
            onReviveParent={reviveParent}
            onDeclineParent={declineParent}
          />

          <MutterForm onSend={send} busy={thinking} />
        </section>
      </main>

      <div className="pointer-events-none fixed bottom-20 left-3 z-10 w-16 sm:bottom-6 sm:left-6 sm:w-24">
        <NudgeySheep mood={mood} />
      </div>
    </>
  );
}
