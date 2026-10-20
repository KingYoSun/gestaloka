import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { SceneCommand, type SceneStatus } from "@gestaloka/contracts";
import { $api, pendingKey } from "./api.js";
import { usePending } from "./forms.js";
import { useUpdates, worldQuery } from "./updates.js";
import { History, type HistoryHandle } from "./History.js";
import { Notice, Problem, worldTime } from "./presentation.js";
import { RichText } from "./RichText.js";
import { Button } from "./components/ui/button.js";
import { Label } from "./components/ui/label.js";
import { Textarea } from "./components/ui/textarea.js";
type State = z.infer<typeof SceneStatus>;
const labels = {
  preparing: "背景情報をもとに、シーンのあらすじをまとめています。",
  ready: "あらすじを読んだら、シーンを始められます。",
  active: "この場でどう行動しますか。",
  acting: "相手の反応や行動の結果を待っています。",
  reflecting: "このシーンが世界に残した影響をまとめています。",
  result: "このシーンのリザルトです。",
  paused: "処理を保留しました。保存したシーンから再開できます。",
};
export function ScenePlayer({
  id,
  viewer,
  at,
  scene,
}: {
  id: string;
  viewer: string;
  at: number;
  scene: State | null;
}) {
  const client = useQueryClient(),
    history = useRef<HistoryHandle>(null),
    composing = useRef(false),
    [showHistory, setShowHistory] = useState(!scene);
  const [pending, save] = usePending(pendingKey(id, "scene"), SceneCommand);
  const form = useForm({
    defaultValues: {
      purpose:
        pending?.command === "prepare"
          ? pending.purpose
          : (scene?.nextPurpose ?? ""),
      actionText: pending?.command === "act" ? pending.actionText : "",
    },
  });
  const connection = useUpdates(
    id,
    "player",
    () => {
      if (!scene || scene.state === "result") history.current?.updated();
    },
    viewer,
  );
  const mutate = $api.useMutation("post", "/api/worlds/{id}/scene", {
    onSuccess: async () => {
      save(null);
      form.setValue("actionText", "");
      await client.invalidateQueries({
        predicate: (q) => worldQuery(q.queryKey, id, false),
      });
    },
  });
  useEffect(() => {
    if (pending && scene?.requestId === pending.requestId) {
      save(null);
      if (
        pending.command === "act" &&
        form.getValues("actionText") === pending.actionText
      )
        form.setValue("actionText", "");
    }
  }, [pending, scene?.requestId, save, form]);
  useEffect(() => {
    if (scene?.state === "result" && scene.nextPurpose)
      form.setValue("purpose", scene.nextPurpose);
  }, [scene?.state, scene?.nextPurpose, form]);
  function send(command: z.infer<typeof SceneCommand>) {
    if (mutate.isPending) return;
    const body = pending ?? command;
    save(body);
    mutate.mutate({ params: { path: { id } }, body });
  }
  function simple(command: "start" | "finish" | "resume") {
    send({ requestId: crypto.randomUUID(), command });
  }
  const entry = !scene || scene.state === "result",
    active = scene?.state === "active",
    busy = mutate.isPending || !!pending;
  function submit() {
    const values = form.getValues();
    if (busy) return;
    if (entry && values.purpose.trim())
      send({
        requestId: crypto.randomUUID(),
        command: "prepare",
        purpose: values.purpose,
      });
    else if (active && values.actionText.trim())
      send({
        requestId: crypto.randomUUID(),
        command: "act",
        actionText: values.actionText,
      });
  }
  return (
    <main className="page play">
      <div className="play-heading">
        <div>
          <p className="eyebrow">LIVED STORIES</p>
          <h1>村民として</h1>
        </div>
        <p className="world-clock">T + {worldTime(scene?.at ?? at)}</p>
      </div>
      {connection !== "open" && (
        <Notice>再接続しています。保存したシーンから復帰します。</Notice>
      )}
      {scene ? (
        <Notice>{labels[scene.state]}</Notice>
      ) : (
        <Notice>
          次に体験したい場面を伝えてください。背景情報から、シーンのあらすじを準備します。
        </Notice>
      )}
      {mutate.error && <Problem error={mutate.error} />}
      {pending && !mutate.isPending && (
        <Button onClick={() => send(pending)}>同じ操作で確認する</Button>
      )}
      {scene?.synopsis && (
        <section className="scene-panel" aria-label="シーンのあらすじ">
          <p className="record-meta">シーン開始時の背景情報</p>
          <h2>シーンのあらすじ</h2>
          <RichText text={scene.synopsis} />
          {scene.state === "ready" && (
            <Button disabled={busy} onClick={() => simple("start")}>
              シーンを始める
            </Button>
          )}
        </section>
      )}
      {scene?.actions.at(-1) && (
        <div className="submitted-action">
          <p className="record-meta">送った行動</p>
          <p className="plain-text">{scene.actions.at(-1)!.text}</p>
        </div>
      )}
      {scene && scene.messages.length > 0 && (
        <section className="scene-panel" aria-label="このシーン">
          <h2>このシーン</h2>
          {scene.messages.map((m) => (
            <article className="scene-message" key={m.id}>
              <RichText text={m.text} />
            </article>
          ))}
        </section>
      )}
      {scene && scene.actions.length > 1 && (
        <details className="scene-inputs">
          <summary>入力した行動</summary>
          {scene.actions.map((a) => (
            <p className="plain-text" key={a.id}>
              {a.text}
              {a.state === "boundary" && (
                <span className="record-meta"> — 続きは次のシーンで</span>
              )}
            </p>
          ))}
        </details>
      )}
      {scene?.state === "reflecting" && scene.nextPurpose && (
        <Notice>
          続きの行動には新しい背景情報が必要です。リザルトのあと、次のシーンで続けられます。
        </Notice>
      )}
      {scene?.state === "paused" && (
        <Button disabled={busy} onClick={() => simple("resume")}>
          保存したシーンから再開する
        </Button>
      )}
      {scene?.state === "result" && scene.result && (
        <section className="scene-panel scene-result" aria-label="リザルト">
          <h2>リザルト</h2>
          <RichText text={scene.result} />
        </section>
      )}
      {(entry || active) && (
        <form
          className="action-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!composing.current) submit();
          }}
        >
          <Label htmlFor="scene-input">
            {entry ? "次のシーンで何をしたいですか" : "どう行動しますか"}
          </Label>
          <Textarea
            id="scene-input"
            rows={4}
            placeholder={
              entry
                ? "体験したい場面や目的を、自由に書いてください。"
                : "行いたいことを、自由に書いてください。"
            }
            readOnly={busy}
            {...form.register(entry ? "purpose" : "actionText")}
            aria-describedby="scene-help"
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                (e.ctrlKey || e.metaKey) &&
                !e.nativeEvent.isComposing &&
                !composing.current &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="action-footer">
            <p id="scene-help" className="record-meta">
              {entry
                ? "実際の行動は、あらすじを読んでシーンを始めた後に入力します。"
                : "Ctrl / ⌘ + Enter で送信"}
            </p>
            <Button type="submit" disabled={busy}>
              {mutate.isPending
                ? "受け付けています"
                : entry
                  ? "シーンのあらすじを準備する"
                  : "この行動を送る"}
            </Button>
          </div>
        </form>
      )}
      {active && (
        <div className="scene-end">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => simple("finish")}
          >
            シーンを終えてリザルトを見る
          </Button>
        </div>
      )}
      <div className="scene-history-toggle">
        <Button variant="ghost" onClick={() => setShowHistory(!showHistory)}>
          {showHistory ? "これまでの記録を閉じる" : "これまでの記録を読む"}
        </Button>
      </div>
      {showHistory && (
        <History
          ref={history}
          id={id}
          role="player"
          viewer={viewer}
          {...(scene ? { excludeIds: scene.recordIds } : {})}
        />
      )}
    </main>
  );
}
