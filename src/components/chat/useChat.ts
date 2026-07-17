import { useEffect, useRef, useState } from "react";
import { FALLBACK_REPLY } from "../../server/ai/constants";
import {
  postDiscard,
  postReaction,
  postReviveParent,
  resolveNudge,
  type ReactionKind,
} from "../../server/nudges";
import { postMutter } from "../../server/mutterings";
import { updateIntensity } from "../../server/profile";
import { PARENT_SUGGESTION_LABELS, REACTION_LABELS } from "./reactions";

export type ChatRole = "user" | "nudgey";

export type NudgeStatus = "idle" | "sending" | "resolved";

export type HousekeepingRowStatus = "idle" | "discarding";

export type HousekeepingRow = {
  seedId: string;
  task: string;
  status: HousekeepingRowStatus;
};

export type ChatMessageData =
  | { kind: "text"; id: string; role: ChatRole; text: string }
  | {
      kind: "nudge";
      id: string;
      seedId: string;
      prophecy: string;
      status: NudgeStatus;
    }
  | { kind: "housekeeping"; id: string; items: HousekeepingRow[] }
  | {
      kind: "parentSuggestion";
      id: string;
      parentSeedId: string;
      parentTask: string;
      status: NudgeStatus;
    };

export type Intensity = "chill" | "sharp";

type TimelineRow = {
  id: string;
  content: string;
  reply: string | null;
};

/** 棚卸しの全行処理後にカードを置き換える締めのメッセージ */
const HOUSEKEEPING_DONE_REPLY = "じゃあ今回はここまでにするね〜。また気になったら教えてね";

/** 親タスクの再提案で「今はいいや」を選んだ際の静的応答（server fn を呼ばずクライアント完結するため） */
const PARENT_DECLINED_REPLY = "そっか、また気が向いたら教えてね";

/** タイムライン行（1件 = 1往復）をチャット表示用メッセージに展開する */
export function toMessages(rows: TimelineRow[]): ChatMessageData[] {
  return rows.flatMap((row) => [
    { kind: "text" as const, id: `${row.id}-user`, role: "user" as const, text: row.content },
    ...(row.reply
      ? [{ kind: "text" as const, id: row.id, role: "nudgey" as const, text: row.reply }]
      : []),
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
  const [reactingSeedId, setReactingSeedId] = useState<string | null>(null);
  const nudgeResolvedRef = useRef(false);

  // 起動時のナッジ状態解決（タイムアウト archive・新規ナッジ生成の副作用あり）は
  // StrictMode の二重 mount や再レンダーでも1回だけ呼ぶ
  useEffect(() => {
    if (nudgeResolvedRef.current) return;
    nudgeResolvedRef.current = true;

    void (async () => {
      try {
        const resolution = await resolveNudge();
        if (resolution.kind === "nudge") {
          setMessages((prev) => [
            ...prev,
            {
              kind: "nudge",
              id: resolution.seed.seedId,
              seedId: resolution.seed.seedId,
              prophecy: resolution.seed.prophecy,
              status: "idle",
            },
          ]);
        } else if (resolution.kind === "housekeeping") {
          setMessages((prev) => [
            ...prev,
            {
              kind: "housekeeping",
              id: crypto.randomUUID(),
              items: resolution.items.map((item) => ({
                seedId: item.seedId,
                task: item.task,
                status: "idle" as const,
              })),
            },
          ]);
        } else if (resolution.kind === "review") {
          setMessages((prev) => [
            ...prev,
            { kind: "text", id: crypto.randomUUID(), role: "nudgey", text: resolution.reply },
          ]);
        }
      } catch (error) {
        console.error("resolveNudge failed", error);
      }
    })();
  }, []);

  async function send(content: string): Promise<boolean> {
    if (thinking) return false;
    setThinking(true);
    const optimisticId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { kind: "text", id: optimisticId, role: "user", text: content },
    ]);

    try {
      const result = await postMutter({ data: { content } });
      if (result.ok) {
        setMessages((prev) => [
          ...prev,
          {
            kind: "text",
            id: result.muttering.id,
            role: "nudgey",
            text: result.muttering.reply ?? "",
          },
        ]);
        return true;
      }
      // 未保存のため楽観表示を取り消し、キャラ内エラーだけを残す（入力はフォームに復元）
      pushNudgeyErrorInsteadOfUserMessage(optimisticId, result.reply);
      return false;
    } catch {
      pushNudgeyErrorInsteadOfUserMessage(optimisticId, FALLBACK_REPLY);
      return false;
    } finally {
      setThinking(false);
    }
  }

  /**
   * 楽観表示していたユーザーバブルを取り消し、ナッジーのエラー応答に置き換える。
   * in-flight 中に react()/discard() 等が別のバブルを追加しうるため、末尾要素ではなく
   * 対象の id を filter で除去する（末尾前提だと他の非同期処理が挟まった際に誤削除しうる）。
   */
  function pushNudgeyErrorInsteadOfUserMessage(optimisticId: string, reply: string) {
    setMessages((prev) => [
      ...prev.filter((message) => message.id !== optimisticId),
      { kind: "text", id: crypto.randomUUID(), role: "nudgey", text: reply },
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

  /**
   * nudged タスクへの反応（やったよ/難しい/いらない）を送信する。
   * in-flight は高々1件（送信中は全反応ボタンを disable）。
   */
  async function react(seedId: string, reaction: ReactionKind) {
    if (reactingSeedId) return;
    setReactingSeedId(seedId);

    const optimisticId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev.map((message) =>
        message.kind === "nudge" && message.seedId === seedId
          ? { ...message, status: "sending" as const }
          : message,
      ),
      { kind: "text", id: optimisticId, role: "user", text: REACTION_LABELS[reaction] },
    ]);

    try {
      const result = await postReaction({ data: { seedId, reaction } });
      if (result.ok) {
        setMessages((prev) => {
          const resolved = prev.map((message) =>
            message.kind === "nudge" && message.seedId === seedId
              ? { ...message, status: "resolved" as const }
              : message,
          );
          // alreadyReacted は応答バブルなしでボタン無効化のみ
          if (result.alreadyReacted) return resolved;
          const replyBubble: ChatMessageData = {
            kind: "text",
            id: crypto.randomUUID(),
            role: "nudgey",
            text: result.reply,
          };
          if (!result.parentSuggestion) {
            return [...resolved, replyBubble];
          }
          // 答え合わせバブルと再提案カードは同一 setMessages 内で atomic に append する
          const parentCard: ChatMessageData = {
            kind: "parentSuggestion",
            id: crypto.randomUUID(),
            parentSeedId: result.parentSuggestion.parentSeedId,
            parentTask: result.parentSuggestion.parentTask,
            status: "idle",
          };
          return [...resolved, replyBubble, parentCard];
        });
      } else {
        rollbackReaction(seedId, optimisticId, result.reply);
      }
    } catch {
      rollbackReaction(seedId, optimisticId, FALLBACK_REPLY);
    } finally {
      setReactingSeedId(null);
    }
  }

  /** 反応の失敗時、楽観バブルを取り消してエラー応答を出し、ナッジカードは操作可能に戻す */
  function rollbackReaction(seedId: string, optimisticId: string, reply: string) {
    setMessages((prev) => [
      ...prev
        .filter((message) => message.id !== optimisticId)
        .map((message) =>
          message.kind === "nudge" && message.seedId === seedId
            ? { ...message, status: "idle" as const }
            : message,
        ),
      { kind: "text", id: crypto.randomUUID(), role: "nudgey", text: reply },
    ]);
  }

  /** 棚卸しで「気になってる」（keep）を選んだ行をクライアント側だけで消す（server fn は呼ばない） */
  function keep(seedId: string) {
    removeHousekeepingRow(seedId);
  }

  /** 棚卸しで「もういいや」を選んだ行を破棄する。連打防止に行単位で disable する */
  async function discard(seedId: string) {
    setHousekeepingRowStatus(seedId, "discarding");

    try {
      const result = await postDiscard({ data: { seedId } });
      if (result.ok) {
        removeHousekeepingRow(seedId);
      } else {
        // 競合で対象が既に pending でなかった等。行は消さず操作可能な状態に戻す
        setHousekeepingRowStatus(seedId, "idle");
      }
    } catch {
      setHousekeepingRowStatus(seedId, "idle");
    }
  }

  function setHousekeepingRowStatus(seedId: string, status: HousekeepingRowStatus) {
    setMessages((prev) =>
      prev.map((message) =>
        message.kind === "housekeeping"
          ? {
              ...message,
              items: message.items.map((item) =>
                item.seedId === seedId ? { ...item, status } : item,
              ),
            }
          : message,
      ),
    );
  }

  /** 行を消し、全行処理済みになったカードは締めのメッセージに置き換える */
  function removeHousekeepingRow(seedId: string) {
    setMessages((prev) =>
      prev.flatMap((message): ChatMessageData[] => {
        if (message.kind !== "housekeeping") return [message];
        const items = message.items.filter((item) => item.seedId !== seedId);
        if (items.length > 0) return [{ ...message, items }];
        return [
          {
            kind: "text" as const,
            id: message.id,
            role: "nudgey" as const,
            text: HOUSEKEEPING_DONE_REPLY,
          },
        ];
      }),
    );
  }

  /**
   * 親タスクの再提案カードで「やってみる」を選んだときの処理。react() と同型（in-flight ガード共用・
   * 楽観バブル・失敗時ロールバック）だが、カードの状態更新・ロールバックは messageId（カードの id）
   * スコープで行う。parentSeedId は server fn 呼び出しにのみ使い、カードの特定には使わない
   * （parentSeedId で特定すると、将来カードが複数共存したときに別カードまで誤って再活性しうるため）。
   */
  async function reviveParent(messageId: string, parentSeedId: string) {
    if (reactingSeedId) return;
    setReactingSeedId(messageId);

    const optimisticId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev.map((message) =>
        message.kind === "parentSuggestion" && message.id === messageId
          ? { ...message, status: "sending" as const }
          : message,
      ),
      { kind: "text", id: optimisticId, role: "user", text: PARENT_SUGGESTION_LABELS.revive },
    ]);

    try {
      const result = await postReviveParent({ data: { parentSeedId } });
      if (result.ok) {
        setMessages((prev) => {
          const resolved = prev.map((message) =>
            message.kind === "parentSuggestion" && message.id === messageId
              ? { ...message, status: "resolved" as const }
              : message,
          );
          // alreadyReacted は応答バブルなしでボタン無効化のみ
          if (result.alreadyReacted) return resolved;
          return [
            ...resolved,
            { kind: "text", id: crypto.randomUUID(), role: "nudgey", text: result.reply },
          ];
        });
      } else {
        rollbackParentSuggestion(messageId, optimisticId, result.reply);
      }
    } catch {
      rollbackParentSuggestion(messageId, optimisticId, FALLBACK_REPLY);
    } finally {
      setReactingSeedId(null);
    }
  }

  /** 再提案の失敗時、楽観バブルを取り消してエラー応答を出し、カードは操作可能に戻す */
  function rollbackParentSuggestion(messageId: string, optimisticId: string, reply: string) {
    setMessages((prev) => [
      ...prev
        .filter((message) => message.id !== optimisticId)
        .map((message) =>
          message.kind === "parentSuggestion" && message.id === messageId
            ? { ...message, status: "idle" as const }
            : message,
        ),
      { kind: "text", id: crypto.randomUUID(), role: "nudgey", text: reply },
    ]);
  }

  /**
   * 親タスクの再提案カードで「今はいいや」を選んだときの処理。棚卸しの keep と同じく server fn は呼ばず
   * クライアント完結する（設計書 §3.4「自動復帰ではない」。No は親を softened のまま据え置くだけでよい）
   */
  function declineParent(messageId: string) {
    setMessages((prev) => [
      ...prev.map((message) =>
        message.kind === "parentSuggestion" && message.id === messageId
          ? { ...message, status: "resolved" as const }
          : message,
      ),
      {
        kind: "text",
        id: crypto.randomUUID(),
        role: "user",
        text: PARENT_SUGGESTION_LABELS.decline,
      },
      { kind: "text", id: crypto.randomUUID(), role: "nudgey", text: PARENT_DECLINED_REPLY },
    ]);
  }

  return {
    messages,
    intensity,
    thinking,
    reactingSeedId,
    send,
    changeIntensity,
    react,
    keep,
    discard,
    reviveParent,
    declineParent,
  };
}
