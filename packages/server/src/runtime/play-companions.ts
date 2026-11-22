import type pg from "pg";
import type { z } from "zod";
import type { PlayCommand } from "@gestaloka/contracts";
import { AccessError } from "../http/access.js";
import { directPlaces } from "../world/locations.js";
import { derivedId, type Change } from "../world/model.js";
import type { WorldContext } from "../world/store.js";

type Db = Pick<pg.Pool, "query">;
export type CompanionCommand = Extract<
  z.infer<typeof PlayCommand>,
  { command: `companion-${string}` }
>;
type Companion = {
  npc_id: string;
  actor_id: string;
  mode: "follow" | "wait";
  order_text: string | null;
};

const latest = Number.MAX_SAFE_INTEGER,
  limit = 3;
const fail = (code: string, message: string): never => {
  throw new AccessError(409, code, message);
};
const empty = (): Change => ({
  nodes: [],
  revisions: [],
  edges: [],
  endEdges: [],
});
// 主体から記述へのcontentと、記述から対象へのaboutの組を作る。
const described = (
  changes: Change,
  key: string,
  at: number,
  kind: "status" | "interpret",
  mark: string,
  source: string,
  text: string,
  target: { id: string; text: string },
) => {
  const script = derivedId(`${key}:${mark}`);
  changes.nodes.push({ id: script, kind: "script", text });
  changes.edges.push(
    {
      id: derivedId(`${script}:content`),
      kind,
      role: "content",
      text: mark,
      source,
      target: script,
      period: { from: at },
    },
    {
      id: derivedId(`${script}:about`),
      kind,
      role: "about",
      text: target.text,
      source: script,
      target: target.id,
      period: { from: at },
    },
  );
};

// プレイヤーに付いてくるNPC（ADR-076）。関係そのものは共有グラフのstatusに置き、
// 追従か待機か・最新の指示と、プレイヤーとNPCの双方からの索引をこの表に置く。
export class PlayCompanions {
  async setup(db: Db) {
    await db.query(`CREATE TABLE IF NOT EXISTS bot_companion (
      world_id uuid NOT NULL REFERENCES world_construction(id),
      npc_id uuid NOT NULL, actor_id uuid NOT NULL,
      mode text NOT NULL DEFAULT 'follow' CHECK(mode IN ('follow','wait')),
      order_text text, PRIMARY KEY(world_id,npc_id));
      CREATE INDEX IF NOT EXISTS bot_companion_actor ON bot_companion(world_id,actor_id);`);
  }

  async owned(db: Db, world: string, actor: string) {
    return (
      await db.query<Companion>(
        "SELECT * FROM bot_companion WHERE world_id=$1 AND actor_id=$2 ORDER BY npc_id",
        [world, actor],
      )
    ).rows;
  }

  async #of(db: Db, world: string, npc: string) {
    return (
      await db.query<Companion>(
        "SELECT * FROM bot_companion WHERE world_id=$1 AND npc_id=$2",
        [world, npc],
      )
    ).rows[0];
  }

  // 本人のcompanionであることを確かめる。
  async mine(db: Db, world: string, actor: string, npc: string) {
    const row = await this.#of(db, world, npc);
    if (row?.actor_id !== actor)
      fail("COMPANION_REQUIRED", "本人のcompanionを指定してください");
    return row!;
  }

  // 同行を申請できる相手か。GMを呼ぶ前と、関係を確定する直前に確かめる。
  async check(
    db: Db,
    world: string,
    actor: string,
    target: string,
    members: { actorId: string; instant?: unknown }[],
  ) {
    const npcs = (
      await db.query<{ actor_id: string }>(
        "SELECT actor_id FROM bot_npc WHERE world_id=$1 AND actor_id=ANY($2::uuid[])",
        [world, [actor, target]],
      )
    ).rows.map((r) => r.actor_id);
    if (npcs.includes(actor))
      fail("COMPANION_PLAYER_REQUIRED", "companionを持てるのはプレイヤーです");
    const member = members.find((m) => m.actorId === target);
    if (member?.instant)
      fail(
        "COMPANION_PROMOTION_REQUIRED",
        "出現個体をcompanionにするには、先にユニークNPCへ昇格させてください",
      );
    if (!member || !npcs.includes(target))
      fail(
        "COMPANION_TARGET_UNAVAILABLE",
        "同じセッションにいるユニークNPCを指定してください",
      );
    const owner = await this.#of(db, world, target);
    if (owner)
      fail(
        "COMPANION_TAKEN",
        owner.actor_id === actor
          ? "すでに本人のcompanionです"
          : "このNPCは別の人物のcompanionです",
      );
    if ((await this.owned(db, world, actor)).length >= limit)
      fail("COMPANION_LIMIT", `companionは${limit}体までです`);
  }

  // GMが同行を認めた関係を、NPCの状態として記録して索引に加える。
  async form(
    db: Db,
    world: string,
    context: WorldContext,
    requestId: string,
    at: number,
    actor: string,
    npc: string,
    commit: (context: WorldContext, changes: Change) => Promise<unknown>,
  ) {
    const person = (await context.node(actor))!;
    const changes = empty();
    described(
      changes,
      requestId,
      at,
      "status",
      "companion",
      npc,
      `${person.text}に同行している`,
      person,
    );
    await commit(context, changes);
    await db.query(
      "INSERT INTO bot_companion(world_id,npc_id,actor_id) VALUES($1,$2,$3)",
      [world, npc, actor],
    );
  }

  // NPCが帰る場所として認識している場所。
  async home(context: WorldContext, npc: string) {
    for (const edge of await context.marked(npc, "interpret", "home"))
      for (const about of await context.relations(
        edge.target,
        "interpret",
        "out",
        latest,
      ))
        if (about.role === "about") return about.target;
    return undefined;
  }

  // 確定の後に読む一覧は、確定で進んだ版を読む新しい文脈で作る。
  async command(
    db: Db,
    world: string,
    contexts: () => WorldContext,
    actor: string,
    input: CompanionCommand,
    at: number,
    commit: (context: WorldContext, changes: Change) => Promise<unknown>,
  ) {
    const npc = "targetId" in input ? input.targetId : undefined,
      context = contexts();
    let message = "companionの状態を取得しました";
    if (npc && input.command !== "companion-request")
      await this.mine(db, world, actor, npc);
    switch (input.command) {
      case "companion-follow":
      case "companion-wait": {
        const mode = input.command === "companion-follow" ? "follow" : "wait";
        await db.query(
          "UPDATE bot_companion SET mode=$3 WHERE world_id=$1 AND npc_id=$2",
          [world, npc, mode],
        );
        message =
          mode === "follow"
            ? "本人の移動に付いてくるようにしました"
            : "その場で待つようにしました";
        break;
      }
      case "companion-order":
        await db.query(
          "UPDATE bot_companion SET order_text=$3 WHERE world_id=$1 AND npc_id=$2",
          [world, npc, input.text],
        );
        message = "指示を伝えました。応じるかどうかは本人が決めます";
        break;
      case "companion-home": {
        const place = await context.node(input.placeId);
        if (place?.kind !== "existence")
          fail(
            "COMPANION_PLACE_NOT_FOUND",
            "帰る場所には場所を指定してください",
          );
        const changes = empty();
        for (const edge of await context.marked(npc!, "interpret", "home"))
          for (const e of [
            edge,
            ...(await context.relations(
              edge.target,
              "interpret",
              "out",
              latest,
            )),
          ])
            changes.endEdges.push(e.id);
        described(
          changes,
          input.requestId,
          at,
          "interpret",
          "home",
          npc!,
          "帰る場所",
          place!,
        );
        await commit(context, changes);
        message = `帰る場所を「${place!.text}」にしました`;
        break;
      }
      case "companion-dismiss": {
        const changes = empty();
        for (const edge of await context.marked(npc!, "status", "companion"))
          for (const e of [
            edge,
            ...(await context.relations(edge.target, "status", "out", latest)),
          ])
            changes.endEdges.push(e.id);
        await commit(context, changes);
        await db.query(
          "DELETE FROM bot_companion WHERE world_id=$1 AND npc_id=$2",
          [world, npc],
        );
        message = "同行の関係を終えました";
        break;
      }
    }
    return {
      companions: await this.list(db, world, contexts(), actor),
      action: { command: input.command, message },
    };
  }

  async list(db: Db, world: string, context: WorldContext, actor: string) {
    return Promise.all(
      (await this.owned(db, world, actor)).map(async (row) => {
        const [placeId] = await directPlaces(context, row.npc_id),
          homeId = await this.home(context, row.npc_id);
        return {
          targetId: row.npc_id,
          name: (await context.node(row.npc_id))?.text ?? "人物",
          mode: row.mode,
          ...(placeId ? { placeId } : {}),
          ...(homeId ? { homeId } : {}),
          ...(row.order_text ? { order: row.order_text } : {}),
        };
      }),
    );
  }

  // 自己照会に載せる情報。プレイヤーには自分のcompanion、NPCには同行先と最新の指示。
  async self(db: Db, world: string, context: WorldContext, actor: string) {
    const row = await this.#of(db, world, actor);
    if (row)
      return {
        companionOf: {
          actorId: row.actor_id,
          name: (await context.node(row.actor_id))?.text ?? "人物",
          mode: row.mode,
          ...(row.order_text ? { order: row.order_text } : {}),
        },
      };
    const companions = await this.list(db, world, context, actor);
    return companions.length ? { companions } : {};
  }
}
