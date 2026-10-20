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
