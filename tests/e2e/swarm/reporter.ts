import fs from "node:fs/promises";
import path from "node:path";

import type { TestInfo } from "@playwright/test";

import type { DerivedPlayerProfile } from "./playerProfiles";
import type { SwarmDecision } from "./playbook";
import type { SwarmUserPersona } from "./userPersonas";

export type PersonaEvaluation = {
  personaId: string;
  rating: "good" | "acceptable" | "needs work" | "blocked";
  observedImpact: string;
  evidence: string[];
};

export type SwarmReport = {
  run_id: string;
  created_at: string;
  world_id: string;
  user_personas: SwarmUserPersona[];
  derived_player_profiles: DerivedPlayerProfile[];
  persona_decision_log: Array<SwarmDecision & { personaId: string }>;
  persona_experience_evaluation: PersonaEvaluation[];
  hard_checks: Record<string, boolean>;
  runtime: Array<{
    personaId: string;
    actorId: string;
    sessionId: string;
    locationId: string;
    eventIds: string[];
    turnIds: string[];
  }>;
  artifacts: string[];
};

export function buildRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function defaultArtifactDir(runId: string): string {
  return (
    process.env.SWARM_ARTIFACT_DIR ??
    path.resolve(process.cwd(), "../documents/testplay-reports/artifacts", `swarm-test-${runId}`)
  );
}

export async function writeSwarmReport(testInfo: TestInfo, artifactDir: string, report: SwarmReport): Promise<void> {
  await fs.mkdir(artifactDir, { recursive: true });
  const jsonPath = path.join(artifactDir, "swarm-test-result.json");
  const markdownPath = path.join(artifactDir, "swarm-test-report.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(markdownPath, markdownReport(report), "utf8");
  await testInfo.attach("swarm-test-result", {
    path: jsonPath,
    contentType: "application/json",
  });
  await testInfo.attach("swarm-test-report", {
    path: markdownPath,
    contentType: "text/markdown",
  });
}

function markdownReport(report: SwarmReport): string {
  const lines = [
    `# swarm-test report ${report.run_id}`,
    "",
    `- created_at: ${report.created_at}`,
    `- world_id: ${report.world_id}`,
    "",
    "## Hard Checks",
    "",
    ...Object.entries(report.hard_checks).map(([key, value]) => `- ${key}: ${value ? "pass" : "fail"}`),
    "",
    "## Personas",
    "",
    ...report.user_personas.map(
      (persona) =>
        `- ${persona.id}: gender=${persona.gender}, age=${persona.age}, occupation=${persona.occupation}, hobbies=${persona.hobbies.join(
          ", ",
        )}, personality=${persona.personality.join(", ")}`,
    ),
    "",
    "## Derived Player Profiles",
    "",
    ...report.derived_player_profiles.map(
      (profile) =>
        `- ${profile.sourcePersonaId}: ${profile.displayName}; gender=${profile.gender}; playLanguage=${profile.playLanguage.preset}`,
    ),
    "",
    "## Persona Decisions",
    "",
    ...report.persona_decision_log.map(
      (decision) =>
        `- ${decision.personaId}: ${decision.scenario}; ${decision.inputMode}; ${
          decision.choiceId ?? decision.inputText
        }; reason=${decision.reason}`,
    ),
    "",
    "## Persona Experience Evaluation",
    "",
    ...report.persona_experience_evaluation.map(
      (evaluation) =>
        `- ${evaluation.personaId}: ${evaluation.rating}; ${evaluation.observedImpact}; evidence=${evaluation.evidence.join(
          " | ",
        )}`,
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

