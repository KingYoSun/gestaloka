import { z } from "zod";

const count = z.number().int().nonnegative().safe();
const text = z.string().min(1);
export const Information = z
  .object({
    kind: z.enum(["node", "edge"]),
    id: text,
    aspect: text,
    state: text,
    version: text.nullable(),
    at: count,
    origin: z.enum(["reference", "generated"]),
    evidence: text,
    canonical: z.literal(true).optional(),
  })
  .strict();
export type Information = z.infer<typeof Information>;
export const InformationReference = z.union([
  z.object({ id: text, evidence: text.optional() }).strict(),
  Information,
]);
export type InformationReference = z.infer<typeof InformationReference>;
export const Presentation = z
  .object({
    id: z.uuid(),
    sceneId: z.uuid(),
    inputId: z.uuid().nullable(),
    kind: z.enum(["synopsis", "response", "result"]),
    ordinal: count,
    text: z.string(),
    at: count,
    providedAt: z.iso.datetime().nullable(),
    information: z.array(Information).nullable(),
  })
  .strict();
export type Presentation = z.infer<typeof Presentation>;
export const InitialPresentation = Presentation.pick({
  id: true,
  text: true,
  at: true,
  providedAt: true,
  information: true,
});
export const InspectionWeights = z
  .object({
    version: text,
    values: z
      .object({ node: count, edge: count, aspect: count, update: count })
      .strict(),
    rationale: text,
  })
  .strict();
export const InspectionSelection = z
  .object({
    worldId: z.uuid(),
    userId: z.uuid().nullable(),
    actorId: z.uuid(),
    endSceneId: z.uuid(),
    n: z.number().int().positive().safe(),
    metricVersion: z
      .enum(["presentation-v1", "presentation-v2", "presentation-v3"])
      .default("presentation-v3"),
    weights: InspectionWeights.default({
      version: "unit-v1",
      values: { node: 1, edge: 1, aspect: 1, update: 1 },
      rationale: "全区分1の未校正の基準値。満足度や意味的重要度を表さない。",
    }),
    lowThreshold: z.number().finite().nonnegative().default(0),
  })
  .strict();
export const InspectionCall = z
  .object({
    id: z.uuid(),
    responseId: z.uuid().nullable(),
    model: z.string().nullable(),
    configurationVersion: count.nullable(),
    task: z.string().nullable(),
    status: z.string(),
    nanoUsd: z.string().regex(/^\d+$/).nullable(),
    reservedNanoUsd: z.string().regex(/^\d+$/),
    elapsedMs: count.nullable(),
    inputTokens: count.nullable(),
    outputTokens: count.nullable(),
  })
  .strict();
export const InspectionScene = z
  .object({
    id: z.uuid(),
    revision: text,
    state: text,
    createdAt: z.iso.datetime(),
    purpose: z.string().optional(),
    inputs: z.array(
      z
        .object({
          id: z.uuid(),
          text: z.string(),
          state: text,
          submittedAt: z.iso.datetime().nullable(),
          completedAt: z.iso.datetime().nullable(),
        })
        .strict(),
    ),
    presentations: z.array(Presentation),
    calls: z.array(InspectionCall),
    administratorEvidence: z
      .object({
        background: z.unknown(),
        events: z.array(z.unknown()),
        dependencies: z.array(z.unknown()),
        projection: z.unknown(),
        contextRequests: z.array(z.unknown()).optional(),
      })
      .strict(),
    recording: z.enum(["recorded", "legacy"]),
  })
  .strict();
export const InspectionManifest = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    recordVersion: z.enum([
      "inspection-record-v1",
      "inspection-record-v2",
      "inspection-record-v3",
    ]),
    capturedAt: z.iso.datetime(),
    selection: InspectionSelection,
    requestedScenes: count,
    actualScenes: count,
    initial: z.array(InitialPresentation).nullable().optional(),
    declaredContext: z
      .object({
        character: z
          .object({
            presetId: z.uuid(),
            version: count,
            settings: z.string(),
            registrationAt: count,
          })
          .strict()
          .nullable(),
        preparations: z.array(
          z
            .object({
              sceneId: z.uuid(),
              purpose: z.string().nullable(),
              createdAt: z.iso.datetime(),
            })
            .strict(),
        ),
        timeBasis: z.literal("world-clock-is-not-character-history"),
      })
      .strict()
      .optional(),
    prior: z.array(Presentation),
    priorMissingScenes: z.array(z.uuid()),
    scenes: z.array(InspectionScene),
  })
  .strict();
export type InspectionManifest = z.infer<typeof InspectionManifest>;
export const InspectionPageQuery = z
  .object({
    worldId: z.uuid(),
    manifestId: InspectionManifest.shape.id,
    after: count.optional(),
  })
  .strict();
const MeaningUnit = z
  .object({
    text,
    category: z.enum([
      "addition",
      "update",
      "reinterpretation",
      "certainty",
      "duplicate",
    ]),
    importance: z.number().int().min(0).max(3),
    evidence: z
      .array(z.object({ presentationId: z.uuid(), quote: text }).strict())
      .min(1),
    explanation: text,
  })
  .strict();
export const SemanticAssessment = z
  .object({
    inputs: z.array(
      z
        .object({
          inputId: z.uuid(),
          units: z.array(MeaningUnit),
          responsiveness: z.enum([
            "responsive",
            "partial",
            "unresponsive",
            "unknown",
          ]),
          principle: z.enum(["consistent", "violation", "unknown"]),
          principleEvidence: z.array(
            z
              .object({
                presentationId: z.uuid(),
                quote: text,
                explanation: text,
              })
              .strict(),
          ),
          missing: z.array(text),
        })
        .strict(),
    ),
    otherPresentations: z
      .array(
        z
          .object({
            presentationId: z.uuid(),
            units: z.array(MeaningUnit),
            missing: z.array(text),
          })
          .strict(),
      )
      .default([]),
    overall: z
      .object({
        newInformation: count.nullable(),
        importance: z.number().min(0).max(3).nullable(),
        responsiveness: text,
        stagnation: text,
        principle: z.enum(["consistent", "violation", "unknown"]),
        explanation: text,
        missing: z.array(text),
      })
      .strict(),
    disagreements: z.array(
      z.object({ presentationId: z.uuid(), explanation: text }).strict(),
    ),
  })
  .strict();
export const InspectionEvaluation = z
  .object({
    configurationVersion: z.number().int().positive().safe(),
    target: z.enum(["default", "resolution"]),
    budgetUsd: z
      .number()
      .positive()
      .finite()
      .max(Number.MAX_SAFE_INTEGER / 1e9),
  })
  .strict();
export const InspectionSchedule = z
  .object({
    enabled: z.boolean(),
    intervalMinutes: z.number().int().positive().safe(),
    periodHours: z.number().int().positive().safe(),
    n: z.number().int().positive().safe(),
    lowThreshold: z.number().finite().nonnegative(),
    weights: InspectionWeights,
    evaluation: InspectionEvaluation.nullable(),
    sampleCount: count,
  })
  .strict();
export const InspectionHistoryQuery = z
  .object({
    worldId: z.uuid(),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    userId: z.uuid().nullable().optional(),
    actorId: z.uuid().optional(),
    n: z.number().int().positive().optional(),
    metricVersion: text.optional(),
    weightVersion: text.optional(),
    model: text.optional(),
    configurationVersion: count.optional(),
    after: count.optional(),
  })
  .strict()
  .refine((q) => q.from < q.to, "期間の開始は終了より前にしてください");

const Breakdown = z.object({
  counts: z.object({ node: count, edge: count, aspect: count, update: count }),
  origins: z.object({ reference: count, generated: count }),
  observedValue: z.number(),
  value: z.number().nullable(),
  coverage: z.object({
    presentations: count,
    mapped: count,
    ratio: z.number().nullable(),
    adequacy: z.literal("unreviewed").optional(),
  }),
  missing: z.array(z.uuid()),
});
const Resources = z.object({
  calls: count,
  calculatedNanoUsd: z.string().nullable(),
  knownNanoUsd: z.string(),
  costMissing: z.boolean(),
  modelCallMs: count.nullable(),
  responseWaitMs: count.nullable(),
  perUsd: z.number().nullable(),
  perWaitSecond: z.number().nullable(),
});
const InputMeasurement = Breakdown.extend({
  ...Resources.shape,
  id: z.uuid(),
  state: text,
});
export const SceneMeasurement = Breakdown.extend({
  ...Resources.shape,
  id: z.uuid(),
  state: text,
  revision: text,
  inputs: z.array(InputMeasurement),
  kinds: z.record(z.string(), Breakdown),
});
export const PresentationDiff = z.object({
  presentationId: z.uuid(),
  sceneId: z.uuid(),
  inputId: z.uuid().nullable(),
  kind: Presentation.shape.kind,
  missing: z.boolean(),
  elements: z.array(
    Information.extend({
      category: z.enum(["node", "edge", "aspect", "update", "repeat"]),
    }),
  ),
});
export const InspectionMeasurement = z.object({
  manifestId: text,
  metricVersion: text,
  weights: InspectionWeights,
  requestedScenes: count,
  actualScenes: count,
  initialMissing: z.boolean().default(true),
  status: z.enum(["complete", "partial"]),
  total: Breakdown.extend({
    ...Resources.shape,
    inputCount: count,
    perInput: z.number().nullable(),
  }),
  missingScenes: z.array(z.uuid()),
  priorMissingScenes: z.array(z.uuid()),
  scenes: z.array(SceneMeasurement),
  diffs: z.array(PresentationDiff),
  lowRuns: z.array(z.object({ inputIds: z.array(z.uuid()), length: count })),
  longestLowRun: count,
  limitations: z.array(text),
});
export const InspectionEvidence = z.object({
  id: text,
  section: z.enum([
    "initial",
    "prior",
    "scene",
    "input",
    "presentation",
    "call",
    "administrator",
    "measure-scene",
    "measure-diff",
  ]),
  sceneId: z.uuid().nullable(),
  inputId: z.uuid().nullable(),
  value: z.unknown(),
});
export const InspectionReadResult = z.object({
  manifest: InspectionManifest.omit({
    initial: true,
    prior: true,
    scenes: true,
  }).extend({
    initialRecording: z.enum(["recorded", "missing"]).default("missing"),
    sceneOrder: z.array(
      z.object({ id: z.uuid(), revision: text, state: text }),
    ),
  }),
  measurement: InspectionMeasurement.omit({ scenes: true, diffs: true }),
  items: z.array(InspectionEvidence),
  next: count.nullable(),
  fetched: z.object({
    offset: count,
    count: count,
    total: count,
    complete: z.boolean(),
  }),
  retention: text,
});
