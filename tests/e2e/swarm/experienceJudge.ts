import fs from "node:fs/promises";
import path from "node:path";

import type { SwarmDecision } from "./playbook";
import type { SwarmUiTurnObservation, SwarmViewportProfile } from "./uiDriver";
import type { AssignedSwarmUserPersona } from "./userPersonas";

export type ExperienceDimension = "ux_clarity" | "gameplay_fun" | "story_progression" | "overall";
export type ExperienceRating = "good" | "acceptable" | "needs work" | "blocked";

export type ExperienceScore = {
  score: number | null;
  rating: ExperienceRating;
  rationale: string;
};

export type ExperienceEvidenceSnapshot = {
  viewport: SwarmViewportProfile;
  decisions: Array<SwarmDecision & { personaId: string }>;
  turns: SwarmUiTurnObservation[];
};

export type SwarmExperienceEvaluation = {
  personaId: string;
  ux_clarity: ExperienceScore;
  gameplay_fun: ExperienceScore;
  story_progression: ExperienceScore;
  overall: ExperienceScore;
  suggestions: string[];
  warnings: string[];
  judge: {
    status: "ok" | "blocked";
    modelId: string | null;
    message: string | null;
  };
  evidence: ExperienceEvidenceSnapshot;
};

type JudgeResponse = {
  personas: Array<{
    personaId: string;
    ux_clarity: ExperienceScore;
    gameplay_fun: ExperienceScore;
    story_progression: ExperienceScore;
    overall: ExperienceScore;
    suggestions: string[];
    warnings?: string[];
  }>;
};

type JudgeInput = {
  runId: string;
  personas: AssignedSwarmUserPersona[];
  decisions: Array<SwarmDecision & { personaId: string }>;
  observationsByPersona: Map<string, SwarmUiTurnObservation[]>;
  viewportByPersona: Map<string, SwarmViewportProfile>;
};

export async function evaluateSwarmExperience(input: JudgeInput): Promise<SwarmExperienceEvaluation[]> {
  const promptPath = resolveJudgePromptPath();
  const evidence = buildJudgeEvidence(input);
  const modelId = judgeModelId();
  if (!judgeEnabled()) {
    return blockedEvaluations(input, "SWARM_JUDGE_ENABLED により LLM judge が無効化されています。", modelId);
  }
  if (!modelId) {
    return blockedEvaluations(input, "SWARM_JUDGE_MODEL_ID、MODEL_LITE_ID、MODEL_MAIN_ID のいずれも設定されていません。", null);
  }
  if (!process.env.OPENAI_COMPAT_API_KEY?.trim() || !process.env.OPENAI_COMPAT_BASE_URL?.trim()) {
    return blockedEvaluations(input, "OPENAI_COMPAT_API_KEY または OPENAI_COMPAT_BASE_URL が設定されていません。", modelId);
  }

  try {
    const prompt = await fs.readFile(promptPath, "utf8");
    const response = await callJudge(prompt, evidence, modelId);
    return normalizeJudgeEvaluations(response, input, modelId);
  } catch (error) {
    return blockedEvaluations(input, `LLM judge が実行できませんでした: ${errorMessage(error)}`, modelId);
  }
}

export function parseJudgeResponse(payload: unknown): JudgeResponse {
  const content = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!content || typeof content !== "object" || !Array.isArray((content as { personas?: unknown }).personas)) {
    throw new Error("Judge response must include personas array.");
  }
  return {
    personas: (content as { personas: unknown[] }).personas.map((item) => {
      if (!item || typeof item !== "object") {
        throw new Error("Judge persona item must be an object.");
      }
      const raw = item as Record<string, unknown>;
      return {
        personaId: requiredString(raw.personaId, "personaId"),
        ux_clarity: parseScore(raw.ux_clarity, "ux_clarity"),
        gameplay_fun: parseScore(raw.gameplay_fun, "gameplay_fun"),
        story_progression: parseScore(raw.story_progression, "story_progression"),
        overall: parseScore(raw.overall, "overall"),
        suggestions: parseStringList(raw.suggestions),
        warnings: parseStringList(raw.warnings),
      };
    }),
  };
}

export function experienceHasWarning(evaluation: SwarmExperienceEvaluation, threshold = warningThreshold()): boolean {
  return (
    evaluation.judge.status === "blocked" ||
    evaluation.warnings.length > 0 ||
    dimensions.some((dimension) => {
      const score = evaluation[dimension].score;
      return typeof score !== "number" || score < threshold || evaluation[dimension].rating === "needs work";
    })
  );
}

export function warningThreshold(): number {
  return envInt("SWARM_EXPERIENCE_WARNING_THRESHOLD", 3);
}

function normalizeJudgeEvaluations(
  response: JudgeResponse,
  input: JudgeInput,
  modelId: string,
): SwarmExperienceEvaluation[] {
  const responseByPersona = new Map(response.personas.map((item) => [item.personaId, item]));
  return input.personas.map((persona) => {
    const judged = responseByPersona.get(persona.id);
    if (!judged) {
      return blockedEvaluationForPersona(input, persona, `LLM judge の応答に ${persona.id} の評価が含まれていません。`, modelId);
    }
    return {
      personaId: persona.id,
      ux_clarity: judged.ux_clarity,
      gameplay_fun: judged.gameplay_fun,
      story_progression: judged.story_progression,
      overall: judged.overall,
      suggestions: judged.suggestions,
      warnings: judged.warnings ?? [],
      judge: { status: "ok", modelId, message: null },
      evidence: evidenceForPersona(input, persona.id),
    };
  });
}

function blockedEvaluations(input: JudgeInput, message: string, modelId: string | null): SwarmExperienceEvaluation[] {
  return input.personas.map((persona) => blockedEvaluationForPersona(input, persona, message, modelId));
}

function blockedEvaluationForPersona(
  input: JudgeInput,
  persona: AssignedSwarmUserPersona,
  message: string,
  modelId: string | null,
): SwarmExperienceEvaluation {
  const blocked = { score: null, rating: "blocked" as const, rationale: message };
  return {
    personaId: persona.id,
    ux_clarity: blocked,
    gameplay_fun: blocked,
    story_progression: blocked,
    overall: blocked,
    suggestions: [],
    warnings: [message],
    judge: { status: "blocked", modelId, message },
    evidence: evidenceForPersona(input, persona.id),
  };
}

async function callJudge(prompt: string, evidence: unknown, modelId: string): Promise<JudgeResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), envInt("SWARM_JUDGE_TIMEOUT_MS", 120_000));
  try {
    const baseURL = process.env.OPENAI_COMPAT_BASE_URL?.trim().replace(/\/$/, "");
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_COMPAT_API_KEY?.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: JSON.stringify(evidence, null, 2) },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`judge request failed: ${response.status} ${await response.text()}`);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const content = responseContent(payload);
    return parseJudgeResponse(content);
  } finally {
    clearTimeout(timeout);
  }
}

function buildJudgeEvidence(input: JudgeInput): Record<string, unknown> {
  return {
    runId: input.runId,
    warningThreshold: warningThreshold(),
    personas: input.personas.map((persona) => ({
      id: persona.id,
      label: persona.label,
      archetype: persona.archetype,
      gameMotivation: persona.gameMotivation,
      playStyle: persona.playStyle,
      narrativePreference: persona.narrativePreference,
      frictionSensitivity: persona.frictionSensitivity,
      evaluationLens: persona.evaluationLens,
      viewport: input.viewportByPersona.get(persona.id),
      decisions: input.decisions.filter((decision) => decision.personaId === persona.id),
      turns: input.observationsByPersona.get(persona.id) ?? [],
    })),
    rubric: {
      ux_clarity: "操作開始、turn待機、二重送信防止、提示行動/free-text切替、stream可読性、回復導線を1-5で評価する。",
      gameplay_fun:
        "ペルソナ動機に合う行動選択、意味あるstarter quest進行/探索/競合、待ち時間への納得感を1-5で評価する。",
      story_progression:
        "starter questが開始時点から文脈として読めるか、表示文面に沿って進行したか、他プレイヤー痕跡とworld beat連続性を1-5で評価する。",
    },
  };
}

function evidenceForPersona(input: JudgeInput, personaId: string): ExperienceEvidenceSnapshot {
  return {
    viewport: input.viewportByPersona.get(personaId) ?? { kind: "desktop", width: 1280, height: 900 },
    decisions: input.decisions.filter((decision) => decision.personaId === personaId),
    turns: input.observationsByPersona.get(personaId) ?? [],
  };
}

function resolveJudgePromptPath(): string {
  const promptDir = process.env.SWARM_JUDGE_PROMPT_DIR?.trim() || process.env.PROMPT_DIR?.trim() || "/workspace/prompts";
  return path.join(promptDir, "swarm_experience_judge.md");
}

function judgeEnabled(): boolean {
  const raw = process.env.SWARM_JUDGE_ENABLED?.trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

function judgeModelId(): string {
  return (
    process.env.SWARM_JUDGE_MODEL_ID?.trim() ||
    process.env.MODEL_LITE_ID?.trim() ||
    process.env.MODEL_MAIN_ID?.trim() ||
    ""
  );
}

function responseContent(payload: Record<string, unknown>): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content !== "string") {
    throw new Error("judge response did not include message.content");
  }
  return content;
}

function parseScore(value: unknown, label: ExperienceDimension): ExperienceScore {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} must be an object.`);
  }
  const raw = value as Record<string, unknown>;
  const score = Number(raw.score);
  if (!Number.isFinite(score) || score < 1 || score > 5) {
    throw new Error(`${label}.score must be 1-5.`);
  }
  return {
    score,
    rating: parseRating(raw.rating, label),
    rationale: requiredString(raw.rationale, `${label}.rationale`),
  };
}

function parseRating(value: unknown, label: string): ExperienceRating {
  if (value === "good" || value === "acceptable" || value === "needs work" || value === "blocked") {
    return value;
  }
  throw new Error(`${label}.rating is invalid.`);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function parseStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const dimensions: ExperienceDimension[] = ["ux_clarity", "gameplay_fun", "story_progression", "overall"];
