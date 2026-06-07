import { createFileRoute } from "@tanstack/react-router";
import ChatTimeline from "../components/chat/ChatTimeline";
import IntensityToggle from "../components/chat/IntensityToggle";
import MutterForm from "../components/chat/MutterForm";
import { toMessages, useChat, type Intensity } from "../components/chat/useChat";
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
  const { messages, intensity, thinking, send, changeIntensity } = useChat({
    initialMessages: toMessages(timeline),
    initialIntensity: profile.intensity_level === "sharp" ? "sharp" : ("chill" as Intensity),
  });

  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in flex flex-col gap-6 rounded-[2rem] px-5 py-8 sm:px-8 sm:py-10">
        <div className="flex items-center justify-between gap-3">
          <p className="island-kicker m-0">ゆるなっじ</p>
          <IntensityToggle value={intensity} onChange={changeIntensity} />
        </div>

        <ChatTimeline messages={messages} thinking={thinking} />

        <MutterForm onSend={send} busy={thinking} />
      </section>
    </main>
  );
}
