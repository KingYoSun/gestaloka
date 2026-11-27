import { createHash } from "node:crypto";
import { z } from "zod";

// Operators identify the row and the precise JSON string after inspecting it.
// The ledger carries hashes and offsets, never the original passage.
const sources = {
  generationRequest: ["llm_call", "request", "id"],
  generationResponse: ["llm_call", "response", "id"],
  inspection: ["inspection_manifest", "data", "id"],
  inspectionEvidence: [
    "inspection_evidence",
    "value",
    "manifest_id",
    "position",
  ],
  evaluation: ["inspection_evaluation", "result", "id"],
  scene: ["world_scene", "data", "id"],
  chat: ["bot_chat", "payload", "id"],
  operationResult: ["operation_request", "result", "id"],
};
export const reviewRule = z.object({
  source: z.enum(Object.keys(sources)),
  key: z.array(z.string()).min(1).max(2),
  path: z.array(z.string()),
  start: z.number().int().nonnegative(),
  length: z.number().int().positive(),
  before: z.string().regex(/^[a-f0-9]{64}$/),
  after: z.string().regex(/^[a-f0-9]{64}$/),
});
const hash = (s) => createHash("sha256").update(s).digest("hex");
export async function redact(db, rules) {
  for (const input of rules) {
    const r = reviewRule.parse(input);
    const [table, column, ...keys] = sources[r.source];
    if (keys.length !== r.key.length) throw new Error("WITHDRAWAL_REVIEW_KEY");
    const where = keys.map((key, i) => `${key}=$${i + 1}`).join(" AND ");
    const path = "$" + (keys.length + 1);
    const params = [...r.key, r.path];
    const row = (
      await db.query(
        `SELECT ${column} #> ${path}::text[] AS value FROM ${table} WHERE ${where} FOR UPDATE`,
        params,
      )
    ).rows[0];
    if (row?.value == null) continue;
    if (typeof row.value !== "string")
      throw new Error("WITHDRAWAL_REVIEW_TYPE");
    if (hash(row.value) === r.after) continue;
    const chars = Array.from(row.value);
    if (hash(row.value) !== r.before || r.start + r.length > chars.length)
      throw new Error("WITHDRAWAL_REVIEW_VERSION");
    const text =
      chars.slice(0, r.start).join("") +
      "［削除済み］" +
      chars.slice(r.start + r.length).join("");
    if (hash(text) !== r.after) throw new Error("WITHDRAWAL_REVIEW_RANGE");
    const replacement = "to_jsonb($" + (params.length + 1) + "::text)";
    await db.query(
      `UPDATE ${table} SET ${column}=CASE WHEN cardinality(${path}::text[])=0 THEN ${replacement}
      ELSE jsonb_set(${column},${path}::text[],${replacement},false) END WHERE ${where}`,
      [...params, text],
    );
  }
}
