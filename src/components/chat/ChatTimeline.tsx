import { useEffect, useRef } from "react";
import type { ReactionKind } from "../../server/nudges";
import ChatMessage from "./ChatMessage";
import HousekeepingCard from "./HousekeepingCard";
import NudgeCard from "./NudgeCard";
import ThinkingIndicator from "./ThinkingIndicator";
import type { ChatMessageData } from "./useChat";

export default function ChatTimeline({
  messages,
  thinking,
  onReact,
  onKeep,
  onDiscard,
}: {
  messages: ChatMessageData[];
  thinking: boolean;
  onReact: (seedId: string, reaction: ReactionKind) => void;
  onKeep: (seedId: string) => void;
  onDiscard: (seedId: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, thinking]);

  if (messages.length === 0 && !thinking) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-[var(--sea-ink-soft)]">
        <span aria-hidden className="text-4xl">
          🐑
        </span>
        <p className="text-sm">ナッジーは牧草地でのんびりしてるよ</p>
      </div>
    );
  }

  return (
    <ul className="m-0 flex min-h-64 list-none flex-col gap-3 p-0">
      {messages.map((message) => {
        switch (message.kind) {
          case "nudge":
            return (
              <NudgeCard
                key={message.id}
                prophecy={message.prophecy}
                status={message.status}
                onReact={(reaction) => onReact(message.seedId, reaction)}
              />
            );
          case "housekeeping":
            return (
              <HousekeepingCard
                key={message.id}
                items={message.items}
                onKeep={onKeep}
                onDiscard={onDiscard}
              />
            );
          case "text":
            return <ChatMessage key={message.id} role={message.role} text={message.text} />;
        }
      })}
      {thinking && <ThinkingIndicator />}
      <div ref={bottomRef} aria-hidden />
    </ul>
  );
}
