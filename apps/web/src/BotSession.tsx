import { useLayoutEffect, useState, useRef } from "react";
import { ArrowDownToLine, ArrowUpToLine } from "lucide-react";
import { z } from "zod";
import {
  ItemOutcome,
  PlayCommand,
  PlayerCharacter,
} from "@gestaloka/contracts";
import type { paths } from "@gestaloka/contracts/http";
import { $api, ApiFailure, pendingKey } from "./api.js";
import { usePending } from "./forms.js";
import { Button } from "./components/ui/button.js";
import { Textarea } from "./components/ui/textarea.js";
import { Notice, Problem } from "./presentation.js";
import { PlayCommandEditor } from "./PlayCommandEditor.js";
import { PlayApplications } from "./PlayApplications.js";
import { RichText } from "./RichText.js";
import { History, type HistoryHandle } from "./History.js";
import { Link } from "@tanstack/react-router";
import {
  Belongings,
  itemText,
  PlayLayout,
  PlayerPanel,
  PlayScreen,
  realTime,
  ScenePanel,
} from "./play-panels.js";

const TextNode = z.object({ text: z.string() });
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
  belongings: Belongings.optional(),
});
const SearchResult = z.object({
  material: Material,
  appearanceText: z.string().optional(),
  arriving: z
    .array(z.object({ items: Belongings.shape.items, dueAt: z.iso.datetime() }))
    .optional(),
});
const View = z.object({
  sessionId: z.string().optional(),
  viewerId: z.string(),
  aiControlled: z.boolean().optional(),
  actorId: z.string().nullish(),
  turnStartedAt: z.string().optional(),
  screen: PlayScreen,
  dailySp: z
    .object({
      remaining: z.number(),
      limit: z.number(),
      resetsAt: z.iso.datetime(),
    })
    .optional(),
  callsUsed: z.number().optional(),
  callsLimit: z.number().optional(),
  unreadNotices: z.number().optional(),
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
        recordedAt: z.string().nullish(),
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
                    items: z.array(ItemOutcome).optional(),
                    outcome: z.object({ success: z.boolean() }).optional(),
                  })
                  .passthrough(),
              }),
            )
            .optional(),
          comment: z.string().optional(),
          reason: z.string().optional(),
          state: z.string().optional(),
          transition: z
            .object({ at: z.string(), message: z.string() })
            .optional(),
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
  const {
    material: data,
    appearanceText,
    arriving,
  } = SearchResult.parse(value);
  const texts = [
    data.node?.text,
    ...(data.states ?? []).map((x) => x.node.text),
    ...(data.interpretations ?? []).map((x) => x.node.text),
    ...(data.locations ?? []).map((x) => x.text),
    data.belongings?.capacity &&
      `手持ちの使用枠 ${data.belongings.capacity.usedSlots}/${data.belongings.capacity.limitSlots}`,
    ...(data.belongings?.items ?? []).map(itemText),
    ...(data.belongings?.storages ?? []).flatMap((x) => [
      x.capacity
        ? `${x.label}（使用枠 ${x.capacity.usedSlots}/${x.capacity.limitSlots}）`
        : x.label,
      ...x.items.map(itemText),
    ]),
    ...(data.belongings?.skills ?? []).map((x) => x.text),
  ].filter(Boolean);
  return (
    <details className="rounded-lg border bg-secondary p-4" open>
      <summary>自分への検索結果</summary>
      <p className="muted">
        {appearanceText
          ? "検索素材は本人にだけ表示されます。出現の描写はセッションのチャットにも表示されます。"
          : "検索した時点の情報です。セッションのチャットには共有されません。"}
      </p>
      {appearanceText && <RichText text={appearanceText} />}
      {texts.map((text, i) => (
        <RichText key={i} text={text!} />
      ))}
      {!!arriving?.length && (
        <section className="mt-3">
          <h3>届く予定</h3>
          <ul className="play-list">
            {arriving.map(({ items, dueAt }, i) => (
              <li key={i}>
                {items.map(itemText).join("、")}（
                <time dateTime={dueAt}>{realTime(dueAt)}</time>）
              </li>
            ))}
          </ul>
        </section>
      )}
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
    [searchResult, setSearchResult] = useState<unknown>();
  const history = useRef<HistoryHandle>(null);
  const editorRequest = useRef<string>(null);
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(!sceneId);
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
          view: "screen",
          ...(actorId ? { actorId } : {}),
          ...(sceneId ? { sceneId } : {}),
        },
      },
    },
    { refetchInterval: 1000 },
  );
  const mutation = $api.useMutation("post", "/api/worlds/{id}/session"),
    view = query.data ? View.parse(query.data) : undefined;
  // 取得時に既読になるため、プレイヤーが通知を読む操作で取得する。
  const waiting = $api.useMutation("post", "/api/worlds/{id}/waiting");
  const notices = $api.useMutation("get", "/api/worlds/{id}/notices", {
    onSuccess: () => void query.refetch(),
  });
  const newest = view?.entries.at(-1)?.id;
  useLayoutEffect(() => {
    if (newest && follow.current && log.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [newest]);
  const execute = async (body: z.infer<typeof PlayCommand>) => {
    save(body);
    try {
      const result = await mutation.mutateAsync({
        params: { path: { id }, query: actorId ? { actorId } : {} },
        body: body as paths["/api/worlds/{id}/session"]["post"]["requestBody"]["content"]["application/json"],
      });
      save(null);
      if (
        body.command === "search" &&
        (body.query.kind === "self" || body.query.kind === "surroundings")
      )
        setSearchResult(result.material === undefined ? undefined : result);
      else if (
        editorRequest.current !== body.requestId &&
        (body.command === "say" || body.command === "comment")
      )
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
  const send = (raw?: Record<string, unknown>) =>
    execute(
      pending ?? PlayCommand.parse({ ...raw, requestId: crypto.randomUUID() }),
    );
  if (query.error) return <Problem error={query.error} />;
  if (!view) return <Notice>セッションを読み込んでいます</Notice>;
  const unreadNotices = view.unreadNotices ?? 0;
  const readNotices = () => {
    if (!notices.isPending)
      notices.mutate({
        params: { path: { id }, query: { actorId: view.viewerId } },
      });
  };
  const personName = (id: string) =>
    view.characters.find((c) => c.actorId === id)?.name ?? id;
  const mine = view.actorId === view.viewerId,
    busy = mutation.isPending || pending !== null,
    archive =
      !!sceneId &&
      sceneId !==
        view.members.find((m) => m.actorId === view.viewerId)?.sceneId;
  const player = view.characters.find(
    ({ actorId }) => actorId === view.viewerId,
  ) ?? { ...view.screen.own, icon: null };
  // 手動で操作する人物の待機を解除し、新しい接触の対象から外す。CLIのdisconnectと同じ。
  const release = view.aiControlled === false && (
    <Button
      variant="outline"
      disabled={busy || waiting.isPending || waiting.data?.active === false}
      onClick={() =>
        waiting.mutate({
          params: { path: { id }, query: { actorId: view.viewerId } },
          body: { active: false },
        })
      }
    >
      {waiting.data?.active === false ? "待機を解除しました" : "待機を解除する"}
    </Button>
  );
  function jump(toEnd: boolean) {
    follow.current = toEnd;
    if (log.current)
      log.current.scrollTop = toEnd ? log.current.scrollHeight : 0;
  }
  return (
    <PlayLayout
      unreadNotices={unreadNotices}
      left={
        <PlayerPanel
          world={id}
          player={player}
          screen={view.screen}
          notices={{
            unread: unreadNotices,
            items: notices.data?.notices,
            loading: notices.isPending,
            error: notices.error,
            read: readNotices,
          }}
          {...(sceneId ? { sceneId } : {})}
          history={
            <History
              id={id}
              role="player"
              viewer={view.viewerId}
              ref={history}
            />
          }
        />
      }
      right={
        <ScenePanel
          people={view.characters}
          screen={view.screen}
          turn={archive ? null : view.actorId}
          turnStartedAt={view.turnStartedAt}
        />
      }
      toolbar={
        <>
          <h1>
            {archive
              ? "過去のプレイログ"
              : view.sessionId
                ? `${view.members.length}人のセッション`
                : view.result
                  ? "本人のシーンを終了しました"
                  : "セッションを始める"}
          </h1>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="play-icon"
            onClick={() => jump(false)}
            aria-label="最上部へ移動"
            title="最上部へ移動"
          >
            <ArrowUpToLine />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="play-icon"
            onClick={() => jump(true)}
            aria-label="最下部に移動"
            title="最下部に移動"
          >
            <ArrowDownToLine />
          </Button>
        </>
      }
    >
      {mutation.error && <Problem error={mutation.error} />}
      {pending && !mutation.isPending && (
        <Button onClick={() => void send()}>保存した同じ要求で確認する</Button>
      )}
      {!archive && (
        <>
          <PlayApplications
            actorId={view.viewerId}
            screen={view.screen}
            canAct={!!view.sessionId && mine && !view.receiving}
            busy={busy}
            send={(raw) => void send(raw)}
          />
          {typeof mutation.data?.message === "string" && (
            <Notice>{mutation.data.message}</Notice>
          )}
        </>
      )}
      {!archive && view.aiControlled === false && (
        <PlayCommandEditor
          actorId={view.viewerId}
          disabled={busy}
          selection={
            view.sessionId
              ? {
                  screen: view.screen,
                  characters: view.characters,
                  canAct: mine && !view.receiving,
                }
              : undefined
          }
          response={mutation.data}
          execute={(command) => {
            editorRequest.current = command.requestId;
            void execute(command);
          }}
        />
      )}
      <div
        className="play-log space-y-4"
        aria-label="セッションのチャット"
        role="region"
        tabIndex={0}
        ref={log}
        onScroll={(event) => {
          const node = event.currentTarget;
          follow.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 32;
        }}
      >
        {view.entries.length === 0 && (
          <p className="muted">表示できるプレイログはまだありません</p>
        )}
        {view.entries.map((row) => {
          const at = row.recordedAt ?? row.payload.transition?.at;
          return (
            <article
              className="rounded-lg border bg-card px-6 py-5"
              key={row.id}
            >
              <p className="record-meta">
                {at ? (
                  <time dateTime={at}>{realTime(at)}</time>
                ) : (
                  "時刻の記録なし"
                )}
              </p>
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
                  {entry.result.items?.map((item) => (
                    <div key={item.itemId}>
                      <span>
                        {item.label}
                        {item.count ? ` ×${item.count}` : ""}〈{item.itemId}〉
                      </span>
                      {item.holding && (
                        <p>
                          {item.holding.fromId
                            ? personName(item.holding.fromId)
                            : "なし"}{" "}
                          → {personName(item.holding.toId)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              {row.payload.comment && (
                <p>ターンコメント：{row.payload.comment}</p>
              )}
              {row.payload.reason && <p>{row.payload.reason}</p>}
              {row.payload.transition && (
                <p className="record-meta">{row.payload.transition.message}</p>
              )}
            </article>
          );
        })}
        {view.legacy.length > 0 && sceneId && (
          <details className="initial-setting" open={archive}>
            <summary>引き継いだシーンの記録</summary>
            <History
              id={id}
              role="player"
              viewer={view.viewerId}
              sceneId={sceneId}
              sceneKind="events"
              hideWorldTime
              ref={null}
            />
            <History
              id={id}
              role="player"
              viewer={view.viewerId}
              sceneId={sceneId}
              sceneKind="actions"
              hideWorldTime
              ref={null}
            />
          </details>
        )}
      </div>
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
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={busy}
            onClick={() => void send({ command: "start" })}
          >
            セッションを開始
          </Button>
          {release}
        </div>
      ) : (
        <>
          <Notice>
            {mine
              ? "あなたの手番です"
              : view.actorId
                ? `${personName(view.actorId)}の手番を待っています`
                : "待機中です"}
            （通常API {view.callsUsed} / {view.callsLimit}回）
            {view.dailySp &&
              `探索・生成の残り ${view.dailySp.remaining} / ${view.dailySp.limit} SP（回復 ${realTime(view.dailySp.resetsAt)}）`}
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
                  void send({ command: "search", query: { kind: "self" } })
                }
              >
                自分の情報
              </Button>
            </div>
          )}
          {searchResult !== undefined && (
            <PersonalMaterial
              value={searchResult}
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
          {view.aiControlled === false && (
            <div className="flex flex-wrap gap-3">
              {view.members.length > 1 && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void send({ command: "leave" })}
                >
                  セッションを離れて続ける
                </Button>
              )}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void send({ command: "finish" })}
              >
                自分のプレイを終了する
              </Button>
              {release}
            </div>
          )}
        </>
      )}
    </PlayLayout>
  );
}
