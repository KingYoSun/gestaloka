// Share complete graph objects, never just IDs: the same identity can have different history or observation data.
export function graphContext(input: Record<string, unknown>): string {
  const graphObjects: unknown[] = [];
  const indices = new Map<string, number>();
  const payload = JSON.stringify(input, (_key, value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const object = value as Record<string, unknown>;
    if (
      typeof object.id !== "string" ||
      typeof object.kind !== "string" ||
      !("text" in object || ("source" in object && "target" in object))
    )
      return value;
    const key = JSON.stringify(value, (_name, item: unknown) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
          )
        : item,
    );
    let index = indices.get(key);
    if (index === undefined) {
      index = graphObjects.length;
      indices.set(key, index);
      graphObjects.push(value);
    }
    return { graphRef: index };
  });
  return JSON.stringify({ graphObjects, ...JSON.parse(payload) });
}
