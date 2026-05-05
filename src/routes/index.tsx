import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: App });

function App() {
  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in rounded-[2rem] px-6 py-10 sm:px-10 sm:py-14">
        <p className="island-kicker mb-3">ゆるなっじ</p>
        <h1 className="display-title mb-5 text-4xl leading-[1.05] font-bold tracking-tight text-[var(--sea-ink)] sm:text-5xl">
          まだなにもないよ。
        </h1>
        <p className="m-0 max-w-2xl text-base text-[var(--sea-ink-soft)] sm:text-lg">
          ナッジーはまだお散歩中。Phase 2 でこの場所につぶやきの入り口ができます。
        </p>
      </section>
    </main>
  );
}
