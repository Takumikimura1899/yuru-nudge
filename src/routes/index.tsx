import { createFileRoute } from "@tanstack/react-router";
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
  } = useChat({
    initialMessages: toMessages(timeline),
    initialIntensity: normalizeIntensity(profile.intensity_level),
  });

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
