import type { NudgeyMood } from "../NudgeySheep";
import ClassificationChip from "./ClassificationChip";
import { NUDGEY_BUBBLE_CLASS, NudgeyAvatar } from "./ChatCard";
import type { ChatRole, ClassificationChip as ClassificationChipData } from "./useChat";

export default function ChatMessage({
  role,
  text,
  mood,
  chip,
}: {
  role: ChatRole;
  text: string;
  mood: NudgeyMood;
  chip?: ClassificationChipData;
}) {
  const isUser = role === "user";
  if (isUser) {
    return (
      <li className="rise-in flex items-end gap-2 justify-end">
        <p className="max-w-[75%] rounded-3xl rounded-br-md bg-[var(--lagoon)] px-4 py-2.5 text-sm leading-relaxed text-white shadow-[0_8px_22px_rgba(30,90,72,0.14)]">
          {text}
        </p>
      </li>
    );
  }
  return (
    <li className="rise-in flex items-end gap-2 justify-start">
      <NudgeyAvatar mood={mood} />
      <div className="flex max-w-[75%] flex-col gap-1">
        <p className={NUDGEY_BUBBLE_CLASS}>{text}</p>
        {chip && <ClassificationChip category={chip.category} task={chip.task} />}
      </div>
    </li>
  );
}
