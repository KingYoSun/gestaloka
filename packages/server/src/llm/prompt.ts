import type { ChatMessage } from "./client.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = { [key: string]: Json };

// The original bytes remain in sourceMessages; only the provider input uses references.
export function compact(value: Json): Json {
  const counts = new Map<string, number>();
  const visit = (v: Json) => {
    const key = JSON.stringify(v);
    if (key.length >= 80) counts.set(key, (counts.get(key) ?? 0) + 1);
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(value);
  const values: Json[] = [],
    indices = new Map<string, number>();
  const children = (v: Json): Json =>
    Array.isArray(v)
      ? v.map(encode)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]))
        : v;
  const encode = (v: Json): Json => {
    const key = JSON.stringify(v);
    if ((counts.get(key) ?? 0) < 2) return children(v);
    let index = indices.get(key);
    if (index === undefined) {
      index = values.length;
      indices.set(key, index);
      values.push(null);
      values[index] = children(v);
    }
    return { $value: index };
  };
  const context = encode(value);
  const packed = { values, context };
  return values.length &&
    JSON.stringify(packed).length < JSON.stringify(value).length
    ? packed
    : value;
}

// Dictionaries are arrays on the wire. All other constraints still run in Zod.
export function outputSchema(schema: Record<string, unknown>): Schema {
  const convert = (s: Schema): Schema => {
    if (
      s.type === "object" &&
      s.additionalProperties &&
      typeof s.additionalProperties === "object"
    )
      return {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            value: convert(s.additionalProperties as Schema),
          },
          required: ["key", "value"],
          additionalProperties: false,
        },
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
    return converted;
  };
  return convert(schema as Schema);
}

export function parseOutput(
  content: string,
  schema?: Record<string, unknown>,
): unknown {
  const value: Json = JSON.parse(
    content.trim().replace(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/, "$1"),
  );
  const decode = (s: Schema, v: Json): Json => {
    const variants = s.oneOf ?? s.anyOf;
    if (
      Array.isArray(variants) &&
      v &&
      !Array.isArray(v) &&
      typeof v === "object"
    ) {
      const variant = variants.find((x) => {
        const properties = (x as Schema).properties as Schema | undefined;
        return (
          properties &&
          Object.entries(properties).some(
            ([k, p]) =>
              Object.hasOwn(p as Schema, "const") &&
              (p as Schema).const === v[k],
          )
        );
      });
      if (variant) return decode(variant as Schema, v);
    }
    if (
      s.type === "object" &&
      s.additionalProperties &&
      typeof s.additionalProperties === "object" &&
      Array.isArray(v)
    ) {
      const result: Record<string, Json> = {};
      for (const item of v) {
        if (
          !item ||
          Array.isArray(item) ||
          typeof item !== "object" ||
          typeof item.key !== "string" ||
          !("value" in item) ||
          Object.hasOwn(result, item.key)
        )
          throw new Error("辞書のキーが不正または重複しています");
        Object.defineProperty(result, item.key, {
          value: decode(s.additionalProperties as Schema, item.value!),
          enumerable: true,
        });
      }
      return result;
    }
    if (Array.isArray(v) && s.items)
      return v.map((x) => decode(s.items as Schema, x));
    if (v && !Array.isArray(v) && typeof v === "object" && s.properties) {
      const properties = s.properties as Schema;
      return Object.fromEntries(
        Object.entries(v).map(([key, x]) => [
          key,
          properties[key] ? decode(properties[key] as Schema, x) : x,
        ]),
      );
    }
    return v;
  };
  return schema ? decode(schema as Schema, value) : value;
}

export function anthropicPrompt(messages: ChatMessage[], structured = true) {
  const parsed = messages.map((m) => {
    try {
      return m.role === "user" ? (JSON.parse(m.content) as Schema) : undefined;
    } catch {
      return undefined;
    }
  });
  const schema = parsed.find((v) => v?.responseSchema)?.responseSchema as
    Schema | undefined;
  if (!schema) return undefined;
  const cache = { type: "ephemeral" as const };
  const system =
    messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n") +
    '\n入力のvalues/contextは情報を省略しない共通表です。{"$value":n}は同じブロックのvalues[n]そのものを参照し、入れ子の参照も展開して読みます。複数のsceneHistory・observationsブロックは記載順の全履歴です。応答は指定の構造化スキーマに従い、辞書が配列で指定されている場合はkey/valueで返してください。';
  return {
    schema: structured ? schema : undefined,
    system: [
      {
        type: "text" as const,
        text:
          system +
          (structured ? "" : "\nresponseSchema=" + JSON.stringify(schema)),
        cache_control: cache,
      },
    ],
    messages: messages.flatMap<{
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
      if (!input || Array.isArray(input) || typeof input !== "object")
        return [m];
      const {
        background,
        sceneHistory,
        observerId,
        interpretations,
        observations,
        ...current
      } = input;
      delete current.responseSchema;
      const parts: Json[] = [];
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
      let stable = parts.length;
      if (interpretations !== undefined && observerId === undefined)
        current.interpretations = interpretations;
      if (Object.keys(current).length) parts.push(current);
      if (input.initialContext !== undefined) stable = parts.length;
      return [
        {
          role: m.role,
          content: parts.map((p, index) => ({
            type: "text" as const,
            text: JSON.stringify(compact(p)),
            ...(index === stable - 1 ||
            (background !== undefined && index === 0)
              ? { cache_control: cache }
              : {}),
          })),
        },
      ];
    }),
    format: structured
      ? { type: "json_schema", schema: outputSchema(schema) }
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
