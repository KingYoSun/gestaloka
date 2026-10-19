import { createHash } from "node:crypto";
import type { Driver, ManagedTransaction } from "neo4j-driver";
import { z } from "zod";
import {
  Change,
  RelationKind,
  WorldEdge,
  WorldNode,
  validateConnection,
} from "./model.js";

export { Change, RelationKind, WorldEdge, WorldNode } from "./model.js";
type Direction = "in" | "out";
type Lease = { worldId: string; runId: string; generation: number };
type Dependency = { key: string; version: number };
export type Receipt = {
  commitId: string;
  runId: string;
  at: number;
  committedAt: string;
  changes: Change;
};
export class WorldConflict extends Error {}

const nodeKey = (id: string) => `node:${id}`;
const edgeKey = (id: string) => `edge:${id}`;
const relationKey = (id: string, kind: RelationKind, direction: Direction) =>
  `relations:${id}:${kind}:${direction}`;
const edgeKeys = (edge: WorldEdge) => [
  edgeKey(edge.id),
  relationKey(edge.source, edge.kind, "out"),
  relationKey(edge.target, edge.kind, "in"),
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
  constructor(
    readonly driver: Driver,
    readonly worldId: string,
  ) {
    z.uuid().parse(worldId);
  }
  get dependencies(): Dependency[] {
    return [...this.#dependencies].map(([key, version]) => ({ key, version }));
  }

  async #read<T>(key: string, query: (tx: ManagedTransaction) => Promise<T>) {
    const session = this.driver.session();
    try {
      return await session.executeRead(async (tx) => {
        // Capture the revision before the data read; a concurrent write then invalidates the context.
        const revision = await version(tx, this.worldId, key);
        const data = await query(tx);
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

  async node(id: string, at?: number): Promise<WorldNode | undefined> {
    z.uuid().parse(id);
    if (at !== undefined) z.number().int().nonnegative().safe().parse(at);
    return this.#read(nodeKey(id), async (tx) => {
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
  }

  async edge(id: string): Promise<WorldEdge | undefined> {
    z.uuid().parse(id);
    return this.#read(edgeKey(id), async (tx) => {
      const result = await tx.run(
        "MATCH ()-[r {worldId: $worldId, id: $id}]->() RETURN r.data AS data",
        { worldId: this.worldId, id },
      );
      return result.records[0]
        ? WorldEdge.parse(JSON.parse(result.records[0].get("data")))
        : undefined;
    });
  }

  async relations(
    id: string,
    kind: RelationKind,
    direction: Direction,
    at: number,
  ): Promise<WorldEdge[]> {
    z.uuid().parse(id);
    RelationKind.parse(kind);
    z.enum(["in", "out"]).parse(direction);
    z.number().int().nonnegative().safe().parse(at);
    return this.#read(relationKey(id, kind, direction), async (tx) => {
      const pattern =
        direction === "out" ? `(n)-[r:${kind}]->()` : `(n)<-[r:${kind}]-()`;
      const result = await tx.run(
        `MATCH (n:WorldNode {worldId: $worldId, id: $id})
        MATCH ${pattern} WHERE r.worldId = $worldId AND r.validFrom <= $at
        AND (r.validTo IS NULL OR $at < r.validTo) RETURN r.data AS data ORDER BY r.id`,
        { worldId: this.worldId, id, at },
      );
      return result.records.map((row) =>
        WorldEdge.parse(JSON.parse(row.get("data"))),
      );
    });
  }
}

export class WorldStore {
  constructor(readonly driver: Driver) {}

  async setup() {
    for (const [label, field] of [
      ["WorldNode", "id"],
      ["WorldGuard", "key"],
      ["WorldRun", "runId"],
      ["WorldReceipt", "commitId"],
    ]) {
      await this.driver.executeQuery(
        `CREATE CONSTRAINT ${label}_identity IF NOT EXISTS FOR (n:${label}) REQUIRE (n.worldId, n.${field}) IS UNIQUE`,
      );
    }
    await this.driver.executeQuery(
      "CREATE CONSTRAINT WorldRevision_identity IF NOT EXISTS FOR (n:WorldRevision) REQUIRE (n.worldId, n.nodeId, n.version) IS UNIQUE",
    );
  }

  context(worldId: string) {
    return new WorldContext(this.driver, worldId);
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
    const result = await this.driver.executeQuery(
      "MATCH (r:WorldReceipt {worldId: $worldId, commitId: $commitId}) RETURN r.data AS data",
      { worldId, commitId },
    );
    return result.records[0]
      ? (JSON.parse(result.records[0].get("data")) as Receipt)
      : undefined;
  }

  async commit(
    lease: Lease,
    context: WorldContext,
    input: { commitId: string; at: number; changes: unknown },
  ): Promise<Receipt> {
    const { commitId, at, changes } = z
      .object({
        commitId: z.uuid(),
        at: z.number().int().nonnegative().safe(),
        changes: Change,
      })
      .strict()
      .parse(input);
    if (lease.worldId !== context.worldId)
      throw new Error("異なる世界の文脈は確定できません");
    const { worldId, runId, generation } = lease;
    const hash = createHash("sha256")
      .update(JSON.stringify({ runId, at, changes }))
      .digest("hex");
    const session = this.driver.session();
    try {
      return await session.executeWrite(async (tx) => {
        await lock(tx, worldId, `commit:${commitId}`);
        const prior = await tx.run(
          "MATCH (r:WorldReceipt {worldId: $worldId, commitId: $commitId}) RETURN r.hash AS hash, r.data AS data",
          { worldId, commitId },
        );
        if (prior.records[0]) {
          if (prior.records[0].get("hash") !== hash)
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
          revised.push({
            node: WorldNode.parse(JSON.parse(row.get("data"))),
            knownFrom: Number(row.get("knownFrom")),
          });
        }
        const ended: WorldEdge[] = [];
        for (const id of changes.endEdges) {
          dependencies.push({
            key: edgeKey(id),
            version: await version(tx, worldId, edgeKey(id)),
          });
          const result = await tx.run(
            "MATCH ()-[r {worldId: $worldId, id: $id}]->() RETURN r.data AS data",
            { worldId, id },
          );
          const edge = result.records[0]
            ? WorldEdge.parse(JSON.parse(result.records[0].get("data")))
            : undefined;
          if (!edge || edge.period.until !== undefined || at < edge.period.from)
            throw new WorldConflict("終了対象の関係が有効ではありません");
          ended.push(edge);
        }
        const touched = new Set([
          ...changes.nodes.map((node) => nodeKey(node.id)),
          ...changes.revisions.map((node) => nodeKey(node.id)),
          ...changes.edges.flatMap(edgeKeys),
          ...ended.flatMap(edgeKeys),
        ]);
        const keys = [
          ...new Set([
            ...touched,
            ...dependencies.map((dependency) => dependency.key),
          ]),
        ].sort();
        const versions = new Map<string, number>();
        for (const key of keys) versions.set(key, await lock(tx, worldId, key));
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
        for (const node of changes.nodes) {
          await tx.run(
            "CREATE (:WorldNode {worldId: $worldId, id: $id, kind: $kind, data: $data, knownFrom: $at, recordedAt: datetime()})",
            {
              worldId,
              id: node.id,
              kind: node.kind,
              data: JSON.stringify(node),
              at,
            },
          );
        }
        for (const prior of revised) {
          await tx.run(
            "CREATE (:WorldRevision {worldId: $worldId, nodeId: $id, version: $version, data: $data, knownFrom: $from, knownUntil: $at, recordedAt: datetime()})",
            {
              worldId,
              id: prior.node.id,
              version: versions.get(nodeKey(prior.node.id)),
              data: JSON.stringify(prior.node),
              from: prior.knownFrom,
              at,
            },
          );
        }
        for (const node of changes.revisions) {
          await tx.run(
            "MATCH (n:WorldNode {worldId: $worldId, id: $id}) SET n.data = $data, n.knownFrom = $at",
            { worldId, id: node.id, data: JSON.stringify(node), at },
          );
        }
        const endpointIds = [
          ...new Set(
            changes.edges.flatMap((edge) => [edge.source, edge.target]),
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
          await tx.run(
            `MATCH (s:WorldNode {worldId: $worldId, id: $source}), (t:WorldNode {worldId: $worldId, id: $target})
            CREATE (s)-[r:${edge.kind} {worldId: $worldId, id: $id, data: $data, validFrom: $from}]->(t)
            SET r.validTo = $until`,
            {
              worldId,
              source: edge.source,
              target: edge.target,
              id: edge.id,
              data: JSON.stringify(edge),
              from: edge.period.from,
              until: edge.period.until ?? null,
            },
          );
        }
        for (const edge of ended) {
          const data = JSON.stringify({
            ...edge,
            period: { ...edge.period, until: at },
          });
          await tx.run(
            "MATCH ()-[r {worldId: $worldId, id: $id}]->() SET r.validTo = $at, r.data = $data",
            { worldId, id: edge.id, at, data },
          );
        }
        for (const key of touched) {
          await tx.run(
            "MATCH (g:WorldGuard {worldId: $worldId, key: $key}) SET g.version = g.version + 1",
            { worldId, key },
          );
        }
        const receipt: Receipt = {
          commitId,
          runId,
          at,
          committedAt: new Date().toISOString(),
          changes,
        };
        await tx.run(
          "CREATE (:WorldReceipt {worldId: $worldId, commitId: $commitId, hash: $hash, data: $data})",
          { worldId, commitId, hash, data: JSON.stringify(receipt) },
        );
        return receipt;
      });
    } finally {
      await session.close();
    }
  }
}
