import { useState, useRef } from "react";
import { z } from "zod";
import { PlayCommand, PlayerCharacter } from "@gestaloka/contracts";
import type { paths } from "@gestaloka/contracts/http";
import { $api, ApiFailure, pendingKey } from "./api.js";
import { usePending } from "./forms.js";
import { Button } from "./components/ui/button.js";
import { Textarea } from "./components/ui/textarea.js";
import { Notice, Problem } from "./presentation.js";
import { Characters } from "./player-icons.js";
import { RichText } from "./RichText.js";
import { History, type HistoryHandle } from "./History.js";
import { Link } from "@tanstack/react-router";

const TextNode = z.object({ text: z.string() }),
  Item = z.object({ label: z.string() });
const Material = z.object({
  node: TextNode.optional(),
  states: z.array(z.object({ node: TextNode })).optional(),
  interpretations: z.array(z.object({ node: TextNode })).optional(),
  locations: z.array(TextNode).optional(),
  subjects: z
    .array(
      z.object({
        id: z.string(),
        text: z.string(),
        contactAvailable: z.boolean(),
      }),
    )
    .optional(),
  items: z.array(Item).optional(),
  storages: z
    .array(z.object({ label: z.string(), items: z.array(Item) }))
    .optional(),
  skills: z.array(z.object({ text: z.string() })).optional(),
});
const View = z.object({
  sessionId: z.string().optional(),
  viewerId: z.string(),
  actorId: z.string().optional(),
  callsUsed: z.number().optional(),
  callsLimit: z.number().optional(),
  commentUsed: z.boolean().optional(),
  result: z.unknown().optional(),
  members: z
    .array(z.object({ actorId: z.string(), sceneId: z.string() }))
    .default([]),
  characters: z.array(PlayerCharacter).default([]),
  receiving: z
    .object({
      applicationId: z.string(),
      text: z.string().optional(),
      preview: z.array(z.string()).optional(),
      deadline: z.string(),
    })
    .nullable()
    .optional(),
  legacy: z
    .array(
      z.object({
        id: z.string(),
        payload: z.object({
          text: z.string().optional(),
          receipts: z.array(z.object({ text: z.string() })).optional(),
        }),
      }),
    )
    .default([]),
  entries: z
    .array(
      z.object({
        id: z.string(),
        payload: z.object({
          entries: z
            .array(
              z.object({
                actorId: z.string(),
                label: z.string().optional(),
                input: z.string(),
                result: z
                  .object({
                    state: z.string().optional(),
                    effectState: z.string().optional(),
                    outcome: z.object({ success: z.boolean() }).optional(),
                  })
                  .passthrough(),
              }),
            )
            .optional(),
          comment: z.string().optional(),
          reason: z.string().optional(),
          state: z.string().optional(),
        }),
      }),
    )
    .default([]),
});
function PersonalMaterial({
  value,
  contact,
  disabled,
}: {
  value: unknown;
  contact: (id: string) => void;
  disabled: boolean;
}) {
  const data = Material.parse(value);
  const texts = [
    data.node?.text,
    ...(data.states ?? []).map((x) => x.node.text),
    ...(data.interpretations ?? []).map((x) => x.node.text),
    ...(data.locations ?? []).map((x) => x.text),
    ...(data.items ?? []).map((x) => x.label),
    ...(data.storages ?? []).flatMap((x) => [
      x.label,
      ...x.items.map((i) => i.label),
    ]),
    ...(data.skills ?? []).map((x) => x.text),
  ].filter(Boolean);
  return (
    <details className="rounded-lg border bg-secondary p-4" open>
      <summary>自分への検索結果</summary>
      <p className="muted">
        検索した時点の情報です。セッションのチャットには共有されません。
      </p>
      {texts.map((text, i) => (
        <RichText key={i} text={text!} />
      ))}
      {data.subjects?.map((x) => (
        <div
          className="flex items-center justify-between gap-3 py-2"
          key={x.id}
        >
          <span>{x.text}</span>
          {x.contactAvailable && (
            <Button disabled={disabled} onClick={() => contact(x.id)}>
              接触する
            </Button>
          )}
        </div>
      ))}
    </details>
  );
}
export function BotSession({
  id,
  actorId,
  sceneId,
}: {
  id: string;
  actorId?: string;
  sceneId?: string;
}) {
  const [text, setText] = useState(""),
    [material, setMaterial] = useState<unknown>();
  const history = useRef<HistoryHandle>(null);
  const [pending, save] = usePending(
    pendingKey(`${id}:${actorId ?? "selected"}`, "bot-turn"),
    PlayCommand,
  );
  const query = $api.useQuery(
    "get",
    "/api/worlds/{id}/session",
    {
      params: {
        path: { id },
        query: {
          ...(actorId ? { actorId } : {}),
          ...(sceneId ? { sceneId } : {}),
        },
      },
    },
    { refetchInterval: 1000 },
  );
  const mutation = $api.useMutation("post", "/api/worlds/{id}/session"),
    view = query.data ? View.parse(query.data) : undefined;
  const send = async (raw?: Record<string, unknown>) => {
    const body =
      pending ?? PlayCommand.parse({ requestId: crypto.randomUUID(), ...raw });
    save(body);
    try {
      const result = await mutation.mutateAsync({
        params: { path: { id }, query: actorId ? { actorId } : {} },
        body: body as paths["/api/worlds/{id}/session"]["post"]["requestBody"]["content"]["application/json"],
      });
      save(null);
      if (body.command === "search") setMaterial(result.material);
      else if (body.command === "say" || body.command === "comment")
        setText((current) => (current === body.text ? "" : current));
      await query.refetch();
      history.current?.updated();
    } catch (error) {
      if (
        error instanceof ApiFailure &&
        error.status >= 400 &&
        error.status < 500
      )
        save(null);
    }
  };
  if (query.error) return <Problem error={query.error} />;
  if (!view) return <Notice>セッションを読み込んでいます</Notice>;
  const mine = view.actorId === view.viewerId,
    busy = mutation.isPending || pending !== null,
    archive =
      !!sceneId &&
      sceneId !==
        view.members.find((m) => m.actorId === view.viewerId)?.sceneId;
  return (
    <section className="space-y-6" aria-label="セッション">
      <div className="page-title">
        <h1>
          {view.sessionId
            ? `${view.members.length}人のセッション`
            : view.result
              ? "本人のシーンを終了しました"
              : "セッションを始める"}
        </h1>
        <Characters characters={view.characters} />
      </div>
      {mutation.error && <Problem error={mutation.error} />}
      {pending && !mutation.isPending && (
        <Button onClick={() => void send()}>保存した同じ要求で確認する</Button>
      )}
      <details className="initial-setting">
        <summary>本人のこれまでの履歴</summary>
        <History id={id} role="player" viewer={view.viewerId} ref={history} />
      </details>
      <div className="space-y-4" aria-label="セッションのチャット">
        {view.entries.map((row) => (
          <article className="rounded-lg border bg-card px-6 py-5" key={row.id}>
            {row.payload.entries?.map((entry, i) => (
              <div key={i}>
                <p className="record-meta">
                  {entry.label ??
                    view.characters.find((c) => c.actorId === entry.actorId)
                      ?.name ??
                    "参加者"}
                </p>
                <RichText text={entry.input} />
                <p className="muted">
                  結果：
                  {entry.result.outcome
                    ? entry.result.outcome.success
                      ? (entry.result.effectState ?? "成立しました")
                      : "不成立でした"
                    : entry.result.state === "rejected"
                      ? "拒否しました"
                      : entry.result.state === "failed"
                        ? "成立しませんでした"
                        : entry.result.state === "receiving"
                          ? "受領判断中です"
                          : entry.result?.state === "pending"
                            ? "管理者の許可待ちです"
                            : "受理しました"}
                </p>
              </div>
            ))}
            {row.payload.comment && (
              <p>ターンコメント：{row.payload.comment}</p>
            )}
            {row.payload.reason && <p>{row.payload.reason}</p>}
          </article>
        ))}
      </div>
      {view.legacy.length > 0 && sceneId && (
        <details className="initial-setting" open={archive}>
          <summary>引き継いだシーンの記録</summary>
          <History
            id={id}
            role="player"
            viewer={view.viewerId}
            sceneId={sceneId}
            sceneKind="events"
            ref={null}
          />
          <History
            id={id}
            role="player"
            viewer={view.viewerId}
            sceneId={sceneId}
            sceneKind="actions"
            ref={null}
          />
        </details>
      )}
      {archive ? (
        <Link
          to="/worlds/$id/play"
          params={{ id }}
          search={{ actorId: view.viewerId }}
          className="text-link"
        >
          現在のセッションを開く
        </Link>
      ) : !view.sessionId ? (
        <Button disabled={busy} onClick={() => void send({ command: "start" })}>
          セッションを開始
        </Button>
      ) : (
        <>
          <Notice>
            {mine
              ? "あなたの手番です"
              : `${view.characters.find((c) => c.actorId === view.actorId)?.name ?? "相手"}の手番を待っています`}
            （通常API {view.callsUsed} / {view.callsLimit}回）
          </Notice>
          {mine && !view.receiving && (
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={busy}
                onClick={() =>
                  void send({
                    command: "search",
                    query: { kind: "surroundings" },
                  })
                }
              >
                周囲を見る
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void send({
                    command: "search",
                    query: { kind: "belongings" },
                  })
                }
              >
                持ち物・保管先・技能
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void send({ command: "search", query: { kind: "self" } })
                }
              >
                自分の情報
              </Button>
            </div>
          )}
          {material !== undefined && (
            <PersonalMaterial
              value={material}
              disabled={busy || !mine || !!view.receiving}
              contact={(targetId) =>
                void send({ command: "contact", targetId })
              }
            />
          )}
          {view.receiving && mine && (
            <section className="space-y-3">
              <RichText text={view.receiving.text ?? "受領判断"} />
              {view.receiving.preview?.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              <p>
                受領判断の期限：
                {new Date(view.receiving.deadline).toLocaleString()}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void send({
                      command: "receive",
                      applicationId: view.receiving!.applicationId,
                      accept: true,
                    })
                  }
                >
                  受け入れる
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void send({
                      command: "receive",
                      applicationId: view.receiving!.applicationId,
                      accept: false,
                    })
                  }
                >
                  拒否する
                </Button>
              </div>
            </section>
          )}
          {mine && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send({ command: "say", text });
              }}
            >
              <label>
                {view.receiving ? "ターンコメント" : "発言・ターンコメント"}
                <Textarea
                  aria-label={
                    view.receiving ? "ターンコメント" : "発言・ターンコメント"
                  }
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-3">
                {!view.receiving && (
                  <Button type="submit" disabled={busy || !text.trim()}>
                    発言する
                  </Button>
                )}
                <Button
                  type="button"
                  disabled={busy || !text.trim() || view.commentUsed}
                  onClick={() => void send({ command: "comment", text })}
                >
                  ターンコメントを付ける
                </Button>
                {!view.receiving && (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => void send({ command: "end-turn" })}
                  >
                    手番を終える
                  </Button>
                )}
              </div>
            </form>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={busy}
              onClick={() => void send({ command: "leave" })}
            >
              分離して続ける
            </Button>
            <Button
              disabled={busy}
              onClick={() => void send({ command: "finish" })}
            >
              本人のシーンを終了
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
