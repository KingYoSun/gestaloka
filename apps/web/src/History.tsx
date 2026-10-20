import {
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { api, expireSession, ScopeChanged } from "./api.js";
import { worldTime, Problem } from "./presentation.js";
import { RichText } from "./RichText.js";
import { Button } from "./components/ui/button.js";

type Cursor = { before?: string; after?: string };
type Entry = {
  id: string;
  at: number;
  text: string;
  kind: "admin" | "observation" | "interpretation";
  continuation?: string | null;
};
type Page = { items: Entry[]; next: string | null; previous: string | null };
export type HistoryHandle = { updated: () => void };

export function History({
  id,
  role,
  viewer,
  ref,
  excludeIds,
}: {
  id: string;
  role: "admin" | "player";
  viewer: string;
  ref: Ref<HistoryHandle>;
  excludeIds?: string[];
}) {
  const client = useQueryClient(),
    scroll = useRef<HTMLDivElement>(null);
  const key = useMemo(
    () => ["history", id, role, viewer] as const,
    [id, role, viewer],
  );
  const [notice, setNotice] = useState(false);
  const query = useInfiniteQuery<
    Page,
    Error,
    InfiniteData<Page, Cursor>,
    typeof key,
    Cursor
  >({
    queryKey: key,
    initialPageParam: {} as Cursor,
    maxPages: 4,
    gcTime: 0,
    queryFn: async ({ pageParam, signal }): Promise<Page> => {
      if (role === "admin") {
        const { data } = await api.GET("/api/worlds/{id}/records", {
          params: { path: { id }, query: pageParam },
          signal,
        });
        if (!data) throw new Error("記録を取得できませんでした");
        return {
          ...data,
          items: data.items.map((item) => ({
            id: item.id,
            at: item.at,
            text: item.summary,
            kind: "admin",
            continuation: item.continuation,
          })),
        };
      }
      const { data } = await api.GET("/api/worlds/{id}/knowledge", {
        params: { path: { id }, query: pageParam },
        signal,
      });
      if (!data) throw new Error("記録を取得できませんでした");
      if (data.viewerId !== viewer) {
        expireSession();
        throw new ScopeChanged();
      }
      return {
        ...data,
        items: data.items.map((item) => ({
          id: item.id,
          at: item.from,
          text: item.text,
          kind: item.kind,
        })),
      };
    },
    getNextPageParam: (page) => (page.next ? { before: page.next } : undefined),
    getPreviousPageParam: (page) =>
      page.previous ? { after: page.previous } : undefined,
  });
  const entries = useMemo(
    () =>
      query.data?.pages
        .flatMap((page) => page.items)
        .filter((item) => !excludeIds?.includes(item.id)) ?? [],
    [query.data, excludeIds],
  );
  // React Compilerは未使用。必須のTanStack Virtualをそのまま呼び出す。
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroll.current,
    getItemKey: (index) => entries[index]!.id,
    estimateSize: () => 180,
    overscan: 3,
    initialRect: { width: 620, height: 500 },
  });
  const anchor = useRef<{ id: string; offset: number } | null>(null),
    atTop = useRef(true),
    resetting = useRef(false),
    restoring = useRef(false);
  const previous = useRef<InfiniteData<Page, Cursor> | undefined>(undefined);
  function remember() {
    if (resetting.current || restoring.current) return;
    const top = scroll.current?.scrollTop ?? 0;
    atTop.current = top < 48 && query.data?.pages[0]?.previous === null;
    const viewport = scroll.current?.getBoundingClientRect().top ?? 0;
    const item = [
      ...(scroll.current?.querySelectorAll<HTMLElement>("article") ?? []),
    ].find((row) => row.getBoundingClientRect().bottom > viewport + 8);
    if (item?.dataset.recordId)
      anchor.current = {
        id: item.dataset.recordId,
        offset: item.getBoundingClientRect().top - viewport,
      };
  }
  useLayoutEffect(() => {
    let frame: number | undefined;
    if (previous.current !== query.data) {
      if (atTop.current) {
        virtual.scrollToOffset(0);
        anchor.current = null;
      } else if (anchor.current) {
        const index = entries.findIndex(
          (entry) => entry.id === anchor.current!.id,
        );
        if (index >= 0) {
          const saved = anchor.current;
          let stable = 0;
          restoring.current = true;
          const position = () => {
            const start = virtual.getOffsetForIndex(index, "start")?.[0];
            if (start !== undefined)
              virtual.scrollToOffset(start - saved.offset);
          };
          position();
          const restore = () => {
            const container = scroll.current;
            const row = container?.querySelector<HTMLElement>(
              `[data-record-id="${saved.id}"]`,
            );
            if (container && row) {
              const delta =
                row.getBoundingClientRect().top -
                container.getBoundingClientRect().top -
                saved.offset;
              if (Math.abs(delta) > 0.5) {
                container.scrollTop += delta;
                stable = 0;
              } else stable++;
            } else position();
            if (stable < 2) frame = requestAnimationFrame(restore);
            else restoring.current = false;
          };
          frame = requestAnimationFrame(restore);
        } else if (previous.current) {
          client.setQueryData(key, previous.current);
          return;
        }
      }
      previous.current = query.data;
    }
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      restoring.current = false;
    };
  }, [client, entries, key, query.data, virtual]);
  useImperativeHandle(ref, () => ({
    updated() {
      if (atTop.current) {
        void latest();
      } else setNotice(true);
    },
  }));
  async function latest() {
    resetting.current = true;
    setNotice(false);
    atTop.current = true;
    anchor.current = null;
    try {
      await client.resetQueries({ queryKey: key });
      virtual.scrollToOffset(0);
    } finally {
      resetting.current = false;
    }
  }
  if (query.error) return <Problem error={query.error} />;
  return (
    <section
      className="history"
      aria-label={role === "admin" ? "構築の記録" : "あなたの記録"}
      data-retained-records={entries.length}
    >
      <div className="history-toolbar">
        <h2>{role === "admin" ? "構築の記録" : "あなたの記録"}</h2>
        <Button
          variant="ghost"
          onClick={() => {
            void latest();
          }}
        >
          {notice ? "更新を確認" : "最新へ"}
        </Button>
      </div>
      {notice && (
        <p role="status" className="notice">
          更新があります。読んでいる位置はそのまま保たれます。
        </p>
      )}
      {query.hasPreviousPage && (
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => {
            remember();
            void query.fetchPreviousPage();
          }}
        >
          新しい記録を読む
        </Button>
      )}
      <div
        ref={scroll}
        tabIndex={0}
        aria-label="記録の閲覧領域"
        className="history-scroll"
        onScroll={remember}
        aria-busy={query.isFetching}
      >
        {query.isPending ? (
          <p role="status">記録を読み込んでいます</p>
        ) : !entries.length ? (
          <p className="empty">
            {role === "admin"
              ? "確定した記録はまだありません。"
              : "知覚したことが、ここに記録されます。"}
          </p>
        ) : (
          <div
            style={{
              height: virtual.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virtual.getVirtualItems().map((item) => {
              const entry = entries[item.index]!;
              return (
                <article
                  key={item.key}
                  data-index={item.index}
                  data-record-id={entry.id}
                  ref={virtual.measureElement}
                  className="history-entry"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <p className="record-meta">
                    T + {worldTime(entry.at)}
                    {entry.kind === "interpretation" ? " · 当時の解釈" : ""}
                  </p>
                  <RichText text={entry.text} />
                  {entry.continuation && (
                    <p className="continuation">継続中: {entry.continuation}</p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
      {query.hasNextPage && (
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => {
            remember();
            void query.fetchNextPage();
          }}
        >
          古い記録を読む
        </Button>
      )}
      {query.isFetching && !query.isPending && (
        <p role="status" className="record-meta">
          記録を確認しています
        </p>
      )}
    </section>
  );
}
