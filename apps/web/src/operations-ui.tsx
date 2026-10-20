import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { PlayerPreset, type WorldStatus } from "@gestaloka/contracts";
import { api, $api } from "./api.js";
import { Notice, Problem } from "./presentation.js";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";
import { Textarea } from "./components/ui/textarea.js";
import { Label } from "./components/ui/label.js";

const BudgetView = z.object({
  version: z.number(),
  limitUsd: z.number().nullable(),
  upperCostUsd: z.number().nullable(),
  since: z.string().nullable(),
  historyScope: z.string(),
});
export function WorldBudgetSettings({ id }: { id: string }) {
  const client = useQueryClient(),
    [value, setValue] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["world-budget", id],
    queryFn: async () =>
      BudgetView.parse(
        (
          await api.POST("/api/operations", {
            body: {
              requestId: crypto.randomUUID(),
              command: { operation: "worldBudgets.read", worldId: id },
            },
          })
        ).data?.result,
      ),
  });
  const mutation = $api.useMutation("post", "/api/operations", {
    onSuccess: () => {
      setValue(null);
      return client.invalidateQueries({ queryKey: ["world-budget", id] });
    },
  });
  if (query.error) return <Problem error={query.error} />;
  if (!query.data) return <Notice>世界の予算を確認しています。</Notice>;
  const budget = query.data;
  return (
    <form
      className="form-panel"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate({
          body: {
            requestId: crypto.randomUUID(),
            command: {
              operation: "worldBudgets.put",
              worldId: id,
              budgetUsd: Number(value ?? budget.limitUsd),
              expectedVersion: budget.version,
              reason: "管理画面から世界予算を変更",
            },
          },
        });
      }}
    >
      <h2>この世界の予算</h2>
      <p>
        {budget.upperCostUsd === null
          ? "予算は未設定です。API送信前に設定してください。"
          : `計算済み額と未確定予約額の合計: ${budget.upperCostUsd.toLocaleString("en-US", { maximumFractionDigits: 9 })} USD`}
      </p>
      {budget.historyScope !== "all" && (
        <p>
          既存世界の予算は設定後の追加費用に適用します。移行前の費用記録は全体の計算額として保持します。
        </p>
      )}
      {budget.since && (
        <p className="record-meta">
          予算管理の開始: {new Date(budget.since).toLocaleString()}
        </p>
      )}
      <Label htmlFor="world-budget-limit">予算上限（USD）</Label>
      <Input
        id="world-budget-limit"
        required
        type="number"
        min="0.000000001"
        step="any"
        value={value ?? budget.limitUsd ?? ""}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button disabled={mutation.isPending}>予算上限を保存する</Button>
      {mutation.error && <Problem error={mutation.error} />}
      {mutation.isSuccess && (
        <Notice>
          予算上限を保存しました。保留した処理は保存状態から再開できます。
        </Notice>
      )}
    </form>
  );
}

export function Publication({
  id,
  initial,
}: {
  id: string;
  initial: z.infer<typeof WorldStatus>["publication"];
}) {
  const [value, set] = useState(initial);
  const client = useQueryClient();
  const mutation = $api.useMutation("post", "/api/operations", {
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["get", "/api/worlds/{id}"] }),
  });
  return (
    <form
      className="form-panel"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate({
          body: {
            requestId: crypto.randomUUID(),
            command: {
              operation: "worlds.configure",
              worldId: id,
              ...value,
              reason: "管理画面から公開・参加受付を変更",
            },
          },
        });
      }}
    >
      <h2>公開・参加受付</h2>
      <Label htmlFor="public-title">公開用の名称</Label>
      <Input
        id="public-title"
        required
        value={value.title}
        onChange={(e) => set({ ...value, title: e.target.value })}
      />
      <Label htmlFor="public-description">公開用の説明</Label>
      <Textarea
        id="public-description"
        value={value.description}
        onChange={(e) => set({ ...value, description: e.target.value })}
      />
      <Label>
        <input
          type="checkbox"
          checked={value.published}
          onChange={(e) => set({ ...value, published: e.target.checked })}
        />{" "}
        登録済みの全員へ公開する
      </Label>
      <Label>
        <input
          type="checkbox"
          checked={value.accepting}
          onChange={(e) => set({ ...value, accepting: e.target.checked })}
        />{" "}
        新しい参加を受け付ける
      </Label>
      <p>非公開・受付停止にしても、参加済みの人物は利用を続けられます。</p>
      <Button disabled={mutation.isPending}>公開・参加受付を保存する</Button>
      {mutation.error && <Problem error={mutation.error} />}
      {mutation.isSuccess && <Notice>公開・参加受付を保存しました。</Notice>}
    </form>
  );
}
const Preset = PlayerPreset.extend({ settings: z.string() });
const Page = z.object({ items: z.array(Preset), next: z.uuid().nullable() });
const fresh = () => ({
  id: String(crypto.randomUUID()),
  title: "",
  description: "",
  settings: "",
  version: 0,
});
export function Presets() {
  const client = useQueryClient();
  const [before, setBefore] = useState<string>(),
    [value, set] = useState(fresh);
  const page = useQuery({
    queryKey: ["presets", before],
    gcTime: 0,
    queryFn: async () =>
      Page.parse(
        (
          await api.POST("/api/operations", {
            body: {
              requestId: crypto.randomUUID(),
              command: {
                operation: "presets.list",
                ...(before ? { before } : {}),
              },
            },
          })
        ).data?.result,
      ),
  });
  const mutation = $api.useMutation("post", "/api/operations", {
    onSuccess: () => {
      set(fresh());
      return client.invalidateQueries({ queryKey: ["presets"] });
    },
  });
  return (
    <section>
      <h2>参加者のプレイヤー設定</h2>
      <p>設定は参加時の生成に使い、参加済みの人物へ変更を遡及しません。</p>
      {page.error && <Problem error={page.error} />}
      {page.data?.items.map((p) => (
        <article className="world-row" key={p.id}>
          <div>
            <h3>{p.title}</h3>
            <p>{p.description}</p>
          </div>
          <Button variant="outline" onClick={() => set(p)}>
            編集する
          </Button>
        </article>
      ))}
      <div className="action-footer">
        {before && <Button onClick={() => setBefore(undefined)}>先頭へ</Button>}
        {page.data?.next && (
          <Button onClick={() => setBefore(page.data!.next!)}>
            次の設定へ
          </Button>
        )}
      </div>
      <form
        className="form-panel"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate({
            body: {
              requestId: crypto.randomUUID(),
              command: {
                operation: "presets.put",
                presetId: value.id,
                title: value.title,
                description: value.description,
                settings: value.settings,
                expectedVersion: value.version,
                reason: "管理画面からプレイヤー設定を保存",
              },
            },
          });
        }}
      >
        <h3>{value.version ? "設定を編集する" : "設定を作成する"}</h3>
        <Label htmlFor="preset-title">設定の名称</Label>
        <Input
          id="preset-title"
          required
          value={value.title}
          onChange={(e) => set({ ...value, title: e.target.value })}
        />
        <Label htmlFor="preset-description">参加者向けの説明</Label>
        <Textarea
          id="preset-description"
          value={value.description}
          onChange={(e) => set({ ...value, description: e.target.value })}
        />
        <Label htmlFor="preset-settings">生成用の設定本文（管理者向け）</Label>
        <Textarea
          id="preset-settings"
          required
          value={value.settings}
          onChange={(e) => set({ ...value, settings: e.target.value })}
        />
        <Button disabled={mutation.isPending}>プレイヤー設定を保存する</Button>
        {value.version > 0 && (
          <Button type="button" variant="outline" onClick={() => set(fresh())}>
            新規作成へ
          </Button>
        )}
        {mutation.error && <Problem error={mutation.error} />}
        {mutation.isSuccess && <Notice>プレイヤー設定を保存しました。</Notice>}
      </form>
    </section>
  );
}
