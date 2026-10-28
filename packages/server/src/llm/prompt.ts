import type { ChatMessage } from "./client.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = { [key: string]: Json };
// The original bytes remain in sourceMessages; only the provider input uses references.
export function compact(
  value: Json,
  indices = new Map<string, string>(),
  used = new Set<string>(),
): Json {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  const record = (v: Json): v is Schema =>
    !!v &&
    !Array.isArray(v) &&
    typeof v === "object" &&
    "id" in v &&
    "kind" in v &&
    ("source" in v ||
      ["existence", "script", "event"].includes(String(v.kind)));
  const visit = (v: Json) => {
    const key = JSON.stringify(v);
    if (record(v)) {
      if (seen.has(key) || indices.has(key)) return;
      seen.add(key);
    }
    if (typeof v === "string" && key.length >= 80)
      counts.set(key, (counts.get(key) ?? 0) + 1);
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(value);
  const values: Record<string, Json> = {};
  let referenced = false;
  const children = (v: Json): Json =>
    Array.isArray(v)
      ? v.map(encode)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]))
        : v;
  const encode = (v: Json): Json => {
    const key = JSON.stringify(v);
    if (!record(v) && !indices.has(key) && (counts.get(key) ?? 0) < 2)
      return children(v);
    referenced = true;
    let index = indices.get(key);
    if (index === undefined) {
      const id = record(v) ? String(v.id) : undefined;
      index = id
        ? used.has(id)
          ? `${id}@${indices.size}`
          : id
        : `text:${indices.size}`;
      if (id) used.add(id);
      indices.set(key, index);
      values[index] = null;
      values[index] = children(v);
    }
    return { $ref: index };
  };
  const context = children(value);
  const packed = { values, context };
  return referenced ? packed : value;
}

// Bind identity keys already required by the caller; Zod retains the other checks.
export function outputSchema(
  schema: Record<string, unknown>,
  keys?: string[],
): Schema {
  const convert = (s: Schema): Schema => {
    if (
      keys &&
      s.type === "object" &&
      s.additionalProperties &&
      typeof s.additionalProperties === "object" &&
      (s.propertyNames as Schema | undefined)?.format === "uuid"
    )
      return {
        type: "object",
        properties: Object.fromEntries(
          keys.map((id) => [id, convert(s.additionalProperties as Schema)]),
        ),
        required: keys,
        additionalProperties: false,
      };
    const converted = Object.fromEntries(
      Object.entries(s).flatMap<[string, Json]>(([key, value]) => {
        if (
          [
            "$schema",
            "minimum",
            "maximum",
            "exclusiveMinimum",
            "exclusiveMaximum",
            "multipleOf",
            "minLength",
            "maxLength",
            "maxItems",
            "propertyNames",
          ].includes(key)
        )
          return [];
        if (key === "pattern" && s.format === "uuid") return [];
        if (key === "minItems" && Number(value) > 1) return [[key, 1]];
        if (["properties", "$defs", "definitions"].includes(key))
          return [
            [
              key,
              Object.fromEntries(
                Object.entries(value as Schema).map(([k, v]) => [
                  k,
                  convert(v as Schema),
                ]),
              ),
            ],
          ];
        if (Array.isArray(value))
          return [
            [
              key === "oneOf" ? "anyOf" : key,
              value.map((v) =>
                v && typeof v === "object" ? convert(v as Schema) : v,
              ),
            ],
          ];
        return [
          [
            key,
            value && typeof value === "object"
              ? convert(value as Schema)
              : value,
          ],
        ];
      }),
    );
    if (converted.properties) {
      const properties = converted.properties as Schema;
      if (
        "aspect" in properties &&
        "origin" in properties &&
        "evidence" in properties
      ) {
        delete properties.evidence;
        converted.required = ((converted.required as string[]) ?? []).filter(
          (key) => key !== "evidence",
        );
      }
      const metadata = Object.keys(converted.properties).filter(
        (key) => key === "information" || key === "synopsisInformation",
      );
      if (metadata.length)
        converted.required = [
          ...new Set([
            ...((converted.required as string[]) ?? []),
            ...metadata,
          ]),
        ];
    }
    return converted;
  };
  return convert(schema as Schema);
}

export function parseOutput(content: string): unknown {
  return JSON.parse(
    content.trim().replace(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/, "$1"),
  );
}

export function anthropicPrompt(
  messages: ChatMessage[],
  structured = true,
  cacheOnly = false,
) {
  const parsed = messages.map((m) => {
    try {
      return m.role === "user" ? (JSON.parse(m.content) as Schema) : undefined;
    } catch {
      return undefined;
    }
  });
  const schema = parsed.find((v) => v?.responseSchema)?.responseSchema as
    Schema | undefined;
  if (!schema && !cacheOnly) return undefined;
  const request = parsed.find((v) => v?.request)?.request as Schema | undefined;
  const keys = Array.isArray(request?.intentions)
    ? request.intentions.map((v) => String((v as Schema).actorId))
    : undefined;
  const cache = { type: "ephemeral" as const };
  const table = new Map<string, string>();
  const used = new Set<string>();
  const graphInput = parsed.some((v) => v?.initialContext !== undefined);
  const prepared = messages.flatMap<{
    role: ChatMessage["role"];
    content:
      | string
      | {
          type: "text";
          text: string;
          cache_control?: { type: "ephemeral" };
        }[];
  }>((m, i) => {
    if (m.role === "system") return [];
    const input = parsed[i];
    if (!input || Array.isArray(input) || typeof input !== "object") return [m];
    const {
      background,
      sceneHistory,
      observerId,
      interpretations,
      observations,
      initialContext,
      controlledActorIds,
      ...current
    } = input;
    delete current.responseSchema;
    const parts: Json[] = [];
    if (initialContext !== undefined)
      parts.push({
        initialContext,
        ...(controlledActorIds === undefined ? {} : { controlledActorIds }),
      });
    else if (controlledActorIds !== undefined)
      current.controlledActorIds = controlledActorIds;
    if (background !== undefined) parts.push({ background });
    if (observerId !== undefined)
      parts.push({
        observerId,
        ...(interpretations === undefined ? {} : { interpretations }),
      });
    for (const [key, history] of [
      ["sceneHistory", sceneHistory],
      ["observations", observations],
    ] as const)
      if (Array.isArray(history)) {
        if (!history.length) parts.push({ [key]: [] });
        for (const event of history) parts.push({ [key]: [event] });
      }
    const stable = parts.length;
    if (interpretations !== undefined && observerId === undefined)
      current.interpretations = interpretations;
    if (Object.keys(current).length) parts.push(current);
    const definitions: { value: Schema; stable: boolean }[] = [];
    const fields = new Map<string, { value: Json; stable: boolean }>();
    let framed = false;
    for (const [index, part] of parts.entries()) {
      const packed = graphInput
        ? (compact(part, table, used) as Schema)
        : (part as Schema);
      let context = packed;
      if ("values" in packed && "context" in packed) {
        framed = true;
        context = packed.context as Schema;
        if (Object.keys(packed.values as Schema).length)
          definitions.push({
            value: packed.values as Schema,
            stable: index < stable,
          });
      }
      for (const [key, value] of Object.entries(context)) {
        const previous = fields.get(key);
        fields.set(key, {
          value:
            previous && Array.isArray(previous.value) && Array.isArray(value)
              ? [...previous.value, ...value]
              : value,
          stable: index < stable,
        });
      }
    }
    const content: {
      type: "text";
      text: string;
      cache_control?: typeof cache;
    }[] = [];
    const append = (text: string) => content.push({ type: "text", text });
    const mark = () => {
      if (content.length) content[content.length - 1]!.cache_control = cache;
    };
    if (framed) {
      append('{"records":{');
      const lastStable = definitions.map((d) => d.stable).lastIndexOf(true);
      definitions.forEach((definition, index) => {
        append(
          (index ? "," : "") + JSON.stringify(definition.value).slice(1, -1),
        );
        if (index === lastStable) mark();
      });
      append("},");
    } else append("{");
    const entries = [...fields.entries()],
      lastStable = entries.map(([, field]) => field.stable).lastIndexOf(true);
    entries.forEach(([key, field], index) => {
      const prefix = (index ? "," : "") + JSON.stringify(key) + ":";
      const value = field.value;
      if (
        ["sceneHistory", "observations"].includes(key) &&
        Array.isArray(value)
      ) {
        append(prefix + "[");
        value.forEach((event, item) =>
          append((item ? "," : "") + JSON.stringify(event)),
        );
        if (field.stable && (index === 0 || index === lastStable)) mark();
        append("]");
      } else {
        append(prefix + JSON.stringify(value));
        if (field.stable && (index === 0 || index === lastStable)) mark();
      }
    });
    append("}");
    return [{ role: m.role, content }];
  });
  const system =
    messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n") +
    (table.size
      ? '\nrecordsは同じ要求内で追記するノード・関係・文章の共有表です。{"$ref":キー}はrecordsの同じキーへ展開して読みます。'
      : "");

  return {
    system: [
      {
        type: "text" as const,
        text:
          system +
          (!structured && schema
            ? "\nresponseSchema=" + JSON.stringify(outputSchema(schema, keys))
            : ""),
        cache_control: cache,
      },
    ],
    messages: prepared,
    format:
      structured && schema
        ? { type: "json_schema", schema: outputSchema(schema, keys) }
        : undefined,
  };
}

export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}
