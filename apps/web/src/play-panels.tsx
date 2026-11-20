import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { DiagramFlowHorizontal, PanelLeft, PanelRight, X } from "lucide-react";
import { Dialog, Tabs, Tooltip } from "radix-ui";
import { z } from "zod";
import {
  DeferredApplication,
  ExchangeOffer,
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

const Item = z.object({
  id: z.uuid().optional(),
  label: z.string(),
  count: z.number().optional(),
  seriesId: z.uuid().optional(),
  owners: z.array(z.object({ id: z.uuid(), label: z.string() })).optional(),
});
export const Belongings = z.object({
  items: z.array(Item),
  storages: z.array(
    z.object({
      id: z.uuid().optional(),
      label: z.string(),
      items: z.array(Item),
    }),
  ),
  skills: z.array(z.object({ text: z.string() })),
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
export function heldItemText(item: z.infer<typeof Item>, viewerId: string) {
  const label = itemText(item);
  if (!item.owners) return label;
  const owners = item.owners
    .map((owner) => (owner.id === viewerId ? "自分" : owner.label))
    .join("、");
  return `${label}（所有者：${owners || "未登録"}）`;
}
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
  children,
  unreadNotices,
}: {
  left: ReactNode;
  right: ReactNode;
  toolbar: ReactNode;
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
          const title = isLeft ? "プレイヤー情報" : "シーン情報";
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
      <aside className="play-aside" data-side="right" aria-label="シーン情報">
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

export function PlayerPanel({
  world,
  player,
  screen,
  history,
  sceneId,
  notices,
}: {
  world: string;
  player: Character;
  screen: Screen;
  history: ReactNode;
  sceneId?: string;
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
          <TextList
            items={
              belongings?.items.map((item) =>
                heldItemText(item, own.actorId),
              ) ?? []
            }
            empty="所持品はありません"
          />
        </Tabs.Content>
        <Tabs.Content value="storage">
          {belongings?.storages.length ? (
            belongings.storages.map(({ label, items }, i) => (
              <section className="play-storage" key={i}>
                <h3>{label}</h3>
                <TextList
                  items={items.map((item) => heldItemText(item, own.actorId))}
                  empty="保管品はありません"
                />
              </section>
            ))
          ) : (
            <p className="muted">利用できる保管先はありません</p>
          )}
        </Tabs.Content>
        <Tabs.Content value="skills">
          <TextList
            items={belongings?.skills.map(({ text }) => text) ?? []}
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

export function ScenePanel({
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
        <ol className="scene-people">
          {people.map((person) => {
            const active = turn === person.actorId;
            const label = characterName(person);
            return (
              <li key={person.actorId} className="scene-person">
                <Dialog.Root>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <Dialog.Trigger asChild>
                        <button
                          type="button"
                          className="scene-person-button"
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
      <div className="scene-place">
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
