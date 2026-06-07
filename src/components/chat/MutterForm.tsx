import { useState } from "react";
import { MAX_CONTENT_LENGTH } from "../../server/ai/constants";

export default function MutterForm({
  onSend,
  busy,
}: {
  onSend: (content: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [content, setContent] = useState("");
  const remaining = MAX_CONTENT_LENGTH - content.length;
  const canSend = content.trim().length > 0 && remaining >= 0 && !busy;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSend) return;
    const sent = await onSend(content.trim());
    if (sent) setContent("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={2}
        placeholder="つぶやいてみる…"
        aria-label="つぶやき"
        className="w-full resize-none rounded-2xl border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3 text-sm text-[var(--sea-ink)] placeholder:text-[var(--sea-ink-soft)] focus:border-[var(--lagoon)] focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <span
          className={`text-xs ${remaining < 0 ? "font-semibold text-red-500" : "text-[var(--sea-ink-soft)]"}`}
        >
          あと{remaining}文字
        </span>
        <button
          type="submit"
          disabled={!canSend}
          className="rounded-full bg-[var(--lagoon)] px-5 py-2 text-sm font-semibold text-white shadow-[0_8px_22px_rgba(30,90,72,0.14)] transition hover:-translate-y-0.5 hover:bg-[var(--lagoon-deep)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
        >
          つぶやく
        </button>
      </div>
    </form>
  );
}
