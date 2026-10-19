import { useState } from "react";
import { z } from "zod";
import { ConstructionDuration, WORLD_DAY_MS } from "@gestaloka/contracts";

export function usePending<T>(key: string, schema: z.ZodType<T>) {
  const [value, setValue] = useState<T | null>(() => {
    try {
      return schema.parse(JSON.parse(localStorage.getItem(key) ?? "null"));
    } catch {
      return null;
    }
  });
  const save = (next: T | null) => {
    if (next === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(next));
    setValue(next);
  };
  return [value, save] as const;
}
export const DurationForm = z
  .object({
    amount: z.string().min(1, "進める日数を入力してください"),
  })
  .transform((value, context) => {
    const duration = Number(value.amount) * WORLD_DAY_MS;
    if (!ConstructionDuration.safeParse(duration).success) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "1日以上の整数で入力してください",
      });
      return z.NEVER;
    }
    return { duration };
  });
