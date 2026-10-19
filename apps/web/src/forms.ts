import { useState } from "react";
import { z } from "zod";

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
    amount: z.string().min(1, "進める時間を入力してください"),
    unit: z.enum(["seconds", "minutes", "hours"]),
  })
  .transform((value, context) => {
    const raw =
        Number(value.amount) *
        { seconds: 1000, minutes: 60000, hours: 3600000 }[value.unit],
      duration = Math.round(raw);
    if (
      !Number.isSafeInteger(duration) ||
      duration <= 0 ||
      Math.abs(raw - duration) > 0.000001
    ) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "正の時間をミリ秒単位で入力してください",
      });
      return z.NEVER;
    }
    return { duration };
  });
