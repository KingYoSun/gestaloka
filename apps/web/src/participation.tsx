import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { JoinWorld } from "@gestaloka/contracts";
import { $api, pendingKey } from "./api.js";
import { usePending } from "./forms.js";
import { Notice, Problem } from "./presentation.js";
import { Button } from "./components/ui/button.js";
import { Label } from "./components/ui/label.js";

const Request = z.object({ requestId: z.uuid(), command: JoinWorld });
function Pages({
  before,
  next,
  set,
}: {
  before: string | undefined;
  next: string | null | undefined;
  set: (value: string | undefined) => void;
}) {
  return (
    <div className="action-footer">
      {before && (
        <Button type="button" variant="outline" onClick={() => set(undefined)}>
          先頭へ
        </Button>
      )}
      {next && (
        <Button type="button" variant="outline" onClick={() => set(next)}>
          次の一覧へ
        </Button>
      )}
    </div>
  );
}
export function Catalog() {
  const [before, setBefore] = useState<string>();
  const worlds = $api.useQuery(
    "get",
    "/api/catalog/worlds",
    { params: { query: before ? { before } : {} } },
    { gcTime: 0 },
  );
  return (
    <main className="page">
      <div className="page-title">
        <p className="eyebrow">SHARED WORLD</p>
        <h1>参加する世界を選ぶ</h1>
        <p>公開されている世界と、あなたが参加済みの世界を開けます。</p>
      </div>
      {worlds.error ? (
        <Problem error={worlds.error} />
      ) : !worlds.data ? (
        <Notice>世界を読み込んでいます</Notice>
      ) : (
        <>
          <section className="worlds">
            {worlds.data.items.map((w) => (
              <article className="world-row" key={w.id}>
                <div>
                  <h2>{w.title || w.id}</h2>
                  <p className="plain-text">{w.description}</p>
                  <p className="record-meta">
                    {w.canJoin ? "参加受付中" : "新規参加は受付停止中"}
                  </p>
                </div>
                <Link
                  to="/worlds/$id"
                  params={{ id: w.id }}
                  className="text-link"
                >
                  世界を開く →
                </Link>
              </article>
            ))}
            {!worlds.data.items.length && (
              <p>参加できる世界はまだありません。</p>
            )}
          </section>
          <Pages before={before} next={worlds.data.next} set={setBefore} />
        </>
      )}
    </main>
  );
}
export function Participation({ id }: { id: string }) {
  const client = useQueryClient();
  const [before, setBefore] = useState<string>(),
    [presetBefore, setPresetBefore] = useState<string>(),
    [choice, setChoice] = useState("");
  const [pending, save] = usePending(pendingKey(id, "join"), Request);
  const world = $api.useQuery("get", "/api/catalog/worlds/{id}", {
    params: { path: { id } },
  });
  const presets = $api.useQuery(
    "get",
    "/api/catalog/presets",
    { params: { query: presetBefore ? { before: presetBefore } : {} } },
    { gcTime: 0 },
  );
  const players = $api.useQuery(
    "get",
    "/api/worlds/{id}/players",
    { params: { path: { id }, query: before ? { before } : {} } },
    {
      gcTime: 0,
      refetchInterval: (q) =>
        q.state.data?.items.some((p) => p.state === "joining") ? 1000 : false,
    },
  );
  const tracked = $api.useQuery(
    "get",
    "/api/worlds/{id}/players/{playerId}",
    { params: { path: { id, playerId: pending?.requestId ?? id } } },
    {
      enabled: !!pending,
      gcTime: 0,
      refetchInterval: (q) =>
        q.state.data?.player?.state === "joining" ? 1000 : false,
    },
  );
  const invalidate = () =>
    client.invalidateQueries({
      predicate: (q) => JSON.stringify(q.queryKey).includes(id),
    });
  const join = $api.useMutation("post", "/api/operations", {
    onSettled: invalidate,
  });
  const resume = $api.useMutation("post", "/api/operations", {
    onSettled: invalidate,
  });
  const selected = presets.data?.items.find(
    (p) => p.id === (choice || presets.data.items[0]?.id),
  );
  const person = tracked.data?.player;
  const open = (actorId: string, label: string) => (
    <Link
      to="/worlds/$id/play"
      params={{ id }}
      search={{ actorId }}
      className="text-link"
      onClick={() => {
        if (person?.actorId === actorId) save(null);
      }}
    >
      {label} →
    </Link>
  );
  return (
    <main className="page">
      <div className="page-title">
        <h1>{world.data?.title || "世界への参加"}</h1>
        <p className="plain-text">{world.data?.description}</p>
      </div>
      {world.error && <Problem error={world.error} />}
      <section>
        <h2>あなたの操作対象</h2>
        {players.error ? (
          <Problem error={players.error} />
        ) : (
          players.data?.items.map((p) => (
            <article className="world-row" key={p.id}>
              <p>
                {p.state === "joining"
                  ? "人物を準備しています"
                  : p.state === "paused"
                    ? "参加生成を保留しています"
                    : "参加済みの人物"}
              </p>
              {p.actorId
                ? open(p.actorId, "この人物で開く")
                : p.state === "paused" && (
                    <Button
                      disabled={resume.isPending}
                      onClick={() =>
                        resume.mutate({
                          body: {
                            requestId: crypto.randomUUID(),
                            command: {
                              operation: "worlds.resumeJoin",
                              joinId: p.id,
                            },
                          },
                        })
                      }
                    >
                      参加生成を再開する
                    </Button>
                  )}
            </article>
          ))
        )}
        <Pages before={before} next={players.data?.next} set={setBefore} />
      </section>
      {pending ? (
        <section className="form-panel">
          <h2>参加要求</h2>
          {person?.state === "ready" && person.actorId ? (
            <>
              {open(person.actorId, "この人物で始める")}
              <Button variant="outline" onClick={() => save(null)}>
                別の人物で参加する
              </Button>
            </>
          ) : person?.state === "joining" ? (
            <Notice>
              人物を準備しています。画面を閉じても処理は続きます。
            </Notice>
          ) : person?.state === "paused" ? (
            <>
              <Notice>
                参加生成を保留しました。保存した状態から再開できます。
              </Notice>
              <Button
                disabled={resume.isPending}
                onClick={() =>
                  resume.mutate({
                    body: {
                      requestId: crypto.randomUUID(),
                      command: {
                        operation: "worlds.resumeJoin",
                        joinId: pending.requestId,
                      },
                    },
                  })
                }
              >
                保存した状態から参加生成を再開する
              </Button>
            </>
          ) : (
            <Button
              disabled={join.isPending}
              onClick={() => join.mutate({ body: pending })}
            >
              同じ参加要求で確認する
            </Button>
          )}
        </section>
      ) : world.data?.canJoin ? (
        <form
          className="form-panel"
          onSubmit={(e) => {
            e.preventDefault();
            if (!selected || join.isPending) return;
            const body = {
              requestId: crypto.randomUUID(),
              command: {
                operation: "worlds.join" as const,
                worldId: id,
                presetId: selected.id,
                presetVersion: selected.version,
              },
            };
            save(body);
            join.mutate({ body });
          }}
        >
          <h2>新しく参加する</h2>
          <Label htmlFor="player-preset">プレイヤー設定</Label>
          <select
            id="player-preset"
            value={selected?.id ?? ""}
            onChange={(e) => setChoice(e.target.value)}
          >
            {presets.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <p className="plain-text">{selected?.description}</p>
          <Pages
            before={presetBefore}
            next={presets.data?.next}
            set={(v) => {
              setPresetBefore(v);
              setChoice("");
            }}
          />
          {!presets.data?.items.length && (
            <Notice>プレイヤー設定はまだ用意されていません。</Notice>
          )}
          <Button type="submit" disabled={!selected || join.isPending}>
            この設定で参加する
          </Button>
        </form>
      ) : (
        <Notice>
          現在、新しい参加は受け付けていません。参加済みの人物は引き続き開けます。
        </Notice>
      )}
      {join.error && <Problem error={join.error} />}
      {resume.error && <Problem error={resume.error} />}
      {presets.error && <Problem error={presets.error} />}
      {tracked.error && <Problem error={tracked.error} />}
    </main>
  );
}
