import { z } from "zod";
import { derivedId } from "../world/model.js";

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

export type LearningAttempt = {
  action: string;
  success: boolean;
  commitId?: string | undefined;
  proposalIndex?: number | undefined;
};

type LearningReference = {
  label: string;
  experienceRefs?: string[];
};

export function learningReferences(
  actor: string,
  materials: unknown[],
  attempts: LearningAttempt[],
) {
  const references = new Map<string, LearningReference>();
  for (const material of materials) {
    const { data } = Material.safeParse(material);
    if (!data) continue;
    const { node, belongings, experiencedBy } = data;
    if (node.id === actor)
      for (const skill of belongings?.skills ?? [])
        references.set(`skill:${skill.id}`, {
          label: `技能「${skill.name || skill.text}」`,
        });
    // 本人が行ったと確定した出来事にだけ、経験者の印が付く。
    if (experiencedBy === actor && node.kind === "event")
      references.set(`experience:${node.id}`, {
        label: `経験「${node.text}」`,
      });
  }
  for (const [
    index,
    { action, success, commitId, proposalIndex },
  ] of attempts.entries()) {
    const experienceRefs =
      success && commitId
        ? (proposalIndex === undefined
            ? [`${commitId}:experience`, `${commitId}:action`]
            : [`${commitId}:proposal:${proposalIndex}:experience`]
          ).map((key) => `experience:${derivedId(key)}`)
        : undefined;
    references.set(`attempt:${index + 1}`, {
      label: `過去の試行（${success ? "成功" : "失敗"}）「${action}」`,
      ...(experienceRefs ? { experienceRefs } : {}),
    });
  }
  return references;
}

export function resolveLearningFactors(
  references: ReadonlyMap<string, LearningReference>,
  value: unknown,
): LearningFactor[] {
  if (!Array.isArray(value)) return [];
  const selected = new Map<string, z.infer<typeof Factor>["impact"]>();
  for (const entry of value) {
    const { data } = Factor.safeParse(entry);
    if (data && references.has(data.ref) && !selected.has(data.ref))
      selected.set(data.ref, data.impact);
  }
  return [...selected].flatMap(([ref, impact]) => {
    const { label, experienceRefs } = references.get(ref)!;
    return experienceRefs?.some((experience) => selected.has(experience))
      ? []
      : [{ label, impact }];
  });
}

export const learningFactorsPrompt =
  "申請者本人のlearningにダイス設定を返す場合、判断に実際に使った主な根拠をlearningReferencesから選び、learningFactors:[{ref,impact}]で返す。impactは有利ならhelped、不利ならhindered。skill:は本人の技能ID、experience:は本人の確定済みの経験のnode.id、attempt:は本人のrecentAttemptsの先頭を1とした番号。該当する根拠がなければ省いてよい。理由文やほかの参照は書かない。";
