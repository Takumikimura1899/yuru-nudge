import { useState } from "react";
import { FALLBACK_REPLY } from "../../server/ai/constants";
import { postMutter } from "../../server/mutterings";
import { updateIntensity } from "../../server/profile";

export type ChatRole = "user" | "nudgey";

export type ChatMessageData = {
  id: string;
  role: ChatRole;
  text: string;
};

export type Intensity = "chill" | "sharp";

type TimelineRow = {
  id: string;
  content: string;
  reply: string | null;
};

/** タイムライン行（1件 = 1往復）をチャット表示用メッセージに展開する */
export function toMessages(rows: TimelineRow[]): ChatMessageData[] {
  return rows.flatMap((row) => [
    { id: `${row.id}-user`, role: "user" as const, text: row.content },
    ...(row.reply ? [{ id: row.id, role: "nudgey" as const, text: row.reply }] : []),
  ]);
}

/**
 * チャット画面の状態管理フック。
 * 送信成功時のみ true を返す（フォーム側は true のときだけ入力をクリアする）。
 * LLM 失敗時はユーザー発言の楽観表示を取り消し、ナッジーのキャラ内エラーだけを残す。
 */
export function useChat(init: { initialMessages: ChatMessageData[]; initialIntensity: Intensity }) {
  const [messages, setMessages] = useState(init.initialMessages);
  const [intensity, setIntensity] = useState(init.initialIntensity);
  const [thinking, setThinking] = useState(false);

  async function send(content: string): Promise<boolean> {
    if (thinking) return false;
    setThinking(true);
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text: content }]);

    try {
      const result = await postMutter({ data: { content } });
      if (result.ok) {
        setMessages((prev) => [
          ...prev,
          { id: result.muttering.id, role: "nudgey", text: result.muttering.reply ?? "" },
        ]);
        return true;
      }
      // 未保存のため楽観表示を取り消し、キャラ内エラーだけを残す（入力はフォームに復元）
      pushNudgeyErrorInsteadOfUserMessage(result.reply);
      return false;
    } catch {
      pushNudgeyErrorInsteadOfUserMessage(FALLBACK_REPLY);
      return false;
    } finally {
      setThinking(false);
    }
  }

  function pushNudgeyErrorInsteadOfUserMessage(reply: string) {
    setMessages((prev) => [
      ...prev.slice(0, -1),
      { id: crypto.randomUUID(), role: "nudgey", text: reply },
    ]);
  }

  async function changeIntensity(next: Intensity) {
    const previous = intensity;
    setIntensity(next);
    try {
      await updateIntensity({ data: { intensity: next } });
    } catch {
      setIntensity(previous);
    }
  }

  return { messages, intensity, thinking, send, changeIntensity };
}
