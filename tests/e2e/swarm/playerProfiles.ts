import type { SwarmUserPersona } from "./userPersonas";

export type DerivedPlayerProfile = {
  sourcePersonaId: string;
  displayName: string;
  gender: "female" | "male" | "other" | "unspecified";
  background: string;
  freeText: string;
  playLanguage: {
    mode: "preset";
    preset: "en";
    custom: "";
  };
  narrativePreferences: {
    perspective: "first_person" | "third_person";
    tone: "lyrical" | "logical";
    density: "concise" | "ornate";
    dialogue_style: "dialogue_forward" | "literary";
  };
};

export function derivePlayerProfile(persona: SwarmUserPersona): DerivedPlayerProfile {
  const template = profileTemplate(persona);
  return {
    sourcePersonaId: persona.id,
    displayName: `${template.namePrefix} ${stableNamePart(persona.id)}`,
    gender: persona.gender,
    background: template.background,
    freeText: template.freeText,
    playLanguage: { mode: "preset", preset: "en", custom: "" },
    narrativePreferences: template.narrativePreferences,
  };
}

function profileTemplate(persona: SwarmUserPersona): Omit<DerivedPlayerProfile, "sourcePersonaId" | "displayName" | "gender" | "playLanguage"> & {
  namePrefix: string;
} {
  if (persona.archetype === "story" || persona.archetype === "social") {
    return {
      namePrefix: "Mio",
      background:
        "A careful steward of gate records who notices emotional shifts between travelers, stewards, and local rumors.",
      freeText:
        "They prefer actions that leave visible traces: a remembered kindness, a restored relationship, or a clue another traveler can later recognize.",
      narrativePreferences: {
        perspective: "third_person",
        tone: "lyrical",
        density: "ornate",
        dialogue_style: "literary",
      },
    };
  }

  if (persona.archetype === "mmo" || persona.archetype === "optimizer") {
    return {
      namePrefix: "Kaito",
      background:
        "A route-minded operative who tracks objectives, bottlenecks, and which local figures can move the situation forward.",
      freeText:
        "They try to advance the current objective quickly, but expect the world to explain contention around a busy route, place, or guide.",
      narrativePreferences: {
        perspective: "third_person",
        tone: "logical",
        density: "concise",
        dialogue_style: "dialogue_forward",
      },
    };
  }

  return {
    namePrefix: persona.archetype === "explorer" ? "Rin" : "Sena",
    background:
      "A quiet field auditor who compares public signs, local testimony, and the order of events before acting.",
    freeText:
      "They look for whether a visible change has a traceable cause, then ask precise questions that test continuity in the shared place.",
    narrativePreferences: {
      perspective: "third_person",
      tone: "logical",
      density: "concise",
      dialogue_style: "literary",
    },
  };
}

function stableNamePart(id: string): string {
  return id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function profilePayloadForApi(profile: DerivedPlayerProfile): Record<string, unknown> {
  return {
    display_name: profile.displayName,
    gender: profile.gender,
    background: profile.background,
    free_text: profile.freeText,
    narrative_preferences: profile.narrativePreferences,
    play_language: profile.playLanguage,
  };
}
