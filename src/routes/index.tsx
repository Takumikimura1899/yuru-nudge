import { createFileRoute } from "@tanstack/react-router";
import { getProfile } from "../server/profile";

export const Route = createFileRoute("/")({
  component: App,
  loader: async () => ({ profile: await getProfile() }),
});

function App() {
  const { profile } = Route.useLoaderData();
  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in rounded-[2rem] px-6 py-10 sm:px-10 sm:py-14">
        <p className="island-kicker mb-3">ゆるなっじ</p>
        <h1 className="display-title mb-5 text-4xl leading-[1.05] font-bold tracking-tight text-[var(--sea-ink)] sm:text-5xl">
          まだなにもないよ。
        </h1>
        <p className="mb-6 max-w-2xl text-base text-[var(--sea-ink-soft)] sm:text-lg">
          ナッジーはまだお散歩中。Phase 2 でこの場所につぶやきの入り口ができます。
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-[var(--sea-ink-soft)]">
          <dt className="font-semibold">user_id</dt>
          <dd className="font-mono">{profile.user_id}</dd>
          <dt className="font-semibold">intensity</dt>
          <dd className="font-mono">{profile.intensity_level}</dd>
        </dl>
      </section>
    </main>
  );
}
