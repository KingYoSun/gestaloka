import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { WorldEvent } from "@gestaloka/contracts";
import { api, ScopeChanged } from "./api.js";

export function worldQuery(key: QueryKey, id: string, history = true) {
  if (key[0] === "history") return history && key[1] === id;
  const init = key[2] as { params?: { path?: { id?: string } } } | undefined;
  return init?.params?.path?.id === id || key[1] === "/api/runs/{id}";
}
export function useUpdates(
  id: string,
  role: "admin" | "player",
  onUpdate: () => void,
  viewer = "admin",
) {
  const client = useQueryClient(),
    callback = useRef(onUpdate);
  useEffect(() => {
    callback.current = onUpdate;
  }, [onUpdate]);
  const [connection, setConnection] = useState<"connecting" | "open" | "retry">(
    "connecting",
  );
  useEffect(() => {
    let live = true,
      stream: EventSource | undefined,
      timer: number | undefined,
      connecting = false,
      last = 0n;
    const controller = new AbortController();
    const reconnect = () => {
      stream?.close();
      if (timer) window.clearTimeout(timer);
      setConnection("retry");
      timer = window.setTimeout(() => {
        void connect();
      }, 1000);
    };
    async function connect() {
      if (!live || connecting) return;
      connecting = true;
      stream?.close();
      try {
        const { data } = await api.GET("/api/worlds/{id}/cursor", {
          params: { path: { id }, query: { role } },
          signal: controller.signal,
        });
        if (!data) throw new Error("配信位置を取得できませんでした");
        last = BigInt(data.cursor);
        await client.invalidateQueries({
          predicate: (query) => worldQuery(query.queryKey, id),
        });
        if (!live) return;
        callback.current();
        const source = new EventSource(
          `/api/worlds/${id}/events?role=${role}&after=${data.cursor}`,
        );
        stream = source;
        source.onopen = () => {
          if (live) setConnection("open");
        };
        source.addEventListener("update", (event) => {
          if (!live || stream !== source) return;
          try {
            const parsed = WorldEvent.parse(
              JSON.parse((event as MessageEvent<string>).data),
            );
            if (
              parsed.worldId !== id ||
              parsed.id !== (event as MessageEvent<string>).lastEventId
            )
              throw new Error("配信の文脈が変わりました");
            const sequence = BigInt(parsed.id);
            if (sequence <= last) return;
            last = sequence;
            void client.invalidateQueries({
              predicate: (query) => worldQuery(query.queryKey, id, false),
            });
            callback.current();
          } catch {
            source.close();
            reconnect();
          }
        });
        source.onerror = () => {
          if (live && stream === source) reconnect();
        };
      } catch (error) {
        if (
          live &&
          !(error instanceof ScopeChanged) &&
          !controller.signal.aborted
        )
          reconnect();
      } finally {
        connecting = false;
      }
    }
    void connect();
    const visible = () => {
      if (document.visibilityState === "visible") void connect();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      controller.abort();
      stream?.close();
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [client, id, role, viewer]);
  return connection;
}
