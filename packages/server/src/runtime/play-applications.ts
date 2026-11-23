import type pg from "pg";
import type { z } from "zod";
import type {
  DeferredApplication,
  ExchangeOffer,
  ExchangeTerms,
  ItemOutcome,
} from "@gestaloka/contracts";
import { AccessError } from "../http/access.js";
import {
  BelongingRejected,
  planBelongings,
  checkBelongingCapacity,
  type BelongingOp,
} from "../world/belongings.js";
import { directPlaces } from "../world/locations.js";
import { atTime, derivedId, type Change } from "../world/model.js";
import {
  WorldConflict,
  FixedPlaceMovement,
  type Dependency,
  type WorldContext,
  type WorldStore,
} from "../world/store.js";

type Db = Pick<pg.Pool, "query">;
type World = { id: string; at: number };
type Offer = z.infer<typeof ExchangeOffer>;
type HandoffOperation = Extract<BelongingOp, { type: "move" }>;
type HandoffItem = {
  itemId: string;
  label: string;
  seriesId: string | null;
  holderId: string | null;
  wholeCount?: number | null;
};
export type Handoff = { operations: HandoffOperation[]; items: HandoffItem[] };
type Share = {
  text: string;
  preview: string[];
  changes: Change;
  at: number;
  dependencies: Dependency[];
  items?: ItemOutcome[];
  handoff?: Handoff;
};
type Result = {
  applicationId: string;
  state:
    "pending" | "accepted" | "rejected" | "expired" | "withdrawn" | "changed";
  message: string;
  commitId?: string;
  items?: ItemOutcome[];
};
type Row = {
  id: string;
  world_id: string;
  sender: string;
  recipients: string[];
  approved: string[];
  deadline: Date | null;
  share: Share | null;
  offer: Offer | null;
  place: string | null;
  result: Result | null;
};
type ReplanHandoff = (input: {
  sender: string;
  text: string;
  deadline: string;
  recipients: string[];
  handoff: Handoff;
}) => Promise<{ context: WorldContext; changes: Change; at: number }>;
const latest = Number.MAX_SAFE_INTEGER;
const reject = (code: string, message: string): never => {
  throw new AccessError(409, code, message);
};

export function isHandoffOperation(op: BelongingOp): op is HandoffOperation {
  return op.type === "move";
}

export async function readHandoff(
  context: WorldContext,
  operations: HandoffOperation[],
  expected?: Handoff,
): Promise<Handoff> {
  const wholeItems = new Set(
    operations.filter((op) => op.count === undefined).map((op) => op.item),
  );
  const items = await Promise.all(
    [...new Set(operations.map((op) => op.item))].map(async (itemId) => {
      const node = await context.node(itemId);
      if (node?.kind !== "existence")
        throw new BelongingRejected("受け渡しの対象が見つかりません");
      const incoming = await context.relations(itemId, "has", "in", latest);
      return {
        itemId,
        label: node.text,
        seriesId: node.seriesId ?? null,
        holderId: incoming.find((e) => !e.role)?.source ?? null,
        ...(wholeItems.has(itemId) ? { wholeCount: node.count ?? null } : {}),
      };
    }),
  );
  if (expected) {
    for (const [index, item] of items.entries()) {
      const original = expected.items[index]!;
      if (item.label !== original.label || item.seriesId !== original.seriesId)
        throw new BelongingRejected("受け渡しの対象の呼称か系列が変わりました");
      if (item.holderId !== original.holderId)
        throw new BelongingRejected("受け渡しの対象の保持先が変わりました");
      if (item.wholeCount !== original.wholeCount)
        throw new BelongingRejected("全部を渡す物品の個数が変わりました");
    }
  }
  return { operations, items };
}

export async function itemOutcomeMessage(
  context: WorldContext,
  items: ItemOutcome[],
  viewer?: string,
) {
  const name = async (id: string) =>
    id === viewer ? "あなた" : ((await context.node(id))?.text ?? id);
  return (
    await Promise.all(
      items.map(async ({ label, holding }) =>
        !holding
          ? ""
          : holding.toId === viewer
            ? `「${label}」を手元に置きました。`
            : `「${label}」は${await name(holding.toId)}が持っています。`,
      ),
    )
  ).join("");
}

export class PlayApplications {
  constructor(
    private readonly pool: pg.Pool,
    private readonly store: WorldStore,
    private readonly now: () => Date,
  ) {}

  async setup() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS play_application (
      id uuid PRIMARY KEY REFERENCES bot_request(id),
      world_id uuid NOT NULL REFERENCES world_construction(id),
      sender uuid NOT NULL, recipients uuid[] NOT NULL DEFAULT '{}',
      approved uuid[] NOT NULL DEFAULT '{}',
      deadline timestamptz, share jsonb, offer jsonb, place uuid, result jsonb
    );
    CREATE INDEX IF NOT EXISTS play_application_sender ON play_application(world_id,sender) WHERE result IS NULL;
    CREATE INDEX IF NOT EXISTS play_application_recipients ON play_application USING gin(recipients) WHERE result IS NULL;
    CREATE INDEX IF NOT EXISTS play_application_place ON play_application(world_id,place) WHERE result IS NULL;
    CREATE INDEX IF NOT EXISTS play_application_deadline ON play_application(deadline) WHERE result IS NULL;`);
  }

  async notice(
    db: Db,
    world: string,
    id: string,
    actors: string[],
    text: string,
  ) {
    for (const actor of new Set(actors))
      await db.query(
        `WITH inserted AS (
           INSERT INTO player_notice (id,world_id,actor_id,created_at,text)
           VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING actor_id
         ) SELECT pg_notify('gestaloka_turn',$2::text||':'||actor_id::text) FROM inserted`,
        [
          derivedId(`application:${id}:${actor}`),
          world,
          actor,
          this.now(),
          text,
        ],
      );
  }

  async send(
    db: Db,
    world: string,
    sender: string,
    id: string,
    deadline: string,
    recipients: string[],
    share: Share,
  ) {
    if (new Date(deadline) <= this.now())
      reject("APPLICATION_DEADLINE", "受領期限は未来の日時を指定してください");
    await db.query(
      "INSERT INTO play_application(id,world_id,sender,deadline,recipients,share) VALUES($1,$2,$3,$4,$5,$6)",
      [id, world, sender, deadline, recipients, share],
    );
    await this.notice(
      db,
      world,
      `${id}:opened`,
      recipients,
      `受領依頼「${share.text}」（申請ID ${id}）があります。未決の申請を確認してください`,
    );
  }

  async list(db: Db, world: string, context: WorldContext, actor: string) {
    const { rows } = await db.query<Row>(
      `SELECT * FROM play_application WHERE world_id=$1 AND result IS NULL
       AND (sender=$2 OR recipients @> ARRAY[$2]::uuid[])
       AND (deadline IS NULL OR deadline>$3) ORDER BY deadline,id`,
      [world, actor, this.now()],
    );
    const applications: z.infer<typeof DeferredApplication>[] = [];
    const ownOffers: Offer[] = [];
    for (const row of rows) {
      if (row.offer) ownOffers.push(row.offer);
      if (row.share && row.deadline)
        applications.push({
          id: row.id,
          senderId: row.sender,
          senderName: (await context.node(row.sender))?.text ?? "申請者",
          text: row.share.text,
          deadline: row.deadline.toISOString(),
          awaitingYou:
            row.recipients.includes(actor) && !row.approved.includes(actor),
          preview: row.share.preview,
        });
    }
    return { applications, ownOffers };
  }

  async #finish(
    db: Db,
    row: Row,
    result: Omit<Result, "applicationId">,
  ): Promise<Result> {
    const outcome = { applicationId: row.id, ...result };
    await db.query("UPDATE play_application SET result=$2 WHERE id=$1", [
      row.id,
      outcome,
    ]);
    if (row.share)
      await this.notice(
        db,
        row.world_id,
        `${row.id}:result`,
        [row.sender, ...row.recipients],
        `「${row.share.text}」（申請ID ${row.id}）。${result.message}`,
      );
    return outcome;
  }

  async #row(db: Db, world: string, id: string) {
    return (
      await db.query<Row>(
        "SELECT * FROM play_application WHERE id=$1 AND world_id=$2 FOR UPDATE",
        [id, world],
      )
    ).rows[0];
  }

  async #settled(db: Db, w: World, row: Row) {
    if (row.result) return row.result;
    if (!row.share) return;
    const prior = await this.store.receipt(w.id, row.id);
    if (prior) return this.#confirmed(db, w, row, prior.commitId);
    if (row.deadline && row.deadline <= this.now())
      return this.#finish(db, row, {
        state: "expired",
        message: "受領期限が過ぎました",
      });
  }

  async #confirmed(db: Db, w: World, row: Row, commitId: string) {
    const items = row.share?.items;
    return this.#finish(db, row, {
      state: "accepted",
      commitId,
      ...(items?.length ? { items } : {}),
      message: items?.length
        ? await itemOutcomeMessage(this.store.context(w.id), items)
        : "全員が承認し、申請を確定しました",
    });
  }

  async receive(
    db: Db,
    world: string,
    w: World,
    actor: string,
    id: string,
    accept: boolean,
    replan: ReplanHandoff,
  ) {
    const row = await this.#row(db, world, id);
    if (!row?.share || !row.recipients.includes(actor)) return;
    const settled = await this.#settled(db, w, row);
    if (settled) return settled;
    const approved = [...new Set([...row.approved, actor])];
    if (
      row.approved.includes(actor) ||
      (accept && approved.length < row.recipients.length)
    ) {
      await db.query("UPDATE play_application SET approved=$2 WHERE id=$1", [
        id,
        approved,
      ]);
      return {
        applicationId: id,
        state: "pending",
        message: "ほかの受領者の判断を待っています",
      } satisfies Result;
    }
    if (!accept)
      return this.#finish(db, row, {
        state: "rejected",
        message: "受領者が申請を却下しました",
      });
    const share = row.share;
    for (let attempt = 0; ; attempt++) {
      try {
        const { context, changes, at } = share.handoff
          ? await replan({
              sender: row.sender,
              text: share.text,
              deadline: row.deadline!.toISOString(),
              recipients: row.recipients,
              handoff: share.handoff,
            })
          : {
              context: this.store.context(w.id, share.dependencies),
              changes: share.changes,
              at: Math.max(w.at, share.at),
            };
        await this.store.commit(
          await this.store.claim(w.id, id),
          context,
          {
            commitId: id,
            at,
            changes: atTime(changes, at),
            playerAction: true,
          },
          true,
        );
        break;
      } catch (error) {
        if (
          share.handoff &&
          error instanceof WorldConflict &&
          !(error instanceof FixedPlaceMovement)
        ) {
          const result = await this.#settled(db, w, row);
          if (result) return result;
          if (attempt === 0) continue;
          reject(
            "WORLD_CHANGED",
            "受領処理中に状態が変わりました。同じ受領要求を再送してください",
          );
        }
        if (!(
          error instanceof WorldConflict ||
          (share.handoff &&
            (error instanceof BelongingRejected ||
              error instanceof AccessError))
        ))
          throw error;
        return this.#finish(db, row, {
          state: "changed",
          message:
            error instanceof BelongingRejected ||
            error instanceof FixedPlaceMovement
              ? `${error.message}。対象を確認して申請し直してください`
              : "申請時の前提が変わりました。対象を確認して申請し直してください",
        });
      }
    }
    return this.#confirmed(db, w, row, id);
  }

  async withdraw(db: Db, world: string, w: World, actor: string, id: string) {
    const row = await this.#row(db, world, id);
    if (row?.sender !== actor)
      return reject(
        "APPLICATION_NOT_FOUND",
        "本人が出した申請を指定してください",
      );
    return (
      (await this.#settled(db, w, row)) ??
      this.#finish(db, row, {
        state: "withdrawn",
        message: "申請を取り下げました",
      })
    );
  }

  async expire(world?: string) {
    const { rows } = await this.pool.query<{
      id: string;
      world_id: string;
      graph_id: string;
    }>(
      `SELECT a.id,a.world_id,w.world_id AS graph_id FROM play_application a
       JOIN world_construction w ON w.id=a.world_id
       WHERE a.result IS NULL AND a.deadline<=$1 AND ($2::uuid IS NULL OR a.world_id=$2)
       ORDER BY a.deadline,a.id`,
      [this.now(), world ?? null],
    );
    for (const { id, world_id, graph_id } of rows) {
      const db = await this.pool.connect();
      try {
        await db.query("BEGIN");
        const row = await this.#row(db, world_id, id);
        if (row) await this.#settled(db, { id: graph_id, at: 0 }, row);
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    }
  }

  async #held(
    context: WorldContext,
    itemId: string,
    holder: string,
    count: number,
  ) {
    const item = await context.node(itemId);
    if (
      item?.kind === "existence" &&
      (item.count ?? 1) >= count &&
      (await context.relations(itemId, "has", "in", latest)).some(
        (edge) => !edge.role && edge.source === holder,
      )
    )
      return item;
  }

  // 売り手が登録した保管先で、その場所にあるもの。品物は保管先が持つ物。
  async #stock(context: WorldContext, offer: Offer, place: string) {
    const storage = await context.relations(
      offer.storageId,
      "has",
      "in",
      latest,
    );
    if (
      storage.some((e) => e.role === "use" && e.source === offer.sellerId) &&
      (offer.storageId === place ||
        (await directPlaces(context, offer.storageId))[0] === place)
    )
      return this.#held(context, offer.itemId, offer.storageId, offer.count);
  }

  async offer(
    db: Db,
    world: string,
    context: WorldContext,
    sellerId: string,
    id: string,
    terms: z.infer<typeof ExchangeTerms>,
  ) {
    const place = (await directPlaces(context, sellerId))[0],
      offer = { ...terms, id, sellerId, itemLabel: "" },
      item = place && (await this.#stock(context, offer, place));
    if (!place || !item || !item.text.trim())
      return reject(
        "EXCHANGE_STOCK",
        "この場所で本人が登録した保管先と、そこにある在庫を指定してください",
      );
    offer.itemLabel = item.text;
    await context.validate();
    await this.publishOffer(db, world, place, offer);
    return offer;
  }

  async publishOffer(db: Db, world: string, place: string, offer: Offer) {
    await db.query(
      "INSERT INTO play_application(id,world_id,sender,offer,place) VALUES($1,$2,$3,$4,$5)",
      [offer.id, world, offer.sellerId, offer, place],
    );
  }

  async offers(db: Db, world: string, context: WorldContext, actor: string) {
    const [place] = await directPlaces(context, actor);
    if (!place) return [];
    const { rows } = await db.query<{ offer: Offer }>(
      "SELECT offer FROM play_application WHERE world_id=$1 AND place=$2 AND result IS NULL ORDER BY id",
      [world, place],
    );
    const visible: Offer[] = [];
    for (const { offer } of rows) {
      const item = await this.#stock(context, offer, place);
      if (item?.text === offer.itemLabel) visible.push(offer);
    }
    return visible;
  }

  // tradeは同席している出現個体の取引。在庫と場所はなく、品物を新しく作り、代価を除く。
  async exchange(
    db: Db,
    world: string,
    w: World,
    buyer: string,
    request: string,
    id: string,
    paymentItemId: string,
    trade?: Offer,
  ) {
    const row = trade ? undefined : await this.#row(db, world, id),
      offer = trade ?? row?.offer;
    if (!offer || (row && (!row.place || row.sender === buyer)))
      return reject(
        "EXCHANGE_NOT_AVAILABLE",
        "ここで受領できる交換を指定してください",
      );
    const context = this.store.context(w.id),
      prior = await this.store.receipt(w.id, request);
    if (!prior) {
      if (
        row &&
        (row.result || (await directPlaces(context, buyer))[0] !== row.place)
      )
        return reject(
          "EXCHANGE_NOT_AVAILABLE",
          "交換条件を公開している場所で受領してください",
        );
      const item = row && (await this.#stock(context, offer, row.place!));
      if (row && item?.text !== offer.itemLabel)
        return reject("EXCHANGE_STOCK", "売り手の在庫が変わりました");
      const payment = await this.#held(
        context,
        paymentItemId,
        buyer,
        offer.paymentCount,
      );
      if (!payment || payment.seriesId !== offer.paymentSeriesId)
        return reject(
          "EXCHANGE_PAYMENT",
          "提示された系列と個数を満たす、本人の手持ちの品を指定してください",
        );
      const basis = offer.text;
      const ops: BelongingOp[] = item
        ? [
            {
              type: "move",
              item: item.id,
              from: offer.storageId,
              to: buyer,
              ...(item.count ? { count: offer.count } : {}),
              basis,
            },
            {
              type: "move",
              item: payment.id,
              from: buyer,
              to: offer.storageId,
              ...(payment.count ? { count: offer.paymentCount } : {}),
              basis,
            },
          ]
        : [
            {
              type: "create",
              label: offer.itemLabel,
              count: offer.count,
              holder: buyer,
              basis,
            },
            {
              type: "remove",
              id: payment.id,
              ...(payment.count ? { count: offer.paymentCount } : {}),
            },
          ];
      try {
        if (item) await context.assertMovable(item.id);
        await context.assertMovable(payment.id);
        const plan = await planBelongings(context, request, w.at, ops);
        await checkBelongingCapacity(
          context,
          request,
          plan.at,
          plan.changes,
          ops,
        );
        await this.store.commit(
          await this.store.claim(w.id, request),
          context,
          { commitId: request, ...plan, playerAction: true },
          true,
        );
      } catch (error) {
        if (!(
          error instanceof BelongingRejected || error instanceof WorldConflict
        ))
          throw error;
        return reject(
          "EXCHANGE_CHANGED",
          "交換に使う品の状態が変わりました。品物を確認し直してください",
        );
      }
    }
    const text = `${offer.itemLabel}×${offer.count}と${offer.paymentLabel}×${offer.paymentCount}の交換が成立しました`;
    await this.notice(
      db,
      world,
      `${request}:exchange`,
      row ? [offer.sellerId, buyer] : [buyer],
      text,
    );
    return { state: "accepted", commitId: request, offerId: id, message: text };
  }
}
