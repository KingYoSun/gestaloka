import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { SceneCommand, type SceneStatus } from "@gestaloka/contracts";
import { $api, api, pendingKey } from "./api.js";
import { usePending } from "./forms.js";
import { useUpdates, worldQuery } from "./updates.js";
import { History, type HistoryHandle } from "./History.js";
import { Notice, Problem, worldTime } from "./presentation.js";
import { RichText } from "./RichText.js";
import { Button } from "./components/ui/button.js";
import { Label } from "./components/ui/label.js";
import { Textarea } from "./components/ui/textarea.js";
import { Characters } from "./player-icons.js";
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
  selectedSceneId,
}: {
  id: string;
  viewer: string;
  at: number;
  scene: State | null;
  selectedSceneId?: string;
}) {
  const client = useQueryClient(),
    history = useRef<HistoryHandle>(null),
    messages = useRef<HistoryHandle>(null),
    actions = useRef<HistoryHandle>(null),
    composing = useRef(false),
    [showHistory, setShowHistory] = useState(!scene);
  const [pending, save] = usePending(
    pendingKey(
      `${id}:${viewer}${selectedSceneId ? `:${selectedSceneId}` : ""}`,
      "scene",
    ),
    SceneCommand,
  );
  const [showInputs, setShowInputs] = useState(false);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [pendingControl, saveControl] = usePending(
    pendingKey(`${id}:${viewer}`, "reaction"),
    z.object({ sceneId: z.uuid(), body: SceneCommand }),
  );
  const [pendingInvite, saveInvite] = usePending(
    pendingKey(`${id}:${viewer}`, "invite"),
    SceneCommand,
  );
  const form = useForm({
    defaultValues: {
      purpose:
        pending?.command === "prepare"
          ? pending.purpose
          : (scene?.nextPurpose ?? ""),
      actionText: pending?.command === "act" ? pending.actionText : "",
      shared: pending?.command === "prepare" ? !!pending.shared : false,
    },
  });
  const connection = useUpdates(
    id,
    "player",
    () => {
      messages.current?.updated();
      actions.current?.updated();
      if (!scene || scene.state === "result") history.current?.updated();
    },
    viewer,
  );
  const mutate = $api.useMutation("post", "/api/worlds/{id}/scene", {
    onSuccess: async (data) => {
      save(null);
      form.setValue("actionText", "");
      actions.current?.updated();
      await client.invalidateQueries({
        predicate: (q) => worldQuery(q.queryKey, id, false),
      });
      if (selectedSceneId && data.scene?.id !== selectedSceneId)
        window.location.assign(`/worlds/${id}/play?actorId=${viewer}`);
    },
  });
  const inbox = $api.useQuery(
    "get",
    "/api/worlds/{id}/scene/inbox",
    { params: { path: { id }, query: { actorId: viewer } } },
    { refetchInterval: 1000, gcTime: 0 },
  );
  const invite = $api.useMutation("post", "/api/worlds/{id}/scene", {
    onSuccess: async () => {
      saveInvite(null);
      await inbox.refetch();
      await client.invalidateQueries({
        predicate: (q) => worldQuery(q.queryKey, id, false),
      });
    },
  });
  const control = $api.useMutation("post", "/api/worlds/{id}/scene", {
    onSuccess: async () => {
      saveControl(null);
      await inbox.refetch();
      await client.invalidateQueries({
        predicate: (q) => worldQuery(q.queryKey, id, false),
      });
    },
  });
  function replyControl(
    sceneId: string,
    body: Extract<z.infer<typeof SceneCommand>, { command: "react" | "vote" }>,
  ) {
    if (control.isPending) return;
    const saved = pendingControl ?? { sceneId, body };
    if (saved.body.command !== "react" && saved.body.command !== "vote") return;
    saveControl(saved);
    control.mutate({
      params: {
        path: { id },
        query: { view: "compact", actorId: viewer, sceneId: saved.sceneId },
      },
      body: saved.body,
    });
  }
  function replyInvitation(invitationId: string, accept: boolean) {
    const body =
      pendingInvite?.command === "invite"
        ? pendingInvite
        : {
            requestId: crypto.randomUUID(),
            command: "invite" as const,
            invitationId,
            accept,
          };
    saveInvite(body);
    invite.mutate({
      params: { path: { id }, query: { actorId: viewer, view: "compact" } },
      body,
    });
  }
  const sharedScene = !!scene?.shared;
  useEffect(() => {
    if (!sharedScene) return;
    const connectionId = crypto.randomUUID();
    const heartbeat = (active: boolean) =>
      api
        .POST("/api/worlds/{id}/presence", {
          params: { path: { id }, query: { actorId: viewer } },
          body: { requestId: crypto.randomUUID(), connectionId, active },
        })
        .catch(() => {});
    void heartbeat(true);
    const interval = setInterval(() => {
      void heartbeat(true);
    }, 30000);
    return () => {
      clearInterval(interval);
      void heartbeat(false);
    };
  }, [id, viewer, sharedScene]);
  useEffect(() => {
    if (
      pending &&
      (scene?.requestId === pending.requestId ||
        scene?.shared?.requestIds.includes(pending.requestId))
    ) {
      save(null);
      if (
        pending.command === "act" &&
        form.getValues("actionText") === pending.actionText
      )
        form.setValue("actionText", "");
    }
  }, [pending, scene?.requestId, scene?.shared?.requestIds, save, form]);
  useEffect(() => {
    if (scene?.state === "result" && scene.nextPurpose)
      form.setValue("purpose", scene.nextPurpose);
  }, [scene?.state, scene?.nextPurpose, form]);
  function send(command: z.infer<typeof SceneCommand>) {
    if (mutate.isPending) return;
    const body = pending ?? command;
    save(body);
    mutate.mutate({
      params: {
        path: { id },
        query: {
          view: "compact",
          actorId: viewer,
          ...(selectedSceneId && body.command !== "prepare"
            ? { sceneId: selectedSceneId }
            : {}),
        },
      },
      body:
        body.command === "prepare"
          ? {
              requestId: body.requestId,
              command: body.command,
              purpose: body.purpose,
              ...(body.shared ? { shared: true as const } : {}),
            }
          : body,
    });
  }
  function simple(command: "start" | "finish" | "resume" | "leave") {
    send({ requestId: crypto.randomUUID(), command });
  }
  const entry =
      !scene ||
      scene.state === "result" ||
      !!scene.departed ||
      !!scene.waitingFor?.length,
    active =
      !!scene &&
      (scene.state === "active" ||
        (!!scene.shared && scene.state === "acting")) &&
      !scene.departed &&
      !["voting", "rounds", "inactive", "closing"].includes(
        scene.shared?.flow ?? "open",
      ),
    canFinish = scene?.shared
      ? scene.shared.owner &&
        scene.shared.flow !== "closing" &&
        ["active", "acting", "paused"].includes(scene.state) &&
        !scene.departed
      : active,
    busy = mutate.isPending || !!pending;
  function submit() {
    const values = form.getValues();
    if (busy) return;
    if (entry && values.purpose.trim())
      send({
        requestId: crypto.randomUUID(),
        command: "prepare",
        purpose: values.purpose,
        ...(values.shared ? { shared: true as const } : {}),
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
      {(!!inbox.data?.invitations.length ||
        pendingInvite?.command === "invite") && (
        <section className="form-panel">
          <h2>共有シーンへの参加要請</h2>
          {inbox.data?.invitations.map((i) => (
            <article key={i.id}>
              <p>
                この場面に同席しますか。参加は、場面内の依頼や取引への同意ではありません。
              </p>
              <details>
                <summary>あなたが知っている状況</summary>
                {i.context.map((text, index) => (
                  <p key={index}>{text}</p>
                ))}
              </details>
              <div className="action-footer">
                {[true, false].map((accept) => (
                  <Button
                    key={String(accept)}
                    disabled={invite.isPending || !!pendingInvite}
                    onClick={() => replyInvitation(i.id, accept)}
                  >
                    {accept ? "同席する" : "今回は参加しない"}
                  </Button>
                ))}
              </div>
            </article>
          ))}
          {pendingInvite?.command === "invite" && !invite.isPending && (
            <Button
              onClick={() =>
                replyInvitation(
                  pendingInvite.invitationId,
                  pendingInvite.accept,
                )
              }
            >
              同じ参加回答で確認する
            </Button>
          )}
          {invite.error && <Problem error={invite.error} />}
        </section>
      )}
      {(!!inbox.data?.opportunities?.length ||
        !!inbox.data?.proposals?.length ||
        !!pendingControl) && (
        <section className="form-panel">
          {inbox.data?.opportunities?.map((opportunity) => (
            <article key={opportunity.id}>
              <h2>返答を求められています</h2>
              <details>
                <summary>この返答で見聞きしていた範囲</summary>
                {opportunity.context.map((text, index) => (
                  <p key={index}>{text}</p>
                ))}
              </details>
              <Label htmlFor={`reaction-${opportunity.id}`}>
                返す発言や行動
              </Label>
              <Textarea
                id={`reaction-${opportunity.id}`}
                value={responses[opportunity.id] ?? ""}
                onChange={(e) =>
                  setResponses({
                    ...responses,
                    [opportunity.id]: e.currentTarget.value,
                  })
                }
              />
              <div className="action-footer">
                <Button
                  disabled={
                    control.isPending ||
                    !!pendingControl ||
                    !responses[opportunity.id]?.trim()
                  }
                  onClick={() =>
                    replyControl(opportunity.sceneId, {
                      requestId: crypto.randomUUID(),
                      command: "react",
                      opportunityId: opportunity.id,
                      actionText: responses[opportunity.id]!,
                    })
                  }
                >
                  この反応を返す
                </Button>
                <Button
                  variant="outline"
                  disabled={control.isPending || !!pendingControl}
                  onClick={() =>
                    replyControl(opportunity.sceneId, {
                      requestId: crypto.randomUUID(),
                      command: "react",
                      opportunityId: opportunity.id,
                      actionText: null,
                    })
                  }
                >
                  反応しない
                </Button>
              </div>
            </article>
          ))}
          {inbox.data?.proposals?.map((proposal) => (
            <article key={proposal.id}>
              <h2>このシーンを続けますか</h2>
              <p>
                ここまでのやりとりで終了するか、もう少し続けるかを選んでください。
              </p>
              <div className="action-footer">
                {[false, true].map((keepGoing) => (
                  <Button
                    key={String(keepGoing)}
                    disabled={control.isPending || !!pendingControl}
                    onClick={() =>
                      replyControl(proposal.sceneId, {
                        requestId: crypto.randomUUID(),
                        command: "vote",
                        proposalId: proposal.id,
                        continue: keepGoing,
                      })
                    }
                  >
                    {keepGoing ? "続ける" : "このシーンを終える"}
                  </Button>
                ))}
              </div>
            </article>
          ))}
          {pendingControl &&
            !control.isPending &&
            (pendingControl.body.command === "react" ||
              pendingControl.body.command === "vote") && (
              <Button
                onClick={() => {
                  const body = pendingControl.body;
                  if (body.command === "react" || body.command === "vote")
                    replyControl(pendingControl.sceneId, body);
                }}
              >
                同じ回答で確認する
              </Button>
            )}
          {control.error && <Problem error={control.error} />}
        </section>
      )}
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
        <Notice>
          {scene.shared?.flow === "voting"
            ? "終了・続行の回答を待っています。自動応答は止めています。"
            : scene.shared?.flow === "manual"
              ? "自動応答を止めています。次の行動を入力するか、シーンを終了できます。"
              : scene.shared?.flow === "rounds"
                ? "自動進行の上限で休止しています。開始者が再開・終了を選べます。"
                : scene.shared?.flow === "inactive"
                  ? "全員の接続がないため、シーンを保存して休止しています。"
                  : scene.departed
                    ? "退出しました。元のシーンの終了を待たず、次のシーンを始められます。"
                    : scene.waitingFor?.length
                      ? "シーンは終了しました。先行するシーンの確定後にリザルトを作成します。次のシーンは始められます。"
                      : scene.state === "preparing" &&
                          scene.shared?.phase === "inviting"
                        ? "同席の返答を待っています。回答が揃うか、締切を迎えたらあらすじを準備します。"
                        : scene.state === "paused"
                          ? (scene.error ?? labels.paused)
                          : labels[scene.state]}
        </Notice>
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
          <Characters characters={scene.synopsisCharacters} />
          <RichText text={scene.synopsis} />
          {scene.state === "ready" && (!scene.shared || scene.shared.owner) && (
            <Button disabled={busy} onClick={() => simple("start")}>
              シーンを始める
            </Button>
          )}
        </section>
      )}
      {scene?.actions.at(-1) && (
        <div className="submitted-action">
          <p className="record-meta">送った行動</p>
          <Characters characters={scene.actions.at(-1)!.characters} />
          <p className="plain-text">{scene.actions.at(-1)!.text}</p>
        </div>
      )}
      {scene && (
        <History
          ref={messages}
          id={id}
          role="player"
          viewer={viewer}
          sceneId={scene.id}
          sceneKind="events"
        />
      )}
      {scene && scene.actions.length > 0 && (
        <details
          className="scene-inputs"
          onToggle={(e) => setShowInputs(e.currentTarget.open)}
        >
          <summary>入力した行動</summary>
          {showInputs && (
            <History
              ref={actions}
              id={id}
              role="player"
              viewer={viewer}
              sceneId={scene.id}
              sceneKind="actions"
            />
          )}
        </details>
      )}
      {scene?.state === "reflecting" && scene.nextPurpose && (
        <Notice>
          続きの行動には新しい背景情報が必要です。リザルトのあと、次のシーンで続けられます。
        </Notice>
      )}
      {scene?.state === "paused" && (!scene.shared || scene.shared.owner) && (
        <Button disabled={busy} onClick={() => simple("resume")}>
          保存したシーンから再開する
        </Button>
      )}
      {scene?.state === "result" && scene.result && (
        <section className="scene-panel scene-result" aria-label="リザルト">
          <h2>リザルト</h2>
          <Characters characters={scene.resultCharacters} />
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
          {entry && (
            <Label>
              <input type="checkbox" {...form.register("shared")} />
              共有シーンとして参加を求める
            </Label>
          )}
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
      {scene && (active || canFinish) && (
        <div className="scene-end">
          {scene.shared && active && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => simple("leave")}
            >
              この場から退出する
            </Button>
          )}
          {canFinish && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => simple("finish")}
            >
              シーンを終えてリザルトを見る
            </Button>
          )}
        </div>
      )}
      {scene?.departed && scene.shared?.owner && scene.state === "active" && (
        <Button disabled={busy} onClick={() => simple("finish")}>
          元のシーンを終えてリザルトを見る
        </Button>
      )}
      {selectedSceneId && (
        <a href={`/worlds/${id}/play?actorId=${viewer}`}>現在のシーンへ戻る</a>
      )}
      {!!inbox.data?.items.some(
        (n) => n.sceneId && n.sceneId !== scene?.id,
      ) && (
        <details>
          <summary>シーンの通知と記録</summary>
          {[
            ...new Set(
              inbox.data.items
                .map((n) => n.sceneId)
                .filter((n) => n && n !== scene?.id),
            ),
          ].map((sceneId) => (
            <p key={sceneId}>
              <a
                href={`/worlds/${id}/play?actorId=${viewer}&sceneId=${sceneId}`}
              >
                別のシーンの記録を開く
              </a>
            </p>
          ))}
        </details>
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
          {...(scene ? { excludeScene: scene.id } : {})}
        />
      )}
    </main>
  );
}
