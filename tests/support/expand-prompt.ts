export function expandPrompt(
  value: unknown,
  records: Record<string, unknown>,
): unknown {
  if (Array.isArray(value))
    return value.map((item) => expandPrompt(item, records));
  if (value && typeof value === "object") {
    if ("$ref" in value) {
      const key = String(value.$ref);
      if (!(key in records)) throw new Error(`参照先がありません: ${key}`);
      return expandPrompt(records[key], records);
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        expandPrompt(item, records),
      ]),
    );
  }
  return value;
}
