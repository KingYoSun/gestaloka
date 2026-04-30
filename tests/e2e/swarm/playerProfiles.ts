import type { SwarmUserPersona } from "./userPersonas";

export type DerivedPlayerProfile = {
  sourcePersonaId: SwarmUserPersona["id"];
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
  if (persona.id === "novel-lover") {
    return {
      sourcePersonaId: persona.id,
      displayName: "Mio Archive Steward",
      gender: "female",
      background:
        "A careful steward of gate records who notices small emotional shifts between travelers, stewards, and local rumors.",
      freeText:
        "She prefers to help people in ways that leave visible traces: a remembered kindness, a restored relationship, or a clue another traveler can later recognize.",
      playLanguage: { mode: "preset", preset: "en", custom: "" },
      narrativePreferences: {
        perspective: "third_person",
        tone: "lyrical",
        density: "ornate",
        dialogue_style: "literary",
      },
    };
  }

  if (persona.id === "mmo-gamer") {
    return {
      sourcePersonaId: persona.id,
      displayName: "Kaito Route Expediter",
      gender: "male",
      background:
        "A route-minded operative who keeps track of objectives, bottlenecks, and which local figures can move the situation forward.",
      freeText:
        "He tries to advance the current objective quickly, but he expects the world to explain contention around a busy route, place, or guide.",
      playLanguage: { mode: "preset", preset: "en", custom: "" },
      narrativePreferences: {
        perspective: "third_person",
        tone: "logical",
        density: "concise",
        dialogue_style: "dialogue_forward",
      },
    };
  }

  return {
    sourcePersonaId: persona.id,
    displayName: "Sena Causality Auditor",
    gender: "unspecified",
    background:
      "A quiet field auditor who compares public signs, local testimony, and the order of events before acting.",
    freeText:
      "They look for whether a visible change has a traceable cause, then ask precise questions that test the continuity of the shared place.",
    playLanguage: { mode: "preset", preset: "en", custom: "" },
    narrativePreferences: {
      perspective: "third_person",
      tone: "logical",
      density: "concise",
      dialogue_style: "literary",
    },
  };
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

