import { createHash, randomUUID } from "node:crypto";
import { type Driver } from "neo4j-driver";
import { z } from "zod";

const tables = Array.from({ length: 12 }, (_, i) => "s" + i);
const dim = 384,
  bits = 24;
const segments = new Intl.Segmenter("ja", { granularity: "sentence" });
let planes: Int8Array | undefined;

// Fixed random hyperplanes. The index partition includes the encoder revision.
function signature(vector: number[]) {
  if (!planes) {
    let seed = 0x584;
    planes = Int8Array.from({ length: tables.length * bits * dim }, () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed < 0 ? -1 : 1;
    });
  }
  let k = 0;
  return tables.map(() => {
    let code = 0;
    for (let b = 0; b < bits; b++) {
      let dot = 0;
      for (const x of vector) dot += x * planes![k++]!;
      code = code * 2 + Number(dot >= 0);
    }
    return code.toString(16).padStart(6, "0");
  });
}

export function semanticConfig() {
  const url = process.env.JUDGMENT_EMBEDDING_URL,
    revision = process.env.JUDGMENT_EMBEDDING_REVISION;
  return url && revision ? { url, revision } : undefined;
}
type Config = NonNullable<ReturnType<typeof semanticConfig>>;
async function embed(config: Config, inputs: string[]) {
  const res = await fetch(config.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inputs, normalize: true, truncate: true }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok)
    throw new Error("判定資料のベクトル化に失敗しました: " + res.status);
  return z
    .array(z.array(z.number().finite()).length(dim))
    .length(inputs.length)
    .parse(await res.json());
}
const partition = (owner: string, revision: string) => owner + ":" + revision;

export async function setupSemantic(driver: Driver) {
  await driver.executeQuery(
    "CREATE INDEX IF NOT EXISTS FOR ()-[r:happen]-() ON (r.semanticDue)",
  );
  await driver.executeQuery(
    "CREATE INDEX IF NOT EXISTS FOR (p:WorldExperiencePassage) ON (p.worldId,p.edge)",
  );
  for (const key of tables)
    await driver.executeQuery(
      "CREATE INDEX IF NOT EXISTS FOR (p:WorldExperiencePassage) ON (p.owner,p." +
        key +
        ")",
    );
}

export async function indexSemanticExperience(
  driver: Driver,
  config: Config,
  worldId?: string,
) {
  const claim = randomUUID(),
    now = Date.now();
  const job = (
    await driver.executeQuery(
      `MATCH ()-[r:happen]->(n) USING INDEX r:happen(semanticDue)
       WHERE r.semanticDue<=$now AND ($scope IS NULL OR r.worldId=$scope)
       WITH r,n ORDER BY r.semanticDue LIMIT 1
       SET r.semanticLock=true REMOVE r.semanticLock
       WITH r,n WHERE r.semanticDue<=$now SET r.semanticDue=$lease,r.semanticClaim=$claim
       RETURN r.worldId AS world,r.id AS edge,r.experienceOwner AS owner,n.data AS data`,
      { now, lease: now + 60000, claim, scope: worldId ?? null },
    )
  ).records[0];
  if (!job) return;
  const data = job.get("data") as string,
    text = JSON.parse(data).text as string;
  const quotes = new Set<string>();
  for (const { segment } of segments.segment(text)) {
    const chars = [...segment.trim()];
    for (let i = 0; i < chars.length; i += 64) {
      quotes.add(chars.slice(i, i + 96).join(""));
      if (i + 96 >= chars.length) break;
    }
  }
  const pieces = [...quotes],
    rows = [];
  for (let i = 0; i < pieces.length; i += 32) {
    const part = pieces.slice(i, i + 32);
    const vectors = await embed(
      config,
      part.map((t) => "passage: " + t),
    );
    for (const [j, vector] of vectors.entries()) {
      const salt = createHash("sha256")
        .update(job.get("edge") + ":" + String(i + j))
        .digest("hex")
        .slice(0, 12);
      const codes = signature(vector);
      rows.push({
        vector,
        ...Object.fromEntries(tables.map((key, t) => [key, codes[t] + salt])),
      });
    }
  }
  await driver.executeQuery(
    `MATCH ()-[r:happen {worldId:$world,id:$edge}]->(n)
     SET r.semanticLock=true REMOVE r.semanticLock
     WITH r,n WHERE r.semanticClaim=$claim AND n.data=$data
     CALL (r) { MATCH (old:WorldExperiencePassage {worldId:r.worldId,edge:r.id}) DELETE old }
     SET r.semanticRevision=$revision REMOVE r.semanticDue,r.semanticClaim
     WITH r,n UNWIND $rows AS row
     CREATE (p:WorldExperiencePassage {worldId:r.worldId,edge:r.id,event:n.id,owner:$owner,at:r.validFrom,known:n.knownFrom})
     SET p+=row`,
    {
      world: job.get("world"),
      edge: job.get("edge"),
      owner: partition(job.get("owner"), config.revision),
      claim,
      data,
      rows,
      revision: config.revision,
    },
  );
}

// Each range uses the scoped index order and stops before scoring any vectors.
// Check the canonical event and its owner again on the bounded result, including
// after a revision but before the worker has replaced the old vectors.
const probes = tables
  .flatMap((key, i) =>
    ["ASC", "DESC"].map((order) => {
      const comparison = order === "DESC" ? "<" : ">=";
      // Including the equality prefix in ORDER BY lets Neo4j stop the index seek
      // at eight rows. Ordering by the signature alone sorts the entire range.
      return `MATCH (p:WorldExperiencePassage) USING RANGE INDEX p:WorldExperiencePassage(owner,${key})
    WHERE p.owner=$owner AND p.${key} ${comparison} q.codes[${i}]
    WITH p ORDER BY p.owner ${order},p.${key} ${order} LIMIT 8 RETURN p`;
    }),
  )
  .join(" UNION ALL ");
export async function semanticExperiences(
  driver: Driver,
  config: Config,
  world: string,
  owner: string,
  at: number,
  texts: string[][],
) {
  const scope = partition(owner, config.revision);
  if (
    !(
      await driver.executeQuery(
        "MATCH (p:WorldExperiencePassage {owner:$owner}) WHERE p.s0 IS NOT NULL RETURN p.event LIMIT 1",
        { owner: scope },
      )
    ).records.length
  )
    return texts.map(() => []);
  const inputs = texts.flatMap((pair, index) =>
    [...new Set(pair)].map((text) => ({ index, text: text.slice(0, 2400) })),
  );
  const vectors = await embed(
    config,
    inputs.map(({ text }) => "query: " + text),
  ).catch(() => undefined);
  if (!vectors) return texts.map((): string[] => []);
  const qs = vectors.map((vec, i) => ({
    idx: inputs[i]!.index,
    vec,
    codes: signature(vec).map(
      (s) =>
        s +
        createHash("sha256").update(inputs[i]!.text).digest("hex").slice(0, 12),
    ),
  }));
  const { records } = await driver.executeQuery(
    `UNWIND $qs AS q CALL (q) {
       CALL (q) { ${probes} }
       WITH DISTINCT p,q WHERE p.at<=$at
       WITH p.event AS id,p.edge AS edge,p.known AS known,max(vector.similarity.cosine(p.vector,q.vec)) AS score
       ORDER BY score DESC,id LIMIT 20
       MATCH ()-[r:happen {worldId:$world,id:edge}]->(n:WorldNode {worldId:$world,id:id})
       WHERE r.experienceOwner=$authority AND n.knownFrom=known AND r.semanticRevision=$revision AND r.semanticDue IS NULL
       RETURN id,score
     }
     WITH q.idx AS idx,id,max(score) AS score ORDER BY idx,score DESC,id
     RETURN idx,collect(id)[..20] AS ids`,
    {
      owner: scope,
      authority: owner,
      world,
      at,
      qs,
      revision: config.revision,
    },
  );
  const result = texts.map((): string[] => []);
  for (const r of records) result[Number(r.get("idx"))] = r.get("ids");
  return result;
}
