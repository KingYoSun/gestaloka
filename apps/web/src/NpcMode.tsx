import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { z } from "zod";
import type { NpcModeCommand } from "@gestaloka/contracts";
import { $api } from "./api.js";
import { Button } from "./components/ui/button.js";
import { Problem } from "./presentation.js";
import { worldQuery } from "./updates.js";

export function NpcMode({
  id,
  actorId,
  children,
}: {
  id: string;
  actorId: string;
  children: ReactNode;
}) {
  const client = useQueryClient(),
    params = { path: { id }, query: { actorId } };
  const report = $api.useQuery(
    "get",
    "/api/worlds/{id}/npc-mode",
    { params },
    {
      refetchInterval: (q) =>
        q.state.data?.active ||
        q.state.data?.scenes.some((s) => s.handoff === "processing")
          ? 3000
          : false,
    },
  );
  const change = $api.useMutation("post", "/api/worlds/{id}/npc-mode", {
    onSuccess: async () => {
      await client.invalidateQueries({
        predicate: (q) => worldQuery(q.queryKey, id),
      });
    },
  });
  function send(body: z.infer<typeof NpcModeCommand>) {
    change.mutate({ params, body });
  }
  const data = report.data;
  return (
    <>
      <section className="page" aria-label="離席中のプレイ">
        <Button
          disabled={!data || change.isPending}
          onClick={() =>
            send({
              command: data?.active ? "return" : "away",
              requestId: crypto.randomUUID(),
            })
          }
        >
          {data?.active ? "NPCモードから復帰する" : "NPCモードで離席する"}
        </Button>
        {data?.active && <p>離席中です。あなたの人物はNPCとして行動します。</p>}
        {change.error && <Problem error={change.error} />}
        {report.error && <Problem error={report.error} />}
        {data && (data.active || data.scenes.length > 0 || change.data) && (
          <>
            <h2>離席中の記録</h2>
            <p>{data.summary}</p>
            {data.scenes.map((scene, i) => (
              <section key={scene.sceneId}>
                <details>
                  <summary>
                    シーン {i + 1} のログ（{scene.log.length}件）
                  </summary>
                  {scene.log.map((entry, i) => (
                    <p key={i}>
                      <strong>
                        {entry.kind === "intent" ? "選んだ行動" : "見聞"}
                      </strong>{" "}
                      {entry.text}
                    </p>
                  ))}
                </details>
                {scene.handoff === "processing" && (
                  <p>シーンの進行後に参加を選べます。</p>
                )}
                {scene.handoff === "available" && (
                  <div className="actions">
                    <Button
                      disabled={change.isPending}
                      onClick={() =>
                        send({
                          command: "join",
                          requestId: crypto.randomUUID(),
                          sceneId: scene.sceneId,
                        })
                      }
                    >
                      このシーンに参加する
                    </Button>
                    <Button
                      disabled={change.isPending}
                      onClick={() =>
                        send({
                          command: "decline",
                          requestId: crypto.randomUUID(),
                          sceneId: scene.sceneId,
                        })
                      }
                    >
                      辞退して場を離れる
                    </Button>
                  </div>
                )}
              </section>
            ))}
          </>
        )}
      </section>
      {!data?.active && children}
    </>
  );
}
