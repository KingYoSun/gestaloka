import type { readBelongings } from "../world/belongings.js";
import type { ChatMessage } from "./client.js";
import type { PreparedPrompt } from "./prompt.js";

type Belongings = Awaited<ReturnType<typeof readBelongings>>;
type Item = Belongings["items"][number];
type Skill = Belongings["skills"][number];
type DiceInput = {
  premise: string;
  actor: string;
  nodes: { node: { id: string }; belongings?: Belongings }[];
  consumable?: { id: string; label: string; count?: number }[];
};

export function prepareDicePrompt(
  messages: ChatMessage[],
  cacheSkills: boolean,
): PreparedPrompt | undefined {
  const input = messages.find((message) => message.role === "user");
  if (!input) return;
  const { premise, actor, nodes, consumable, ...action } = JSON.parse(
    input.content,
  ) as DiceInput;
  if (!Array.isArray(nodes)) return;

  const held = nodes.find(({ node }) => node.id === actor)?.belongings;
  const actorSkills = held?.skills ?? [];
  const prefix = JSON.stringify({ premise, actor, actorSkills });
  // 2 KiB was the lower bound for useful skill prefixes in the saved calls.
  const split =
    cacheSkills && actorSkills.length > 0 && Buffer.byteLength(prefix) >= 2048;
  const belongs = nodes.flatMap(({ belongings }) =>
    belongings ? [belongings] : [],
  );
  const counts = new Map<string, number>();
  for (const records of belongs)
    for (const { basis } of [
      ...records.items,
      ...records.storages.flatMap(({ items }) => items),
      ...(split && records === held ? [] : records.skills),
    ])
      if (basis && basis.length > 12)
        counts.set(basis, (counts.get(basis) ?? 0) + 1);
  const basisDictionary = [...counts].flatMap(([basis, count]) =>
    count > 1 ? [basis] : [],
  );
  const references = new Map(
    basisDictionary.map((basis, index) => [basis, index]),
  );
  const basisValue = (basis: string | null) =>
    basis === null ? null : (references.get(basis) ?? basis);
  const item = ({ id, label, owners, basis, since, count }: Item) => [
    id,
    label,
    owners,
    basisValue(basis),
    since,
    ...(count === undefined ? [] : [count]),
  ];
  const skill = ({ id, text, basis, since }: Skill) => [
    id,
    text,
    basisValue(basis),
    since,
  ];
  const packedNodes = nodes.map(({ belongings, ...facts }) =>
    belongings
      ? {
          ...facts,
          belongings: {
            items: belongings.items.map(item),
            storages: belongings.storages.map(({ id, label, items }) => [
              id,
              label,
              items.map(item),
            ]),
            ...(split && belongings === held
              ? {}
              : { skills: belongings.skills.map(skill) }),
          },
        }
      : facts,
  );
  const heldItems = new Map(held?.items.map((item) => [item.id, item]));
  const packedConsumable = consumable?.map((candidate) => {
    const held = heldItems.get(candidate.id);
    return held?.label === candidate.label && held.count === candidate.count
      ? candidate.id
      : candidate;
  });
  const current = JSON.stringify({
    ...(split ? {} : { premise, actor }),
    ...action,
    nodes: packedNodes,
    ...(packedConsumable ? { consumable: packedConsumable } : {}),
    ...(basisDictionary.length ? { basisDictionary } : {}),
  });
  const instructions =
    "itemsの列は[id,表示名,所有者,basis,成立時点,個数(任意)]、storagesは[id,表示名,物品行]、skillsは[id,説明,basis,成立時点]。basisが整数ならbasisDictionaryの0始まりの添字。文字列なら取得経緯の原文。consumableの文字列は申請者が保持する物品のIDを指す。物品行から表示名と個数を読む。" +
    (split
      ? "最初のJSONは世界設定・申請者・申請者の技能(actorSkills)。次のJSONは今回の申請と他の材料。両方を合わせて判定する。"
      : "");
  return {
    system: [
      {
        type: "text",
        text:
          messages
            .filter(({ role }) => role === "system")
            .map(({ content }) => content)
            .join("\n\n") +
          "\n" +
          instructions,
        ...(split ? {} : { cacheBoundary: true as const }),
      },
    ],
    messages: messages
      .filter(({ role }) => role !== "system")
      .map((message) =>
        message !== input
          ? message
          : {
              role: message.role,
              content: split
                ? [
                    { type: "text", text: prefix, cacheBoundary: true },
                    { type: "text", text: "\n" + current },
                  ]
                : current,
            },
      ),
    format: undefined,
  };
}
