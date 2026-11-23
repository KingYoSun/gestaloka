import { BotSession } from "./BotSession.js";
import { useEffect, useRef, useState } from "react";
import { Link, useRouter, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CreateWorld, WorldCommand } from "@gestaloka/contracts";
import { $api, pendingKey } from "./api.js";
import { usePending, DurationForm } from "./forms.js";
import { useUpdates, worldQuery } from "./updates.js";
import { History, type HistoryHandle } from "./History.js";
import { Notice, Problem, worldTime, createdDate } from "./presentation.js";
import { Button } from "./components/ui/button.js";
import { Textarea } from "./components/ui/textarea.js";
import { Input } from "./components/ui/input.js";
import { Label } from "./components/ui/label.js";
import { Publication, Presets, WorldBudgetSettings } from "./operations-ui.js";
import { operate } from "./operations-client.js";

const PromptForm = CreateWorld.omit({ requestId: true }).extend({
  prompt: z.string().min(1, "初期設定を入力してください"),
});
const stateLabels = {
  generating: "初期世界を生成中",
  ready: "区切りに到達",
  running: "試遊を進行中",
  paused: "試遊を保留中",
  finished: "世界構築を完了",
  joining: "新しい村民を準備中",
  playing: "村民が行動中",
  play_paused: "村民の行動を保留中",
};

export function Home() {
  const router = useRouter(),
    client = useQueryClient(),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [pending, save] = usePending(pendingKey("new", "create"), CreateWorld);
  const form = useForm<z.infer<typeof PromptForm>>({
    resolver: zodResolver(PromptForm),
    defaultValues: {
      prompt: pending?.prompt ?? "",
      playerSettings: pending?.playerSettings ?? "",
      ...(pending ? { budgetUsd: pending.budgetUsd } : {}),
    },
  });
  const [before, setBefore] = useState<string>();
  const worlds = useQuery({
    queryKey: ["admin-worlds", before],
    gcTime: 0,
    queryFn: async ({ signal }) =>
      z
        .object({
          items: z.array(z.object({ id: z.uuid() })),
          next: z.uuid().nullable(),
        })
        .parse(
          await operate(
            { operation: "worlds.list", ...(before ? { before } : {}) },
            undefined,
            signal,
          ),
        ),
  });
  const create = $api.useMutation("post", "/api/worlds", {
    onSuccess: (data) => {
      if (!data) return;
      save(null);
      form.reset();
      void client.invalidateQueries({ queryKey: ["admin-worlds"] });
      if (alive.current)
        void router.navigate({ to: "/worlds/$id", params: { id: data.id } });
    },
  });
  function submit(value: z.infer<typeof PromptForm>) {
    const body = pending ?? {
      requestId: crypto.randomUUID(),
      prompt: value.prompt,
      playerSettings: value.playerSettings ?? "",
      budgetUsd: value.budgetUsd,
    };
    save(body);
    const { playerSettings, ...request } = body;
    create.mutate({
      body: {
        ...request,
        ...(playerSettings !== undefined ? { playerSettings } : {}),
      },
    });
  }
  return (
    <main className="page home">
      <div className="page-title">
        <p className="eyebrow">WORLD BUILDING</p>
        <h1>世界を始める</h1>
        <p>
          初期設定を入力してください。生成後、進める時間を指定して試遊します。
        </p>
      </div>
      <form onSubmit={form.handleSubmit(submit)} className="form-panel">
        <Label htmlFor="world-prompt">世界の初期設定</Label>
        <Textarea
          id="world-prompt"
          rows={7}
          placeholder="どんな場所に、どんな人々が暮らしていますか。"
          readOnly={!!pending || create.isPending}
          {...form.register("prompt")}
          aria-describedby="prompt-error"
        />
        <p id="prompt-error" className="field-error">
          {form.formState.errors.prompt?.message}
        </p>
        <Label htmlFor="world-player-settings">参加者の基本設定</Label>
        <Textarea
          id="world-player-settings"
          rows={3}
          readOnly={!!pending || create.isPending}
          {...form.register("playerSettings")}
        />
        <p>
          参加する一人ひとりに適用します。ここに書いた人物や持ち物は、参加時に作られます。
        </p>
        <Label htmlFor="world-budget">この世界の予算上限（USD）</Label>
        <Input
          id="world-budget"
          type="number"
          min="0.000000001"
          step="any"
          required
          readOnly={!!pending || create.isPending}
          {...form.register("budgetUsd", { valueAsNumber: true })}
        />
        <p className="field-error">
          {form.formState.errors.budgetUsd?.message}
        </p>
        {pending && <Notice>前回と同じ入力・要求IDで受付を確認します。</Notice>}
        {create.error && <Problem error={create.error} />}
        <Button type="submit" disabled={create.isPending}>
          {create.isPending
            ? "受け付けています"
            : pending
              ? "同じ入力で確認する"
              : "初期世界を生成する"}
        </Button>
      </form>
      <section className="worlds">
        <h2>あなたの世界</h2>
        {worlds.error ? (
          <Problem error={worlds.error} />
        ) : worlds.isPending ? (
          <Notice>記録を読み込んでいます</Notice>
        ) : !worlds.data?.items.length ? (
          <p className="muted">作成した世界はここから開けます。</p>
        ) : (
          worlds.data.items.map((world) => (
            <WorldCard key={world.id} id={world.id} />
          ))
        )}
        <div className="action-footer">
          {before && (
            <Button onClick={() => setBefore(undefined)}>先頭の世界へ</Button>
          )}
          {worlds.data?.next && (
            <Button onClick={() => setBefore(worlds.data!.next!)}>
              次の世界を取得
            </Button>
          )}
        </div>
      </section>
      <Presets />
    </main>
  );
}
function WorldCard({ id }: { id: string }) {
  const query = $api.useQuery("get", "/api/worlds/{id}", {
    params: { path: { id } },
  });
  if (query.error) return <Problem error={query.error} />;
  if (!query.data) return <p className="muted">記録を読み込んでいます</p>;
  const world = query.data;
  return (
    <article className="world-row">
      <div>
        <p className="record-meta">
          {createdDate(world.createdAt)} · {stateLabels[world.state]}
        </p>
        <p className="world-excerpt">{world.prompt}</p>
      </div>
      <Link to="/worlds/$id" params={{ id }} className="text-link">
        構築を開く →
      </Link>
    </article>
  );
}

export function Manage({ id }: { id: string }) {
  const client = useQueryClient(),
    history = useRef<HistoryHandle>(null);
  const query = $api.useQuery("get", "/api/worlds/{id}", {
    params: { path: { id } },
  });
  const connection = useUpdates(id, "admin", () => history.current?.updated());
  const [pending, save] = usePending(pendingKey(id, "command"), WorldCommand);
  const duration = useForm<
    z.input<typeof DurationForm>,
    unknown,
    z.output<typeof DurationForm>
  >({
    resolver: zodResolver(DurationForm),
    defaultValues: { amount: "1" },
  });
  const command = $api.useMutation("post", "/api/worlds/{id}/commands", {
    onSuccess: () => {
      save(null);
      return client.invalidateQueries({
        predicate: (query) => worldQuery(query.queryKey, id),
      });
    },
  });
  function send(body: z.infer<typeof WorldCommand>) {
    const request = pending ?? body;
    save(request);
    command.mutate({ params: { path: { id } }, body: request });
  }
  if (query.error)
    return (
      <main className="page">
        <Problem error={query.error} />
      </main>
    );
  if (!query.data)
    return (
      <main className="page">
        <Notice>世界を読み込んでいます</Notice>
      </main>
    );
  const world = query.data,
    busy =
      ["generating", "running", "joining", "playing"].includes(world.state) ||
      command.isPending;
  return (
    <main className="page management">
      <div className="page-title">
        <p className="eyebrow">WORLD BUILDING</p>
        <h1>世界構築</h1>
        <p className="state" role="status">
          {stateLabels[world.state]}
        </p>
      </div>
      <details className="initial-setting">
        <summary>初期設定を確認する</summary>
        <p className="plain-text">{world.prompt}</p>
      </details>
      <div className="time-summary">
        <div>
          <span>現在の世界内時刻</span>
          <strong>T + {worldTime(world.at)}</strong>
        </div>
        <div>
          <span>構築区間の目標</span>
          <strong>T + {worldTime(world.target)}</strong>
        </div>
      </div>
      {connection !== "open" && (
        <Notice>
          接続を確認しています。受け付けた処理はサーバーで継続します。
        </Notice>
      )}
      {world.error && <Problem error={new Error(world.error)} />}
      {command.error && <Problem error={command.error} />}
      {pending && (
        <div className="pending-action">
          <Notice>前回の操作の受付を確認できます。</Notice>
          <Button disabled={command.isPending} onClick={() => send(pending)}>
            同じ操作で確認する
          </Button>
        </div>
      )}
      {!pending && world.state === "ready" && (
        <div className="build-controls">
          <form
            onSubmit={duration.handleSubmit((value) =>
              send({
                requestId: crypto.randomUUID(),
                command: "advance",
                duration: value.duration,
              }),
            )}
          >
            <Label htmlFor="duration">さらに進める日数</Label>
            <div className="duration-fields">
              <Input
                id="duration"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                {...duration.register("amount")}
                aria-describedby="duration-error"
              />
              <span>日</span>
              <Button type="submit" disabled={busy}>
                {world.at === 0 ? "試遊を進める" : "さらに進める"}
              </Button>
            </div>
            <p id="duration-error" className="field-error">
              {duration.formState.errors.amount?.message}
            </p>
          </form>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              send({ requestId: crypto.randomUUID(), command: "finish" })
            }
          >
            世界構築を完了する
          </Button>
        </div>
      )}
      {!pending && world.state === "paused" && (
        <Button
          onClick={() =>
            send({ requestId: crypto.randomUUID(), command: "resume" })
          }
          disabled={busy}
        >
          保存した状態から再開する
        </Button>
      )}
      <Publication
        id={id}
        skillSlots={world.inventoryLimits?.skillSlots}
        initial={{
          ...world.publication,
          playerSettings: world.playerSettings ?? "",
        }}
      />
      <WorldBudgetSettings id={id} />
      <History ref={history} id={id} role="admin" viewer="admin" />
    </main>
  );
}

export function Player({ id }: { id: string }) {
  const { actorId, sceneId } = useSearch({ from: "/worlds/$id/play" });
  return (
    <main className="page play-page">
      <BotSession
        key={`${id}:${actorId ?? "selected"}:${sceneId ?? "current"}`}
        id={id}
        {...(actorId ? { actorId } : {})}
        {...(sceneId ? { sceneId } : {})}
      />
    </main>
  );
}
