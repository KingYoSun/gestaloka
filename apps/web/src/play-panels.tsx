import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { DiagramFlowHorizontal, PanelLeft, PanelRight, X } from "lucide-react";
import { Dialog, Tabs, Tooltip } from "radix-ui";
import { z } from "zod";
import {
  DeferredApplication,
  ExchangeOffer,
  type InventoryBundleCommand,
  PlayerCharacter,
  type PlayerNotices,
} from "@gestaloka/contracts";
import { Button } from "./components/ui/button.js";
import {
  CharacterAvatar,
  CharacterBadge,
  characterName,
} from "./player-icons.js";
import { RichText } from "./RichText.js";
import { Notice, Problem } from "./presentation.js";
import { $api, api } from "./api.js";

const Item = z.object({
  id: z.uuid().optional(),
  label: z.string(),
  count: z.number().optional(),
  seriesId: z.uuid().optional(),
  slots: z.number().optional(),
  totalSlots: z.number().optional(),
  states: z.array(z.string()).optional(),
});
const Capacity = z.object({ usedSlots: z.number(), limitSlots: z.number() });
const Storage = z.object({
  id: z.uuid().optional(),
  label: z.string(),
  items: z.array(Item),
  capacity: Capacity.optional(),
  bundles: z
    .array(
      z.object({
        id: z.uuid(),
        label: z.string(),
        itemCount: z.number(),
        normalSlots: z.number(),
      }),
    )
    .default([]),
  bundleLimitSlots: z.number().optional(),
  organizeHere: z.boolean().optional(),
});
export const Belongings = z.object({
  items: z.array(Item),
  capacity: Capacity.optional(),
  skillCapacity: Capacity.optional(),
  storages: z.array(Storage),
  skills: z.array(
    z.object({
      id: z.uuid().optional(),
      text: z.string(),
      name: z.string().optional(),
    }),
  ),
});
const Profile = z.object({ actorId: z.string(), profile: z.array(z.string()) });
export const PlayScreen = z.object({
  own: Profile.extend({ name: z.string() }),
  people: z.array(Profile.extend({ canReceive: z.boolean().optional() })),
  belongings: Belongings.optional(),
  place: z.string().optional(),
  neighbors: z.array(z.object({ id: z.string(), label: z.string() })),
  past: z.array(z.object({ sceneId: z.string(), startedAt: z.string() })),
  applications: z.array(DeferredApplication).default([]),
  exchangeOffers: z.array(ExchangeOffer).default([]),
  ownOffers: z.array(ExchangeOffer).default([]),
});
type Screen = z.infer<typeof PlayScreen>;
type Character = z.infer<typeof PlayerCharacter>;
export const itemText = (item: z.infer<typeof Item>) =>
  item.count ? `${item.label} ×${item.count}` : item.label;
function inventoryItemUsage(item: z.infer<typeof Item>) {
  if (item.slots === undefined) return "";
  const total = item.totalSlots ?? item.slots;
  return total > item.slots
    ? ` ${total}枠（本体${item.slots}枠・中身${total - item.slots}枠）`
    : ` ${total}枠`;
}
export const inventoryItemText = (item: z.infer<typeof Item>) =>
  itemText(item) + inventoryItemUsage(item);
export function realTime(at: string) {
  return new Date(at).toLocaleString("ja-JP");
}

function PanelDialog({
  side,
  title,
  children,
}: {
  side?: "left" | "right";
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="play-overlay" />
      <Dialog.Content
        className="play-dialog"
        data-side={side}
        aria-describedby={undefined}
      >
        <div className="play-dialog-heading">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Close asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="play-icon"
              aria-label="閉じる"
            >
              <X />
            </Button>
          </Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export function PlayLayout({
  left,
  right,
  toolbar,
  actions,
  children,
  unreadNotices,
}: {
  left: ReactNode;
  right: ReactNode;
  toolbar: ReactNode;
  actions: {
    label: string;
    icon: ReactNode;
    badge?: number;
    content: ReactNode;
  }[];
  children: ReactNode;
  unreadNotices: number;
}) {
  const [drawer, setDrawer] = useState<"left" | "right">();
  const start = useRef<{ x: number; y: number }>(null);
  return (
    <section
      className="play-layout"
      data-drawer-open={!!drawer}
      aria-label="セッション"
      onTouchStart={(event) => {
        const touch = event.touches[0];
        start.current =
          event.touches.length === 1 && touch
            ? { x: touch.clientX, y: touch.clientY }
            : null;
      }}
      onTouchEnd={(event) => {
        const from = start.current,
          to = event.changedTouches[0];
        start.current = null;
        if (!from || !to || !matchMedia("(max-width: 940px)").matches) return;
        const dx = to.clientX - from.x,
          dy = to.clientY - from.y;
        if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 2) return;
        if ((drawer === "left" && dx < 0) || (drawer === "right" && dx > 0))
          setDrawer(undefined);
        else if (!drawer && dx > 0 && from.x < 64) setDrawer("left");
        else if (!drawer && dx < 0 && from.x > window.innerWidth - 64)
          setDrawer("right");
      }}
    >
      <div className="play-toolbar">
        {(["left", "right"] as const).map((side) => {
          const isLeft = side === "left";
          const title = isLeft ? "プレイヤー情報" : "セッション情報";
          const Icon = isLeft ? PanelLeft : PanelRight;
          const hasUnread = isLeft && unreadNotices > 0;
          return (
            <Dialog.Root
              key={side}
              open={drawer === side}
              onOpenChange={(open) => setDrawer(open ? side : undefined)}
            >
              <Dialog.Trigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="play-icon play-drawer-trigger"
                  data-side={side}
                  aria-label={
                    hasUnread
                      ? `${title}（未読の通知 ${unreadNotices}件）`
                      : title
                  }
                  title={title}
                >
                  <Icon />
                  {hasUnread && (
                    <span
                      className="play-unread absolute -top-1 -right-1"
                      aria-hidden="true"
                    >
                      {unreadNotices}
                    </span>
                  )}
                </Button>
              </Dialog.Trigger>
              <PanelDialog side={side} title={title}>
                {isLeft ? left : right}
              </PanelDialog>
            </Dialog.Root>
          );
        })}
        <div className="play-log-toolbar">{toolbar}</div>
      </div>
      <aside
        className="play-aside"
        data-side="left"
        aria-label="プレイヤー情報"
      >
        {left}
      </aside>
      <div className="play-center">{children}</div>
      <div className="play-actions">
        {actions.map(({ label, icon, badge, content }) => (
          <Dialog.Root key={label}>
            <Dialog.Trigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="play-icon"
                aria-label={badge ? `${label}（${badge}件）` : label}
                title={label}
              >
                {icon}
                {!!badge && (
                  <span
                    className="play-unread absolute -top-1 -right-1"
                    aria-hidden="true"
                  >
                    {badge}
                  </span>
                )}
              </Button>
            </Dialog.Trigger>
            <PanelDialog title={label}>
              <div className="space-y-4">{content}</div>
            </PanelDialog>
          </Dialog.Root>
        ))}
      </div>
      <aside
        className="play-aside"
        data-side="right"
        aria-label="セッション情報"
      >
        {right}
      </aside>
    </section>
  );
}

const tabs = {
  profile: "基本情報",
  items: "所持品",
  storage: "保管品",
  skills: "技能",
  past: "過去の履歴",
  notices: "通知",
};

function TextList({ items, empty }: { items: string[]; empty: string }) {
  return items.length ? (
    <ul className="play-list">
      {items.map((item, i) => (
        <li key={i}>
          <RichText text={item} />
        </li>
      ))}
    </ul>
  ) : (
    <p className="muted">{empty}</p>
  );
}

type InventoryViewer = { world: string; actor: string };
type ItemActions = (item: z.infer<typeof Item>) => ReactNode;

function Contents({
  world,
  actor,
  container,
  actions,
}: InventoryViewer & { container: string; actions?: ItemActions }) {
  const query = useInfiniteQuery({
    queryKey: ["inventory-contents", world, actor, container],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await api.GET("/api/worlds/{id}/inventory/contents", {
        params: {
          path: { id: world },
          query: {
            actorId: actor,
            containerId: container,
            ...(pageParam ? { after: pageParam } : {}),
          },
        },
        signal,
      });
      if (!data) throw new Error("中身を取得できませんでした");
      return data;
    },
    getNextPageParam: (last) => last.next ?? undefined,
  });
  return (
    <div className="ml-3">
      {query.isPending && <p role="status">中身を読み込み中…</p>}
      {query.error && <Problem error={query.error} />}
      {query.data && (
        <InventoryList
          world={world}
          actor={actor}
          items={query.data.pages.flatMap((page) => page.items)}
          empty="中身はありません"
          actions={actions}
        />
      )}
      {query.hasNextPage && (
        <Button
          size="sm"
          variant="ghost"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          中身をさらに読む
        </Button>
      )}
    </div>
  );
}

function ItemDescription({
  world,
  actor,
  item,
}: InventoryViewer & { item: string }) {
  const query = useInfiniteQuery({
    queryKey: ["inventory-description", world, actor, item],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await api.GET("/api/worlds/{id}/inventory/description", {
        params: {
          path: { id: world },
          query: {
            actorId: actor,
            itemId: item,
            ...(pageParam ? { after: pageParam } : {}),
          },
        },
        signal,
      });
      if (!data) throw new Error("説明を取得できませんでした");
      return data;
    },
    getNextPageParam: (last) => last.next ?? undefined,
  });
  if (query.error) return <Problem error={query.error} />;
  if (!query.data) return <p role="status">説明を読み込み中…</p>;
  const pages = query.data.pages;
  const origin = pages[0]?.origin;
  const states = pages.flatMap((page) => page.states);
  const inherited = pages.flatMap((page) => page.inherited);
  return (
    <>
      {states.map((state, i) => (
        <RichText key={i} text={state} />
      ))}
      {!!inherited.length && (
        <>
          <strong>取り分けたときの特徴</strong>
          {inherited.map((state, i) => (
            <RichText key={i} text={state} />
          ))}
        </>
      )}
      {origin && (
        <>
          <strong>作成時の取得経緯</strong>
          <RichText text={origin} />
        </>
      )}
      {!origin && !states.length && !inherited.length && !query.hasNextPage && (
        <p className="muted">説明は記録されていません。</p>
      )}
      {query.hasNextPage && (
        <Button
          size="sm"
          variant="ghost"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          説明の続きを見る
        </Button>
      )}
    </>
  );
}

function InventoryItem({
  world,
  actor,
  item,
  actions,
  bundleMember,
  showDescription,
}: InventoryViewer & {
  item: z.infer<typeof Item>;
  actions?: ReactNode;
  bundleMember: boolean;
  showDescription: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const usage = bundleMember
    ? `単独で${item.slots}枠`
    : inventoryItemUsage(item);
  return (
    <li>
      <RichText text={itemText(item)} />
      {usage && <span>{usage}</span>}
      {item.states?.map((state, i) => (
        <RichText key={i} text={state} />
      ))}
      {actions}
      {showDescription && item.id && (
        <details
          onToggle={(event) => setDescriptionOpen(event.currentTarget.open)}
        >
          <summary>説明を見る</summary>
          {descriptionOpen && (
            <ItemDescription world={world} actor={actor} item={item.id} />
          )}
        </details>
      )}
      {item.id && (item.totalSlots ?? 0) > (item.slots ?? 0) && (
        <details onToggle={(event) => setOpen(event.currentTarget.open)}>
          <summary>中身を見る</summary>
          {open && <Contents world={world} actor={actor} container={item.id} />}
        </details>
      )}
    </li>
  );
}

function InventoryList({
  world,
  actor,
  items,
  empty,
  actions,
  showDescription = false,
}: InventoryViewer & {
  items: z.infer<typeof Item>[];
  empty: string;
  actions?: ItemActions | undefined;
  showDescription?: boolean;
}) {
  return items.length ? (
    <ul className="play-list">
      {items.map((item, i) => (
        <InventoryItem
          key={item.id ?? i}
          world={world}
          actor={actor}
          item={item}
          actions={actions?.(item)}
          bundleMember={!!actions}
          showDescription={showDescription}
        />
      ))}
    </ul>
  ) : empty ? (
    <p className="muted">{empty}</p>
  ) : null;
}

type BundleCommand = z.infer<typeof InventoryBundleCommand>;
type BundlePlay = {
  refresh: () => Promise<unknown>;
  take: (item: string, from: string, label: string) => Promise<boolean>;
  canTake: boolean;
  error: unknown;
};

function BundleRow({
  world,
  actor,
  bundle,
  actions,
  dissolve,
}: InventoryViewer & {
  bundle: z.infer<typeof Storage>["bundles"][number];
  actions: ItemActions;
  dissolve: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {bundle.label} · {bundle.itemCount}点 · 1枠
      </summary>
      {open && (
        <Contents
          world={world}
          actor={actor}
          container={bundle.id}
          actions={actions}
        />
      )}
      {dissolve}
    </details>
  );
}

function StorageInventory({
  world,
  actor,
  storage,
  play,
}: InventoryViewer & { storage: z.infer<typeof Storage>; play: BundlePlay }) {
  const [selected, select] = useState<string[]>([]);
  const [label, name] = useState("");
  const [target, setTarget] = useState("");
  const client = useQueryClient();
  const refresh = async () => {
    await play.refresh();
    await client.invalidateQueries({
      queryKey: ["inventory-contents", world, actor],
    });
  };
  const edit = $api.useMutation("post", "/api/worlds/{id}/inventory/bundles", {
    onSuccess: () => {
      select([]);
      name("");
      void refresh();
    },
  });
  const available = storage.items.filter(
    (item) => item.id && item.slots === item.totalSlots,
  );
  const chosen = available.filter(
    (item) => item.id && selected.includes(item.id),
  );
  const organize = (
    command: (
      request: Pick<BundleCommand, "storageId" | "requestId">,
    ) => BundleCommand,
  ) => {
    if (!storage.id) return;
    const body = command({
      storageId: storage.id,
      requestId: crypto.randomUUID(),
    });
    edit.mutate({
      params: { path: { id: world }, query: { actorId: actor } },
      body,
    });
  };
  const bundle = storage.bundles.find((row) => row.id === target);
  const total =
    (bundle?.normalSlots ?? 0) +
    chosen.reduce((sum, item) => sum + (item.slots ?? 0), 0);
  return (
    <section className="play-storage">
      <h3>{storage.label}</h3>
      {storage.capacity && (
        <p className="muted">
          使用枠 {storage.capacity.usedSlots}/{storage.capacity.limitSlots}
        </p>
      )}
      {edit.error && <Problem error={edit.error} />}
      {storage.organizeHere && !!play.error && <Problem error={play.error} />}
      <InventoryList
        world={world}
        actor={actor}
        items={storage.items}
        empty={storage.bundles.length ? "" : "保管品はありません"}
      />
      {storage.bundles.map((row) => (
        <BundleRow
          key={row.id}
          world={world}
          actor={actor}
          bundle={row}
          actions={(item) =>
            storage.organizeHere &&
            item.id &&
            storage.id && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={edit.isPending}
                  onClick={() =>
                    organize((request) => ({
                      ...request,
                      action: "release",
                      bundleId: row.id,
                      itemId: item.id!,
                    }))
                  }
                >
                  保管先で外す
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!play.canTake}
                  onClick={() =>
                    void play
                      .take(item.id!, storage.id!, item.label)
                      .then((done) => {
                        if (done) void refresh();
                      })
                  }
                >
                  手持ちへ取り出す
                </Button>
              </>
            )
          }
          dissolve={
            storage.organizeHere && (
              <Button
                size="sm"
                variant="ghost"
                disabled={edit.isPending}
                onClick={() =>
                  organize((request) => ({
                    ...request,
                    action: "dissolve",
                    bundleId: row.id,
                  }))
                }
              >
                バンドルを解除する
              </Button>
            )
          }
        />
      ))}
      {storage.organizeHere && available.length > 0 && (
        <details>
          <summary>品をまとめる</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const itemIds = chosen.map((item) => item.id!);
              organize((request) =>
                bundle
                  ? { ...request, action: "add", bundleId: bundle.id, itemIds }
                  : { ...request, action: "create", label, itemIds },
              );
            }}
          >
            {storage.bundles.length > 0 && (
              <label>
                バンドル
                <select
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                >
                  <option value="">新しく作る</option>
                  {storage.bundles.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!bundle && (
              <label>
                名前{" "}
                <input
                  required
                  value={label}
                  onChange={(event) => name(event.target.value)}
                />
              </label>
            )}
            <ul className="play-list">
              {available.map((item) => (
                <li key={item.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id!)}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        select((ids) =>
                          checked
                            ? [...ids, item.id!]
                            : ids.filter((id) => id !== item.id),
                        );
                      }}
                    />{" "}
                    {itemText(item)}
                  </label>
                </li>
              ))}
            </ul>
            <p className="muted">
              品の通常枠 {total}/{storage.bundleLimitSlots}
            </p>
            <Button
              type="submit"
              disabled={
                edit.isPending ||
                chosen.length < (bundle ? 1 : 2) ||
                total > (storage.bundleLimitSlots ?? Infinity)
              }
            >
              {bundle ? "選んだ品を追加する" : "選んだ品をまとめる"}
            </Button>
          </form>
        </details>
      )}
    </section>
  );
}

export function PlayerPanel({
  world,
  player,
  screen,
  history,
  sceneId,
  notices,
  bundlePlay,
}: {
  world: string;
  player: Character;
  screen: Screen;
  history: ReactNode;
  sceneId?: string;
  bundlePlay: BundlePlay;
  notices: {
    unread: number;
    items: z.infer<typeof PlayerNotices>["notices"] | undefined;
    loading: boolean;
    error: unknown;
    read: () => void;
  };
}) {
  const { belongings, own, past } = screen;
  return (
    <>
      <div className="play-profile">
        <CharacterBadge {...player} />
      </div>
      <Tabs.Root
        defaultValue={sceneId ? "past" : "profile"}
        onValueChange={(tab) => {
          if (tab === "notices") notices.read();
        }}
      >
        <Tabs.List className="play-tabs" aria-label="プレイヤー情報の種類">
          {Object.entries(tabs).map(([key, label]) => (
            <Tabs.Trigger key={key} value={key}>
              {label}
              {key === "notices" && notices.unread > 0 && (
                <span className="play-unread ml-1">
                  <span className="sr-only">未読 {notices.unread}件</span>
                  <span aria-hidden="true">{notices.unread}</span>
                </span>
              )}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="profile">
          <TextList
            items={own.profile}
            empty="プロフィールの記録がありません"
          />
        </Tabs.Content>
        <Tabs.Content value="items">
          {belongings?.capacity && (
            <p className="muted">
              使用枠 {belongings.capacity.usedSlots}/
              {belongings.capacity.limitSlots}
            </p>
          )}
          <InventoryList
            world={world}
            actor={own.actorId}
            items={belongings?.items ?? []}
            empty="所持品はありません"
            showDescription
          />
        </Tabs.Content>
        <Tabs.Content value="storage">
          {belongings?.storages.length ? (
            belongings.storages.map((storage, i) => (
              <StorageInventory
                world={world}
                actor={own.actorId}
                storage={storage}
                play={bundlePlay}
                key={storage.id ?? i}
              />
            ))
          ) : (
            <p className="muted">利用できる保管先はありません</p>
          )}
        </Tabs.Content>
        <Tabs.Content value="skills">
          {belongings?.skillCapacity && (
            <p>
              使用枠 {belongings.skillCapacity.usedSlots}/
              {belongings.skillCapacity.limitSlots}
            </p>
          )}
          <TextList
            items={
              belongings?.skills.map(({ text, name }) =>
                name ? `${name} — ${text}` : text,
              ) ?? []
            }
            empty="技能の記録がありません"
          />
        </Tabs.Content>
        <Tabs.Content value="past">
          {sceneId && (
            <Link
              to="/worlds/$id/play"
              params={{ id: world }}
              search={{ actorId: player.actorId }}
              className="text-link"
            >
              現在のログへ
            </Link>
          )}
          {past.length ? (
            <ul className="play-list">
              {past.map((entry) => (
                <li key={entry.sceneId}>
                  <Link
                    to="/worlds/$id/play"
                    params={{ id: world }}
                    search={{ actorId: player.actorId, sceneId: entry.sceneId }}
                    aria-current={
                      sceneId === entry.sceneId ? "page" : undefined
                    }
                    className="text-link"
                  >
                    <time dateTime={entry.startedAt}>
                      {realTime(entry.startedAt)}
                    </time>{" "}
                    開始
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">終了したプレイはありません</p>
          )}
          <details className="play-individual-history">
            <summary>本人のこれまでの履歴</summary>
            {history}
          </details>
        </Tabs.Content>
        <Tabs.Content value="notices">
          {notices.loading && <Notice>通知を読み込んでいます</Notice>}
          {notices.error != null && <Problem error={notices.error} />}
          {notices.items?.length === 0 && (
            <p className="muted">通知はありません</p>
          )}
          {!!notices.items?.length && (
            <ul className="space-y-3">
              {notices.items.map(({ id, at, text }) => (
                <li key={id}>
                  <time className="muted" dateTime={at}>
                    {realTime(at)}
                  </time>
                  <p className="whitespace-pre-wrap">{text}</p>
                </li>
              ))}
            </ul>
          )}
          {(notices.error != null || (notices.items && notices.unread > 0)) && (
            <Button type="button" onClick={notices.read}>
              {notices.error != null ? "再試行" : "未読を読む"}
            </Button>
          )}
        </Tabs.Content>
      </Tabs.Root>
    </>
  );
}

function TurnClock({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const duration = [Math.floor(seconds / 60), seconds % 60]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
  return (
    <span className="turn-clock" aria-label={`手番の経過時間 ${duration}`}>
      {duration}
    </span>
  );
}

export function SessionPanel({
  people,
  screen,
  turn,
  turnStartedAt,
}: {
  people: Character[];
  screen: Screen;
  turn?: string | null | undefined;
  turnStartedAt?: string | undefined;
}) {
  const profiles = new Map(
    [screen.own, ...screen.people].map(({ actorId, profile }) => [
      actorId,
      profile,
    ]),
  );
  return (
    <>
      <h2>登場人物</h2>
      <Tooltip.Provider>
        <ol className="session-people">
          {people.map((person) => {
            const active = turn === person.actorId;
            const label = characterName(person);
            return (
              <li key={person.actorId} className="session-person">
                <Dialog.Root>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Dialog.Trigger asChild>
                        <button
                          type="button"
                          className="session-person-button"
                          aria-current={active ? "true" : undefined}
                          aria-label={
                            active
                              ? `${label}のプロフィール（手番中）`
                              : `${label}のプロフィール`
                          }
                        >
                          <CharacterAvatar {...person} />
                          {!!person.count && person.count > 1 && (
                            <span className="record-meta">×{person.count}</span>
                          )}
                        </button>
                      </Dialog.Trigger>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content className="play-tooltip" sideOffset={6}>
                        {label}
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                  <PanelDialog title={<CharacterBadge {...person} />}>
                    <TextList
                      items={profiles.get(person.actorId) ?? []}
                      empty="閲覧できるプロフィールがありません"
                    />
                  </PanelDialog>
                </Dialog.Root>
                {active &&
                  (turnStartedAt ? (
                    <TurnClock key={turnStartedAt} since={turnStartedAt} />
                  ) : (
                    <span
                      className="turn-clock"
                      aria-label="手番開始時刻の記録なし"
                    >
                      --:--:--
                    </span>
                  ))}
              </li>
            );
          })}
        </ol>
      </Tooltip.Provider>
      <h2>現在地</h2>
      <div className="session-place">
        <span>{screen.place ?? "現在地は未確定です"}</span>
        {screen.place && (
          <Dialog.Root>
            <Dialog.Trigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="play-icon"
                aria-label="隣接する場所"
                title="隣接する場所"
              >
                <DiagramFlowHorizontal />
              </Button>
            </Dialog.Trigger>
            <PanelDialog title="隣接する場所">
              <TextList
                items={screen.neighbors.map(({ label }) => label)}
                empty="隣接する場所の記録がありません"
              />
            </PanelDialog>
          </Dialog.Root>
        )}
      </div>
    </>
  );
}
