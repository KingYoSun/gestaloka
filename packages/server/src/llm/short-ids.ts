import { createHash } from "node:crypto";
import type { ChatMessage } from "./client.js";
import { parseOutput } from "./prompt.js";

/** The dictionary can be reconstructed from the frozen messages of this call. */
export function shortIds(callId: string, source: ChatMessage[]) {
  const ids = new Map<string, string>();
  const reverse = new Map<string, string>();
  let prefix = "~";
  while (source.some((m) => new RegExp(prefix + "[gn][0-9]+~").test(m.content)))
    prefix += "~";
  const token = new RegExp(prefix + "([gn])([1-9][0-9]*)~", "g");
  const messages = source.map((m) => {
    let text = m.content;
    if (m.role === "user") {
      // UUID fields in the advertised schema must accept the transport notation.
      const packet = JSON.parse(text);
      for (const schema of [packet.responseSchema, packet.querySchema]) {
        if (schema) adaptSchema(schema, prefix);
      }
      text = JSON.stringify(packet);
    }
    const content = text.replace(
      /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi,
      (id) => {
        let alias = ids.get(id);
        if (!alias) {
          alias = prefix + "g" + (ids.size + 1) + "~";
          ids.set(id, alias);
          reverse.set(alias, id);
        }
        return alias;
      },
    );
    return {
      role: m.role,
      content:
        m.role === "system"
          ? content +
            `\n既存IDは入力の ${prefix}g番号~ を使い、新規IDはcreationsまたはchanges.nodes/edgesのidに ${prefix}n番号~ を定義して同一応答内で参照します。`
          : content,
    };
  });
  function expand(content: string) {
    const value = parseOutput(content) as {
      changes?: { nodes?: { id: string }[]; edges?: { id: string }[] };
      creations?: { id: string }[];
    };
    const fresh = new Set(
      [value?.creations, value?.changes?.nodes, value?.changes?.edges].flatMap(
        (rows) => (Array.isArray(rows) ? rows.map((row) => row?.id) : []),
      ),
    );
    let invalid: string | undefined;
    const expanded = JSON.stringify(value).replace(token, (key, kind) => {
      const known = reverse.get(key);
      if (known) return known;
      if (kind === "n" && fresh.has(key)) {
        const hex = createHash("sha256")
          .update(callId + "|" + key)
          .digest("hex");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      }
      invalid = key;
      return key;
    });
    return invalid ? JSON.stringify({ invalidShortId: invalid }) : expanded;
  }
  return { messages, expand };
}

function adaptSchema(value: Record<string, unknown>, prefix: string) {
  if (value.format === "uuid") {
    delete value.format;
    value.pattern = "^" + prefix + "[gn][1-9][0-9]*~$";
  }
  for (const child of Object.values(value))
    if (child && typeof child === "object")
      adaptSchema(child as Record<string, unknown>, prefix);
}
