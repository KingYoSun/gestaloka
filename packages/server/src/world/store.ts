import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { int, type Driver, type ManagedTransaction } from "neo4j-driver";
import { z } from "zod";
import {
  InstallationPolicy,
  type CommandRestriction,
} from "@gestaloka/contracts";
import { routeEndpoints } from "./locations.js";
import {
  editBundle,
  InventoryBundleError,
  parseBundle,
  readBundle,
  type BundleCommand,
} from "./inventory-bundles.js";
import {
  defaultInventoryLimits,
  checkSkillChange,
  skillCapacityError,
  usedSkillSlots,
  initializeInventory,
  inventoryChange,
  inventoryStackKey,
  inventoryState,
  saveInventory,
  type InventoryLimits,
} from "./inventory.js";
import {
  Change,
  RelationKind,
  WorldEdge,
  WorldNode,
  validateConnection,
  bindingScripts,
  validateBindings,
  normalizeChange,
  requestedChange,
  BelongingRole,
  derivedId,
  isRespawnHome,
  respawnHome,
  summaryId,
  summaryText,
  type SummaryKind,
} from "./model.js";

export {
  Change,
  RelationKind,
  WorldEdge,
  WorldNode,
  BelongingRole,
  derivedId,
} from "./model.js";
type Direction = "in" | "out";
type InventoryActors = (worldId: string, ids: string[]) => Promise<Set<string>>;
export type Lease = { worldId: string; runId: string; generation: number };
export type Dependency = { key: string; version: number };
const storageBase = { storageId: z.uuid() };
const StorageEffect = z.discriminatedUnion("type", [
  z.object({
    ...storageBase,
    type: z.literal("install"),
    placeId: z.uuid(),
    managerId: z.uuid(),
    policy: InstallationPolicy,
  }),
  z.object({
    ...storageBase,
    type: z.literal("relocate"),
    placeId: z.uuid(),
    managerId: z.uuid(),
  }),
  z.object({
    ...storageBase,
    type: z.literal("post"),
    allocationIds: z.array(z.uuid()),
  }),
  z.object({
    ...storageBase,
    type: z.literal("withdraw"),
    allocationId: z.uuid(),
  }),
  z.object({
    ...storageBase,
    type: z.literal("claim"),
    allocationId: z.uuid(),
    sender: z.uuid(),
    receiver: z.uuid(),
    itemId: z.uuid(),
    label: z.string(),
    count: z.number().int().positive(),
    remaining: z.number().int().nonnegative(),
  }),
]);
export type StorageEffect = z.infer<typeof StorageEffect>;
export type PickupAllocation = {
  id: string;
  itemId: string;
  count: number;
  storageId: string;
  sender: string;
  recipient: string;
  label: string;
};
export type Receipt = {
  storageEffect?: StorageEffect;
  management?: { editorId: string; reason: string; requestHash: string };
  commitId: string;
  runId: string;
  at: number;
  committedAt: string;
  changes: Change;
  versions?: Record<string, { before: number; after: number }>;
};
export class WorldConflict extends Error {}
export class FixedPlaceMovement extends WorldConflict {
  constructor() {
    super("固定場所そのものの所在や所持先は変更できません");
  }
}
export const spUseProhibition = "system:sp-use-prohibited";
export function isSpUseProhibition(edge: WorldEdge) {
  return (
    edge.kind === "status" &&
    edge.role === "content" &&
    edge.text === spUseProhibition
  );
}
const spUseProhibitionAdminRequired = () =>
  new WorldConflict("SP使用禁止の状態は管理者だけが付与・変更できます");
const respawnHomeCommandRequired = () =>
  new WorldConflict("ホームは専用の設定操作で変更してください");
export type ItemReservations = {
  add?: { id: string; itemId: string; count: number };
  allocations?: PickupAllocation[];
  release: string[];
};

const nodeKey = (id: string) => `node:${id}`;
const placeKey = (id: string) => `fixed-place:${id}`;
const edgeKey = (id: string) => `edge:${id}`;
const restrictionSubject: Record<CommandRestriction, string> = {
  say: "restrictedSpeaker",
  move: "restrictedMover",
  "vehicle-travel": "restrictedVehicle",
};
// 関係の索引は種類ごとにある。種類を省いた照合は索引を使えず、世界中の関係を走査する。
const edgeById = `CALL () { ${RelationKind.options
  .map(
    (kind) =>
      `MATCH ()-[r:${kind} {worldId: $worldId, id: $id}]->() RETURN r.data AS data`,
  )
  .join(" UNION ALL ")} } RETURN data`;
const edgesById = `UNWIND $ids AS id CALL (id) { ${RelationKind.options
  .map(
    (kind) =>
      `MATCH ()-[r:${kind} {worldId:$worldId,id:id}]->() RETURN r.data AS data`,
  )
  .join(" UNION ALL ")} } RETURN data`;
const judgmentTextKey = '"text":"';
const excerptKinds = ["node", "has"] as const;
type ExcerptKind = (typeof excerptKinds)[number];
export type JudgmentExcerptJob = {
  kind: ExcerptKind;
  worldId: string;
  id: string;
  text: string;
  claim: string;
  sourceHash: string;
};
const excerptPatterns = {
  node: {
    match: "(v:WorldNode)",
    identity: "v:WorldNode(worldId,id)",
    ready: "v:WorldNode(judgmentAvailableAt)",
  },
  has: {
    match: "()-[v:has]->()",
    identity: "v:has(worldId,id)",
    ready: "v:has(judgmentAvailableAt)",
  },
} as const;
const excerptHash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
function excerptProperties(text: string | undefined) {
  const characters = (text ?? "")[Symbol.iterator]();
  for (let count = 0; count < 400; count++)
    if (characters.next().done)
      return { long: false, hash: null, available: null };
  return { long: true, hash: excerptHash(text!), available: Date.now() };
}
// 正本のJSONから本文の外側を保ち、準備済みの抜粋か、保護扱いの短い候補を返す。
const judgmentProjection = `WITH id,data,excerptLong,excerpt,split(data,$textKey) AS fields
  WITH id,data,excerptLong,excerpt,head(fields) AS prefix,
       CASE WHEN size(fields)>1 THEN substring(data,size(head(fields))+size($textKey)) ELSE '' END AS rest
  WITH id,data,excerptLong,excerpt,prefix,rest,head(split(rest,'","')) AS first
  WITH id,data,excerptLong,excerpt,prefix,rest,
       CASE WHEN first=rest THEN left(first,CASE WHEN size(first)>2 THEN size(first)-2 ELSE 0 END) ELSE first END AS text
  WITH id,data,excerpt,prefix,rest,text,coalesce(excerptLong,size(text)>=400) AS long
  RETURN id,
    CASE WHEN long THEN null ELSE data END AS data,
    CASE WHEN long THEN prefix END AS prefix,
    CASE WHEN long AND excerpt IS NULL THEN left(text,400) END AS preview,
    CASE WHEN long THEN excerpt END AS excerpt,
    CASE WHEN long THEN substring(rest,size(text)) END AS suffix,
    size(text) AS textLength`;

export type JudgmentPreview<T> = T & {
  judgmentTruncated?: true;
  judgmentTextLength?: number;
  judgmentExcerptPending?: true;
};
function parseJudgmentRecord<T extends object>(
  row: { get(key: string): unknown },
  schema: { parse(value: unknown): T },
): JudgmentPreview<T> {
  const data = row.get("data");
  if (typeof data === "string") return schema.parse(JSON.parse(data));
  const excerpt = row.get("excerpt");
  const ready = typeof excerpt === "string";
  // JSONのエスケープ文字列の途中で切れたときは、最後の完結した文字まで戻す。
  const complete = ready
    ? JSON.stringify(excerpt).slice(1, -1)
    : /^(?:[^"\\]|\\(?:["\\/bfnrt]|u[\da-f]{4}))*/iu.exec(
        row.get("preview") as string,
      )![0];
  return {
    ...schema.parse(
      JSON.parse(
        `${row.get("prefix")}${judgmentTextKey}${complete}${row.get("suffix")}`,
      ),
    ),
    judgmentTruncated: true,
    judgmentTextLength: Number(row.get("textLength")),
    ...(!ready ? { judgmentExcerptPending: true as const } : {}),
  };
}
const relationKey = (id: string, kind: RelationKind, direction: Direction) =>
  `relations:${id}:${kind}:${direction}`;
const edgeKeys = (edge: WorldEdge) => [
  edgeKey(edge.id),
  relationKey(edge.source, edge.kind, "out"),
  relationKey(edge.target, edge.kind, "in"),
];
const observationKeys = (edge: WorldEdge) => [
  ...(edge.observation?.sourceIds ?? []).map((id) => `source:${id}`),
  ...(edge.observation?.pathIds ?? []).map(edgeKey),
];

async function version(tx: ManagedTransaction, worldId: string, key: string) {
  const result = await tx.run(
    "MATCH (g:WorldGuard {worldId: $worldId, key: $key}) RETURN g.version AS version",
    { worldId, key },
  );
  return Number(result.records[0]?.get("version") ?? 0);
}

async function lock(tx: ManagedTransaction, worldId: string, key: string) {
  const result = await tx.run(
    `MERGE (g:WorldGuard {worldId: $worldId, key: $key})
    ON CREATE SET g.version = 0
    SET g._lock = true REMOVE g._lock RETURN g.version AS version`,
    { worldId, key },
  );
  return Number(result.records[0]!.get("version"));
}

export class WorldContext {
  readonly #dependencies = new Map<string, number>();
  readonly #histories = new Map<string, WorldEdge[]>();
  constructor(
    readonly driver: Driver,
    readonly worldId: string,
    dependencies: readonly Dependency[] = [],
    readonly drafts: readonly { at: number; changes: Change }[] = [],
    readonly inventoryActors: InventoryActors = async () => new Set(),
  ) {
    z.uuid().parse(worldId);
    for (const dependency of dependencies)
      this.#dependencies.set(dependency.key, dependency.version);
  }
  get dependencies(): Dependency[] {
    return [...this.#dependencies].map(([key, version]) => ({ key, version }));
  }
  dependOn(saved: readonly Dependency[]) {
    for (const { key, version } of saved) {
      const current = this.#dependencies.get(key);
      if (current !== undefined && current !== version)
        throw new WorldConflict("保存済みの文脈が変わりました");
      this.#dependencies.set(key, version);
    }
  }

  async inventoryRead<T>(
    fn: (
      tx: ManagedTransaction,
      state: Awaited<ReturnType<typeof initializeInventory>>,
    ) => Promise<T>,
  ) {
    const session = this.driver.session();
    try {
      return await session.executeWrite(async (tx) => {
        await lock(tx, this.worldId, "inventory");
        return fn(tx, await initializeInventory(tx, this.worldId));
      });
    } finally {
      await session.close();
    }
  }

  async checkInventory(
    changes: Change,
    { readOnly = false, deferSkills = false } = {},
  ) {
    await this.inventoryLimits();
    const check = async (
      tx: ManagedTransaction,
      { enabled, limits }: Awaited<ReturnType<typeof initializeInventory>>,
    ) => {
      const gainsSkills =
        !deferSkills && changes.edges.some((edge) => edge.role === "skill");
      if (!enabled && !gainsSkills) return;
      const ended: WorldEdge[] = [];
      for (const id of changes.endEdges) {
        const { records } = await tx.run(edgeById, {
          worldId: this.worldId,
          id,
        });
        if (records[0])
          ended.push(WorldEdge.parse(JSON.parse(records[0].get("data"))));
      }
      if (gainsSkills)
        await checkSkillChange(
          tx,
          this.worldId,
          changes.edges,
          ended,
          limits.skillSlots,
        );
      if (!enabled) return;
      await inventoryChange(
        tx,
        this.worldId,
        changes,
        ended,
        (ids) => this.inventoryActors(this.worldId, ids),
        limits,
        true,
      );
    };
    if (!readOnly) return this.inventoryRead(check);
    await this.prepareInventory();
    const session = this.driver.session();
    try {
      await session.executeRead(async (tx) =>
        check(tx, await inventoryState(tx, this.worldId)),
      );
    } finally {
      await session.close();
    }
  }

  async inventorySettings() {
    return this.#read("inventory", (tx) => inventoryState(tx, this.worldId));
  }

  async inventoryLimits() {
    return (await this.inventorySettings()).limits;
  }

  async usedSkillSlots(holder: string) {
    return this.#read(relationKey(holder, "has", "out"), (tx) =>
      usedSkillSlots(tx, this.worldId, holder),
    );
  }

  async skillCapacityError(holder: string, delta = 1) {
    return skillCapacityError(
      holder,
      await this.usedSkillSlots(holder),
      (await this.inventoryLimits()).skillSlots,
      delta,
    );
  }

  async inventorySlots(id: string) {
    return (await this.inventorySlotTotals(id, [id])).get(id) ?? 0;
  }

  async inventorySlotTotals(holder: string, ids: string[]) {
    await this.prepareInventory();
    return this.#read(`inventory:${holder}`, async (tx) => {
      const { records } = await tx.run(
        `UNWIND $ids AS id MATCH (n:WorldNode {worldId:$worldId,id:id})
         RETURN id,coalesce(n.inventorySlots,0) -
           CASE WHEN id=$holder THEN coalesce(n.inventoryDiscount,0) ELSE 0 END AS slots`,
        { worldId: this.worldId, holder, ids },
      );
      return new Map(
        records.map((r) => [r.get("id") as string, Number(r.get("slots"))]),
      );
    });
  }

  async inventoryBundles(storage: string) {
    return this.#read(`inventory:${storage}`, async (tx) => {
      const { records } = await tx.run(
        `MATCH (b:InventoryBundle {worldId:$worldId,storageId:$storage})
         RETURN b {.id,.storageId,.label,.normalSlots,.itemCount} AS bundle ORDER BY b.id`,
        { worldId: this.worldId, storage },
      );
      return records.map((row) => ({
        ...parseBundle(row.get("bundle")),
        slots: 1,
      }));
    });
  }

  async looseStorageItems(storage: string) {
    await this.prepareInventory();
    return this.#read(relationKey(storage, "has", "out"), async (tx) => {
      const { records } = await tx.run(
        `MATCH (n:WorldNode {worldId:$worldId,inventoryLooseHolder:$storage})
         USING INDEX n:WorldNode(worldId,inventoryLooseHolder)
         MATCH (:WorldNode {worldId:$worldId,id:$storage})-[r:has]->(n)
         WHERE r.role IS NULL AND r.validTo IS NULL
         RETURN r.data AS data`,
        { worldId: this.worldId, storage },
      );
      return records.map((row) => WorldEdge.parse(JSON.parse(row.get("data"))));
    });
  }

  async isBundled(id: string, holder?: string) {
    if (!holder) return false;
    return this.#read(`inventory:${holder}`, async (tx) => {
      const { records } = await tx.run(
        `MATCH (n:WorldNode {worldId:$worldId,id:$id})
         RETURN n.inventoryBundleId IS NOT NULL AS bundled`,
        { worldId: this.worldId, id },
      );
      return Boolean(records[0]?.get("bundled"));
    });
  }

  async editInventoryBundle(
    actor: string,
    input: BundleCommand,
    here: boolean,
  ) {
    return this.inventoryRead(async (tx, { limits, enabled }) =>
      editBundle(tx, this.worldId, actor, input, limits, enabled, async () => {
        if (!here)
          throw new InventoryBundleError(
            "保管先へ移動してから整理してください",
          );
        for (const { key, version } of [...this.dependencies].sort((a, b) =>
          a.key.localeCompare(b.key),
        ))
          if ((await lock(tx, this.worldId, key)) !== version)
            throw new WorldConflict("整理する前に本人の所在地が変わりました");
      }),
    );
  }

  async inventoryContents(actor: string, container: string, after?: string) {
    return this.inventoryRead(async (tx, { limits }) => {
      const worldId = this.worldId;
      const bundle = await readBundle(tx, worldId, container, actor);
      const seen = new Set<string>();
      let within = container;
      let allowed = !!bundle;
      while (!allowed && !seen.has(within)) {
        seen.add(within);
        const { records } = await tx.run(
          `MATCH (n:WorldNode {worldId:$worldId,id:$within})
           MATCH (p:WorldNode {worldId:$worldId,id:n.inventoryHolder})
           RETURN p.id AS parent, EXISTS {
             MATCH (:WorldNode {worldId:$worldId,id:$actor})-[u:has {role:'use'}]->(p)
             WHERE u.validTo IS NULL
           } AS registered`,
          { worldId, within, actor },
        );
        const row = records[0];
        if (!row) return;
        within = row.get("parent") as string;
        allowed = within === actor || row.get("registered");
      }
      if (!allowed) return;
      const key = bundle ? "inventoryBundleId" : "inventoryHolder";
      const pageSize = 50;
      // 複合索引の順で読み、残りの品を並べ替えずにページ末尾で止める。
      const { records: page } = await tx.run(
        `MATCH (n:WorldNode {worldId:$worldId,${key}:$container})
         USING INDEX n:WorldNode(worldId,${key},id)
         WHERE n.id > $after
         WITH n ORDER BY n.worldId,n.${key},n.id LIMIT $limit
         RETURN n.data AS data,coalesce(n.inventorySlots,0) AS slots`,
        { worldId, container, after: after ?? "", limit: int(pageSize + 1) },
      );
      const items = page.slice(0, pageSize).map((r) => ({
        node: WorldNode.parse(JSON.parse(r.get("data"))) as Extract<
          WorldNode,
          { kind: "existence" }
        >,
        contentsSlots: Number(r.get("slots")),
      }));
      return {
        items,
        next: page.length > pageSize ? items.at(-1)!.node.id : null,
        limits,
        isBundle: !!bundle,
      };
    });
  }

  async mergeCandidate(holder: string, key: string, exclude: string[]) {
    await this.prepareInventory();
    return this.#read(relationKey(holder, "has", "out"), async (tx) => {
      const { records } = await tx.run(
        `MATCH (n:WorldNode {worldId:$worldId,inventoryStackKey:$key})
         WHERE NOT n.id IN $exclude
         AND NOT EXISTS { MATCH (:InventoryBundle {worldId:$worldId,id:n.inventoryBundleId,storageId:$holder}) }
         RETURN n.id AS id ORDER BY n.id LIMIT 1`,
        { worldId: this.worldId, key, exclude, holder },
      );
      return records[0]?.get("id") as string | undefined;
    });
  }

  async prepareInventory() {
    const { records } = await this.driver.executeQuery(
      `MATCH (g:WorldGuard {worldId:$worldId,key:'inventory'})
       WHERE NOT coalesce(g.inventoryReady,false) AND g.inventoryHolderIndexed AND g.inventoryBundlesIndexed
         AND g.inventoryCacheUnits=coalesce(g.inventoryUnitsPerSlot,$defaultUnits) RETURN g.key`,
      {
        worldId: this.worldId,
        defaultUnits: defaultInventoryLimits.unitsPerSlot,
      },
      { routing: "READ" },
    );
    if (!records.length) await this.inventoryRead(async () => {});
  }

  async validate() {
    if (!this.#dependencies.size) return;
    const session = this.driver.session();
    try {
      await session.executeRead(async (tx) => {
        const changed = await tx.run(
          `UNWIND $dependencies AS d
          OPTIONAL MATCH (g:WorldGuard {worldId:$worldId,key:d.key})
          WITH d,g WHERE coalesce(g.version,0) <> d.version RETURN d.key LIMIT 1`,
          { worldId: this.worldId, dependencies: this.dependencies },
        );
        if (changed.records.length)
          throw new WorldConflict("保存済みの文脈が変わりました");
      });
    } finally {
      await session.close();
    }
  }

  async #read<T>(
    key: string,
    query: (tx: ManagedTransaction, revision: number) => Promise<T>,
  ) {
    const session = this.driver.session();
    try {
      return await session.executeRead(async (tx) => {
        // Capture the revision before the data read; a concurrent write then invalidates the context.
        const revision = await version(tx, this.worldId, key);
        const data = await query(tx, revision);
        const prior = this.#dependencies.get(key);
        if (prior !== undefined && prior !== revision)
          throw new WorldConflict("文脈の取得中に依存が変わりました");
        this.#dependencies.set(key, revision);
        return data;
      });
    } finally {
      await session.close();
    }
  }

  async #readMany<T>(
    keys: readonly string[],
    query: (tx: ManagedTransaction) => Promise<T>,
  ) {
    const session = this.driver.session();
    try {
      return await session.executeRead(async (tx) => {
        const { records } = await tx.run(
          `UNWIND $keys AS key
           OPTIONAL MATCH (g:WorldGuard {worldId:$worldId,key:key})
           RETURN key,coalesce(g.version,0) AS version`,
          { worldId: this.worldId, keys },
        );
        const data = await query(tx);
        this.dependOn(
          records.map((row) => ({
            key: row.get("key") as string,
            version: Number(row.get("version")),
          })),
        );
        return data;
      });
    } finally {
      await session.close();
    }
  }

  async nodes(ids: Iterable<string>, preview = false) {
    const wanted = new Set(ids);
    if (!wanted.size) return new Map<string, JudgmentPreview<WorldNode>>();
    const stored = await this.#readMany(
      [...wanted].map(nodeKey),
      async (tx) => {
        const { records } = await tx.run(
          `UNWIND $ids AS id MATCH (n:WorldNode {worldId:$worldId,id:id})
           WITH id,n.data AS data ${preview ? ",n.judgmentLong AS excerptLong,n.judgmentExcerpt AS excerpt " + judgmentProjection : "RETURN data"}`,
          { worldId: this.worldId, ids: [...wanted], textKey: judgmentTextKey },
        );
        return new Map<string, JudgmentPreview<WorldNode>>(
          records.map((row) => {
            const node = parseJudgmentRecord(row, WorldNode);
            return [node.id, node];
          }),
        );
      },
    );
    for (const draft of this.drafts)
      for (const node of draft.changes.nodes)
        if (wanted.has(node.id) && !stored.has(node.id))
          stored.set(node.id, node);
    return stored;
  }

  async edges(ids: Iterable<string>) {
    const wanted = new Set(ids);
    if (!wanted.size) return new Map<string, WorldEdge>();
    const stored = await this.#readMany(
      [...wanted].map(edgeKey),
      async (tx) => {
        const { records } = await tx.run(edgesById, {
          worldId: this.worldId,
          ids: [...wanted],
        });
        return new Map<string, WorldEdge>(
          records.map((row) => {
            const edge = WorldEdge.parse(JSON.parse(row.get("data")));
            return [edge.id, edge];
          }),
        );
      },
    );
    for (const draft of this.drafts)
      for (const edge of draft.changes.edges)
        if (wanted.has(edge.id) && !stored.has(edge.id))
          stored.set(edge.id, edge);
    return stored;
  }

  async outgoingRelations(
    ids: Iterable<string>,
    kind: RelationKind,
    at: number,
    through: number = at,
    preview = false,
  ) {
    const bySubject = new Map<string, JudgmentPreview<WorldEdge>[]>(
      [...ids].map((id) => [id, []]),
    );
    if (!bySubject.size) return bySubject;
    RelationKind.parse(kind);
    const subjects = [...bySubject.keys()];
    const accepts = (edge: WorldEdge) =>
      edge.period.from <= through &&
      (edge.period.until === undefined || at < edge.period.until);
    await this.#readMany(
      subjects.map((id) => relationKey(id, kind, "out")),
      async (tx) => {
        const { records } = await tx.run(
          `UNWIND $subjects AS id MATCH (n:WorldNode {worldId:$worldId,id:id})
           MATCH (n)-[r:${kind}]->() WHERE r.worldId=$worldId AND r.validFrom<=$through
           AND (r.validTo IS NULL OR $at<r.validTo)
           WITH id,r.data AS data ${preview && kind === "has" ? ",r.judgmentLong AS excerptLong,r.judgmentExcerpt AS excerpt " + judgmentProjection : "RETURN id,data"}`,
          {
            worldId: this.worldId,
            subjects,
            at,
            through,
            textKey: judgmentTextKey,
          },
        );
        for (const row of records)
          bySubject
            .get(row.get("id"))!
            .push(parseJudgmentRecord(row, WorldEdge));
      },
    );
    for (const [id, edges] of bySubject)
      bySubject.set(
        id,
        this.#merge(edges, id, kind, "out", accepts, (a, b) =>
          a.id.localeCompare(b.id),
        ),
      );
    return bySubject;
  }

  async node(id: string, at?: number): Promise<WorldNode | undefined> {
    z.uuid().parse(id);
    if (at !== undefined) z.number().int().nonnegative().safe().parse(at);
    const stored = await this.#read(nodeKey(id), async (tx) => {
      const result = await tx.run(
        `MATCH (n:WorldNode {worldId: $worldId, id: $id})
         WHERE $at IS NULL OR n.knownFrom <= $at RETURN n.data AS data
         UNION ALL
         MATCH (r:WorldRevision {worldId: $worldId, nodeId: $id})
         WHERE $at IS NOT NULL AND r.knownFrom <= $at AND $at < r.knownUntil RETURN r.data AS data`,
        { worldId: this.worldId, id, at: at ?? null },
      );
      return result.records[0]
        ? WorldNode.parse(JSON.parse(result.records[0].get("data")))
        : undefined;
    });
    // A scene can commit a status interval that starts before its script was stored.
    // Resolve that interval to the original text, never a later revision.
    if (
      !stored &&
      at !== undefined &&
      (await this.relations(id, "status", "in", at)).some(
        (edge) => edge.role === "content",
      )
    ) {
      const original = await this.#read(nodeKey(id), async (tx) => {
        const result = await tx.run(
          `MATCH (n:WorldNode {worldId:$worldId,id:$id,kind:'script'})
           OPTIONAL MATCH (r:WorldRevision {worldId:$worldId,nodeId:$id})
           RETURN coalesce(r.data,n.data) AS data ORDER BY r.version LIMIT 1`,
          { worldId: this.worldId, id },
        );
        return result.records[0]?.get("data") as string | undefined;
      });
      if (original) return WorldNode.parse(JSON.parse(original));
    }
    return (
      stored ??
      this.drafts
        .filter((d) => at === undefined || d.at <= at)
        .flatMap((d) => d.changes.nodes)
        .find((n) => n.id === id)
    );
  }

  async edge(id: string): Promise<WorldEdge | undefined> {
    z.uuid().parse(id);
    const stored = await this.#read(edgeKey(id), async (tx) => {
      const result = await tx.run(edgeById, { worldId: this.worldId, id });
      return result.records[0]
        ? WorldEdge.parse(JSON.parse(result.records[0].get("data")))
        : undefined;
    });
    return (
      stored ??
      this.drafts.flatMap((d) => d.changes.edges).find((e) => e.id === id)
    );
  }

  async spUseProhibitedUntil(actor: string, at: number) {
    z.uuid().parse(actor);
    z.number().int().nonnegative().safe().parse(at);
    return this.#read(relationKey(actor, "status", "out"), async (tx) => {
      // 複合索引の順で期限が最も遅い有効な関係を1件だけ読む。
      const { records } = await tx.run(
        `MATCH ()-[r:status]->()
         USING INDEX r:status(worldId,spSubject,validTo)
         WHERE r.worldId=$worldId AND r.spSubject=$actor AND r.validTo>$at AND r.validFrom<=$at
         WITH r ORDER BY r.worldId DESC,r.spSubject DESC,r.validTo DESC LIMIT 1
         RETURN r.validTo AS until`,
        { worldId: this.worldId, actor, at },
      );
      return records[0] ? Number(records[0].get("until")) : undefined;
    });
  }

  async commandRestriction(
    actor: string,
    command: CommandRestriction,
    at: number,
  ) {
    const subject = restrictionSubject[command];
    const ended = this.drafts.flatMap(({ changes }) => changes.endEdges);
    const edges = await this.#read(
      relationKey(actor, "status", "out"),
      async (tx) => {
        const { records } = await tx.run(
          `MATCH ()-[r:status]->()
         USING INDEX r:status(worldId,${subject},restrictionUntil)
         WHERE r.worldId=$worldId AND r.${subject}=$actor AND r.restrictionUntil>$at
           AND r.validFrom<=$at AND NOT r.id IN $ended
         WITH r ORDER BY r.worldId DESC,r.${subject} DESC,r.restrictionUntil DESC LIMIT 1
         RETURN r.data AS data`,
          { worldId: this.worldId, actor, at, ended },
        );
        return records.map((r) => WorldEdge.parse(JSON.parse(r.get("data"))));
      },
    );
    return this.#merge(
      edges,
      actor,
      "status",
      "out",
      (edge) =>
        !!edge.commandRestrictions?.includes(command) &&
        edge.period.from <= at &&
        (edge.period.until ?? Infinity) > at &&
        !ended.includes(edge.id),
      (a, b) =>
        (b.period.until ?? Number.MAX_SAFE_INTEGER) -
        (a.period.until ?? Number.MAX_SAFE_INTEGER),
      1,
    )[0];
  }

  async latestTime(id: string) {
    const stored = await this.#read(nodeKey(id), async (tx) => {
      const result = await tx.run(
        "MATCH (n:WorldNode {worldId:$worldId,id:$id}) RETURN n.knownFrom AS at",
        { worldId: this.worldId, id },
      );
      return result.records[0]
        ? Number(result.records[0].get("at"))
        : undefined;
    });
    return (
      stored ??
      this.drafts.find((d) => d.changes.nodes.some((n) => n.id === id))?.at
    );
  }

  #merge(
    edges: WorldEdge[],
    id: string,
    kind: RelationKind,
    direction: Direction,
    accepts: (edge: WorldEdge) => boolean,
    compare: (a: WorldEdge, b: WorldEdge) => number,
    limit?: number,
  ) {
    return [
      ...new Map(
        [
          ...this.drafts
            .flatMap((d) => d.changes.edges)
            .filter(
              (e) =>
                e.kind === kind &&
                (direction === "out" ? e.source : e.target) === id &&
                accepts(e),
            ),
          ...edges,
        ].map((e) => [e.id, e]),
      ).values(),
    ]
      .sort(compare)
      .slice(0, limit);
  }

  // 行き来の記述(route)で結ばれている場所のうち、同じ呼び名のもの。申請の可否の確認に使い、依存版には含めない。
  async routePlace(name: string) {
    // 呼び名の一致はTEXT索引で引き、世界中の存在を走査しない。
    const result = await this.driver.executeQuery(
      `MATCH (n:WorldNode) USING TEXT INDEX n:WorldNode(data)
       WHERE n.data CONTAINS $name AND n.worldId=$world AND n.kind='existence'
       MATCH (n)-[r:status {role:'content'}]->(:WorldNode)
       WHERE r.data CONTAINS $marker AND r.validTo IS NULL
       RETURN DISTINCT n.id AS id,n.data AS data ORDER BY id`,
      {
        world: this.worldId,
        marker: '"text":"route"',
        name: JSON.stringify(name),
      },
    );
    return result.records
      .find((r) => JSON.parse(r.get("data")).text === name)
      ?.get("id") as string | undefined;
  }

  // 指定した存在のうち、呼称が名前のどれかを含むものの呼称。1回でまとめて読む。
  async named(ids: string[], names: string[]) {
    const result = await this.driver.executeQuery(
      `UNWIND $ids AS id MATCH (n:WorldNode {worldId:$world,id:id})
       WHERE any(name IN $names WHERE n.data CONTAINS name) RETURN n.data AS data`,
      {
        world: this.worldId,
        ids,
        names: names.map((name) => JSON.stringify(name).slice(1, -1)),
      },
    );
    return result.records
      .map((r) => JSON.parse(r.get("data")).text as string)
      .filter((text) => names.some((name) => text.includes(name)));
  }

  async locationSubjects(
    place: string,
    at = Number.MAX_SAFE_INTEGER,
    direct?: { after?: string | undefined; limit: number },
  ) {
    z.uuid().parse(place);
    return this.#read(relationKey(place, "status", "in"), async (tx) => {
      const result = await tx.run(
        `MATCH (p:WorldNode {worldId:$world,id:$place})<-[a:status {role:'about'}]-(s:WorldNode)<-[c:status {role:'content'}]-(n:WorldNode)
        WHERE c.data CONTAINS $marker AND c.validFrom<=$at AND (c.validTo IS NULL OR $at<c.validTo)
        AND a.validFrom<=$at AND (a.validTo IS NULL OR $at<a.validTo)
        AND (NOT $direct OR a.data CONTAINS '"text":"direct-place"')
        AND ($after IS NULL OR n.id>$after)
        RETURN DISTINCT n.id AS id ${direct ? (direct.limit === 1 && !direct.after ? "LIMIT $limit" : "ORDER BY id LIMIT $limit") : ""}`,
        {
          world: this.worldId,
          place,
          at,
          marker: '"text":"location"',
          direct: !!direct,
          after: direct?.after ?? null,
          limit: int(direct?.limit ?? 21),
        },
      );
      return result.records.map((r) => r.get("id") as string);
    });
  }
  // 主体の最初の所在記録。世界内の同じ時点に重なった記録は、記録された順で区別する。
  async firstLocation(actor: string) {
    z.uuid().parse(actor);
    return this.#read(relationKey(actor, "status", "out"), async (tx) => {
      const result = await tx.run(
        `MATCH (:WorldNode {worldId:$world,id:$actor})-[c:status {role:'content'}]->(s:WorldNode)
        WHERE c.data CONTAINS $marker
        RETURN s.id AS id ORDER BY c.validFrom,s.recordedAt,s.id LIMIT 1`,
        { world: this.worldId, actor, marker: '"text":"location"' },
      );
      return result.records[0]?.get("id") as string | undefined;
    });
  }
  // 主体の有効な所在記録と、所在記録の最新の始点・最後の時点。終わった記録はDBの中で集計だけに使い、
  // 移動を重ねても読み出す量を有効な記録の数に保つ。
  async locations(actor: string) {
    z.uuid().parse(actor);
    const stored = await this.#read(
      relationKey(actor, "status", "out"),
      async (tx) => {
        const row = (
          await tx.run(
            `MATCH (n:WorldNode {worldId:$world,id:$actor})-[c:status {role:'content'}]->()
            WHERE c.worldId=$world AND c.data CONTAINS $marker
            RETURN max(c.validFrom) AS latest,max(coalesce(c.validTo,c.validFrom)) AS last,
              [x IN collect(c) WHERE x.validTo IS NULL | x.data] AS active`,
            { world: this.worldId, actor, marker: '"text":"location"' },
          )
        ).records[0]!;
        const time = (key: string) =>
          row.get(key) === null ? null : Number(row.get(key));
        return {
          latest: time("latest"),
          last: time("last"),
          active: (row.get("active") as string[]).map((d) =>
            WorldEdge.parse(JSON.parse(d)),
          ),
        };
      },
    );
    const drafts = this.drafts
      .flatMap((d) => d.changes.edges)
      .filter(
        (e) =>
          e.kind === "status" &&
          e.source === actor &&
          e.role === "content" &&
          e.text === "location",
      );
    const times = drafts.flatMap((e) => [e.period.from, e.period.until ?? 0]);
    return {
      latest: Math.max(
        stored.latest ?? -1,
        ...drafts.map((e) => e.period.from),
      ),
      last: Math.max(stored.last ?? 0, ...times),
      active: [
        ...new Map(
          [
            ...drafts.filter((e) => e.period.until === undefined),
            ...stored.active,
          ].map((e) => [e.id, e]),
        ).values(),
      ],
    };
  }
  async assertMovable(id: string) {
    const fixed = await this.#read(placeKey(id), async (tx) => {
      const result = await tx.run(
        "MATCH (n:WorldNode {worldId:$world,id:$id}) RETURN n.fixedPlace AS fixed, n:InstalledStorage AS installed",
        { world: this.worldId, id },
      );
      const row = result.records[0];
      if (row?.get("installed"))
        throw new WorldConflict(
          "設置済み保管先の移動には管理者の移設操作を使ってください",
        );
      return row?.get("fixed") === true;
    });
    if (fixed) throw new FixedPlaceMovement();
  }

  // 主体から記述への有効なcontentのうち、名目が一致するもの。絞り込みはDBの中で行い、ほかの関係を読み出さない。
  async marked(id: string, kind: "status" | "interpret", text: string) {
    z.uuid().parse(id);
    const stored = await this.#read(relationKey(id, kind, "out"), async (tx) =>
      (
        await tx.run(
          `MATCH (:WorldNode {worldId:$world,id:$id})-[c:${kind} {role:'content'}]->()
          WHERE c.worldId=$world AND c.validTo IS NULL AND c.data CONTAINS $marker RETURN c.data AS data`,
          {
            world: this.worldId,
            id,
            marker: JSON.stringify({ text }).slice(1, -1),
          },
        )
      ).records.map((r) => WorldEdge.parse(JSON.parse(r.get("data")))),
    );
    return this.#merge(
      stored,
      id,
      kind,
      "out",
      (e) =>
        e.role === "content" && e.text === text && e.period.until === undefined,
      (a, b) => a.id.localeCompare(b.id),
    ).filter((e) => e.text === text);
  }
  // 物品を現在持つ関係。firstを渡すと、終了した関係も含めた最初の1件（成立時）を返す。
  async holding(id: string, first = false, preview = false) {
    return this.#read(relationKey(id, "has", "in"), async (tx) => {
      const { records } = await tx.run(
        `MATCH ()-[h:has]->(:WorldNode {worldId:$world,id:$id})
         WHERE h.role IS NULL AND ($first OR h.validTo IS NULL)
         WITH $id AS id,h.data AS data,h.judgmentLong AS excerptLong,h.judgmentExcerpt AS excerpt ORDER BY h.validFrom,h.validTo LIMIT 1
         ${preview ? judgmentProjection : "RETURN data"}`,
        { world: this.worldId, id, first, textKey: judgmentTextKey },
      );
      return records[0]
        ? parseJudgmentRecord(records[0], WorldEdge)
        : undefined;
    });
  }
  // 自由入力の呼称を現物に結び付ける。2件あれば曖昧なのでそれ以上は読まない。
  async materialIds(holder: string, label: string) {
    return this.#read(relationKey(holder, "has", "out"), async (tx) => {
      const { records } = await tx.run(
        `MATCH (n:WorldNode) USING TEXT INDEX n:WorldNode(data)
         WHERE n.worldId=$world AND n.kind='existence' AND n.data CONTAINS $text
         MATCH (:WorldNode {worldId:$world,id:$holder})-[h:has]->(n)
         WHERE h.validTo IS NULL AND h.role IS NULL RETURN DISTINCT n.id AS id LIMIT 2`,
        {
          world: this.worldId,
          holder,
          text: '"text":' + JSON.stringify(label),
        },
      );
      return records.map((row) => row.get("id") as string);
    });
  }
  async storageAccess(id: string, actor: string) {
    return this.#read(relationKey(id, "has", "in"), async (tx) => {
      const { records } = await tx.run(
        `MATCH (s:WorldNode {worldId:$world,id:$id})
         RETURN EXISTS { MATCH ()-[h:has {role:'use'}]->(s) WHERE h.validTo IS NULL } AS registered,
           EXISTS { MATCH (:WorldNode {worldId:$world,id:$actor})-[h:has {role:'use'}]->(s)
                    WHERE h.validTo IS NULL } AS allowed`,
        { world: this.worldId, id, actor },
      );
      return {
        registered: records[0]?.get("registered") === true,
        allowed: records[0]?.get("allowed") === true,
      };
    });
  }
  async routesBetween(from: string, to: string) {
    return this.#read(relationKey(from, "status", "out"), async (tx) => {
      const { records } = await tx.run(
        `MATCH (:WorldNode {worldId:$world,id:$from})-[r:status {role:'content'}]->(s)
         MATCH (s)-[a:status {role:'about'}]->(:WorldNode {worldId:$world,id:$to})
         WHERE r.validTo IS NULL AND r.data CONTAINS '"text":"route"'
           AND a.validTo IS NULL AND NOT a.data CONTAINS '"text":"route-requires"'
         RETURN DISTINCT s.id AS id`,
        { world: this.worldId, from, to },
      );
      return records.map((r) => r.get("id") as string);
    });
  }
  // 行き来の記述で結ばれた既知の場所。読み取りを件数に比例させないよう、問い合わせで8件に絞る。
  async routeNeighbors(id: string) {
    return this.#read(relationKey(id, "status", "out"), async (tx) => {
      const { records } = await tx.run(
        `MATCH (:WorldNode {worldId:$world,id:$id})-[c:status {role:'content'}]->()-[a:status {role:'about'}]->(x:WorldNode)
         WHERE c.validTo IS NULL AND c.data CONTAINS '"text":"route"'
           AND a.validTo IS NULL AND NOT a.data CONTAINS '"text":"route-requires"' AND x.id <> $id
         RETURN DISTINCT x.id AS id, x.data AS data ORDER BY id LIMIT 8`,
        { world: this.worldId, id },
      );
      return records.map((r) => ({
        id: r.get("id") as string,
        label: (JSON.parse(r.get("data") as string) as { text: string }).text,
      }));
    });
  }
  // 場所の説明が part-of で指す親。説明や about の変更は source キーを更新する。
  async partParents(id: string, at: number) {
    return this.#read(`source:${id}`, async (tx) => {
      const { records } = await tx.run(
        `MATCH (:WorldNode {worldId:$world,id:$id})-[c:status {role:'content'}]->()-[a:status {role:'about'}]->(p:WorldNode {worldId:$world,kind:'existence'})
         WHERE c.validFrom <= $at AND (c.validTo IS NULL OR $at < c.validTo)
           AND a.validFrom <= $at AND (a.validTo IS NULL OR $at < a.validTo)
           AND a.data CONTAINS '"text":"part-of"'
         RETURN DISTINCT p.id AS id`,
        { world: this.worldId, id, at },
      );
      return records.map((r) => r.get("id") as string);
    });
  }

  // 一部の場所(part-of)で結ばれた場所。接続元の一部として探索された場所と、その接続元を互いに返す。
  async partPlaces(id: string) {
    const read = (direction: "out" | "in", pattern: string) =>
      this.#read(relationKey(id, "status", direction), async (tx) => {
        const { records } = await tx.run(
          `MATCH ${pattern}
           WHERE c.validTo IS NULL AND a.validTo IS NULL AND a.data CONTAINS '"text":"part-of"'
           RETURN DISTINCT x.id AS id ORDER BY id LIMIT 8`,
          { world: this.worldId, id },
        );
        return records.map((r) => r.get("id") as string);
      });
    return [
      ...(await read(
        "out",
        "(:WorldNode {worldId:$world,id:$id})-[c:status {role:'content'}]->()-[a:status {role:'about'}]->(x:WorldNode)",
      )),
      ...(await read(
        "in",
        "(x:WorldNode)-[c:status {role:'content'}]->()-[a:status {role:'about'}]->(:WorldNode {worldId:$world,id:$id})",
      )),
    ];
  }
  async vehiclesAt(place: string, actor: string, after?: string) {
    return this.#read(relationKey(place, "status", "in"), async (tx) => {
      const { records } = await tx.run(
        `MATCH (p:WorldNode {worldId:$world,id:$place})
         CALL (p) {
           MATCH (p)<-[a:status {role:'about'}]-()<- [c:status {role:'content'}]-(v)
           WHERE a.validTo IS NULL AND a.data CONTAINS '"text":"direct-place"'
             AND c.validTo IS NULL AND c.data CONTAINS '"text":"location"'
             AND NOT EXISTS { MATCH ()-[h:has]->(v) WHERE h.role IS NULL AND h.validTo IS NULL }
           RETURN v
           UNION
           UNWIND [p.id,$actor] AS holder
           MATCH path=(:WorldNode {worldId:$world,id:holder})-[:has*1..]->(v)
           WHERE all(h IN relationships(path) WHERE h.validTo IS NULL AND h.role IS NULL)
             AND none(s IN nodes(path)[0..-1] WHERE
               EXISTS { MATCH ()-[u:has {role:'use'}]->(s) WHERE u.validTo IS NULL }
               AND NOT EXISTS { MATCH (:WorldNode {worldId:$world,id:$actor})-[u:has {role:'use'}]->(s) WHERE u.validTo IS NULL })
           RETURN v
         }
         WITH DISTINCT v WHERE v.id>$after AND EXISTS {
           MATCH (v)-[mark:status {role:'content'}]->()
           WHERE mark.validTo IS NULL AND mark.data CONTAINS '"text":"vehicle"'
         }
         RETURN v.id AS id ORDER BY id LIMIT 21`,
        { world: this.worldId, place, actor, after: after ?? "" },
      );
      return records.map((r) => r.get("id") as string);
    });
  }
  async reserved(itemId: string) {
    return this.#read(relationKey(itemId, "has", "in"), async (tx) => {
      const { records } = await tx.run(
        "MATCH (r:WorldItemReservation {worldId:$worldId,itemId:$itemId}) RETURN sum(r.quantity) AS quantity",
        { worldId: this.worldId, itemId },
      );
      return Number(records[0]!.get("quantity"));
    });
  }

  async installation(id: string) {
    return this.#read(placeKey(id), async (tx) => {
      const { records } = await tx.run(
        "MATCH (n:WorldNode:InstalledStorage {worldId:$world,id:$id}) RETURN n.manager AS manager,n.place AS place,n.policy AS policy",
        { world: this.worldId, id },
      );
      const row = records[0];
      return (
        row && {
          manager: row.get("manager") as string,
          place: row.get("place") as string,
          policy: InstallationPolicy.parse(JSON.parse(row.get("policy"))),
        }
      );
    });
  }

  async relations(
    id: string,
    kind: RelationKind,
    direction: Direction,
    at: number,
    through: number = at,
    page?: { after?: string | undefined; limit: number },
  ): Promise<WorldEdge[]> {
    z.uuid().parse(id);
    RelationKind.parse(kind);
    z.enum(["in", "out"]).parse(direction);
    z.number().int().nonnegative().safe().parse(at);
    z.number().int().min(at).safe().parse(through);
    const stored = await this.#read(
      relationKey(id, kind, direction),
      async (tx) => {
        const pattern =
          direction === "out" ? `(n)-[r:${kind}]->()` : `(n)<-[r:${kind}]-()`;
        const result = await tx.run(
          `MATCH (n:WorldNode {worldId: $worldId, id: $id})
        MATCH ${pattern} WHERE r.worldId = $worldId AND r.validFrom <= $through
        AND (r.validTo IS NULL OR $at < r.validTo) AND ($after IS NULL OR r.id>$after)
        RETURN r.data AS data ORDER BY r.id ${page ? "LIMIT $limit" : ""}`,
          {
            worldId: this.worldId,
            id,
            at,
            through,
            after: page?.after ?? null,
            limit: int(page?.limit ?? 51),
          },
        );
        return result.records.map((row) =>
          WorldEdge.parse(JSON.parse(row.get("data"))),
        );
      },
    );
    return this.#merge(
      stored,
      id,
      kind,
      direction,
      (e) =>
        e.period.from <= through &&
        (e.period.until === undefined || at < e.period.until) &&
        (!page?.after || e.id > page.after),
      (a, b) => a.id.localeCompare(b.id),
      page?.limit,
    );
  }

  async history(
    id: string,
    kind: RelationKind,
    direction: Direction,
    through: number,
    from = 0,
    page?: { after?: { from: number; id: string } | undefined; limit: number },
  ): Promise<WorldEdge[]> {
    z.uuid().parse(id);
    RelationKind.parse(kind);
    z.enum(["in", "out"]).parse(direction);
    z.number().int().nonnegative().safe().parse(from);
    z.number().int().min(from).safe().parse(through);
    const cacheKey = JSON.stringify([id, kind, direction, through, from, page]);
    const stored = await this.#read(
      relationKey(id, kind, direction),
      async (tx) => {
        const cached = this.#histories.get(cacheKey);
        if (cached) return cached;
        const pattern =
          direction === "out" ? `(n)-[r:${kind}]->()` : `(n)<-[r:${kind}]-()`;
        const result = await tx.run(
          `MATCH(n:WorldNode {worldId:$worldId,id:$id}) MATCH ${pattern}
        WHERE r.worldId=$worldId AND r.validFrom>=$from AND r.validFrom<=$through
        AND ($after IS NULL OR r.validFrom>$after OR (r.validFrom=$after AND r.id>$cursor))
        RETURN r.data AS data ORDER BY r.validFrom,r.id ${page ? "LIMIT $limit" : ""}`,
          {
            worldId: this.worldId,
            id,
            from,
            through,
            after: page?.after?.from ?? null,
            cursor: page?.after?.id ?? null,
            limit: int(page?.limit ?? 51),
          },
        );
        const edges = result.records.map((row) =>
          WorldEdge.parse(JSON.parse(row.get("data"))),
        );
        this.#histories.set(cacheKey, edges);
        return edges;
      },
    );
    return this.#merge(
      stored,
      id,
      kind,
      direction,
      (e) =>
        e.period.from >= from &&
        e.period.from <= through &&
        (!page?.after ||
          e.period.from > page.after.from ||
          (e.period.from === page.after.from && e.id > page.after.id)),
      (a, b) => a.period.from - b.period.from || a.id.localeCompare(b.id),
      page?.limit,
    );
  }

  async historyPage(
    id: string,
    kind: "see" | "interpret",
    through: number,
    before?: { from: number; id: string },
    after?: { from: number; id: string },
  ) {
    z.uuid().parse(id);
    z.enum(["see", "interpret"]).parse(kind);
    const cursor = after ?? before,
      order = after ? "ASC" : "DESC",
      compare = after ? ">" : "<";
    const stored = await this.#read(
      relationKey(id, kind, "out"),
      async (tx) => {
        const result = await tx.run(
          `MATCH(n:WorldNode {worldId:$worldId,id:$id})-[r:${kind}]->()
         WHERE r.worldId=$worldId AND r.validFrom<=$through
         AND ($before IS NULL OR r.validFrom${compare}$before OR (r.validFrom=$before AND r.id${compare}$cursor))
         RETURN r.data AS data ORDER BY r.validFrom ${order},r.id ${order} LIMIT $limit`,
          {
            worldId: this.worldId,
            id,
            through,
            before: cursor?.from ?? null,
            cursor: cursor?.id ?? null,
            limit: int(51),
          },
        );
        return result.records.map((row) =>
          WorldEdge.parse(JSON.parse(row.get("data"))),
        );
      },
    );
    return this.#merge(
      stored,
      id,
      kind,
      "out",
      (e) =>
        e.period.from <= through &&
        (!cursor ||
          (after
            ? e.period.from > cursor.from ||
              (e.period.from === cursor.from && e.id > cursor.id)
            : e.period.from < cursor.from ||
              (e.period.from === cursor.from && e.id < cursor.id))),
      (a, b) =>
        (after ? 1 : -1) *
        (a.period.from - b.period.from || a.id.localeCompare(b.id)),
      51,
    );
  }

  private async observationState(edge: WorldEdge, through: number) {
    const basis = edge.observation;
    let sourceChanged: boolean | null = basis?.versions ? false : null;
    for (const [key, old] of Object.entries(basis?.versions ?? {})) {
      const current = await this.#read(key, async (_tx, revision) => revision);
      if (current !== old) sourceChanged = true;
    }
    return {
      sourceChanged,
      timeAdvanced: basis === undefined || through > basis.through,
    };
  }
  // One excerpt per observed target. Raw records remain addressable by edge ID;
  // specifying a target pages its evidence rather than unfolding every target.
  async sceneObservations(
    observer: string,
    through: number,
    purpose: string,
    offset = 0,
    target?: string,
    from = 0,
  ) {
    const terms = [
      ...new Set(
        [
          ...new Intl.Segmenter(undefined, { granularity: "word" }).segment(
            purpose.toLowerCase(),
          ),
        ]
          .filter((word) => word.isWordLike && word.segment.length > 1)
          .map((word) => word.segment),
      ),
    ];
    const drafts = this.drafts
      .flatMap((d) => d.changes.edges)
      .filter(
        (e) =>
          e.kind === "see" &&
          e.source === observer &&
          e.period.from >= from &&
          e.period.from <= through &&
          (!target || e.target === target),
      )
      .map((e) => ({
        id: e.id,
        target: e.target,
        at: e.period.from,
        data: JSON.stringify(e),
      }));
    const pageSize = 12;
    const rows = await this.#read(
      relationKey(observer, "see", "out"),
      async (tx) => {
        const r = await tx.run(
          `CALL () {
        MATCH (:WorldNode {worldId:$worldId,id:$observer})-[r:see]->(t)
        WHERE r.validFrom >= $from AND r.validFrom <= $through AND ($target IS NULL OR t.id=$target)
        RETURN r.id AS id,t.id AS target,r.validFrom AS at,r.data AS data
        UNION ALL
        UNWIND $drafts AS e
        WITH e WHERE NOT EXISTS { MATCH (:WorldNode {worldId:$worldId,id:$observer})-[r:see {id:e.id}]->() }
        RETURN e.id AS id,e.target AS target,e.at AS at,e.data AS data
      }
      WITH data,id,target,at, size([term IN $terms WHERE toLower(data) CONTAINS term]) AS score
      ORDER BY score DESC, at DESC, id
      WITH target, CASE WHEN $target IS NULL THEN target ELSE id END AS groupId,
           head(collect(data)) AS representative, max(score) AS relevance, min(at) AS firstAt,max(at) AS lastAt,count(*) AS count
      RETURN target,representative,firstAt,lastAt,count ORDER BY relevance DESC,lastAt DESC,groupId SKIP $offset LIMIT $limit`,
          {
            worldId: this.worldId,
            observer,
            through,
            from,
            target: target ?? null,
            drafts,
            terms,
            offset: int(offset),
            limit: int(pageSize + 1),
          },
        );
        return r.records;
      },
    );
    const items = [];
    for (const row of rows.slice(0, pageSize)) {
      const edge = WorldEdge.parse(JSON.parse(row.get("representative")));
      items.push({
        edge,
        count: Number(row.get("count")),
        firstAt: Number(row.get("firstAt")),
        lastAt: Number(row.get("lastAt")),
        ...(await this.observationState(edge, through)),
      });
    }
    return { items, next: rows.length > pageSize ? offset + pageSize : null };
  }

  // 起点から近い順に12ノードまでたどり、各ノードの到達作用と状態も12件までにする。
  // 続きはrelationsのページ照会で取得する。
  async effects(id: string, from: number, through: number) {
    const pending = [id],
      visited = new Set<string>(),
      page = { limit: 12 };
    const result = [];
    while (pending.length && result.length < page.limit) {
      const current = pending.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const incoming = await this.relations(
        current,
        "effect",
        "in",
        from,
        through,
        page,
      );
      result.push({
        id: current,
        node: await this.node(current, through),
        states: await this.relations(
          current,
          "status",
          "out",
          from,
          through,
          page,
        ),
        incoming,
      });
      pending.push(...incoming.map((edge) => edge.source));
    }
    return result;
  }
}

export class WorldStore {
  readonly #drafts = new AsyncLocalStorage<{
    worldId: string;
    drafts: readonly { at: number; changes: Change }[];
  }>();
  constructor(
    readonly driver: Driver,
    readonly inventoryActors?: InventoryActors,
  ) {}

  async setup() {
    for (const [label, field] of [
      ["WorldNode", "id"],
      ["WorldGuard", "key"],
      ["WorldRun", "runId"],
      ["WorldReceipt", "commitId"],
      ["WorldItemReservation", "id"],
      ["InventoryBundle", "id"],
    ]) {
      await this.driver.executeQuery(
        `CREATE CONSTRAINT ${label}_identity IF NOT EXISTS FOR (n:${label}) REQUIRE (n.worldId, n.${field}) IS UNIQUE`,
      );
    }
    await this.driver.executeQuery(
      "CREATE CONSTRAINT WorldRevision_identity IF NOT EXISTS FOR (n:WorldRevision) REQUIRE (n.worldId, n.nodeId, n.version) IS UNIQUE",
    );
    await this.driver.executeQuery(
      "CREATE INDEX WorldItemReservation_by_item IF NOT EXISTS FOR (r:WorldItemReservation) ON (r.worldId, r.itemId)",
    );
    for (const index of [
      "FOR (n:InstalledStorage) ON (n.worldId,n.place,n.id)",
      "FOR (n:WorldItemReservation) ON (n.worldId,n.storageId,n.recipient,n.id)",
      "FOR (n:WorldItemReservation) ON (n.worldId,n.storageId,n.sender,n.id)",
      "FOR (n:WorldPickup) ON (n.worldId,n.storageId,n.sender,n.commitId)",
      "FOR (n:WorldPickup) ON (n.worldId,n.storageId,n.receiver,n.commitId)",
      "FOR (n:WorldPickup) ON (n.noticePending)",
      "FOR (n:WorldPickup) ON (n.worldId,n.noticePending)",
      "FOR (n:WorldNode) ON (n.worldId,n.inventoryStackKey)",
      "FOR (n:WorldNode) ON (n.worldId,n.inventoryHolder,n.id)",
      "FOR (n:WorldNode) ON (n.worldId,n.inventoryBundleId,n.id)",
      "FOR (n:WorldNode) ON (n.worldId,n.inventoryLooseHolder)",
      "FOR (b:InventoryBundle) ON (b.worldId,b.storageId,b.id)",
      "FOR (r:InventoryBundleRequest) ON (r.worldId,r.actor,r.id)",
    ])
      await this.driver.executeQuery("CREATE INDEX IF NOT EXISTS " + index);
    await this.driver.executeQuery(
      "CREATE INDEX WorldReceipt_delivery IF NOT EXISTS FOR (n:WorldReceipt) ON (n.worldId, n.pendingDelivery)",
    );
    for (const kind of RelationKind.options)
      await this.driver.executeQuery(
        `CREATE INDEX WorldEdge_${kind}_identity IF NOT EXISTS FOR ()-[r:${kind}]-() ON (r.worldId, r.id)`,
      );
    await this.driver.executeQuery(
      "CREATE TEXT INDEX WorldNode_data IF NOT EXISTS FOR (n:WorldNode) ON (n.data)",
    );
    await this.driver.executeQuery(
      "CREATE INDEX WorldEdge_has_role IF NOT EXISTS FOR ()-[r:has]-() ON (r.role)",
    );
    await this.driver.executeQuery(
      "CREATE CONSTRAINT WorldJudgmentExcerptCursor_identity IF NOT EXISTS FOR (n:WorldJudgmentExcerptCursor) REQUIRE n.kind IS UNIQUE",
    );
    for (const index of [
      "FOR (n:WorldNode) ON (n.judgmentAvailableAt)",
      "FOR ()-[r:has]-() ON (r.judgmentAvailableAt)",
    ])
      await this.driver.executeQuery("CREATE INDEX IF NOT EXISTS " + index);
    await this.driver.executeQuery(
      "CREATE INDEX WorldEdge_status_sp_subject IF NOT EXISTS FOR ()-[r:status]-() ON (r.worldId,r.spSubject,r.validTo)",
    );
    for (const subject of Object.values(restrictionSubject)) {
      await this.driver.executeQuery(
        `CREATE INDEX IF NOT EXISTS FOR ()-[r:status]-() ON (r.worldId,r.${subject},r.restrictionUntil)`,
      );
    }
    // 同名確認は索引を指定して引くので、作成中の索引を使わせない。
    await this.driver.executeQuery("CALL db.awaitIndexes(300)");
    // ADR-072: 物品を持つ関係は役割なしのhas。旧版が役割holdで記録した関係を書き換える。
    await this.driver.executeQuery(
      `MATCH ()-[r:has {role:'hold'}]->() SET r.role = null, r.data = replace(r.data, ',"role":"hold"', '')`,
    );
  }

  // 旧記録は順序つきID索引から一定件数ずつ進め、同じ更新で位置と登録結果を保存する。
  async #backfillJudgmentExcerpts(
    tx: ManagedTransaction,
    kind: ExcerptKind,
    scope?: string,
  ) {
    const key = scope ? `${kind}:${scope}` : kind;
    const cursor = (
      await tx.run(
        `MERGE (cursor:WorldJudgmentExcerptCursor {kind:$key})
         ON CREATE SET cursor.lastWorldId=$scope,cursor.id='',cursor.done=false
         SET cursor.lock=true REMOVE cursor.lock
         RETURN cursor.lastWorldId AS worldId,cursor.id AS id,cursor.done AS done`,
        { key, scope: scope ?? "" },
      )
    ).records[0]!;
    if (cursor.get("done")) return;
    const { match, identity } = excerptPatterns[kind];
    const worldId: string = cursor.get("worldId");
    const id: string = cursor.get("id");
    const eligible =
      kind === "node"
        ? "v.kind IN ['script','existence'] AND NOT EXISTS { MATCH ()-[:has {role:'summary'}]->(v) }"
        : "(v.role IS NULL OR v.role='skill')";
    const page = async (same: boolean, limit: number) =>
      (
        await tx.run(
          `MATCH ${match} USING INDEX ${identity}
         WHERE ${same ? "v.worldId=$worldId AND v.id>$id" : "v.worldId>$worldId AND v.id IS NOT NULL"}
         WITH v ORDER BY v.worldId,v.id LIMIT $limit
         RETURN v.worldId AS worldId,v.id AS id,
           CASE WHEN v.judgmentLong IS NULL AND ${eligible} THEN v.data END AS data`,
          { worldId, id, limit: int(limit) },
        )
      ).records;
    const limit = 64;
    const rows = worldId ? await page(true, limit) : [];
    if (!scope && rows.length < limit)
      rows.push(...(await page(false, limit - rows.length)));
    const entries = rows.flatMap((row) => {
      const data = row.get("data") as string | null;
      if (!data) return [];
      const text = JSON.parse(data).text as string | undefined;
      return [
        {
          worldId: row.get("worldId"),
          id: row.get("id"),
          data,
          ...excerptProperties(text),
        },
      ];
    });
    if (entries.length)
      await tx.run(
        `UNWIND $entries AS entry
         MATCH ${match} USING INDEX ${identity}
         WHERE v.worldId=entry.worldId AND v.id=entry.id AND v.judgmentLong IS NULL
         SET v.judgmentLock=true REMOVE v.judgmentLock
         WITH v,entry WHERE v.judgmentLong IS NULL AND v.data=entry.data
         SET v.judgmentLong=entry.long,v.judgmentSourceHash=entry.hash,v.judgmentAvailableAt=entry.available`,
        { entries },
      );
    const last = rows.at(-1);
    await tx.run(
      `MATCH (cursor:WorldJudgmentExcerptCursor {kind:$key})
       SET cursor.lastWorldId=$worldId,cursor.id=$id,cursor.done=$done`,
      {
        key,
        worldId: last?.get("worldId") ?? worldId,
        id: last?.get("id") ?? id,
        done: rows.length < limit,
      },
    );
  }

  async judgmentExcerptJobs(
    limit: number,
    worldId?: string,
  ): Promise<JudgmentExcerptJob[]> {
    z.number().int().min(1).max(64).parse(limit);
    if (worldId) z.uuid().parse(worldId);
    const session = this.driver.session();
    try {
      return await session.executeWrite(async (tx) => {
        const claim = randomUUID();
        const jobs: JudgmentExcerptJob[] = [];
        for (const kind of excerptKinds) {
          await this.#backfillJudgmentExcerpts(tx, kind, worldId);
          const now = Date.now();
          const { match, ready } = excerptPatterns[kind];
          const { records } = await tx.run(
            `MATCH ${match} USING INDEX ${ready}
             WHERE v.judgmentAvailableAt<=$now AND ($worldId IS NULL OR v.worldId=$worldId)
             WITH v ORDER BY v.judgmentAvailableAt LIMIT $limit
             SET v.judgmentLock=true REMOVE v.judgmentLock
             WITH v WHERE v.judgmentAvailableAt<=$now
             SET v.judgmentAvailableAt=$until,v.judgmentClaim=$claim
             RETURN v.worldId AS worldId,v.id AS id,v.data AS data,v.judgmentSourceHash AS sourceHash`,
            {
              now,
              until: now + 5 * 60 * 1000,
              worldId: worldId ?? null,
              claim,
              limit: int(
                kind === "node" ? Math.ceil(limit / 2) : limit - jobs.length,
              ),
            },
          );
          for (const row of records)
            jobs.push({
              kind,
              worldId: row.get("worldId"),
              id: row.get("id"),
              text: JSON.parse(row.get("data")).text,
              claim,
              sourceHash: row.get("sourceHash"),
            });
        }
        return jobs;
      });
    } finally {
      await session.close();
    }
  }

  async finishJudgmentExcerpt(
    job: JudgmentExcerptJob,
    excerpt: string | null,
  ): Promise<boolean> {
    const { match, identity } = excerptPatterns[job.kind];
    const result = await this.driver.executeQuery(
      `MATCH ${match} USING INDEX ${identity}
       WHERE v.worldId=$worldId AND v.id=$id AND v.judgmentClaim=$claim
       SET v.judgmentLock=true REMOVE v.judgmentLock
       WITH v WHERE v.judgmentClaim=$claim AND v.judgmentSourceHash=$sourceHash
       SET v.judgmentExcerpt=$excerpt REMOVE v.judgmentClaim,v.judgmentAvailableAt
       RETURN v.id AS id`,
      {
        worldId: job.worldId,
        id: job.id,
        claim: job.claim,
        sourceHash: job.sourceHash,
        excerpt: excerpt?.trim() || null,
      },
    );
    return result.records.length > 0;
  }

  context(worldId: string, dependencies: readonly Dependency[] = []) {
    const scope = this.#drafts.getStore();
    return new WorldContext(
      this.driver,
      worldId,
      dependencies,
      scope?.worldId === worldId ? scope.drafts : [],
      this.inventoryActors,
    );
  }

  async configureInventory(
    worldId: string,
    enabled?: boolean,
    limits?: { [K in keyof InventoryLimits]?: number | undefined },
  ) {
    return this.context(worldId).inventoryRead(async (tx, state) => {
      const next = {
        skillSlots: limits?.skillSlots ?? state.limits.skillSlots,
        carrySlots: limits?.carrySlots ?? state.limits.carrySlots,
        storageSlots: limits?.storageSlots ?? state.limits.storageSlots,
        bundleSlots: limits?.bundleSlots ?? state.limits.bundleSlots,
        unitsPerSlot: limits?.unitsPerSlot ?? state.limits.unitsPerSlot,
      };
      const active = enabled ?? state.enabled;
      const changed =
        active !== state.enabled ||
        next.skillSlots !== state.limits.skillSlots ||
        next.carrySlots !== state.limits.carrySlots ||
        next.storageSlots !== state.limits.storageSlots ||
        next.bundleSlots !== state.limits.bundleSlots ||
        next.unitsPerSlot !== state.limits.unitsPerSlot;
      if (!changed && !limits) return state;
      await tx.run(
        `MATCH (g:WorldGuard {worldId:$worldId,key:'inventory'})
         SET g.inventoryEnabled=$enabled, g.inventoryCarrySlots=$carrySlots,
          g.inventoryStorageSlots=$storageSlots, g.inventoryUnitsPerSlot=$unitsPerSlot,
          g.inventoryBundleSlots=$bundleSlots,g.skillSlots=$skillSlots,
          g.version=g.version+$versionIncrease`,
        {
          worldId,
          enabled: active,
          ...next,
          versionIncrease: int(changed ? 1 : 0),
        },
      );
      return initializeInventory(tx, worldId);
    });
  }

  /** 管理者による一度の移行。候補の抽出は通常のプレイ・起動から呼び出さない。 */
  async protectExistingPlaces(
    worldId: string,
    actors: readonly string[],
    reviewed: { fixed: readonly string[]; movable: readonly string[] },
    apply = false,
  ) {
    const session = this.driver.session();
    const classify = async (tx: ManagedTransaction) => {
      const raw = await tx.run(
        `MATCH (p:WorldNode {worldId:$worldId,kind:'existence'})-[r:status {role:'content'}]->(s:WorldNode {kind:'script'})
         WHERE r.validTo IS NULL AND r.data CONTAINS '"text":"route"'
         WITH s, collect(r.data) AS contents
         OPTIONAL MATCH (s)-[a:status {role:'about'}]->(:WorldNode)
         WHERE a.validTo IS NULL
         RETURN contents, collect(a.data) AS about`,
        { worldId },
      );
      const endpoints = routeEndpoints(
        raw.records.flatMap((r) =>
          [...r.get("contents"), ...r.get("about")].map((data) =>
            WorldEdge.parse(JSON.parse(data)),
          ),
        ),
      );
      const movable = new Set(reviewed.movable);
      const fixed = new Set(reviewed.fixed);
      if (reviewed.fixed.some((id) => movable.has(id)))
        throw new Error("固定と移動可の判定が重複しています");
      const controlled = new Set(actors);
      let automatic = 0,
        ambiguous = 0;
      const ids = [...new Set([...endpoints, ...fixed, ...movable])].sort();
      // プレイヤーの確定と同じ順で印をロックしてから、現在の所持先を照合する。
      if (apply) for (const id of ids) await lock(tx, worldId, placeKey(id));
      const rows = await tx.run(
        `UNWIND $ids AS id OPTIONAL MATCH (n:WorldNode {worldId:$worldId,id:id,kind:'existence'})
         RETURN id,n.id IS NOT NULL AS found,coalesce(n.fixedPlace,false) AS fixed,
           EXISTS { MATCH (:WorldNode {kind:'existence'})-[h:has]->(n) WHERE h.role IS NULL AND h.validTo IS NULL } AS held`,
        { worldId, ids },
      );
      const mark = [];
      for (const r of rows.records) {
        const id: string = r.get("id");
        if (!r.get("found"))
          throw new Error(`判定対象が世界にありません: ${id}`);
        if (movable.has(id)) {
          if (r.get("fixed"))
            throw new Error(`固定済みの場所が移動可に指定されています: ${id}`);
          continue;
        }
        if (!fixed.has(id)) {
          if (controlled.has(id) || r.get("held")) {
            ambiguous++;
            continue;
          }
          automatic++;
        }
        if (!r.get("fixed")) mark.push(id);
      }
      const added = mark.length;
      if (apply && added)
        await tx.run(
          `UNWIND $mark AS id MATCH (n:WorldNode {worldId:$worldId,id:id}),
         (g:WorldGuard {worldId:$worldId,key:'fixed-place:'+id})
         SET n.fixedPlace=true,g.version=g.version+1`,
          { worldId, mark },
        );
      return {
        automatic,
        ambiguous,
        reviewedFixed: fixed.size,
        reviewedMovable: movable.size,
        added,
        applied: apply,
      };
    };
    try {
      return await (apply
        ? session.executeWrite(classify)
        : session.executeRead(classify));
    } finally {
      await session.close();
    }
  }

  withDrafts<T>(
    worldId: string,
    drafts: readonly { at: number; changes: Change }[],
    work: () => Promise<T>,
  ) {
    return this.#drafts.run({ worldId, drafts }, work);
  }

  // 自分の観測か解釈を持つ存在。見聞きし判断する主体を、種別の登録なしに関係から導く。
  async observers(worldId: string): Promise<WorldNode[]> {
    const result = await this.driver.executeQuery(
      `MATCH (n:WorldNode {worldId:$worldId,kind:'existence'})
       WHERE EXISTS { (n)-[r:see|interpret]->() WHERE r.worldId=$worldId }
       RETURN n.data AS data`,
      { worldId },
    );
    return result.records.map((row) =>
      WorldNode.parse(JSON.parse(row.get("data"))),
    );
  }

  async claim(worldId: string, runId: string): Promise<Lease> {
    z.uuid().parse(worldId);
    z.uuid().parse(runId);
    const result = await this.driver.executeQuery(
      `MERGE (r:WorldRun {worldId: $worldId, runId: $runId})
      ON CREATE SET r.generation = 0 SET r.generation = r.generation + 1 RETURN r.generation AS generation`,
      { worldId, runId },
    );
    return {
      worldId,
      runId,
      generation: Number(result.records[0]!.get("generation")),
    };
  }

  async receipt(
    worldId: string,
    commitId: string,
  ): Promise<Receipt | undefined> {
    return (await this.receipts(worldId, [commitId]))[0];
  }

  async receipts(worldId: string, commitIds: string[]): Promise<Receipt[]> {
    const result = await this.driver.executeQuery(
      "UNWIND $commitIds AS commitId MATCH (r:WorldReceipt {worldId: $worldId, commitId: commitId}) RETURN r.data AS data",
      { worldId, commitIds },
    );
    return result.records.map((r) => JSON.parse(r.get("data")) as Receipt);
  }

  async pendingReceipts(worldId: string): Promise<Receipt[]> {
    const key = "delivery:initialized";
    const initialized = await this.driver.executeQuery(
      "MATCH(g:WorldGuard {worldId:$worldId,key:$key}) RETURN g.version AS version",
      { worldId, key },
    );
    if (!initialized.records.length) {
      const session = this.driver.session();
      try {
        await session.executeWrite(async (tx) => {
          if ((await lock(tx, worldId, key)) !== 0) return;
          await tx.run(
            "MATCH(r:WorldReceipt {worldId:$worldId}) WHERE r.pendingDelivery IS NULL SET r.pendingDelivery=true",
            { worldId },
          );
          await tx.run(
            "MATCH(g:WorldGuard {worldId:$worldId,key:$key}) SET g.version=1",
            { worldId, key },
          );
        });
      } finally {
        await session.close();
      }
    }
    const result = await this.driver.executeQuery(
      "MATCH(r:WorldReceipt {worldId:$worldId,pendingDelivery:true}) RETURN r.data AS data ORDER BY r.commitId LIMIT 50",
      { worldId },
    );
    return result.records.map((r) => JSON.parse(r.get("data")) as Receipt);
  }

  async ackReceipt(worldId: string, commitId: string) {
    await this.driver.executeQuery(
      "MATCH(r:WorldReceipt {worldId:$worldId,commitId:$commitId}) SET r.pendingDelivery=false",
      { worldId, commitId },
    );
  }

  async commit(
    lease: Lease,
    context: WorldContext,
    input: {
      commitId: string;
      at: number;
      changes: unknown;
      playerAction?: boolean;
      newFixedPlaces?: string[];
      storageEffect?: StorageEffect;
      management?: { editorId: string; reason: string; requestHash: string };
      seriesGrants?: string[];
      spUseProhibitionGrants?: string[];
      respawnHomeActor?: string;
    },
    fromBelongingOperations = false,
    reservations?: ItemReservations,
  ): Promise<Receipt> {
    const parsed = z
      .object({
        commitId: z.uuid(),
        at: z.number().int().nonnegative().safe(),
        changes: Change,
        playerAction: z.boolean().optional(),
        newFixedPlaces: z.array(z.uuid()).optional(),
        storageEffect: StorageEffect.optional(),
        management: z
          .object({
            editorId: z.uuid(),
            reason: z.string().trim().min(1),
            requestHash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
          .optional(),
        seriesGrants: z.array(z.uuid()).optional(),
        spUseProhibitionGrants: z.array(z.uuid()).optional(),
        respawnHomeActor: z.uuid().optional(),
      })
      .strict()
      .parse(input);
    const { commitId, at } = parsed;
    const changes = normalizeChange(parsed.changes, at);
    const canChangeHome = (actor: string) =>
      parsed.management || parsed.respawnHomeActor === actor;
    for (const edge of changes.edges)
      if (isRespawnHome(edge) && !canChangeHome(edge.source))
        throw respawnHomeCommandRequired();
    for (const edge of changes.edges.filter(isSpUseProhibition)) {
      if (
        !parsed.management &&
        !parsed.spUseProhibitionGrants?.includes(edge.id)
      )
        throw spUseProhibitionAdminRequired();
      if (
        edge.period.until === undefined ||
        edge.period.until <= edge.period.from ||
        Number.isNaN(new Date(edge.period.until).getTime())
      )
        throw new WorldConflict("SP使用禁止の状態には期限を指定してください");
    }
    if (
      !parsed.management &&
      !fromBelongingOperations &&
      changes.nodes.some(
        (node) =>
          node.kind === "existence" &&
          !parsed.seriesGrants?.includes(node.id) &&
          (node.seriesId ||
            node.unitsPerSlot !== undefined ||
            node.storageLimitSlots !== undefined),
      )
    )
      throw new WorldConflict(
        "新しい物品へ系列を付けるには管理者の確定が必要です",
      );
    if (lease.worldId !== context.worldId)
      throw new Error("異なる世界の文脈は確定できません");
    const { worldId, runId, generation } = lease;
    const hashRequest = (fixedPlaces?: readonly string[]) =>
      createHash("sha256")
        .update(
          JSON.stringify({
            runId,
            at,
            changes: requestedChange(changes, at),
            ...(fixedPlaces?.length ? { newFixedPlaces: fixedPlaces } : {}),
            ...(reservations ? { reservations } : {}),
            ...(parsed.storageEffect
              ? { storageEffect: parsed.storageEffect }
              : {}),
            ...(parsed.management ? { management: parsed.management } : {}),
          }),
        )
        .digest("hex");
    const hash = hashRequest(parsed.newFixedPlaces);
    const session = this.driver.session();
    try {
      return await session.executeWrite(async (tx) => {
        await lock(tx, worldId, `commit:${commitId}`);
        const prior = await tx.run(
          "MATCH (r:WorldReceipt {worldId: $worldId, commitId: $commitId}) RETURN r.hash AS hash, r.data AS data,r.placePolicy AS placePolicy",
          { worldId, commitId },
        );
        if (prior.records[0]) {
          // 旧版の確定を再送した場合も、当時と同じ入力であることを照合する。
          const expected =
            !prior.records[0].get("placePolicy") &&
            parsed.newFixedPlaces?.length
              ? hashRequest()
              : hash;
          if (prior.records[0].get("hash") !== expected)
            throw new WorldConflict(
              "同じcommitIdに異なる確定内容は対応させられません",
            );
          return JSON.parse(prior.records[0].get("data")) as Receipt;
        }
        const fence = await tx.run(
          `MATCH (r:WorldRun {worldId: $worldId, runId: $runId})
          SET r._lock = true REMOVE r._lock RETURN r.generation AS generation`,
          { worldId, runId },
        );
        if (
          !fence.records[0] ||
          Number(fence.records[0].get("generation")) !== generation
        )
          throw new WorldConflict("古い実行試行からは確定できません");
        const dependencies = context.dependencies;
        const revised: { node: WorldNode; knownFrom: number }[] = [];
        for (const node of changes.revisions) {
          dependencies.push({
            key: nodeKey(node.id),
            version: await version(tx, worldId, nodeKey(node.id)),
          });
          const result = await tx.run(
            "MATCH (n:WorldNode {worldId: $worldId, id: $id}) RETURN n.data AS data, n.knownFrom AS knownFrom",
            { worldId, id: node.id },
          );
          const row = result.records[0];
          if (
            !row ||
            WorldNode.parse(JSON.parse(row.get("data"))).kind !== node.kind ||
            at < Number(row.get("knownFrom"))
          )
            throw new WorldConflict(
              "同一性・種別・既存の記録履歴を維持できない改訂です",
            );
          const original = WorldNode.parse(JSON.parse(row.get("data")));
          if (
            !parsed.management &&
            node.kind === "existence" &&
            original.kind === "existence"
          ) {
            if (
              node.seriesId !== undefined &&
              node.seriesId !== original.seriesId
            )
              throw new WorldConflict(
                "物品の系列の変更には管理者の確定が必要です",
              );
            if (original.seriesId) {
              if (
                !fromBelongingOperations &&
                (node.count ?? 0) > (original.count ?? 0)
              )
                throw new WorldConflict(
                  "系列のある物品の個数を増やすには管理者の確定が必要です",
                );
              node.seriesId = original.seriesId;
            }
            if (
              node.unitsPerSlot !== undefined &&
              node.unitsPerSlot !== original.unitsPerSlot
            )
              throw new WorldConflict(
                "1枠あたりの個数の変更には管理者の確定が必要です",
              );
            node.unitsPerSlot = original.unitsPerSlot;
            if (original.storageLimitSlots !== undefined)
              node.storageLimitSlots = original.storageLimitSlots;
            if (
              !fromBelongingOperations &&
              node.storageLimitSlots !== original.storageLimitSlots
            )
              throw new WorldConflict(
                "保管枠の設定には保管先の登録または管理者の確定が必要です",
              );
          }
          revised.push({
            node: original,
            knownFrom: Number(row.get("knownFrom")),
          });
        }
        const ended: WorldEdge[] = [];
        for (const id of changes.endEdges) {
          dependencies.push({
            key: edgeKey(id),
            version: await version(tx, worldId, edgeKey(id)),
          });
          const result = await tx.run(edgeById, { worldId, id });
          const edge = result.records[0]
            ? WorldEdge.parse(JSON.parse(result.records[0].get("data")))
            : undefined;
          if (
            !edge ||
            (edge.period.until ?? Infinity) <= at ||
            at < edge.period.from
          )
            throw new WorldConflict("終了対象の関係が有効ではありません");
          if (!parsed.management && isSpUseProhibition(edge))
            throw spUseProhibitionAdminRequired();
          if (isRespawnHome(edge) && !canChangeHome(edge.source))
            throw respawnHomeCommandRequired();
          ended.push(edge);
        }
        const inventoryTouched =
          changes.revisions.some((node) => node.kind === "existence") ||
          [...changes.edges, ...ended].some((edge) => edge.kind === "has");
        let inventorySettings:
          Awaited<ReturnType<typeof initializeInventory>> | undefined;
        if (inventoryTouched) {
          await lock(tx, worldId, "inventory");
          inventorySettings = await initializeInventory(tx, worldId);
          await checkSkillChange(
            tx,
            worldId,
            changes.edges,
            ended,
            inventorySettings.limits.skillSlots,
          );
        }
        // 持つ物品・役割つきhasの集合か、その対象の本文が変わる主体は、同じ確定で要約を作り直す。
        const summaries = new Map<
          string,
          { role: SummaryKind; edge: WorldEdge }
        >();
        const kinds = new Map(
          changes.nodes.map((node) => [node.id, node.kind]),
        );
        const kindOf = async (id: string) =>
          kinds.get(id) ??
          (
            await tx.run(
              "MATCH (n:WorldNode {worldId:$worldId,id:$id}) RETURN n.kind AS kind",
              { worldId, id },
            )
          ).records[0]?.get("kind");
        // 役割なしのhasは、存在へ向くときだけ物品を持つことを表す。
        const held = async (edge: WorldEdge) =>
          edge.kind === "has" &&
          edge.role === undefined &&
          (await kindOf(edge.target)) === "existence";
        const summarize = (subject: string, value: unknown) => {
          const role: SummaryKind | undefined =
            value === "hold" ? value : BelongingRole.safeParse(value).data;
          if (!role) return;
          const target = summaryId(subject, role);
          summaries.set(target, {
            role,
            edge: {
              id: derivedId(`${target}:has`),
              kind: "has",
              source: subject,
              target,
              role: "summary",
              period: { from: at },
            },
          });
        };
        for (const edge of [...changes.edges, ...ended])
          if (edge.kind === "has")
            summarize(edge.source, (await held(edge)) ? "hold" : edge.role);
        const stackHolders = new Set<string>();
        for (const [index, node] of changes.revisions.entries()) {
          const key = relationKey(node.id, "has", "in");
          dependencies.push({ key, version: await version(tx, worldId, key) });
          const holders = await tx.run(
            `MATCH(s:WorldNode)-[r:has {worldId:$worldId}]->(t:WorldNode {worldId:$worldId,id:$id})
            WHERE r.validTo IS NULL AND (r.role IS NOT NULL OR t.kind='existence')
            RETURN s.id AS subject,coalesce(r.role,'hold') AS role`,
            { worldId, id: node.id },
          );
          for (const row of holders.records) {
            summarize(row.get("subject"), row.get("role"));
            const prior = revised[index]!.node;
            const holder = row.get("subject") as string;
            if (
              row.get("role") === "hold" &&
              node.kind === "existence" &&
              prior.kind === "existence" &&
              inventorySettings &&
              inventoryStackKey(
                prior,
                inventorySettings.limits.unitsPerSlot,
                holder,
              ) !==
                inventoryStackKey(
                  node,
                  inventorySettings.limits.unitsPerSlot,
                  holder,
                )
            )
              stackHolders.add(relationKey(holder, "has", "out"));
          }
        }
        const releasing = reservations?.release.length
          ? (
              await tx.run(
                "UNWIND $ids AS id MATCH (r:WorldItemReservation {worldId:$worldId,id:id}) RETURN r.itemId AS item",
                { worldId, ids: reservations.release },
              )
            ).records.map((row) => row.get("item") as string)
          : [];
        const additions = [
          ...(reservations?.add ? [reservations.add] : []),
          ...(reservations?.allocations ?? []),
        ];
        const reservedItems = [...releasing, ...additions.map((a) => a.itemId)];
        if (releasing.length !== (reservations?.release.length ?? 0))
          throw new WorldConflict("取り置きはすでに解放されています");
        const touched = new Set([
          ...stackHolders,
          ...(parsed.storageEffect?.type === "install" ||
          parsed.storageEffect?.type === "relocate"
            ? [placeKey(parsed.storageEffect.storageId)]
            : []),
          ...reservedItems.map((id) => relationKey(id, "has", "in")),
          ...changes.nodes.map((node) => nodeKey(node.id)),
          ...changes.revisions.map((node) => nodeKey(node.id)),
          ...changes.edges.flatMap(edgeKeys),
          ...ended.flatMap(edgeKeys),
          ...[...summaries.values()].flatMap(({ edge }) => [
            nodeKey(edge.target),
            ...edgeKeys(edge),
          ]),
        ]);
        const sourceIds = new Set(
          [...changes.nodes, ...changes.revisions].map((node) => node.id),
        );
        for (const edge of [...changes.edges, ...ended]) {
          if (edge.kind !== "see" && edge.kind !== "interpret") {
            sourceIds.add(edge.source);
            sourceIds.add(edge.target);
          }
        }
        const movementTargets = new Set<string>();
        const changedStorageUsers = new Set<string>();
        const changedAbout = new Set<string>();
        if (parsed.playerAction) {
          for (const edge of [...changes.edges, ...ended]) {
            if (edge.kind === "has" && !edge.role)
              movementTargets.add(edge.target);
            if (edge.kind === "has" && edge.role === "use")
              changedStorageUsers.add(edge.target);
            if (
              edge.kind === "status" &&
              edge.role === "content" &&
              edge.text === "location"
            )
              movementTargets.add(edge.source);
            if (edge.kind === "status" && edge.role === "about")
              changedAbout.add(edge.source);
          }
        }
        const changedScripts = new Set([
          ...changes.revisions
            .filter((node) => node.kind === "script")
            .map((node) => node.id),
          ...[...changes.edges, ...ended]
            .filter((edge) => edge.kind === "status" && edge.role === "about")
            .map((edge) => edge.source),
        ]);
        for (const id of changedScripts) {
          const key = relationKey(id, "status", "in");
          dependencies.push({ key, version: await version(tx, worldId, key) });
          const owners = await tx.run(
            `MATCH (s:WorldNode {worldId:$worldId,id:$id})
            OPTIONAL MATCH (o:WorldNode)-[r:status {worldId:$worldId}]->(s)
            WHERE o.worldId=$worldId AND o.kind='existence' AND r.validFrom<=$at AND (r.validTo IS NULL OR $at<r.validTo)
            RETURN DISTINCT o.id AS id,r.data CONTAINS '"text":"location"' AS location,
              r.role='content' AND r.data CONTAINS $home AS respawnHome,s.spUseProhibition AS spUseProhibition`,
            {
              worldId,
              id,
              at,
              home: JSON.stringify({ text: respawnHome }).slice(1, -1),
            },
          );
          for (const owner of owners.records) {
            if (!parsed.management && owner.get("spUseProhibition"))
              throw spUseProhibitionAdminRequired();
            if (!owner.get("id")) continue;
            if (owner.get("respawnHome") && !canChangeHome(owner.get("id")))
              throw respawnHomeCommandRequired();
            sourceIds.add(owner.get("id"));
            if (changedAbout.has(id) && owner.get("location"))
              movementTargets.add(owner.get("id"));
          }
        }
        for (const edge of changes.edges)
          if (
            edge.kind === "status" &&
            edge.role === "content" &&
            changedScripts.has(edge.target)
          )
            sourceIds.add(edge.source);
        for (const id of sourceIds) touched.add(`source:${id}`);
        const bindings = bindingScripts([...changes.edges, ...ended]);
        const keys = [
          ...new Set([
            ...touched,
            ...[...movementTargets].map(placeKey),
            ...[...changedStorageUsers].map(placeKey),
            ...dependencies.map((dependency) => dependency.key),
            ...changes.edges.flatMap(observationKeys),
            ...bindings.flatMap((binding) => [
              relationKey(binding.id, binding.kind, "in"),
              relationKey(binding.id, binding.kind, "out"),
            ]),
          ]),
        ].sort();
        const versions = new Map<string, number>();
        for (const key of keys) versions.set(key, await lock(tx, worldId, key));
        if (
          movementTargets.size &&
          (
            await tx.run(
              "UNWIND $ids AS id MATCH (n:WorldNode {worldId:$worldId,id:id}) WHERE n.fixedPlace RETURN id LIMIT 1",
              { worldId, ids: [...movementTargets] },
            )
          ).records.length
        )
          throw new FixedPlaceMovement();
        const installedTargets = [
          ...new Set([...movementTargets, ...changedStorageUsers]),
        ];
        if (
          installedTargets.length &&
          (
            await tx.run(
              "UNWIND $ids AS id MATCH (n:WorldNode:InstalledStorage {worldId:$worldId,id:id}) WHERE $allowed IS NULL OR id <> $allowed RETURN id LIMIT 1",
              {
                worldId,
                ids: installedTargets,
                allowed:
                  parsed.storageEffect?.type === "relocate"
                    ? parsed.storageEffect.storageId
                    : null,
              },
            )
          ).records.length
        )
          throw new WorldConflict(
            "設置済み保管先の登録を確認してください。移動には管理者の移設操作を使ってください",
          );
        for (const dependency of dependencies) {
          if (versions.get(dependency.key) !== dependency.version)
            throw new WorldConflict("判断に使用した文脈が変わりました");
        }
        for (const key of [
          ...changes.nodes.map((node) => nodeKey(node.id)),
          ...changes.edges.map((edge) => edgeKey(edge.id)),
        ]) {
          if (versions.get(key) !== 0)
            throw new WorldConflict("同じ同一性を重複作成できません");
        }
        const moving = new Set(
          ended
            .filter((edge) => edge.kind === "has" && !edge.role)
            .map((edge) => edge.target),
        );
        const revisions = new Map(
          changes.revisions
            .filter((node) => node.kind === "existence")
            .map((node) => [node.id, node]),
        );
        const changedItems = new Set([
          ...revisions.keys(),
          ...moving,
          ...reservedItems,
        ]);
        if (changedItems.size) {
          const { records } = await tx.run(
            `UNWIND $ids AS id
             MATCH (n:WorldNode {worldId:$worldId,id:id,kind:'existence'})
             OPTIONAL MATCH (r:WorldItemReservation {worldId:$worldId,itemId:id})
             WHERE NOT r.id IN $ending
             RETURN id,n.data AS data,sum(r.quantity) AS reserved`,
            {
              ids: [...changedItems],
              worldId,
              ending: reservations?.release ?? [],
            },
          );
          for (const row of records) {
            const id: string = row.get("id");
            const quantity =
              Number(row.get("reserved")) +
              additions
                .filter((a) => a.itemId === id)
                .reduce((n, a) => n + a.count, 0);
            if (!quantity) continue;
            const before = WorldNode.parse(JSON.parse(row.get("data")));
            const after = revisions.get(id) ?? before;
            if (
              after.kind !== "existence" ||
              (after.count ?? 1) < quantity ||
              before.text !== after.text ||
              moving.has(id)
            )
              throw new WorldConflict(
                "クエストで取り置きした物品です。取り置きのない分だけ使えます",
              );
          }
        }
        if (reservations?.release.length)
          await tx.run(
            "UNWIND $ids AS id MATCH (r:WorldItemReservation {worldId:$worldId,id:id}) DELETE r",
            { worldId, ids: reservations.release },
          );
        if (additions.length)
          await tx.run(
            "UNWIND $entries AS entry CREATE (r:WorldItemReservation) SET r=entry,r.worldId=$worldId",
            {
              worldId,
              entries: additions.map(({ count, ...entry }) => ({
                ...entry,
                quantity: int(count),
              })),
            },
          );
        const inventory =
          inventorySettings &&
          (await inventoryChange(
            tx,
            worldId,
            changes,
            ended,
            (ids) => context.inventoryActors(worldId, ids),
            inventorySettings.limits,
            inventorySettings.enabled && !parsed.management,
          ));
        const fixedPlaces = new Set(parsed.newFixedPlaces);
        const createNode = (node: WorldNode, summary = false) =>
          tx.run(
            `CREATE (n:WorldNode {worldId: $worldId, id: $id, kind: $kind, data: $data, knownFrom: $at, recordedAt: datetime()})
             SET n.fixedPlace=$fixed,n.judgmentLong=$long,n.judgmentSourceHash=$hash,n.judgmentAvailableAt=$available`,
            {
              worldId,
              id: node.id,
              kind: node.kind,
              fixed:
                node.kind === "existence" && fixedPlaces.has(node.id)
                  ? true
                  : null,
              data: JSON.stringify(node),
              at,
              ...excerptProperties(
                !summary && node.kind !== "event" ? node.text : undefined,
              ),
            },
          );
        const reviseNode = async (
          prior: { node: WorldNode; knownFrom: number },
          node: WorldNode,
          at: number,
          summary = false,
        ) => {
          await tx.run(
            "CREATE (:WorldRevision {worldId: $worldId, nodeId: $id, version: $version, data: $data, knownFrom: $from, knownUntil: $at, recordedAt: datetime()})",
            {
              worldId,
              id: node.id,
              version: versions.get(nodeKey(node.id)),
              data: JSON.stringify(prior.node),
              from: prior.knownFrom,
              at,
            },
          );
          await tx.run(
            `MATCH (n:WorldNode {worldId: $worldId, id: $id})
             SET n.data=$data,n.knownFrom=$at
             FOREACH (_ IN CASE WHEN $textChanged OR n.judgmentLong IS NULL THEN [1] ELSE [] END |
               SET n.judgmentLong=$long,n.judgmentSourceHash=$hash,n.judgmentAvailableAt=$available
               REMOVE n.judgmentExcerpt,n.judgmentClaim)`,
            {
              worldId,
              id: node.id,
              data: JSON.stringify(node),
              at,
              textChanged: prior.node.text !== node.text,
              ...excerptProperties(
                !summary && node.kind !== "event" ? node.text : undefined,
              ),
            },
          );
        };
        const createEdge = (edge: WorldEdge) =>
          tx.run(
            `MATCH (s:WorldNode {worldId: $worldId, id: $source}), (t:WorldNode {worldId: $worldId, id: $target})
            CREATE (s)-[r:${edge.kind} {worldId: $worldId, id: $id, data: $data, validFrom: $from}]->(t)
            SET r.validTo = $until, r.role = $role${edge.kind === "has" ? ", r.judgmentLong=$long,r.judgmentSourceHash=$hash,r.judgmentAvailableAt=$available" : ""}${isSpUseProhibition(edge) ? ", r.spSubject = $source, t.spUseProhibition = true" : ""}${edge.commandRestrictions?.length ? ", r.restrictionUntil = $restrictionUntil" + edge.commandRestrictions.map((command) => `, r.${restrictionSubject[command]} = $source`).join("") : ""}`,
            {
              worldId,
              source: edge.source,
              target: edge.target,
              id: edge.id,
              data: JSON.stringify(edge),
              from: edge.period.from,
              until: edge.period.until ?? null,
              restrictionUntil: edge.period.until ?? Number.MAX_SAFE_INTEGER,
              role: edge.role ?? null,
              ...excerptProperties(
                edge.kind === "has" && (!edge.role || edge.role === "skill")
                  ? edge.text
                  : undefined,
              ),
            },
          );
        for (const node of changes.nodes) await createNode(node);
        const storageEffect = parsed.storageEffect;
        if (storageEffect?.type === "install") {
          if (
            !changes.nodes.some(
              (n) => n.kind === "existence" && n.id === storageEffect.storageId,
            )
          )
            throw new WorldConflict("新規の物品を設置してください");
          await tx.run(
            "MATCH(n:WorldNode {worldId:$worldId,id:$storageId}) SET n:InstalledStorage,n.place=$placeId,n.manager=$managerId,n.policy=$policy",
            {
              worldId,
              ...storageEffect,
              policy: JSON.stringify(storageEffect.policy),
            },
          );
        } else if (storageEffect?.type === "relocate") {
          const moved = await tx.run(
            "MATCH(n:WorldNode:InstalledStorage {worldId:$worldId,id:$storageId,manager:$managerId}) WHERE NOT coalesce(n.fixedPlace,false) SET n.place=$placeId RETURN n.id",
            { worldId, ...storageEffect },
          );
          if (!moved.records.length)
            throw new WorldConflict("保管先の移設権限がありません");
        }
        for (const [index, node] of changes.revisions.entries())
          await reviseNode(revised[index]!, node, at);
        const endpointIds = [
          ...new Set(
            changes.edges.flatMap((edge) => [
              edge.source,
              edge.target,
              ...(edge.observation?.sourceIds ?? []),
            ]),
          ),
        ];
        const endpoints = await tx.run(
          "MATCH (n:WorldNode) WHERE n.worldId = $worldId AND n.id IN $ids RETURN n.id AS id, n.data AS data",
          { worldId, ids: endpointIds },
        );
        const nodes = new Map(
          endpoints.records.map((row) => [
            row.get("id") as string,
            WorldNode.parse(JSON.parse(row.get("data"))),
          ]),
        );
        for (const edge of changes.edges) {
          const source = nodes.get(edge.source),
            target = nodes.get(edge.target);
          if (!source || !target)
            throw new Error("同じ世界の接続先が見つかりません");
          validateConnection(edge, source, target);
          await createEdge(edge);
        }
        for (const edge of ended) {
          const data = JSON.stringify({
            ...edge,
            period: { ...edge.period, until: at },
          });
          await tx.run(
            `MATCH ()-[r:${edge.kind} {worldId: $worldId, id: $id}]->() SET r.validTo = $at, r.data = $data${edge.commandRestrictions?.length ? ", r.restrictionUntil = $at" : ""}`,
            { worldId, id: edge.id, at, data },
          );
        }
        if (inventory) {
          await saveInventory(tx, worldId, inventory);
          await tx.run(
            `UNWIND $keys AS key MERGE (g:WorldGuard {worldId:$worldId,key:key})
             SET g.version=coalesce(g.version,0)+1`,
            {
              worldId,
              keys: [...inventory.slots.keys()].map((id) => `inventory:${id}`),
            },
          );
        }
        for (const edge of changes.edges) {
          if (!(await held(edge))) continue;
          const open = await tx.run(
            `MATCH()-[r:has {worldId:$worldId}]->(:WorldNode {worldId:$worldId,id:$id})
            WHERE r.validTo IS NULL AND r.role IS NULL RETURN count(r) AS count`,
            { worldId, id: edge.target },
          );
          if (Number(open.records[0]!.get("count")) > 1)
            throw new Error("同じ物品の所在を同時に複数成立させられません");
        }
        for (const id of new Set(
          changes.edges
            .filter(
              (e) =>
                e.kind === "status" &&
                e.role === "content" &&
                e.text === "operator",
            )
            .map((e) => e.source),
        )) {
          const { records } = await tx.run(
            `MATCH (:WorldNode {worldId:$worldId,id:$id})-[r:status {role:'content'}]->()
             WHERE r.validTo IS NULL AND r.data CONTAINS '"text":"operator"'
             RETURN count(r) AS count`,
            { worldId, id },
          );
          if (Number(records[0]!.get("count")) > 1)
            throw new WorldConflict(
              "乗り物の専用操縦権は同時に一つだけ有効です",
            );
        }
        const derived = { nodes: [], revisions: [], edges: [] } as Pick<
          Change,
          "nodes" | "revisions" | "edges"
        >;
        for (const [id, { role, edge }] of summaries) {
          const targets = await tx.run(
            `MATCH(:WorldNode {worldId:$worldId,id:$subject})-[r:has {worldId:$worldId}]->(t:WorldNode)
            WHERE r.validTo IS NULL AND ($role='hold' AND r.role IS NULL AND t.kind='existence' OR r.role=$role)
            RETURN t.data AS data ORDER BY r.validFrom,r.id`,
            { worldId, subject: edge.source, role },
          );
          const node: WorldNode = {
            id,
            kind: "script",
            text: summaryText(
              role,
              targets.records.map((row) =>
                WorldNode.parse(JSON.parse(row.get("data"))),
              ),
            ),
          };
          const stored = await tx.run(
            "MATCH (n:WorldNode {worldId: $worldId, id: $id}) RETURN n.data AS data, n.knownFrom AS knownFrom",
            { worldId, id },
          );
          const row = stored.records[0];
          if (!row) {
            await createNode(node, true);
            await createEdge(edge);
            derived.nodes.push(node);
            derived.edges.push(edge);
          } else {
            const prior = {
              node: WorldNode.parse(JSON.parse(row.get("data"))),
              knownFrom: Number(row.get("knownFrom")),
            };
            if (prior.node.text !== node.text) {
              // 要約は最新の確定状態を表す。以前より前の時点の確定でも記録時点は戻さない。
              await reviseNode(
                prior,
                node,
                Math.max(at, prior.knownFrom),
                true,
              );
              derived.revisions.push(node);
            }
          }
          if (role === "skill")
            await tx.run(
              "MATCH (s:WorldNode {worldId:$worldId,id:$id}) SET s.skillSlots=$used",
              { worldId, id, used: int(targets.records.length) },
            );
        }
        for (const key of touched) {
          await tx.run(
            "MATCH (g:WorldGuard {worldId: $worldId, key: $key}) SET g.version = g.version + 1",
            { worldId, key },
          );
        }
        const canonicalEdges = [...derived.edges];
        for (const edge of changes.edges) {
          if (!edge.observation) {
            canonicalEdges.push(edge);
            continue;
          }
          if (edge.observation.sourceIds.some((id) => !nodes.has(id)))
            throw new Error("観測元が同じ世界に存在しません");
          const paths = edge.observation.pathIds;
          if (paths.length) {
            const found = await tx.run(
              "MATCH(:WorldNode {worldId:$worldId})-[r:effect {worldId:$worldId}]->() WHERE r.id IN $ids RETURN r.id AS id",
              { worldId, ids: paths },
            );
            if (
              new Set(found.records.map((record) => record.get("id"))).size !==
              paths.length
            )
              throw new Error("観測した作用経路が同じ世界に存在しません");
          }
          const snapshot = Object.fromEntries(
            observationKeys(edge).map((key) => [
              key,
              versions.get(key)! + (touched.has(key) ? 1 : 0),
            ]),
          );
          const canonical = {
            ...edge,
            observation: { ...edge.observation, versions: snapshot },
          };
          await tx.run(
            "MATCH(:WorldNode {worldId:$worldId,id:$source})-[r {worldId:$worldId,id:$id}]->() SET r.data=$data",
            {
              worldId,
              source: edge.source,
              id: edge.id,
              data: JSON.stringify(canonical),
            },
          );
          canonicalEdges.push(canonical);
        }
        for (const binding of bindings) {
          const result = await tx.run(
            `MATCH(s:WorldNode {worldId:$worldId,id:$id})-[r:${binding.kind}]-(n:WorldNode)
            WHERE r.worldId=$worldId RETURN DISTINCT r.data AS data`,
            { worldId, id: binding.id },
          );
          validateBindings(
            binding.kind,
            binding.id,
            result.records.map((record) =>
              WorldEdge.parse(JSON.parse(record.get("data"))),
            ),
          );
        }
        const receipt: Receipt = {
          ...(storageEffect ? { storageEffect } : {}),
          commitId,
          runId,
          at,
          committedAt: new Date().toISOString(),
          changes: {
            nodes: [...changes.nodes, ...derived.nodes],
            revisions: [...changes.revisions, ...derived.revisions],
            edges: canonicalEdges,
            endEdges: changes.endEdges,
          },
          versions: Object.fromEntries(
            [...touched].map((key) => [
              key,
              {
                before: versions.get(key)!,
                after: versions.get(key)! + 1,
              },
            ]),
          ),
          ...(parsed.management ? { management: parsed.management } : {}),
        };
        await tx.run(
          "CREATE (:WorldReceipt {worldId: $worldId, commitId: $commitId, hash: $hash, data: $data,pendingDelivery:true,placePolicy:true})",
          { worldId, commitId, hash, data: JSON.stringify(receipt) },
        );
        if (storageEffect?.type === "claim")
          await tx.run(
            "MATCH(r:WorldReceipt {worldId:$worldId,commitId:$commitId}) SET r:WorldPickup,r.noticePending=true,r.storageId=$storageId,r.sender=$sender,r.receiver=$receiver,r.pickup=$pickup",
            {
              worldId,
              commitId,
              ...storageEffect,
              pickup: JSON.stringify({
                ...storageEffect,
                at: receipt.committedAt,
                commitId,
              }),
            },
          );
        return receipt;
      });
    } finally {
      await session.close();
    }
  }
}
