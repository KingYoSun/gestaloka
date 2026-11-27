import { z } from "zod";
import { WorldNode } from "@gestaloka/contracts";
import { visibleTo } from "../world/belongings.js";
import { derivedId } from "../world/model.js";

const Material = z.object({
  node: z
    .object({ id: z.string(), kind: z.string(), text: z.string() })
    .passthrough(),
  experiencedBy: z.string().optional(),
  states: z.array(z.object({ node: z.unknown() })).optional(),
  belongings: z
    .object({
      items: z
        .array(
          z.object({
            id: z.string(),
            label: z.string(),
            ground: z.boolean().optional(),
          }),
        )
        .optional(),
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
  fumble?: true;
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
  readable?: { places: readonly string[]; subjects: readonly string[] },
) {
  const references = new Map<string, LearningReference>([
    ["action", { label: "申請した行為の内容" }],
  ]);
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
    if (!readable) continue;
    if (node.id === actor)
      for (const item of belongings?.items ?? [])
        if (!item.ground)
          references.set(`item:${item.id}`, {
            label: `所持品「${item.label}」`,
          });
    const place = readable.places.includes(node.id);
    if (node.id !== actor && !place && !readable.subjects.includes(node.id))
      continue;
    const subject = WorldNode.safeParse(node).data;
    if (node.id !== actor && (!subject || !visibleTo(subject, actor, true)))
      continue;
    if (place)
      references.set(`place:${node.id}`, { label: `場所「${node.text}」` });
    for (const { node: value } of data.states ?? []) {
      const state = WorldNode.safeParse(value).data;
      if (
        state?.kind === "script" &&
        !state.spawn &&
        (node.id === actor || visibleTo(state, actor, true))
      )
        references.set(`state:${state.id}`, { label: `状態「${state.text}」` });
    }
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
  fumbleValue?: unknown,
): LearningFactor[] {
  return [
    ...selectedFactors(references, value),
    ...selectedFactors(references, fumbleValue).map((factor) => ({
      ...factor,
      fumble: true as const,
    })),
  ];
}

function selectedFactors(
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
  "learningReferencesが示されたダイス判定では、実際に判断に使った主な根拠をその一覧から選び、learningFactors:[{ref,impact}]で返す。impactは有利ならhelped、不利ならhindered。ファンブルの範囲を設定する場合、その範囲の根拠は同じ形式でfumbleFactorsに分ける。fumbleFactorsのhelpedは本人がファンブルを免れる側に有利。actionは申請した行為そのもの、skill:は技能ID、experience:は確定済みの経験のnode.id、attempt:は本人のrecentAttemptsの先頭を1とした番号、item:は所持品ID、place:は場所ID、state:は状態のnode.id（終了対象はrelationId）。案別の一覧があれば、その案の一覧だけから選ぶ。該当する根拠がなければ省いてよい。理由文やほかの参照は書かない。";

export function factorMessages(
  text: string,
  factors: LearningFactor[] = [],
  fumble = false,
) {
  const label =
    (text ? `「${text}」の` : "") + (fumble ? "ファンブル判定" : "判定");
  const messages = factors
    .filter((factor) => !!factor.fumble === fumble)
    .map(
      ({ label: source, impact }) =>
        `${label}で、${source}が${impact === "helped" ? "有利" : "不利"}に働きました`,
    );
  return messages.length ? messages : [`${label}：GMの根拠記録なし`];
}
