import type { SwarmUserPersona } from "./userPersonas";

export type DerivedPlayerProfile = {
  sourcePersonaId: string;
  displayName: string;
  gender: "female" | "male" | "other" | "unspecified";
  background: string;
  freeText: string;
  playLanguage: {
    mode: "preset";
    preset: "ja";
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
    displayName: `${template.namePrefix} JP ${stableNamePart(persona.archetype)}`,
    gender: persona.gender,
    background: template.background,
    freeText: template.freeText,
    playLanguage: { mode: "preset", preset: "ja", custom: "" },
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
        "門の記録を丁寧に見守り、旅人、門番、地域の噂のあいだに生まれる感情の変化を読み取る記録係。",
      freeText:
        "記憶に残る親切、修復された関係、後から別の旅人が気づける手がかりなど、目に見える痕跡を残す行動を好む。",
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
        "目的、ボトルネック、状況を前に進められる人物を追跡する、経路意識の強い実行役。",
      freeText:
        "現在の目的を素早く進めようとするが、混雑した経路、場所、案内役をめぐる競合について世界が説明することを期待する。",
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
      "行動する前に、公開された徴候、現地の証言、出来事の順序を照合する静かな現地監査者。",
    freeText:
      "目に見える変化に追跡可能な原因があるかを探し、共有された場所の連続性を試すために精密な質問を投げる。",
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
