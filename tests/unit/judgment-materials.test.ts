import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import { measureDiceMaterials } from "../../packages/server/src/llm/dice-prompt.js";
import {
  judgmentPriority,
  selectJudgmentMaterials,
} from "../../packages/server/src/runtime/judgment-materials.js";
import { stripJudgmentPreview } from "../../packages/server/src/runtime/judgment-records.js";

const bytes = (data: unknown) => Buffer.byteLength(JSON.stringify(data));
const material = (
  id: string,
  skills: { id: string; text: string; name?: string; basis?: string }[],
  extra: { states?: unknown[]; items?: unknown[] } = {},
) => ({
  node: { id, kind: "existence", text: `${id}のプロフィール` },
  states: extra.states ?? [],
  omittedStates: 0,
  belongings: { skills, items: extra.items ?? [], storages: [] },
});

test("判定点・関係・確定事実・情報の区別を同じ0〜10点にまとめる", () => {
  expect(judgmentPriority(0, 0, 0)).toBe(0);
  expect(judgmentPriority(10, 3, 2.5)).toBe(10);
  expect(judgmentPriority(5.4, 0.7, 1.6, 0.8)).toBe(3.8);
});

test("少量の材料は選別せず、そのままGMへ渡す", async () => {
  const materials = [
    material("actor", [
      { id: "skill", text: "紙を折る。", basis: "教わった手順を覚えた。" },
    ]),
  ];
  const decide = vi.fn();
  expect(
    await selectJudgmentMaterials({
      materials,
      requiredIds: new Set(),
      requests: [{ text: "花を渡す" }],
      decide,
    }),
  ).toEqual([materials]);
  expect(decide).not.toHaveBeenCalled();
});

test("本人と現在地の状態が資料枠を超えても、申請に関わる状態だけを主判定へ渡す", async () => {
  const practiced = {
    node: { id: "practice", text: "版画の色合わせを学んだ" },
  };
  const prepared = { node: { id: "prepared", text: "版画の試し刷りを終えた" } };
  const noise = Array.from({ length: 32 }, (_, i) => ({
    node: { id: `other-${i}`, text: "昨日の天気の記録。".repeat(30) },
  }));
  const materials = [
    material("actor", [], { states: [...noise, practiced] }),
    material("studio", [], { states: [...noise, prepared] }),
  ];
  expect(bytes(materials)).toBeGreaterThan(24 * 1024);
  const decide = vi.fn(async (value: unknown) => {
    const { candidates } = value as {
      candidates: { key: string; evidence: typeof practiced }[];
    };
    return Object.fromEntries(
      candidates.flatMap(({ key, evidence }) => {
        const score = evidence.node.id === practiced.node.id ? 0.9 : 0.1;
        return [
          [`r0${key}a`, score],
          [`r0${key}e`, score],
        ];
      }),
    );
  });
  const [packet] = await selectJudgmentMaterials({
    materials,
    requiredIds: new Set(["actor", "studio"]),
    requests: [
      {
        text: "この作業を身につける",
        effect: { nodes: [{ text: "版画の色を合わせて刷る" }] },
        subjects: ["actor"],
      },
    ],
    decide,
  });
  expect(packet).toEqual([
    { ...materials[0], states: [practiced], omittedStates: noise.length },
    { ...materials[1], states: [prepared], omittedStates: noise.length },
  ]);
  expect(decide.mock.calls.length).toBeLessThanOrEqual(2);
});

test.each([
  {
    name: "名前を出さずに指した樹脂の効能",
    request:
      "仕上げ油と昨日拾ったものを使い、水に沈めてもほどけない留め具を作る。",
    change: "水中用の留め具を作る。",
    label: "樹脂の小瓶",
    basis: "昨日の採取。この樹脂は水中でも硬化する。",
    basisScore: [0.79, 0.66] as const,
    itemScore: [0.46, 0.6] as const,
  },
  {
    name: "別の品の取得経緯にある在庫切れの反証",
    request: "粉と甘露で焼き菓子を作る。",
    change: "甘露を加えて生地を整える。",
    label: "空の盆",
    basis: "保管棚の掃除をした。甘露は昨日使い切り、在庫はない。",
    basisScore: [0.16, 0.86] as const,
    itemScore: [0.17, 0.51] as const,
  },
])(
  "索引候補が多くても関連する経緯を評価し、無関係な状態を補わない $name",
  async ({ request, change, label, basis, basisScore, itemScore }) => {
    const item = { id: "evidence-item", label, basis };
    const shelves = Array.from({ length: 105 }, (_, i) => ({
      node: {
        id: `shelf-${i}`,
        text: `棚札${i}。` + "北側の棚板の幅を測り、台帳に書いた。".repeat(5),
      },
    }));
    const materials = [
      material("actor", [], { items: [item] }),
      material("workshop", [], { states: shelves }),
    ];
    const ranks = new Map(shelves.map(({ node }, i) => [node.id, 1 / (i + 1)]));
    ranks.set(item.id, 1 / (shelves.length + 1));
    let basisAsked = false;
    const decide = vi.fn(
      async (value: unknown, questions: Record<string, unknown>) => {
        const { candidates } = value as {
          candidates: { key: string; kind: string; evidence: unknown }[];
        };
        const scores: Record<string, number> = {};
        for (const row of candidates) {
          const applicable = `r0${row.key}a`;
          const effect = `r0${row.key}e`;
          if (!(applicable in questions) || !(effect in questions)) continue;
          const relevant = row.kind === "basis" && row.evidence === basis;
          basisAsked ||= relevant;
          const [a, e] = relevant
            ? basisScore
            : row.kind === "item"
              ? itemScore
              : ([0.12, 0.26] as const);
          scores[applicable] = a;
          scores[effect] = e;
        }
        return scores;
      },
    );
    expect(bytes(materials)).toBeGreaterThan(24 * 1024);

    const [selected] = await selectJudgmentMaterials({
      materials,
      ranks,
      requiredIds: new Set(["actor", "workshop"]),
      requests: [
        {
          text: request,
          effect: { nodes: [{ text: change }] },
          subjects: ["actor"],
        },
      ],
      decide,
      threshold: 0.55,
    });

    expect(decide.mock.calls.length).toBeLessThanOrEqual(2);
    expect(basisAsked).toBe(true);
    expect(selected).toMatchObject([
      { node: { id: "actor" }, belongings: { items: [item] } },
      { node: { id: "workshop" }, states: [] },
    ]);
    expect(bytes(selected)).toBeLessThan(24 * 1024);
  },
);

test("型付きの生成対象が一字でも、Jevの低評価でその現況を落とさない", async () => {
  const hen = { id: "hen", label: "庭の鶏" };
  const egg = { node: { id: "egg-present", text: "敷物の上に卵がある。" } };
  const unrelated = { node: { id: "broom", text: "箒は戸棚に入っている。" } };
  const decide = vi.fn(async (_state, questions: Record<string, unknown>) =>
    Object.fromEntries(Object.keys(questions).map((key) => [key, 0.05])),
  );

  const [selected] = await selectJudgmentMaterials({
    materials: [
      material("actor", [], { items: [hen] }),
      material("yard", [], { states: [egg, unrelated] }),
    ],
    requiredIds: new Set(["actor", "yard"]),
    requests: [
      {
        text: "庭で鶏が残したものを一つ拾う。",
        effect: {
          nodes: [{ id: "created-item", kind: "existence", text: "卵" }],
        },
        subjects: ["actor"],
        requiredIds: new Set([hen.id]),
      },
    ],
    directLimit: 0,
    decide,
  });

  expect(JSON.stringify(decide.mock.calls)).toContain(egg.node.id);
  expect(selected).toMatchObject([
    { node: { id: "actor" }, belongings: { items: [hen] } },
    { node: { id: "yard" }, states: [egg], omittedStates: 1 },
  ]);
});

test("明示した対抗相手の状態はJevの低評価でも判定資料に残る", async () => {
  const carrying = {
    node: { id: "carrying", text: "片手に水桶を抱えている。" },
  };
  const unseen = {
    node: { id: "unseen", text: "袖の裏に補強板がある。", viewers: [] },
  };
  const unrelated = {
    node: { id: "not-opponent", text: "古い帽子を布で補修した。" },
  };
  const decide = vi.fn(async (_state, questions: Record<string, unknown>) =>
    Object.fromEntries(Object.keys(questions).map((key) => [key, 0.05])),
  );

  const [selected] = await selectJudgmentMaterials({
    materials: [
      material("actor", [], { states: [unrelated] }),
      material("opponent", [], { states: [carrying, unseen] }),
    ],
    requiredIds: new Set(["actor", "opponent"]),
    requests: [
      {
        text: "道具部屋へ進もうとする相手を戸口で止める。",
        effect: { targetId: "opponent", state: "戸口の外へ一歩退く。" },
        subjects: ["actor", "opponent"],
      },
    ],
    directLimit: 0,
    decide,
  });

  const reviewed = JSON.stringify(decide.mock.calls);
  expect(reviewed).toContain(carrying.node.id);
  expect(reviewed).toContain(unseen.node.id);
  expect(selected).toMatchObject([
    { node: { id: "actor" }, states: [], omittedStates: 1 },
    { node: { id: "opponent" }, states: [carrying, unseen] },
  ]);
});

test("参照した抜粋待ちの本文と経緯は残し、無関係な抜粋待ちの資料は除く", async () => {
  const text = {
    id: "pending-skill",
    text: "作成中の本文",
    judgmentTextPending: true,
  };
  const basis = {
    id: "pending-basis",
    text: "座って整える。",
    basis: "作成中の習得記録",
    judgmentBasisPending: true,
  };
  const ordinary = { id: "ordinary", text: "布を切る。" };
  const unrelated = {
    id: "unrelated",
    text: "魚の記録の抜粋を準備中。",
    judgmentTextPending: true,
  };
  const materials = [material("actor", [text, basis, ordinary, unrelated])];
  const questionsSent: string[] = [];
  const inputs: string[] = [];
  const [selected] = await selectJudgmentMaterials({
    materials,
    requiredIds: new Set(),
    requests: [
      {
        text: "揺れている板を支える",
        subjects: ["actor"],
        requiredIds: new Set([text.id, basis.id]),
      },
    ],
    directLimit: 0,
    decide: async (state, questions) => {
      questionsSent.push(...Object.keys(questions));
      inputs.push(JSON.stringify(state));
      return Object.fromEntries(Object.keys(questions).map((key) => [key, 0]));
    },
  });
  expect(questionsSent).toHaveLength(2);
  for (const input of inputs) {
    expect(input).not.toContain(text.text);
    expect(input).not.toContain(basis.basis);
    expect(input).not.toContain(unrelated.text);
  }
  expect(selected).toEqual([material("actor", [text, basis])]);
});

test("多数の技能から当事者ごとに選び、2回以内に相手の受動技能を判定に得る", async () => {
  const defense = {
    id: "old-defense",
    text: "熱を通さない皮膚。外からの火傷を防ぐ。",
    basis: "継続中の古い技能",
  };
  const materials = [
    material(
      "actor",
      Array.from({ length: 70 }, (_, i) => ({
        id: `ability-${i}`,
        text: `織物の模様を変える技能 ${i}` + "長い記録。".repeat(20),
      })),
    ),
    material("target", [defense]),
  ];
  const seen = new Set<string>();
  const decide = vi.fn(
    async (
      value: unknown,
      questions: Record<string, unknown>,
      batch: number,
    ) => {
      const state = value as {
        participants: { id: string }[];
        candidates: {
          key: string;
          evidence: { id: string };
          material?: { id: string };
        }[];
      };
      expect(bytes({ state, questions })).toBeLessThanOrEqual(30 * 1024);
      expect(state.participants.map(({ id }) => id)).toEqual([
        "actor",
        "target",
      ]);
      expect(state.candidates.every(({ key }) => !seen.has(key))).toBe(true);
      expect(batch).toBe(decide.mock.calls.length - 1);
      const score: Record<string, number> = {};
      for (const { key, evidence, material } of state.candidates) {
        seen.add(key);
        const p = (material?.id ?? evidence.id) === defense.id ? 0.99 : 0.05;
        score[`r0${key}a`] = p;
        score[`r0${key}e`] = p;
      }
      return score;
    },
  );
  expect(
    await selectJudgmentMaterials({
      materials,
      requiredIds: new Set(),
      requests: [{ text: "相手に炎を浴びせる", subjects: ["actor", "target"] }],
      decide,
      directLimit: 0,
    }),
  ).toMatchObject([[{ node: { id: "actor" } }, material("target", [defense])]]);
  expect(decide.mock.calls.length).toBeLessThanOrEqual(2);
});

test("明示した根拠とJevの重要資料を保護し、修正量だけに関わる候補は人物の資料を優先する", async () => {
  const named = {
    id: "named",
    name: "暗夜の指先",
    text: "細い隙間に指が届く。",
  };
  const legacy = { id: "old-skill", text: "遠見：離れた場所の形を見る。" };
  const identified = {
    id: "4465db6b-1fcd-448c-8849-e24e19cc16e9",
    text: "装飾を見つける。",
  };
  const short = {
    id: "f26a8042-667b-4418-b070-89327864c0dc",
    text: "板の厚さを測る。",
  };
  const shortId =
    "@" + createHash("sha256").update(short.id).digest("hex").slice(0, 8);
  const vital = {
    id: "critical",
    text: "この操作は熱がこもると成立しない。",
    basis: "以前の確定結果。",
  };
  const modifier = { id: "modifier", text: "手の震えが少なくなる。" };
  const optionalItem = {
    id: "optional-item",
    label: "補助台",
    basis: "入手の記録。".repeat(20),
  };
  const oldRestriction = {
    relationId: "command-restriction",
    node: { id: "restriction", text: "発声できない。" },
    commandRestrictions: ["say"],
  };
  const editable = {
    relationId: "edit-me",
    node: { id: "old-state", text: "机に向かっている。" },
  };
  const materials = [
    material("actor", [named, legacy, identified, short, vital, modifier], {
      states: [oldRestriction, editable],
      items: [optionalItem],
    }),
  ];
  const wanted = [
    material("actor", [named, legacy, identified, short, vital, modifier], {
      states: [oldRestriction, editable],
    }),
  ];
  const reviewed = new Set<string>();
  const decide = vi.fn(async (value: unknown) => {
    const state = value as {
      candidates: {
        key: string;
        evidence: { id: string };
        material?: { id: string };
      }[];
    };
    return Object.fromEntries(
      state.candidates.flatMap(({ key, evidence, material }) => {
        const id = material?.id ?? evidence.id;
        reviewed.add(material ? `basis:${id}` : id);
        return [
          [`r0${key}a`, 0.99],
          [`r0${key}e`, id === vital.id ? 0.99 : 0.2],
        ];
      }),
    );
  });
  expect(
    await selectJudgmentMaterials({
      materials,
      requiredIds: new Set(["edit-me"]),
      requests: [
        {
          text: `暗夜の指先と遠見を使う ${identified.id} ${shortId}`,
          subjects: ["actor"],
        },
      ],
      decide,
      directLimit: 0,
      budget: bytes(wanted),
    }),
  ).toEqual([wanted]);
  expect(reviewed).toEqual(
    new Set([
      "critical",
      "basis:critical",
      "modifier",
      "optional-item",
      "basis:optional-item",
    ]),
  );
});

test("明示した物品と技能は、長い取得経緯を個別に評価して本文を残す", async () => {
  const item = {
    id: "item",
    label: "机の板",
    basis: "入手の記録。".repeat(160),
  };
  const skill = {
    id: "skill",
    name: "手仕事",
    text: "紙を裁てる。",
    basis: "習得の記録。".repeat(160),
  };
  const original = [material("actor", [skill], { items: [item] })];
  const wanted = [
    {
      ...original[0]!,
      belongings: {
        ...original[0]!.belongings,
        skills: [{ ...skill, basis: null }],
        items: [{ ...item, basis: null }],
      },
    },
  ];
  const select = (decision: number, budget: number) =>
    selectJudgmentMaterials({
      materials: original,
      requiredIds: new Set(),
      requests: [{ text: "手仕事で机の板を加工する" }],
      decide: async (state, questions) => {
        expect(state).toMatchObject({
          candidates: [
            {
              kind: "basis",
              evidence: skill.basis,
              material: { id: skill.id, basis: null },
            },
            {
              kind: "basis",
              evidence: item.basis,
              material: { id: item.id, basis: null },
            },
          ],
        });
        return Object.fromEntries(
          Object.keys(questions).map((key) => [key, decision]),
        );
      },
      directLimit: 0,
      budget,
    });
  expect(await select(0.05, bytes(wanted))).toEqual([wanted]);
  expect(await select(0.99, bytes(wanted))).toEqual([undefined]);
  expect(await select(0.99, bytes(original))).toEqual([original]);
});

test("索引の順が逆でも、結果の種類に影響し得る技能を確率補正だけの技能より先に残す", async () => {
  const modifier = { id: "modifier", text: "命中の補助。" };
  const uncertain = { id: "uncertain", text: "隠れた反応。" };
  const wanted = [material("actor", [uncertain])];
  expect(
    await selectJudgmentMaterials({
      materials: [material("actor", [modifier, uncertain])],
      requiredIds: new Set(),
      requests: [{ text: "相手を止める", subjects: ["actor"] }],
      ranks: new Map([
        [modifier.id, 1],
        [uncertain.id, 0.01],
      ]),
      decide: async () => ({
        r0c1a: 0.99,
        r0c1e: 0.05,
        r0c2a: 0.8,
        r0c2e: 0.99,
      }),
      directLimit: 0,
      budget: bytes(wanted),
    }),
  ).toEqual([wanted]);
});

test("各案の必須資料を分け、必須資料が収まらない案から結果を作らない", async () => {
  const first = { id: "first", text: "小さな紙を折る。" };
  const second = { id: "second", text: "別の案にだけ必要。".repeat(50) };
  const materials = [material("actor", [first, second])];
  const wanted = [material("actor", [first])];
  expect(
    await selectJudgmentMaterials({
      materials,
      requiredIds: new Set(),
      requests: [
        { text: "折り紙", requiredIds: new Set([first.id]) },
        { text: "別案", requiredIds: new Set([second.id]) },
      ],
      decide: async (_state, questions) =>
        Object.fromEntries(Object.keys(questions).map((key) => [key, 0.05])),
      directLimit: 0,
      budget: bytes(wanted) + 2,
    }),
  ).toEqual([wanted, undefined]);
});

test("別の案が参照する大きな対象は、無関係な案の予算を圧迫しない", async () => {
  const actor = material("actor", []);
  const target = {
    node: { id: "target", kind: "existence", text: "長い設定。".repeat(130) },
    states: [
      {
        node: { id: "silence", text: "発声できない" },
        commandRestrictions: ["say"],
      },
    ],
  };
  const location = {
    node: { id: "location", text: "工作場" },
    judgmentLocation: true,
  };
  actor.states.push(location);
  const decide = vi.fn(async (_state, questions) =>
    Object.fromEntries(Object.keys(questions).map((key) => [key, 0.05])),
  );
  expect(
    await selectJudgmentMaterials({
      materials: [actor, target],
      requiredIds: new Set(),
      requests: [
        { text: "木の札を作る", subjects: ["actor"] },
        {
          text: "対象を調べる",
          subjects: ["actor"],
          requiredIds: new Set(["target"]),
        },
      ],
      decide,
      previewComplete: false,
      hydrate: async (packet) => packet,
      directLimit: 0,
      budget: bytes([actor]),
    }),
  ).toEqual([[actor], undefined]);
  expect(decide.mock.calls.length).toBeLessThanOrEqual(2);
});

test("現在地は選別で保持し、GMへは判定内部の印を渡さない", async () => {
  const state = {
    node: { id: "location", text: "工作場" },
    since: 1,
    about: ["place"],
  };
  const materials = [
    material("actor", [{ id: "skill", text: "紙を折る。" }], {
      states: [{ ...state, judgmentLocation: true }],
    }),
  ];
  const decide = vi.fn(async (_state, questions) =>
    Object.fromEntries(Object.keys(questions).map((key) => [key, 0])),
  );
  expect(
    await selectJudgmentMaterials({
      materials,
      requiredIds: new Set(),
      requests: [{ text: "紙を切る", subjects: ["actor"] }],
      decide,
      directLimit: 0,
      hydrate: async (selected) => stripJudgmentPreview(selected),
    }),
  ).toEqual([[material("actor", [], { states: [state] })]]);
  expect(Object.keys(decide.mock.calls[0]![1])).toHaveLength(2);
});

test("抜粋待ちの対象は参照した案で正本を確認し、無関係な保管品は読まない", async () => {
  const actor = material("actor", [{ id: "ordinary", text: "紙を折る。" }]);
  const target = {
    node: {
      id: "target",
      kind: "existence",
      text: "作成中の本文",
      judgmentExcerptPending: true,
    },
    belongings: {
      items: [],
      skills: [],
      storages: [
        {
          id: "shelf",
          label: "棚",
          items: [
            {
              id: "tool",
              label: "小物",
              basis: "作成中の取得経緯",
              judgmentBasisPending: true,
            },
          ],
        },
      ],
    },
  };
  const independent = [material("actor", [])];
  const hydratedTargetFor = new Set<number>();
  const hydratedStorageIds = new Set<string>();
  const hydrate = vi.fn(async (packet: unknown[], i: number) =>
    (packet as (typeof actor | typeof target)[]).map((fact) => {
      if (fact.node.id !== target.node.id) return fact;
      hydratedTargetFor.add(i);
      for (const storage of (fact as typeof target).belongings.storages)
        hydratedStorageIds.add(storage.id);
      return {
        ...fact,
        node: { ...fact.node, text: "長い設定。".repeat(130) },
      };
    }),
  );
  const inputs: string[] = [];
  expect(
    await selectJudgmentMaterials({
      materials: [actor, target],
      requiredIds: new Set(),
      requests: [
        { text: "木の札を作る", subjects: ["actor"] },
        {
          text: "対象を調べる",
          subjects: ["actor"],
          requiredIds: new Set(["target"]),
        },
      ],
      decide: async (state, questions) => {
        inputs.push(JSON.stringify(state));
        return Object.fromEntries(
          Object.keys(questions).map((key) => [key, 0.05]),
        );
      },
      hydrate,
      directLimit: 0,
      budget: bytes(independent),
    }),
  ).toEqual([independent, undefined]);
  expect(hydratedTargetFor).toEqual(new Set([1]));
  expect(hydratedStorageIds.size).toBe(0);
  for (const input of inputs) expect(input).not.toContain("作成中の");
});

test("高関連の資料が収まらないときも、先に必要な資料を確保して次の候補を試す", async () => {
  const proof = {
    id: "essential",
    text: "この証拠には長い適用条件がある。".repeat(100),
  };
  const next = { id: "short", text: "手元に作業台がある。" };
  const materials = [material("actor", [proof, next])];
  expect(
    await selectJudgmentMaterials({
      materials,
      requiredIds: new Set(),
      requests: [{ text: "材料を切る" }],
      decide: async (_state, questions) =>
        Object.fromEntries(Object.keys(questions).map((key) => [key, 0.99])),
      directLimit: 0,
      budget: 500,
    }),
  ).toEqual([[material("actor", [next])]]);
});

test("回答が不足した案には予算内の元資料を使い、元資料が超過すれば必須資料を使う", async () => {
  const materials = [material("actor", [{ id: "skill", text: "糸を巻く。" }])];
  const args = {
    materials,
    requiredIds: new Set<string>(),
    requests: [{ text: "糸を巻く" }],
    decide: async () => ({ r0c1a: 0.8 }),
    directLimit: 0,
  };
  expect(
    await selectJudgmentMaterials({ ...args, budget: bytes(materials) }),
  ).toEqual([materials]);
  expect(
    await selectJudgmentMaterials({ ...args, budget: bytes(materials) - 1 }),
  ).toEqual([[material("actor", [])]]);
});

test("単独で送信枠を超す候補を送らず、正本が収まる次の資料を残す", async () => {
  const required = {
    id: "required",
    name: "作業の手順",
    text: "手順書の内容。",
  };
  const unknown = { id: "unknown", text: "x".repeat(30 * 1024) };
  const large = { id: "large", text: "長い技能の抜粋。" };
  const short = { id: "short", text: "仕上げを助ける技能。" };
  const materials = [material("actor", [required, unknown, large, short])];
  const decide = vi.fn(
    async (_state, questions: Record<string, unknown>, batch) => {
      expect(batch).toBe(0);
      expect(JSON.stringify(_state)).not.toContain(unknown.text);
      return Object.fromEntries(
        Object.keys(questions).map((key) => [
          key,
          key.startsWith("r0c3") ? 0.99 : 0.9,
        ]),
      );
    },
  );
  const hydrate = vi.fn(async (packet: unknown[]) =>
    JSON.parse(
      JSON.stringify(packet).replace(large.text, "y".repeat(25 * 1024)),
    ),
  );
  const onFiltered = vi.fn();
  const measure = (nodes: unknown[]) =>
    measureDiceMaterials({
      role: "user",
      content: JSON.stringify({
        actor: "actor",
        nodes,
        text: "木の板を加工する",
      }),
    });
  const [selected] = await selectJudgmentMaterials({
    materials,
    requiredIds: new Set([required.id]),
    requests: [{ text: "木の板を加工する", subjects: ["actor"] }],
    decide,
    hydrate,
    measure,
    onFiltered,
  });
  expect(decide).toHaveBeenCalledTimes(1);
  expect(onFiltered).toHaveBeenCalledExactlyOnceWith(0);
  expect(hydrate).toHaveBeenCalledWith(
    [material("actor", [required, large])],
    0,
  );
  expect(selected).toEqual([material("actor", [required, short])]);
  expect(measure(selected!)).toBeLessThanOrEqual(24 * 1024);
});

test("元のJSONが24KiBを超えていても、圧縮後に収まる元資料で選別不能時の判定を続けられる", async () => {
  const basis = "同じ習得の記録。".repeat(850);
  const materials = [
    material(
      "actor",
      [1, 2, 3].map((n) => ({ id: `skill-${n}`, text: "木を仕上げる", basis })),
    ),
  ];
  const measure = (materials: unknown[]) =>
    measureDiceMaterials({
      role: "user",
      content: JSON.stringify({
        actor: "actor",
        action: "木を仕上げる",
        materials,
      }),
    });
  expect(bytes(materials)).toBeGreaterThan(24 * 1024);
  expect(measure(materials)).toBeGreaterThan(12 * 1024);
  expect(measure(materials)).toBeLessThan(24 * 1024);
  const decide = vi.fn(async () => undefined);
  const hydrate = vi.fn(async (packet: unknown[]) => {
    expect(decide).toHaveBeenCalled();
    return packet;
  });
  expect(
    await selectJudgmentMaterials({
      materials,
      requiredIds: new Set(),
      requests: [{ text: "木を仕上げる" }],
      decide,
      hydrate,
      measure,
    }),
  ).toEqual([materials]);
  expect(hydrate).toHaveBeenCalledExactlyOnceWith(materials, 0);
});

test("本文が一部しかない資料は選別してから必要な技能と根拠だけを読み出す", async () => {
  const skill = {
    id: "selected",
    text: "皮をなめす。",
    basis: { preview: "習得の経緯", marker: 1 },
  };
  const excluded = {
    id: "excluded",
    text: "海を読む。",
    basis: { preview: "海での経験", marker: 2 },
  };
  const canonical = {
    ...skill,
    text: "なめす手順と使える条件。",
    basis: "本人が確かに習得した経緯。",
  };
  const materials = [
    {
      ...material("actor", []),
      belongings: { skills: [skill, excluded], items: [], storages: [] },
    },
  ];
  const decide = vi.fn(async (value: unknown) => {
    const { candidates } = value as {
      candidates: {
        key: string;
        evidence: unknown;
        material?: { id: string };
      }[];
    };
    expect(
      candidates.find(({ material }) => material?.id === "selected")?.evidence,
    ).toBe("習得の経緯");
    return Object.fromEntries(
      candidates.flatMap(({ key, evidence, material }) => {
        const id = material?.id ?? (evidence as { id?: string }).id;
        return [
          [`r0${key}a`, id === "selected" ? 0.99 : 0.1],
          [`r0${key}e`, id === "selected" ? 0.99 : 0.1],
        ];
      }),
    );
  });
  const hydratedSkills = new Set<string>();
  const hydratedBases = new Set<string>();
  const hydrate = vi.fn(async (packet: unknown[]) => {
    expect(decide).toHaveBeenCalled();
    return (packet as typeof materials).map((fact) => ({
      ...fact,
      belongings: {
        ...fact.belongings,
        skills: fact.belongings.skills.map((current) => {
          hydratedSkills.add(current.id);
          if (current.basis) hydratedBases.add(current.basis.preview);
          return current.id === skill.id
            ? { ...canonical, basis: current.basis ? canonical.basis : null }
            : current;
        }),
      },
    }));
  });
  expect(
    await selectJudgmentMaterials({
      materials,
      requiredIds: new Set(),
      requests: [{ text: "皮を加工する", subjects: ["actor"] }],
      decide,
      hydrate,
    }),
  ).toEqual([[material("actor", [canonical])]]);
  expect(hydratedSkills).toEqual(new Set([skill.id]));
  expect(hydratedBases).toEqual(new Set([skill.basis.preview]));
});

test("全資料と分かる小さな入力は一度だけ正本を確認し、選別を省く", async () => {
  const materials = [material("actor", [])];
  const decide = vi.fn();
  const hydrate = vi.fn(async (packet: unknown[]) => packet);
  expect(
    await selectJudgmentMaterials({
      materials,
      requiredIds: new Set(),
      requests: [{ text: "紙を折る" }],
      decide,
      hydrate,
      previewComplete: true,
    }),
  ).toEqual([materials]);
  expect(decide).not.toHaveBeenCalled();
  expect(hydrate).toHaveBeenCalledExactlyOnceWith(materials, 0);
});

const heldItem = (id: string, judgmentEdgeId = `held-${id}`) => ({
  id,
  label: "木製の型板",
  basis: "深い溝を使う場合に限り布を傷めなかった。",
  judgmentEdgeId,
});

type HeldItem = Omit<ReturnType<typeof heldItem>, "basis"> & {
  basis: string | null;
};

const holdingMaterials = (stored: HeldItem[], local = stored) => {
  const place = material("workshop", [], { items: local });
  const actor = material("actor", []);
  return [
    {
      ...actor,
      belongings: {
        ...actor.belongings,
        storages: [{ id: "workshop", label: "共同工房", items: stored }],
      },
    },
    place,
  ];
};

test("同じ所持関係を一度だけ評価し、採用した物品に限って経緯を案ごとに1件補う", async () => {
  const first = heldItem("first");
  const second = heldItem("second");
  const excluded = heldItem("excluded");
  const distinct = heldItem("distinct");
  const other = heldItem("distinct", "other-edge");
  const materials = holdingMaterials(
    [first, second, excluded, distinct],
    [first, second, excluded, other],
  );
  const decide = vi.fn(
    async (value: unknown, questions: Record<string, unknown>) => {
      const { candidates } = value as {
        candidates: {
          key: string;
          evidence: HeldItem | string;
          material?: HeldItem;
          holdingPaths?: unknown;
        }[];
      };
      expect(
        candidates.filter(({ holdingPaths }) => holdingPaths),
      ).toHaveLength(6);
      for (const row of candidates.filter(({ holdingPaths }) => holdingPaths)) {
        expect(row.holdingPaths).toEqual({
          holder: { id: "workshop", label: "workshopのプロフィール" },
          registeredUsers: ["actor"],
        });
      }
      expect(
        candidates.filter(
          ({ material, evidence }) =>
            (material ?? (evidence as HeldItem)).id === distinct.id,
        ),
      ).toHaveLength(4);
      const scores: Record<string, number> = {};
      for (const { key, evidence, material } of candidates) {
        const { id } = material ?? (evidence as HeldItem);
        for (const proposal of [0, 1]) {
          const [applicable, effect] = !material
            ? id === excluded.id
              ? [0.54, 0.54]
              : [0.55, 0.55]
            : id === (proposal === 0 ? first.id : second.id)
              ? [0.5, 0.54]
              : [0.54, 0.53];
          scores[`r${proposal}${key}a`] = applicable;
          scores[`r${proposal}${key}e`] = effect;
        }
      }
      expect(Object.keys(questions)).toEqual(Object.keys(scores));
      return scores;
    },
  );
  const expected = (withBasis: HeldItem) =>
    [first, second].map((item) => ({
      ...item,
      basis: item === withBasis ? item.basis : null,
    }));
  const [firstPlan, secondPlan] = await selectJudgmentMaterials({
    materials,
    requiredIds: new Set(["workshop"]),
    requests: ["湿った生地を伸ばす", "布地の端を揃える"].map((text) => ({
      text,
      subjects: ["actor"],
    })),
    directLimit: 0,
    threshold: 0.55,
    decide,
  });
  for (const [packet, basis] of [
    [firstPlan, first],
    [secondPlan, second],
  ] as const) {
    expect(packet).toEqual(
      holdingMaterials(
        [...expected(basis), { ...distinct, basis: null }],
        [...expected(basis), { ...other, basis: null }],
      ),
    );
  }
  expect(decide).toHaveBeenCalledTimes(1);
});

test("追加する取得経緯が正本復元後の予算に収まらなければ物品本体を残す", async () => {
  const item = heldItem("board");
  const materials = holdingMaterials([item]);
  const withoutBasis = holdingMaterials([{ ...item, basis: null }]);
  const budget = bytes(materials);
  const hydrate = vi.fn(
    async (packet: unknown[]) =>
      JSON.parse(
        JSON.stringify(packet).replaceAll(item.basis, "原文".repeat(budget)),
      ) as unknown[],
  );
  const decide = vi.fn(async (value: unknown) => {
    const { candidates } = value as {
      candidates: { key: string; material?: HeldItem }[];
    };
    return Object.fromEntries(
      candidates.flatMap(({ key, material }) => {
        const p = material ? 0.5 : 0.55;
        return [
          [`r0${key}a`, p],
          [`r0${key}e`, p],
        ];
      }),
    );
  });
  expect(
    await selectJudgmentMaterials({
      materials,
      requiredIds: new Set(["workshop"]),
      requests: [{ text: "湿った生地を伸ばす", subjects: ["actor"] }],
      directLimit: 0,
      threshold: 0.55,
      budget,
      decide,
      hydrate,
    }),
  ).toEqual([withoutBasis]);
  expect(hydrate).toHaveBeenCalledWith(materials, 0);
  expect(decide).toHaveBeenCalledTimes(1);
});
