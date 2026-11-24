import { memo, useState, useRef } from "react";
import { ArrowDownToLine, ArrowUpToLine, Inbox, PenLine } from "lucide-react";
import { z } from "zod";
import {
  ItemOutcome,
  PlayerPlayCommand,
  PlayerCharacter,
} from "@gestaloka/contracts";
import type { paths } from "@gestaloka/contracts/http";
import { $api, ApiFailure, errorMessage, pendingKey } from "./api.js";
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
  inventoryItemText,
  PlayLayout,
  PlayerPanel,
  PlayScreen,
  realTime,
  SessionPanel,
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
  home: z.object({ placeId: z.uuid(), name: z.string() }).optional(),
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
      progress: z
        .object({
          approved: z.number(),
          declined: z.number(),
          pending: z.number(),
        })
        .optional(),
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
                    action: z.object({ command: z.string() }).optional(),
                    effectState: z.string().optional(),
                    items: z.array(ItemOutcome).optional(),
                    outcome: z.object({ success: z.boolean() }).optional(),
                  })
                  .passthrough(),
              }),
            )
            .optional(),
          comment: z.string().optional(),
          observation: z.string().optional(),
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
type Session = z.infer<typeof View>;
const parseView = (data: unknown) => View.parse(data);
// 取得のたびに同じ内容の行は同じ参照になるため、追加された記録だけを描画する。
const LogRow = memo(function LogRow({
  row,
  characters,
  fresh,
}: {
  row: Session["entries"][number];
  characters: Session["characters"];
  fresh: boolean;
}) {
  const name = (id: string) => characters.find((c) => c.actorId === id)?.name;
  const at = row.recordedAt ?? row.payload.transition?.at;
  return (
    <div className="play-log-row" data-fresh={fresh || undefined}>
      <div>
        <article className="rounded-lg border bg-card px-6 py-5">
          <p className="record-meta">
            {at ? <time dateTime={at}>{realTime(at)}</time> : "時刻の記録なし"}
          </p>
          {row.payload.entries?.map((entry, i) => (
            <div key={i}>
              <p className="record-meta">
                {entry.label ?? name(entry.actorId) ?? "参加者"}
              </p>
              <RichText text={entry.input} />
              {!row.payload.observation &&
                entry.result.action?.command !== "oppose" && (
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
                            : entry.result.state === "pending"
                              ? "管理者の許可待ちです"
                              : "受理しました"}
                  </p>
                )}
              {entry.result.items?.map((item) => (
                <div key={item.itemId}>
                  <span>
                    {item.label}
                    {item.count ? ` ×${item.count}` : ""}〈{item.itemId}〉
                  </span>
                  {item.holding && (
                    <p>
                      {item.holding.fromId
                        ? (name(item.holding.fromId) ?? item.holding.fromId)
                        : "なし"}{" "}
                      → {name(item.holding.toId) ?? item.holding.toId}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ))}
          {row.payload.comment && <p>ターンコメント：{row.payload.comment}</p>}
          {row.payload.reason && <p>{row.payload.reason}</p>}
          {row.payload.transition && (
            <p className="record-meta">{row.payload.transition.message}</p>
          )}
        </article>
      </div>
    </div>
  );
});
function LogRows({
  entries,
  characters,
}: Pick<Session, "entries" | "characters">) {
  // 開いた時点より後に届いた記録だけを、現れる演出の対象にする。
  const [shown] = useState(() => Number(entries.at(-1)?.id ?? 0));
  return [...entries]
    .reverse()
    .map((row) => (
      <LogRow
        key={row.id}
        row={row}
        characters={characters}
        fresh={Number(row.id) > shown}
      />
    ));
}
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
    ...(data.belongings?.items ?? []).map(inventoryItemText),
    ...(data.belongings?.storages ?? []).flatMap((x) => [
      x.capacity
        ? `${x.label}（使用枠 ${x.capacity.usedSlots}/${x.capacity.limitSlots}）`
        : x.label,
      ...x.items.map(inventoryItemText),
      ...x.bundles.map(
        (bundle) => `${bundle.label} · ${bundle.itemCount}点 · 1枠`,
      ),
    ]),
    data.belongings?.skillCapacity &&
      `技能の使用枠 ${data.belongings.skillCapacity.usedSlots}/${data.belongings.skillCapacity.limitSlots}`,
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
  const [pending, save] = usePending(
    pendingKey(`${id}:${actorId ?? "selected"}`, "bot-turn"),
    PlayerPlayCommand,
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
    { refetchInterval: 1000, select: parseView },
  );
  const mutation = $api.useMutation("post", "/api/worlds/{id}/session"),
    view = query.data;
  // 取得時に既読になるため、プレイヤーが通知を読む操作で取得する。
  const waiting = $api.useMutation("post", "/api/worlds/{id}/waiting");
  const notices = $api.useMutation("get", "/api/worlds/{id}/notices", {
    onSuccess: () => void query.refetch(),
  });
  const execute = async (body: z.infer<typeof PlayerPlayCommand>) => {
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
      return true;
    } catch (error) {
      if (
        error instanceof ApiFailure &&
        error.status >= 400 &&
        error.status < 500
      )
        save(null);
      return false;
    }
  };
  const send = (raw?: Record<string, unknown>) =>
    execute(
      pending ??
        PlayerPlayCommand.parse({ ...raw, requestId: crypto.randomUUID() }),
    );
  if (!view)
    return query.error ? (
      <Problem error={query.error} />
    ) : (
      <Notice>セッションを読み込んでいます</Notice>
    );
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
  const jump = (toEnd: boolean) =>
    log.current?.scrollTo({ top: toEnd ? log.current.scrollHeight : 0 });
  // 新しい記録を上に積むため、現在の状態はログの先頭に置く。
  const state =
    !archive &&
    view.sessionId &&
    (mine
      ? "あなたの手番です"
      : view.actorId
        ? `${personName(view.actorId)}の手番を待っています`
        : "待機中です") + (view.receiving ? "（受領判断中）" : "");
  const feedback = (
    <>
      {mutation.error && <Problem error={mutation.error} />}
      {pending && !mutation.isPending && (
        <Button onClick={() => void send()}>保存した同じ要求で確認する</Button>
      )}
      {typeof mutation.data?.message === "string" && (
        <Notice>{mutation.data.message}</Notice>
      )}
    </>
  );
  return (
    <PlayLayout
      unreadNotices={unreadNotices}
      left={
        <PlayerPanel
          world={id}
          player={player}
          screen={view.screen}
          bundlePlay={{
            canTake: mine && !busy && !archive,
            error: mutation.error,
            refresh: () => query.refetch(),
            take: (item, from, label) =>
              send({
                command: "apply",
                expectedSp: 0,
                action: {
                  type: "direct",
                  text: `${label}を手持ちへ取り出す`,
                  operations: [
                    {
                      type: "move",
                      item,
                      from,
                      to: view.viewerId,
                      basis: "バンドルから取り出す",
                    },
                  ],
                },
                dependencies: [],
              }),
          }}
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
        <>
          <SessionPanel
            people={view.characters}
            screen={view.screen}
            turn={archive ? null : view.actorId}
            turnStartedAt={view.turnStartedAt}
          />
          {!archive && (
            <>
              <h2>Home（復帰先）</h2>
              <div className="session-place">
                <span>{view.home?.name ?? "未設定"}</span>
                {view.screen.place && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void send({ command: "home-set" })}
                  >
                    現在地をHomeにする
                  </Button>
                )}
              </div>
            </>
          )}
        </>
      }
      toolbar={
        <>
          <h1>
            {archive
              ? "過去のプレイログ"
              : view.sessionId
                ? `${view.members.length}人のセッション`
                : view.result
                  ? "今回のプレイを終了しました"
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
      actions={
        archive
          ? []
          : [
              {
                label: "受領と交換",
                icon: <Inbox />,
                badge: view.screen.applications.filter((a) => a.awaitingYou)
                  .length,
                content: (
                  <>
                    {feedback}
                    <PlayApplications
                      actorId={view.viewerId}
                      screen={view.screen}
                      canAct={!!view.sessionId && mine && !view.receiving}
                      busy={busy}
                      send={(raw) => void send(raw)}
                    />
                  </>
                ),
              },
              {
                label: "操作",
                icon: <PenLine />,
                content: (
                  <>
                    {feedback}
                    {view.aiControlled === false && (
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
                    {!view.sessionId ? (
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
                          通常API {view.callsUsed} / {view.callsLimit}回{" "}
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
                                void send({
                                  command: "search",
                                  query: { kind: "self" },
                                })
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
                        {view.receiving?.progress && (
                          <p>
                            承認 {view.receiving.progress.approved}人、辞退{" "}
                            {view.receiving.progress.declined}人、回答待ち{" "}
                            {view.receiving.progress.pending}人
                          </p>
                        )}
                        {view.receiving && mine && (
                          <section className="space-y-3">
                            <RichText
                              text={view.receiving.text ?? "受領判断"}
                            />
                            {view.receiving.preview?.map((line, i) => (
                              <p key={i}>{line}</p>
                            ))}
                            <p>
                              受領判断の期限：
                              {new Date(
                                view.receiving.deadline,
                              ).toLocaleString()}
                            </p>
                            <div className="flex flex-wrap gap-3">
                              <Button
                                disabled={busy}
                                onClick={() =>
                                  void send({
                                    command: "receive",
                                    applicationId:
                                      view.receiving!.applicationId,
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
                                    applicationId:
                                      view.receiving!.applicationId,
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
                              {view.receiving
                                ? "ターンコメント"
                                : "発言・ターンコメント"}
                              <Textarea
                                aria-label={
                                  view.receiving
                                    ? "ターンコメント"
                                    : "発言・ターンコメント"
                                }
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                              />
                            </label>
                            <div className="flex flex-wrap gap-3">
                              {!view.receiving && (
                                <Button
                                  type="submit"
                                  disabled={busy || !text.trim()}
                                >
                                  発言する
                                </Button>
                              )}
                              <Button
                                type="button"
                                disabled={
                                  busy || !text.trim() || view.commentUsed
                                }
                                onClick={() =>
                                  void send({ command: "comment", text })
                                }
                              >
                                ターンコメントを付ける
                              </Button>
                              {!view.receiving && (
                                <Button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void send({ command: "end-turn" })
                                  }
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
                  </>
                ),
              },
            ]
      }
    >
      <div
        role="status"
        className="pointer-events-none fixed inset-x-4 top-4 z-50 flex justify-end"
      >
        {query.error && (
          <div className="max-w-sm rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-md">
            <p className="font-semibold text-destructive">
              セッションを更新できませんでした
            </p>
            <p>{errorMessage(query.error)}</p>
          </div>
        )}
      </div>
      <div
        className="play-log"
        aria-label="セッションのチャット"
        role="region"
        tabIndex={0}
        ref={log}
      >
        {state && (
          <div className="play-log-state" key={state}>
            <Notice>{state}</Notice>
          </div>
        )}
        {view.entries.length === 0 && (
          <p className="muted">表示できるプレイログはまだありません</p>
        )}
        <LogRows entries={view.entries} characters={view.characters} />
        {view.legacy.length > 0 && sceneId && (
          <details className="initial-setting" open={archive}>
            <summary>引き継いだプレイ履歴</summary>
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
      {archive && (
        <Link
          to="/worlds/$id/play"
          params={{ id }}
          search={{ actorId: view.viewerId }}
          className="text-link"
        >
          現在のセッションを開く
        </Link>
      )}
    </PlayLayout>
  );
}
