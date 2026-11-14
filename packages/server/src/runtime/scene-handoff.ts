import { z } from "zod";
import type { ChatMessage } from "../llm/client.js";
import { canonical, parseOutput } from "../llm/prompt.js";
import type { Dependency } from "../world/store.js";
import {
  OperationPaused,
  Query,
  type Interaction,
  type WorldAgent,
} from "./agent.js";
import { sceneId } from "./scene-data.js";

const evidence = z.object({
  id: z.uuid(),
  note: z.string(),
  expires: z.array(z.string()),
  retains: z.array(z.string()),
  uncertain: z.array(z.string()),
});

export async function reviewSceneStates(
  agent: WorldAgent,
  request: Interaction,
  dependencies: Dependency[],
  reviewId: string,
  requested?: z.infer<typeof Query>[],
) {
  const scene = request.completedScene!;
  const ctx = agent.store.context(request.worldId, dependencies),
    at = request.until ?? request.at;
  const currentSources = [];
  const records = new Map<string, unknown>();
  const identities = new Set<string>();
  for (const [id, source] of Object.entries(scene.sources!)) {
    const current = await ctx.edge(id);
    identities.add(source.edge.source).add(source.edge.target);
    if (canonical(current ?? null) !== canonical(source.edge))
      currentSources.push({ id, current: current ?? null });
    records.set(id, { ...source, current: current ?? null });
  }
  const actors = new Set(
    [
      request.controlledActorId,
      ...scene.background.participants,
      ...(request.intentions ?? []).map((v) => v.actorId),
      ...scene.events.map((v) => v.actorId),
    ].filter((v): v is string => !!v),
  );
  const holders = new Set(actors);
  async function profile(holder: string) {
    const states = [];
    for (const edge of await ctx.relations(holder, "status", "out", at)) {
      if (edge.role !== "content") continue;
      const about = (await ctx.relations(edge.target, "status", "out", at))
        .filter((e) => e.role === "about")
        .map((e) => e.target);
      const state = {
        id: edge.id,
        holder,
        text: (await ctx.node(edge.target, at))?.text,
        about,
        period: edge.period,
      };
      states.push(state);
      records.set(edge.id, state);
    }
    return { holder, name: (await ctx.node(holder, at))?.text, states };
  }
  const profiles = [];
  for (const id of actors) {
    const actor = await profile(id);
    profiles.push(actor);
    for (const state of actor.states)
      for (const target of state.about)
        if ((await ctx.node(target, at))?.kind === "existence")
          holders.add(target);
    for (const link of await ctx.relations(id, "status", "in", at)) {
      if (link.role !== "about") continue;
      for (const owner of await ctx.relations(link.source, "status", "in", at))
        if (owner.role === "content") holders.add(owner.source);
    }
  }
  for (const id of holders)
    if (!actors.has(id)) profiles.push(await profile(id));
  let basis = ctx.dependencies;
  const decision = z.discriminatedUnion("type", [
    z.object({ type: z.literal("query"), requests: z.array(Query).min(1) }),
    z.object({
      type: z.literal("ready"),
      evidence: z.array(evidence),
      unknowns: z.array(z.string()),
    }),
  ]);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "世界更新前の追加調査です。表示済みの出来事と、本人・相手それぞれが持つ現状を照合します。旧位置や同席を含む終了候補は、持ち主と関係IDごとに、今回失効する部分(expires)、そのまま残す部分(retains)、未確認の部分(uncertain)と根拠(note)を分けて返します。実行・受容や変化を創作しません。不足する資料はqueryで照会し、揃ったらreadyで確定担当に渡してください。",
    },
    {
      role: "user",
      content: JSON.stringify({
        at: request.at,
        until: at,
        background: scene.background,
        sources: scene.sources,
        currentSources,
        events: scene.events,
        intentions: request.intentions,
        profiles,
        requested,
        responseSchema: z.toJSONSchema(decision, { io: "input" }),
      }),
    },
  ];
  for (;;) {
    // A replay of the same read uses its settled response. A changed graph can produce a different packet.
    const reply = await agent.model.complete(
      sceneId(reviewId + ":" + JSON.stringify(messages)),
      "scene-state-review",
      messages,
      "default",
      "resolution",
      true,
    );
    if (reply.finishReason !== "stop")
      throw new OperationPaused("世界更新前の調査が未完了です");
    messages.push({ role: "assistant", content: reply.content });
    try {
      const answer = decision.parse(parseOutput(reply.content));
      if (answer.type === "ready") {
        const missing = answer.evidence.find((v) => !records.has(v.id));
        if (missing) {
          messages.push({
            role: "user",
            content: JSON.stringify({
              validationErrors: "未照会の根拠ID: " + missing.id,
            }),
          });
          continue;
        }
        await agent.store.context(request.worldId, basis).validate();
        return {
          results: [
            {
              currentSources,
              evidence: answer.evidence.map((v) => ({
                ...v,
                record: records.get(v.id),
              })),
              unknowns: answer.unknowns,
            },
          ],
          dependencies: basis,
          controlledActorIds: [
            ...(await agent.controlledActors(request.worldId, [
              ...new Set([...holders, ...identities]),
            ])),
          ],
        };
      }
      const read = await agent.read(
        { request, dependencies: basis },
        answer.requests,
      );
      basis = read.dependencies;
      for (const actor of read.controlledActorIds) identities.add(actor);
      function index(v: unknown) {
        if (!v || typeof v !== "object") return;
        if ("id" in v && typeof v.id === "string" && "kind" in v)
          records.set(v.id, v);
        for (const child of Object.values(v)) index(child);
      }
      index(read.results);
      messages.push({
        role: "user",
        content: JSON.stringify({
          requests: answer.requests,
          results: read.results,
          controlledActorIds: read.controlledActorIds,
        }),
      });
    } catch (error) {
      if (!(error instanceof SyntaxError || error instanceof z.ZodError))
        throw error;
      messages.push({
        role: "user",
        content: JSON.stringify({ validationErrors: error.message }),
      });
    }
  }
}
