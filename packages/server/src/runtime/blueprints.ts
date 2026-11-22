import type pg from "pg";
import type { z } from "zod";
import type {
  BlueprintAction,
  BlueprintDraft,
  BlueprintProposal,
  BlueprintPublication,
  ExchangeOffer,
} from "@gestaloka/contracts";
import { AccessError } from "../http/access.js";
import { atTime, derivedId, type Change } from "../world/model.js";
import { addRoute, directPlaces } from "../world/locations.js";
import { planBelongings, type BelongingOp } from "../world/belongings.js";
import {
  WorldConflict,
  type Dependency,
  type ItemReservations,
  type WorldStore,
} from "../world/store.js";
import { canonical } from "../llm/prompt.js";
import type { PlayApplications } from "./play-applications.js";
import { deliverPickups } from "./storage-transfers.js";
import { InventoryCapacityExceeded, storageSlots } from "../world/inventory.js";

type Db = Pick<pg.Pool, "query">;
type World = { id: string; at: number };
type Context = ReturnType<WorldStore["context"]>;
type Proposal = z.infer<typeof BlueprintProposal>;
type Publication = z.infer<typeof BlueprintPublication>;
type Draft = z.infer<typeof BlueprintDraft>;
type Offer = z.infer<typeof ExchangeOffer>;
type Template = Publication &
  Partial<Pick<Draft, "instructions" | "materials" | "installation">> & {
    id: string;
    origin: string;
    author: string;
  };
type StoredTemplate = { data: Template; published: boolean; testers: string[] };
type Requirement = {
  label: string;
  count: number;
  usage: "consume" | "tool" | "stock";
  itemId?: string;
};
type Quest = {
  id: string;
  author: string;
  template: Template;
  plan: Proposal;
  requirements: {
    build: Requirement[];
    open: Requirement[];
    craft?: Requirement[];
  };
  totals: number[];
  productId?: string;
  storageLimitSlots?: number;
  phase:
    "craft" | "draft" | "rejected" | "build" | "open" | "done" | "cancelled";
  consent: boolean;
  buildingId: string | null;
  contributors: string[];
  reason?: string;
};
type Contribution = {
  id: string;
  actor: string;
  heldBy: string;
  itemId: string;
  count: number;
  requirement: number;
};
type Show = Extract<BlueprintAction, { command: "blueprint-show" }>;
type Reason = { code: string; message: string };
type ProvisionCheck = {
  maxCount: number | null;
  totalCount?: number;
  reservedCount?: number;
  heldBy?: string;
  reason?: Reason;
  completionBlock?: Reason;
};
type Mutation = {
  quest: Quest;
  commit: string;
  at: number;
  dependencies: Dependency[];
  changes: Change;
  reservations: ItemReservations;
  added?: Contribution;
  released: string[];
  offers: Offer[];
  notice?: { id: string; actors: string[]; text: string };
};

const latest = Number.MAX_SAFE_INTEGER;
const reject = (message: string): never => {
  throw new AccessError(409, "BLUEPRINT_UNAVAILABLE", message);
};
const reason = (code: string, message: string): Reason => ({ code, message });
const action = (block?: Reason) =>
  block ? { allowed: false, reason: block } : { allowed: true };
const wrongPlace = reason(
  "QUEST_LOCATION_REQUIRED",
  "設計図に記載された現地へ移動してください",
);
const shopStorage = reason(
  "SHOP_STORAGE_REQUIRED",
  "店主にこの店を保管先として登録してもらってください",
);
const phaseBlock = reason(
  "QUEST_PHASE",
  "この段階ではこの操作を受け付けません。クエストの進捗を確認してください",
);
const keeperTitle = (template: Template) =>
  template.mode === "craft" ? "管理者" : "店主";
const startRestriction = (quest: Quest, actor: string) => {
  if (quest.phase !== "draft") return phaseBlock;
  if (actor !== quest.author)
    return reason("AUTHOR_REQUIRED", "発案者が着工を申請できます");
  if (!quest.consent)
    return reason(
      "CONSENT_REQUIRED",
      `${keeperTitle(quest.template)}の同意を待ってください`,
    );
};

export const isBlueprint = (input: {
  command: string;
}): input is BlueprintAction => input.command.startsWith("blueprint-");

export class Blueprints {
  constructor(
    private readonly pool: pg.Pool,
    private readonly store: WorldStore,
    private readonly applications: PlayApplications,
  ) {}

  async setup() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS blueprint_template(
        id uuid PRIMARY KEY, origin uuid NOT NULL, mode text NOT NULL, version integer NOT NULL,
        data jsonb NOT NULL, published boolean NOT NULL DEFAULT true, testers uuid[] NOT NULL DEFAULT '{}');
      ALTER TABLE blueprint_template
        ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS testers uuid[] NOT NULL DEFAULT '{}',
        DROP CONSTRAINT IF EXISTS blueprint_template_origin_mode_version_key;
      CREATE INDEX IF NOT EXISTS blueprint_template_published ON blueprint_template(id) WHERE published;
      CREATE TABLE IF NOT EXISTS blueprint_quest(
        id uuid PRIMARY KEY, world uuid NOT NULL, place uuid NOT NULL, building uuid, data jsonb NOT NULL);
      CREATE INDEX IF NOT EXISTS blueprint_quest_place ON blueprint_quest(world,place,id);
      CREATE INDEX IF NOT EXISTS blueprint_quest_building ON blueprint_quest(world,building,id);
      CREATE TABLE IF NOT EXISTS blueprint_contribution(
        id uuid PRIMARY KEY, quest uuid NOT NULL REFERENCES blueprint_quest(id), data jsonb NOT NULL);
      CREATE INDEX IF NOT EXISTS blueprint_contribution_quest ON blueprint_contribution(quest);
      CREATE TABLE IF NOT EXISTS blueprint_mutation(
        request uuid PRIMARY KEY, world uuid NOT NULL, quest uuid NOT NULL,
        mutation jsonb, result jsonb);
      CREATE UNIQUE INDEX IF NOT EXISTS blueprint_pending ON blueprint_mutation(world,quest) WHERE mutation IS NOT NULL;`);
  }

  private async saveTemplate(
    db: Db,
    world: string,
    w: World,
    id: string,
    input: Omit<Template, "id" | "origin" | "author">,
    published: boolean,
    testers: string[],
  ) {
    const author = await this.store.context(w.id).node(input.authorId);
    if (author?.kind !== "existence")
      return reject("発祥の世界にいる原案者を指定してください");
    const template: Template = {
      ...input,
      id,
      origin: world,
      author: author.text,
    };
    await db.query(
      "INSERT INTO blueprint_template(id,origin,mode,version,data,published,testers) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
      [id, world, input.mode, input.version, template, published, testers],
    );
    const stored = (
      await db.query<StoredTemplate>(
        "SELECT data,published,testers FROM blueprint_template WHERE id=$1",
        [id],
      )
    ).rows[0]!;
    if (
      canonical({ ...stored.data, author: author.text }) !==
        canonical(template) ||
      canonical(stored.testers) !== canonical(testers)
    )
      return reject(
        "テンプレートの内容を変える場合は別の版番号を指定してください",
      );
    return stored;
  }

  async createDraft(db: Db, world: string, w: World, input: Draft) {
    const { testerIds, ...definition } = input;
    const testers = [...new Set(testerIds)].sort();
    if (
      testers.length &&
      (
        await db.query(
          "SELECT actor_id FROM world_controlled_actor WHERE world_id=$1 AND actor_id=ANY($2::uuid[])",
          [w.id, testers],
        )
      ).rowCount !== testers.length
    )
      return reject("発祥の世界で操作できる人物を試遊者に指定してください");
    const id = derivedId(
      `blueprint-draft:${canonical([world, input.authorId, input.mode, input.name, input.version])}`,
    );
    const stored = await this.saveTemplate(
      db,
      world,
      w,
      id,
      definition,
      false,
      testers,
    );
    return {
      ...stored.data,
      testerIds: stored.testers,
      state: stored.published ? "published" : "draft",
    };
  }

  async publish(
    db: Db,
    world: string,
    w: World,
    input: Publication | { templateId: string },
  ) {
    if ("mode" in input && input.mode === "craft")
      return reject(
        "製作の材料と利用条件を下書きで設定してから、その版のIDを公開してください",
      );
    const template =
      "templateId" in input
        ? (
            await db.query<{ data: Template }>(
              "UPDATE blueprint_template SET published=true WHERE id=$1 AND origin=$2 RETURNING data",
              [input.templateId, world],
            )
          ).rows[0]?.data
        : (
            await this.saveTemplate(
              db,
              world,
              w,
              derivedId(
                `blueprint-template:${world}:${input.mode}:${input.version}`,
              ),
              input,
              true,
              [],
            )
          ).data;
    if (!template)
      return reject("発祥の世界で作成したテンプレートIDを指定してください");
    await this.applications.notice(
      db,
      world,
      `blueprint-author:${world}:${template.authorId}`,
      [template.authorId],
      `「${template.name}」の公開により、遊び方の原案者として記録されました`,
    );
    return template;
  }

  private async read(db: Db, world: string, id: string) {
    const { rows } = await db.query<{ data: Quest }>(
      "SELECT data FROM blueprint_quest WHERE world=$1 AND id=$2",
      [world, id],
    );
    return rows[0]?.data ?? reject("設計図が見つかりません");
  }

  private async write(db: Db, quest: Quest) {
    await db.query(
      "UPDATE blueprint_quest SET data=$2,building=$3 WHERE id=$1",
      [quest.id, quest, quest.buildingId],
    );
  }

  private view(quest: Quest, actor: string) {
    const requirements =
      quest.phase === "build" ||
      quest.phase === "open" ||
      quest.phase === "craft"
        ? (quest.requirements[quest.phase] ?? []).map((item, index) => ({
            ...item,
            index,
            provided: quest.totals[index] ?? 0,
          }))
        : [];
    const next =
      quest.phase === "draft"
        ? !quest.consent && actor === quest.plan.keeperId
          ? "blueprint-consent"
          : quest.consent && actor === quest.author
            ? "blueprint-start"
            : null
        : requirements.length
          ? "blueprint-provide"
          : null;
    return { quest, requirements, next };
  }

  private async validatePlace(w: World, quest: Quest, actor: string) {
    const context = this.store.context(w.id);
    if (!(await directPlaces(context, actor)).includes(quest.plan.placeId))
      return reject(wrongPlace.message);
    const site = await this.inspectSite(
      context,
      quest,
      quest.plan.product ? "craft" : quest.plan.building ? "build" : "open",
    );
    if (site.issue) return reject(site.issue.message);
    return { context, place: site.place };
  }

  private async usesStorage(context: Context, place: string, actor: string) {
    return (await context.relations(place, "has", "in", latest)).some(
      (edge) => edge.role === "use" && edge.source === actor,
    );
  }

  private async inspectSite(
    context: Context,
    quest: Quest,
    phase: "build" | "open" | "craft",
  ) {
    const id =
      phase === "open"
        ? (quest.buildingId ?? quest.plan.placeId)
        : quest.plan.placeId;
    const place = await context.node(id);
    if (place?.kind !== "existence")
      return {
        issue: reason(
          "QUEST_PLACE_CHANGED",
          "設計図の対象の場所を確認してください",
        ),
      };
    if (
      phase === "open" &&
      !(await this.usesStorage(context, id, quest.plan.keeperId))
    )
      return { issue: shopStorage };
    if (
      phase === "build" &&
      (await context.routePlace(quest.plan.building!.label))
    )
      return {
        issue: reason(
          "BUILDING_NAME_TAKEN",
          "同じ名前の場所があります。建屋には別の名前を指定してください",
        ),
      };
    return { place };
  }

  async prepareStart(world: string, w: World, actor: string, id: string) {
    const quest = await this.read(this.pool, world, id);
    if (startRestriction(quest, actor))
      return reject(
        `${keeperTitle(quest.template)}が同意した設計図を発案者が申請してください`,
      );
    const { context, place } = await this.validatePlace(w, quest, actor);
    return {
      quest,
      context,
      place: place.text,
      keeper: (await context.node(quest.plan.keeperId))?.text,
    };
  }

  private async pending(db: Db, world: string, w: World, questId: string) {
    const { rows } = await db.query<{ request: string; mutation: Mutation }>(
      "SELECT request,mutation FROM blueprint_mutation WHERE world=$1 AND quest=$2 AND mutation IS NOT NULL FOR UPDATE",
      [world, questId],
    );
    const pending = rows[0];
    if (!pending) return;
    const { request, mutation } = pending;
    const {
      quest,
      commit,
      changes,
      reservations,
      dependencies,
      at,
      added,
      released,
      offers,
      notice,
    } = mutation;
    let result: object = quest;
    try {
      if (!(await this.store.receipt(w.id, commit)))
        await this.store.commit(
          await this.store.claim(w.id, commit),
          this.store.context(w.id, dependencies),
          {
            commitId: commit,
            at,
            changes,
            playerAction: true,
            ...(quest.productId &&
            quest.template.installation &&
            changes.nodes.some((n) => n.id === quest.productId)
              ? {
                  storageEffect: {
                    type: "install" as const,
                    storageId: quest.productId,
                    placeId: quest.plan.placeId,
                    managerId: quest.plan.keeperId,
                    policy: quest.template.installation,
                  },
                }
              : {}),
            ...(quest.buildingId &&
            changes.nodes.some((n) => n.id === quest.buildingId)
              ? { newFixedPlaces: [quest.buildingId] }
              : {}),
          },
          true,
          reservations,
        );
    } catch (error) {
      if (!(
        error instanceof WorldConflict ||
        error instanceof InventoryCapacityExceeded
      ))
        throw error;
      result = {
        state: "conflict",
        reason: error.message,
        ...(error instanceof InventoryCapacityExceeded
          ? {
              code: "INVENTORY_CAPACITY_EXCEEDED",
              capacity: error.capacity,
            }
          : {}),
      };
    }
    if (result === quest) {
      if (added && !released.includes(added.id))
        await db.query("INSERT INTO blueprint_contribution VALUES($1,$2,$3)", [
          added.id,
          quest.id,
          added,
        ]);
      if (released.length)
        await db.query(
          "DELETE FROM blueprint_contribution WHERE quest=$1 AND id=ANY($2::uuid[])",
          [quest.id, released],
        );
      for (const offer of offers) {
        await db.query(
          "INSERT INTO bot_request(id,actor_id,world_id,hash) VALUES($1,$2,$3,$4)",
          [offer.id, offer.sellerId, world, request],
        );
        await this.applications.publishOffer(db, world, offer.storageId, offer);
      }
      await this.write(db, quest);
      if (notice)
        await this.applications.notice(
          db,
          world,
          notice.id,
          notice.actors,
          notice.text,
        );
    }
    await db.query(
      "UPDATE blueprint_mutation SET mutation=NULL,result=$2 WHERE request=$1",
      [request, result],
    );
  }

  async recover(world?: string) {
    await deliverPickups(this.pool, this.store, this.applications, world);
    const { rows } = await this.pool.query<{
      world: string;
      quest: string;
      graph: string;
      at: string;
    }>(
      `SELECT m.world,m.quest,w.world_id AS graph,w.at FROM blueprint_mutation m
      JOIN world_construction w ON w.id=m.world WHERE m.mutation IS NOT NULL
      AND ($1::uuid IS NULL OR m.world=$1) ORDER BY m.request LIMIT 20`,
      [world ?? null],
    );
    for (const row of rows) {
      const db = await this.pool.connect();
      try {
        await db.query("BEGIN");
        await db.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,225))",
          [row.world],
        );
        await this.pending(
          db,
          row.world,
          { id: row.graph, at: Number(row.at) },
          row.quest,
        );
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    }
  }

  async command(
    db: pg.PoolClient,
    world: string,
    w: World,
    actor: string,
    input: BlueprintAction,
    startBlock: () => Promise<Reason | undefined>,
    decision?: {
      accepted: boolean;
      reason: string;
      storageLimitSlots?: number | undefined;
      dependencies: Dependency[];
    },
  ) {
    if (input.command === "blueprint-templates") {
      const { rows } = await db.query<{ data: Template }>(
        "SELECT data FROM blueprint_template WHERE published AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 21",
        [input.after ?? null],
      );
      return {
        templates: rows.slice(0, 20).map(({ data }) => ({
          ...data,
          effect: {
            build: "入店と保管",
            open: "在庫と公開交換",
            "build-and-open": "入店・保管の後に公開交換",
            craft: data.installation
              ? [
                  "保管先を製作・設置",
                  ...(data.installation.relocatable
                    ? ["管理者による移設"]
                    : []),
                  ...(data.installation.pickup.includes("public")
                    ? ["公開分の無償受領"]
                    : []),
                  ...(data.installation.pickup.includes("addressed")
                    ? ["本人宛ての無償受領"]
                    : []),
                ].join("、")
              : "物品を製作して受け取る",
          }[data.mode],
        })),
        next: rows[20] ? rows[19]!.data.id : null,
        proposal:
          "play の blueprint-propose で設計図を記入できます。選択肢にない遊び方は report で提案できます。",
      };
    }
    const context = this.store.context(w.id);
    const [here] = await directPlaces(context, actor);
    if (input.command === "blueprint-list") {
      const { rows } = await db.query<{ data: Quest }>(
        `SELECT data FROM blueprint_quest WHERE world=$1 AND (place=$2 OR building=$2)
        AND data->>'phase' NOT IN ('draft','rejected')
        AND (data->>'phase' <> 'cancelled' OR building IS NOT NULL)
        AND ($3::uuid IS NULL OR id>$3) ORDER BY id LIMIT 21`,
        [world, here ?? null, input.after ?? null],
      );
      return {
        quests: rows.slice(0, 20).map(({ data }) => this.view(data, actor)),
        next: rows[20] ? rows[19]!.data.id : null,
      };
    }
    if (input.command === "blueprint-propose") {
      const { plan } = input;
      const record = (
        await db.query<StoredTemplate>(
          "SELECT data,published,testers FROM blueprint_template WHERE id=$1",
          [plan.templateId],
        )
      ).rows[0];
      if (
        !record ||
        (!record.published &&
          (record.data.origin !== world ||
            (record.data.authorId !== actor &&
              !record.testers.includes(actor))))
      )
        return reject("利用できるテンプレートを指定してください");
      const template = record.data;
      const materials = template.materials ?? plan.building?.materials;
      if (
        plan.building &&
        (!materials ||
          (template.materials &&
            plan.building.materials &&
            canonical(plan.building.materials) !==
              canonical(template.materials)))
      )
        return reject("建築の材料をテンプレートで確認してください");

      if (
        !template ||
        !!plan.product !== (template.mode === "craft") ||
        !!plan.building !==
          (template.mode === "build" || template.mode === "build-and-open") ||
        !!plan.shop !==
          (template.mode === "open" || template.mode === "build-and-open") ||
        (template.mode === "craft" && !materials?.length) ||
        new Set(plan.shop?.stock.map((item) => item.itemId)).size !==
          (plan.shop?.stock.length ?? 0)
      )
        return reject(
          "選んだテンプレートの進行形式に必要な情報を記入してください",
        );
      if (
        !(
          await db.query(
            "SELECT 1 FROM world_controlled_actor WHERE world_id=$1 AND actor_id=$2",
            [w.id, plan.keeperId],
          )
        ).rowCount
      )
        return reject(
          `この世界で操作される人物を${keeperTitle(template)}に指定してください`,
        );
      const open: Requirement[] = [];
      for (const terms of plan.shop?.stock ?? []) {
        const item = await context.node(terms.itemId);
        if (
          item?.kind !== "existence" ||
          terms.stockCount > (item.count ?? 1) ||
          terms.count > terms.stockCount
        )
          return reject(
            "実在する初期在庫と、在庫数以下の交換個数を指定してください",
          );
        open.push({
          label: item.text,
          count: terms.stockCount,
          itemId: item.id,
          usage: "stock",
        });
      }
      const quest: Quest = {
        id: input.requestId,
        author: actor,
        template,
        plan,
        requirements:
          template.mode === "craft"
            ? { build: [], open: [], craft: materials! }
            : { build: materials ?? [], open },
        totals: [],
        phase: "draft",
        consent: plan.keeperId === actor,
        buildingId: null,
        contributors: [],
      };
      await this.validatePlace(w, quest, actor);
      await db.query(
        "INSERT INTO blueprint_quest(id,world,place,data) VALUES($1,$2,$3,$4)",
        [quest.id, world, plan.placeId, quest],
      );
      if (!quest.consent)
        await this.applications.notice(
          db,
          world,
          quest.id,
          [plan.keeperId],
          `${keeperTitle(template)}になる同意を求められています。設計図 ${quest.id} を blueprint-show で確認できます`,
        );
      return this.view(quest, actor);
    }

    await this.pending(db, world, w, input.questId);
    const saved = (
      await db.query<{ result: Quest | { state: "conflict"; reason: string } }>(
        "SELECT result FROM blueprint_mutation WHERE request=$1",
        [input.requestId],
      )
    ).rows[0]?.result;
    if (saved) return "state" in saved ? saved : this.view(saved, actor);
    const quest = await this.read(db, world, input.questId);
    const member = actor === quest.author || actor === quest.plan.keeperId;
    const local = here === quest.plan.placeId || here === quest.buildingId;
    if (input.command === "blueprint-show") {
      if (
        !member &&
        (!local || quest.phase === "draft" || quest.phase === "rejected")
      )
        return reject("クエストの場所で確認してください");
      const { rows } = await db.query<{ data: Contribution }>(
        "SELECT data FROM blueprint_contribution WHERE quest=$1 AND data->>'actor'=$2 ORDER BY id",
        [quest.id, actor],
      );
      return {
        ...(await this.show(
          context,
          quest,
          actor,
          here,
          local,
          rows.length > 0,
          input,
          startBlock,
        )),
        contributions: rows.map(({ data }) => data),
      };
    }
    if (input.command === "blueprint-consent") {
      if (quest.phase !== "draft" || quest.plan.keeperId !== actor)
        return reject(
          `${keeperTitle(quest.template)}に指定された人物だけが着工前に同意できます`,
        );
      quest.consent = true;
      await this.write(db, quest);
      return this.view(quest, actor);
    }
    if (input.command === "blueprint-start") {
      if (!decision || startRestriction(quest, actor))
        return reject("この設計図は着工できません");
      await this.validatePlace(w, quest, actor);
      await this.store.context(w.id, decision.dependencies).validate();
      quest.reason = decision.reason;
      if (
        decision.accepted &&
        (quest.plan.building || quest.template.installation)
      )
        quest.storageLimitSlots = decision.storageLimitSlots ?? storageSlots;
      quest.phase = !decision.accepted
        ? "rejected"
        : quest.plan.product
          ? "craft"
          : quest.plan.building
            ? "build"
            : "open";
      if (decision.accepted && quest.template.mode === "open")
        quest.buildingId = quest.plan.placeId;
      await this.write(db, quest);
      return this.view(quest, actor);
    }
    if (
      quest.phase !== "build" &&
      quest.phase !== "open" &&
      quest.phase !== "craft"
    )
      return reject("材料を集めているクエストを指定してください");

    const phase = quest.phase;
    const requirements = quest.requirements[phase] ?? [];
    const added: Contribution | undefined =
      input.command === "blueprint-provide"
        ? await this.provision(
            context,
            quest,
            local ? here : undefined,
            actor,
            input,
          )
        : undefined;
    const contribution = async (id: string) =>
      (
        await db.query<{ data: Contribution }>(
          "SELECT data FROM blueprint_contribution WHERE quest=$1 AND id=$2",
          [quest.id, id],
        )
      ).rows[0]?.data;
    let released: Contribution[] = [];
    if (input.command === "blueprint-withdraw") {
      const item = await contribution(input.contributionId);
      if (!item || item.actor !== actor)
        return reject("自分が提供した未確定の取り置きを指定してください");
      released = [item];
      quest.totals[item.requirement]! -= item.count;
    }
    if (input.command === "blueprint-cancel") {
      if (!member)
        return reject(
          `発案者または${keeperTitle(quest.template)}が中止できます`,
        );
      quest.phase = "cancelled";
      quest.totals = [];
    }
    if (added)
      quest.totals[added.requirement] =
        (quest.totals[added.requirement] ?? 0) + added.count;
    const complete = requirements.every(
      (item, i) => quest.totals[i] === item.count,
    );
    if (complete || quest.phase === "cancelled")
      released = (
        await db.query<{ data: Contribution }>(
          "SELECT data FROM blueprint_contribution WHERE quest=$1",
          [quest.id],
        )
      ).rows.map(({ data }) => data);

    const commit = complete
      ? derivedId(`blueprint:${quest.id}:${phase}`)
      : input.requestId;
    const plan = await this.planStage(
      context,
      w,
      quest,
      phase,
      commit,
      added,
      released,
      complete,
    );
    await context.checkInventory(plan.changes);
    const mutation: Mutation = {
      ...plan,
      quest,
      commit,
      dependencies: context.dependencies,
      released: [
        ...released.map((item) => item.id),
        ...(complete && added ? [added.id] : []),
      ],
      ...(added ? { added } : {}),
    };
    await db.query(
      "INSERT INTO blueprint_mutation(request,world,quest,mutation) VALUES($1,$2,$3,$4)",
      [input.requestId, world, quest.id, mutation],
    );
    // 意図を先に保存し、グラフの確定後にSQL側だけを再開できるようにする。
    await db.query("COMMIT");
    await db.query("BEGIN");
    await db.query("SELECT id FROM bot_request WHERE id=$1 FOR UPDATE", [
      input.requestId,
    ]);
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,225))", [
      world,
    ]);
    await this.pending(db, world, w, quest.id);
    const done = (
      await db.query<{ result: Quest | { state: "conflict"; reason: string } }>(
        "SELECT result FROM blueprint_mutation WHERE request=$1",
        [input.requestId],
      )
    ).rows[0]!.result;
    return "state" in done ? done : this.view(done, actor);
  }

  private async show(
    context: Context,
    quest: Quest,
    actor: string,
    here: string | undefined,
    local: boolean,
    hasContributions: boolean,
    input: Show,
    startBlock: () => Promise<Reason | undefined>,
  ) {
    const view = this.view(quest, actor);
    const draft = quest.phase === "draft";
    const collecting = view.requirements.length > 0;
    const consent = !draft
      ? phaseBlock
      : actor !== quest.plan.keeperId
        ? reason(
            "KEEPER_REQUIRED",
            `${keeperTitle(quest.template)}に指定された人物が同意できます`,
          )
        : quest.consent
          ? reason(
              "CONSENT_ALREADY_GIVEN",
              `${keeperTitle(quest.template)}の同意を受け付け済みです`,
            )
          : undefined;
    let start = startRestriction(quest, actor);
    if (!start)
      start =
        here !== quest.plan.placeId
          ? wrongPlace
          : ((
              await this.inspectSite(
                context,
                quest,
                quest.plan.product
                  ? "craft"
                  : quest.plan.building
                    ? "build"
                    : "open",
              )
            ).issue ?? (await startBlock()));

    const selected = input.provision;
    if (selected && collecting && !view.requirements[selected.requirement])
      return reject("この段階にある要件の番号を指定してください");
    const provisions = [];
    for (const requirement of view.requirements) {
      const itemId =
        requirement.itemId ??
        (selected?.requirement === requirement.index
          ? selected.itemId
          : undefined);
      const assessment = await this.inspectProvision(
        context,
        quest,
        actor,
        local ? here : undefined,
        requirement.index,
        itemId,
      );
      const allowed = (assessment.maxCount ?? 0) > 0;
      provisions.push({
        requirement: requirement.index,
        ...(itemId ? { itemId } : {}),
        remaining: requirement.count - requirement.provided,
        allowed,
        ...assessment,
      });
    }
    const provide = !collecting
      ? phaseBlock
      : !local
        ? wrongPlace
        : provisions.some((item) => item.allowed)
          ? undefined
          : provisions.length === 1
            ? provisions[0]!.reason
            : reason(
                "PROVISION_REQUIRED",
                "必要な品ごとの案内を確認してください",
              );

    const place = async (id: string) => ({
      id,
      label: (await context.node(id))?.text ?? id,
    });
    const contributionPlaces = [];
    for (const id of new Set([
      quest.plan.placeId,
      ...(quest.buildingId ? [quest.buildingId] : []),
    ]))
      contributionPlaces.push(await place(id));
    const current = here ? await place(here) : null;
    await context.validate();
    return {
      ...view,
      location: { current, contributionPlaces },
      actions: {
        "blueprint-consent": action(consent),
        "blueprint-start": action(start),
        "blueprint-provide": { ...action(provide), requirements: provisions },
        "blueprint-withdraw": action(
          !collecting
            ? phaseBlock
            : hasContributions
              ? undefined
              : reason(
                  "NO_CONTRIBUTIONS",
                  "取り下げられる本人の取り置きがありません",
                ),
        ),
        "blueprint-cancel": action(
          !collecting
            ? phaseBlock
            : actor === quest.author || actor === quest.plan.keeperId
              ? undefined
              : reason(
                  "CANCEL_AUTHORITY_REQUIRED",
                  `発案者または${keeperTitle(quest.template)}が中止できます`,
                ),
        ),
      },
    };
  }

  private async inspectProvision(
    context: Context,
    quest: Quest,
    actor: string,
    here: string | undefined,
    index: number,
    itemId: string | undefined,
  ): Promise<ProvisionCheck> {
    const phase = quest.phase;
    if (phase !== "build" && phase !== "open" && phase !== "craft")
      return { maxCount: 0, reason: phaseBlock };
    const requirements = quest.requirements[phase] ?? [];
    const requirement = requirements[index];
    if (!here) return { maxCount: 0, reason: wrongPlace };
    if (!requirement)
      return {
        maxCount: 0,
        reason: reason(
          "REQUIREMENT_REQUIRED",
          "この段階にある要件の番号を指定してください",
        ),
      };
    const remaining = requirement.count - (quest.totals[index] ?? 0);
    if (remaining === 0)
      return {
        maxCount: 0,
        reason: reason("REQUIREMENT_FILLED", "この品は必要数に達しています"),
      };
    if (!itemId)
      return {
        maxCount: null,
        reason: reason(
          "ITEM_REQUIRED",
          "提供したい品のIDを指定して確認してください",
        ),
      };

    const mismatch = reason("ITEM_MISMATCH", "要件に合う品を指定してください");
    if (requirement.itemId && requirement.itemId !== itemId)
      return {
        maxCount: 0,
        reason: mismatch,
      };
    const holding = (await context.relations(itemId, "has", "in", latest)).find(
      (edge) => !edge.role,
    );
    if (
      !holding ||
      (holding.source !== actor &&
        !(await this.usesStorage(context, holding.source, actor)))
    )
      return {
        maxCount: 0,
        reason: reason(
          "ITEM_ACCESS_REQUIRED",
          "本人の手持ち品か登録済みの保管先から品を選んでください",
        ),
      };
    if (
      holding.source !== actor &&
      holding.source !== here &&
      !(await directPlaces(context, holding.source)).includes(here)
    )
      return {
        maxCount: 0,
        reason: reason(
          "ITEM_STORAGE_NOT_HERE",
          "この品を出せる保管先に移動してから提供してください",
        ),
      };

    const item = await context.node(itemId);
    if (item?.kind !== "existence" || item.text !== requirement.label)
      return { maxCount: 0, reason: mismatch };
    const totalCount = item.count ?? 1;
    const reservedCount = await context.reserved(itemId);
    const capacity = Math.min(totalCount - reservedCount, remaining);
    const finishes =
      capacity === remaining &&
      requirements.every(
        (other, i) => i === index || quest.totals[i] === other.count,
      );
    const completionBlock = finishes
      ? (await this.inspectSite(context, quest, phase)).issue
      : undefined;
    // 完成条件が不足している間は、必要数の1個手前まで取り置ける。
    const maxCount = Math.max(0, capacity - (completionBlock ? 1 : 0));
    const issue =
      maxCount > 0
        ? undefined
        : (completionBlock ??
          reason(
            "ITEM_RESERVED",
            "取り置きのない分がありません。取り置きの状況を確認してください",
          ));
    return {
      totalCount,
      reservedCount,
      maxCount,
      heldBy: holding.source,
      ...(issue ? { reason: issue } : {}),
      ...(completionBlock ? { completionBlock } : {}),
    };
  }

  private async provision(
    context: Context,
    quest: Quest,
    here: string | undefined,
    actor: string,
    input: Extract<BlueprintAction, { command: "blueprint-provide" }>,
  ) {
    if (input.phase !== quest.phase) return reject(phaseBlock.message);
    const check = await this.inspectProvision(
      context,
      quest,
      actor,
      here,
      input.requirement,
      input.itemId,
    );
    if (input.count > (check.maxCount ?? 0) || !check.heldBy)
      return reject(
        check.reason?.message ??
          check.completionBlock?.message ??
          `この品は${check.maxCount}個まで提供できます。提供する数量を確認してください`,
      );
    return {
      id: input.requestId,
      actor,
      itemId: input.itemId,
      heldBy: check.heldBy,
      count: input.count,
      requirement: input.requirement,
    };
  }

  private async planStage(
    context: ReturnType<WorldStore["context"]>,
    w: World,
    quest: Quest,
    phase: "build" | "open" | "craft",
    request: string,
    added: Contribution | undefined,
    released: Contribution[],
    complete: boolean,
  ) {
    const ops: BelongingOp[] = [];
    const offers: Offer[] = [];
    const destinations = new Map<string, string>();
    const source = quest.plan.placeId;
    const basis = quest.plan.description;
    const completion = complete ? [...released, ...(added ? [added] : [])] : [];
    const counts = new Map<string, Contribution>();
    for (const item of completion) {
      if (quest.requirements[phase]?.[item.requirement]?.usage === "tool")
        continue;
      const prior = counts.get(item.itemId);
      counts.set(item.itemId, {
        ...item,
        count: (prior?.count ?? 0) + item.count,
      });
    }
    for (const item of counts.values()) {
      const current = await context.node(item.itemId);
      const count =
        current?.kind === "existence" && current.count
          ? { count: item.count }
          : {};
      if (phase !== "open")
        ops.push({ type: "remove", id: item.itemId, ...count });
      else if (item.heldBy !== quest.buildingId) {
        await context.assertMovable(item.itemId);
        ops.push({
          type: "move",
          item: item.itemId,
          from: item.heldBy,
          to: quest.buildingId!,
          basis,
          ...count,
        });
      }
    }
    if (complete && phase === "craft") {
      const product = (quest.productId = derivedId(
        `blueprint:${quest.id}:product`,
      ));
      if (quest.template.installation) {
        ops.push(
          {
            type: "locate",
            subjectId: product,
            text: basis,
            aboutIds: [source],
          },
          {
            type: "grant",
            person: quest.plan.keeperId,
            storage: product,
            basis,
          },
        );
      }
    }
    const plan = await planBelongings(
      context,
      request,
      w.at,
      ops,
      destinations,
    );
    const { changes, at } = plan;
    const reservations: ItemReservations = {
      release: released.map((item) => item.id),
      ...(added && !complete
        ? { add: { id: added.id, itemId: added.itemId, count: added.count } }
        : {}),
    };
    if (!complete)
      return { changes: atTime(changes, at), reservations, at, offers };

    for (const item of completion)
      if (
        !(await context.relations(item.itemId, "has", "in", latest)).some(
          (edge) => !edge.role && edge.source === item.heldBy,
        )
      )
        return reject("取り置いた品の所在を確認できません");
    quest.contributors = [
      ...new Set([
        ...quest.contributors,
        ...completion.map((item) => item.actor),
      ]),
    ];
    if (phase === "craft") {
      const id = quest.productId!;
      changes.nodes.push({
        id,
        kind: "existence",
        text: quest.plan.product!.label,
        ...(quest.template.installation
          ? { storageLimitSlots: quest.storageLimitSlots ?? storageSlots }
          : {}),
      });
      if (!quest.template.installation)
        changes.edges.push({
          id: derivedId(request + ":hold"),
          kind: "has",
          source: quest.plan.keeperId,
          target: id,
          text: basis,
          period: { from: at },
        });
    } else if (phase === "build") {
      const from = await context.node(source);
      const id = derivedId(`blueprint:${quest.id}:building`);
      const building = quest.plan.building!;
      if (!from) return reject("建設地を確認してください");
      addRoute(
        changes,
        quest.id,
        at,
        from,
        { id, text: building.label },
        basis,
      );
      const node = changes.nodes.find((node) => node.id === id);
      if (node?.kind === "existence")
        node.storageLimitSlots = quest.storageLimitSlots ?? storageSlots;
      changes.edges.push({
        id: derivedId(`blueprint:${quest.id}:storage`),
        kind: "has",
        role: "use",
        source: quest.plan.keeperId,
        target: id,
        text: basis,
        period: { from: at },
      });
      quest.buildingId = id;
    } else {
      for (const { stockCount, ...item } of quest.plan.shop!.stock) {
        const id = destinations.get(item.itemId) ?? item.itemId;
        const label = quest.requirements.open.find(
          (requirement) => requirement.itemId === item.itemId,
        )!.label;
        offers.push({
          ...item,
          id: derivedId(`blueprint:${quest.id}:offer:${item.itemId}`),
          sellerId: quest.plan.keeperId,
          storageId: quest.buildingId!,
          itemId: id,
          itemLabel: label,
        });
        void stockCount;
      }
    }
    quest.phase = phase === "build" && quest.plan.shop ? "open" : "done";
    quest.totals = [];
    return {
      changes: atTime(changes, at),
      reservations,
      at,
      offers,
      notice: {
        id: `blueprint:${quest.id}:${phase}`,
        actors: [quest.author, quest.plan.keeperId, ...quest.contributors],
        text: `${phase === "craft" ? "製作が完了しました" : phase === "build" ? "建築が完了しました" : "店が開店しました"}。${phase === "craft" ? "物品" : "場所"} ${quest.productId ?? quest.buildingId}。設計図 ${quest.id}`,
      },
    };
  }
}
