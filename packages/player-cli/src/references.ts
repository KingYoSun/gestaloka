import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

// Store only IDs (no material, dialogue or credentials). The DB lives alongside
// this View's request journal, so commands and the background listener agree.
export class PlayerReferences {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS refs(short TEXT PRIMARY KEY, full TEXT NOT NULL UNIQUE); CREATE TABLE IF NOT EXISTS progress(name TEXT PRIMARY KEY, cursor INTEGER NOT NULL)",
    );
  }
  cursor() {
    return String(
      this.db
        .prepare(
          "SELECT CAST(cursor AS TEXT) AS value FROM progress WHERE name='status'",
        )
        .get()?.value ?? "0",
    );
  }
  advance(cursor: string) {
    this.db
      .prepare(
        "INSERT INTO progress VALUES('status',CAST(? AS INTEGER)) ON CONFLICT(name) DO UPDATE SET cursor=max(cursor,excluded.cursor)",
      )
      .run(cursor);
  }
  private short(full: string) {
    const prior = this.db
      .prepare("SELECT short FROM refs WHERE full=?")
      .get(full);
    if (prior) return String(prior.short);
    const digest =
      createHash("sha256").update(full).digest("hex") +
      full.replaceAll("-", "");
    for (let n = 8; n <= digest.length; n += 2) {
      const short = "@" + digest.slice(0, n);
      this.db
        .prepare("INSERT OR IGNORE INTO refs(short,full) VALUES(?,?)")
        .run(short, full);
      const saved = this.db
        .prepare("SELECT short FROM refs WHERE full=?")
        .get(full);
      if (saved) return String(saved.short);
    }
    throw Error("短縮IDを保存できません");
  }
  expand(value: string) {
    if (!/^@[a-f0-9]{8,96}$/.test(value)) return value;
    const row = this.db
      .prepare("SELECT full FROM refs WHERE short=?")
      .get(value);
    if (!row)
      throw Object.assign(Error("このインスタンスでは未知の短縮IDです"), {
        code: "UNKNOWN_SHORT_ID",
      });
    return String(row.full);
  }
  convert(value: unknown, input = false): unknown {
    const cache = new Map<string, string>();
    const convertId = (id: string) => {
      if (input) return this.expand(id);
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return id;
      const hit = cache.get(id);
      if (hit) return hit;
      const short = this.short(id);
      cache.set(id, short);
      return short;
    };
    const walk = (v: unknown, key: string, parent = ""): unknown => {
      if (Array.isArray(v)) return v.map((x) => walk(x, key, parent));
      if (v && typeof v === "object")
        return Object.fromEntries(
          Object.entries(v).map(([k, x]) => [k, walk(x, k, key)]),
        );
      if (typeof v !== "string") return v;
      if (key === "key" && /^(node|edge|relations):/.test(v)) {
        const parts = v.split(":");
        parts[1] = convertId(parts[1]!);
        return parts.join(":");
      }
      if (
        /(?:Id|Ids)$/.test(key) ||
        (!input &&
          parent === "receiving" &&
          (key === "sender" || key === "recipients")) ||
        [
          "next",
          "id",
          "source",
          "target",
          "participants",
          "endEdges",
          "holder",
          "person",
          "storage",
          "from",
          "to",
          "item",
        ].includes(key)
      )
        return convertId(v);
      return v;
    };
    // One commit per response also makes concurrent listeners see a complete mapping.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = walk(value, "");
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
