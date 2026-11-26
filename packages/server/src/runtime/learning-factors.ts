import { z } from "zod";

const Material = z.object({
  node: z.object({ id: z.string(), kind: z.string(), text: z.string() }),
  experiencedBy: z.string().optional(),
  belongings: z
    .object({
      skills: z.array(
        z.object({
          id: z.string(),
          text: z.string(),
          name: z.string().nullish(),
        }),
      ),
    })
    .optional(),
});

const Factor = z.object({
  ref: z.string(),
  impact: z.enum(["helped", "hindered"]),
});
export type LearningFactor = {
  label: string;
  impact: z.infer<typeof Factor>["impact"];
};

export function learningReferences(
  actor: string,
  materials: unknown[],
  attempts: { action: string; success: boolean }[],
) {
  const references = new Map<string, string>();
  for (const material of materials) {
    const { data } = Material.safeParse(material);
    if (!data) continue;
    const { node, belongings, experiencedBy } = data;
    if (node.id === actor)
      for (const skill of belongings?.skills ?? [])
        references.set(
          `skill:${skill.id}`,
          `技能「${skill.name || skill.text}」`,
        );
    // 本人が行ったと確定した出来事にだけ、経験者の印が付く。
    if (experiencedBy === actor && node.kind === "event")
      references.set(`experience:${node.id}`, `経験「${node.text}」`);
  }
  for (const [index, { action, success }] of attempts.entries())
    references.set(
      `attempt:${index + 1}`,
      `過去の試行（${success ? "成功" : "失敗"}）「${action}」`,
    );
  return references;
}

export function resolveLearningFactors(
  references: ReadonlyMap<string, string>,
  value: unknown,
): LearningFactor[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  return value.flatMap((entry) => {
    const { data } = Factor.safeParse(entry);
    if (!data || used.has(data.ref)) return [];
    const label = references.get(data.ref);
    if (!label) return [];
    used.add(data.ref);
    return [{ label, impact: data.impact }];
  });
}

export const learningFactorsPrompt =
  "申請者本人のlearningにダイス設定を返す場合、判断に実際に使った主な根拠をlearningReferencesから選び、learningFactors:[{ref,impact}]で返す。impactは有利ならhelped、不利ならhindered。skill:は本人の技能ID、experience:は本人の確定済みの経験のnode.id、attempt:は本人のrecentAttemptsの先頭を1とした番号。該当する根拠がなければ省いてよい。理由文やほかの参照は書かない。";
