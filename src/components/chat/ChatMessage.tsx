import type { ChatRole } from "./useChat";

export default function ChatMessage({ role, text }: { role: ChatRole; text: string }) {
  const isUser = role === "user";
  return (
    <li className={`rise-in flex items-end gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <span aria-hidden className="mb-1 text-xl">
          🐑
        </span>
      )}
      <p
        className={
          isUser
            ? "max-w-[75%] rounded-3xl rounded-br-md bg-[var(--lagoon)] px-4 py-2.5 text-sm leading-relaxed text-white shadow-[0_8px_22px_rgba(30,90,72,0.14)]"
            : "max-w-[75%] rounded-3xl rounded-bl-md border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2.5 text-sm leading-relaxed text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(30,90,72,0.08)]"
        }
      >
        {text}
      </p>
    </li>
  );
}
