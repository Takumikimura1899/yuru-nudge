import { useEffect, useRef } from "react";
import type { ReactionKind } from "../../server/nudges";
import type { NudgeyMood } from "../NudgeySheep";
import ChatMessage from "./ChatMessage";
import HousekeepingCard from "./HousekeepingCard";
import NudgeCard from "./NudgeCard";
import ParentSuggestionCard from "./ParentSuggestionCard";
import ThinkingIndicator from "./ThinkingIndicator";
import type { ChatMessageData } from "./useChat";

export default function ChatTimeline({
  messages,
  thinking,
  mood,
  onReact,
  onKeep,
  onDiscard,
  onReviveParent,
  onDeclineParent,
}: {
  messages: ChatMessageData[];
  thinking: boolean;
  mood: NudgeyMood;
  onReact: (seedId: string, reaction: ReactionKind) => void;
  onKeep: (seedId: string) => void;
  onDiscard: (seedId: string) => void;
  onReviveParent: (messageId: string, parentSeedId: string) => void;
  onDeclineParent: (messageId: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bottomRef.current?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "end",
    });
  }, [messages.length, thinking]);

  if (messages.length === 0 && !thinking) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-2 text-[var(--sea-ink-soft)]">
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
                mood={mood}
                onReact={(reaction) => onReact(message.seedId, reaction)}
              />
            );
          case "housekeeping":
            return (
              <HousekeepingCard
                key={message.id}
                items={message.items}
                mood={mood}
                onKeep={onKeep}
                onDiscard={onDiscard}
              />
            );
          case "parentSuggestion":
            return (
              <ParentSuggestionCard
                key={message.id}
                parentTask={message.parentTask}
                status={message.status}
                mood={mood}
                onRevive={() => onReviveParent(message.id, message.parentSeedId)}
                onDecline={() => onDeclineParent(message.id)}
              />
            );
          case "text":
            return (
              <ChatMessage
                key={message.id}
                role={message.role}
                text={message.text}
                mood={mood}
                chip={message.chip}
              />
            );
        }
      })}
      {thinking && <ThinkingIndicator mood={mood} />}
      <div ref={bottomRef} aria-hidden />
    </ul>
  );
}
