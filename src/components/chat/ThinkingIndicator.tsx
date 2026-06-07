export default function ThinkingIndicator() {
  return (
    <li className="rise-in flex items-end gap-2">
      <span aria-hidden className="mb-1 text-xl">
        🐑
      </span>
      <p
        role="status"
        className="max-w-[75%] rounded-3xl rounded-bl-md border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--sea-ink-soft)] italic"
      >
        ナッジーが考え中…
      </p>
    </li>
  );
}
