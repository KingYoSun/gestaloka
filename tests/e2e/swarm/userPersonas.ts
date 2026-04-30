import fs from "node:fs";
import path from "node:path";

export type SwarmPersonaArchetype = "story" | "mmo" | "engineer" | "explorer" | "social" | "optimizer";

export type SwarmAuthUser = {
  username: string;
  password: string;
};

export type AssignedSwarmUserPersona = SwarmUserPersona & {
  user: SwarmAuthUser;
};

export type SwarmUserPersona = {
  id: string;
  label: string;
  archetype: SwarmPersonaArchetype;
  gender: "female" | "male" | "other" | "unspecified";
  age: number;
  occupation: string;
  hobbies: string[];
  personality: string[];
  gameMotivation: string;
  playStyle: string;
  narrativePreference: string;
  frictionSensitivity: string;
  evaluationLens: string;
};

const authSlots: SwarmAuthUser[] = [
  { username: "swarm-a", password: "swarm-password" },
  { username: "swarm-b", password: "swarm-password" },
  { username: "swarm-c", password: "swarm-password" },
];

export const swarmUserPersonas: SwarmUserPersona[] = loadSwarmUserPersonas();

export function personaById(id: string): SwarmUserPersona {
  const persona = swarmUserPersonas.find((item) => item.id === id);
  if (!persona) {
    throw new Error(`Unknown swarm persona: ${id}`);
  }
  return persona;
}

export function selectRandomPersonas(runId: string, count = 3): AssignedSwarmUserPersona[] {
  const explicitIds = process.env.SWARM_PERSONA_IDS?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const selected = explicitIds?.length
    ? explicitIds.map(personaById)
    : seededShuffle(swarmUserPersonas, process.env.SWARM_PERSONA_SEED ?? runId).slice(0, count);

  if (selected.length !== count) {
    throw new Error(`swarm-test requires exactly ${count} personas, got ${selected.length}`);
  }

  return selected.map((persona, index) => ({ ...persona, user: authSlots[index] }));
}

function loadSwarmUserPersonas(): SwarmUserPersona[] {
  const xmlPath = resolvePersonaXmlPath();
  const xml = fs.readFileSync(xmlPath, "utf8");
  const personas = [...xml.matchAll(/<persona\b([^>]*)>([\s\S]*?)<\/persona>/g)].map((match) =>
    parsePersona(match[1], match[2]),
  );
  if (personas.length !== 30) {
    throw new Error(`Expected 30 swarm personas in ${xmlPath}, got ${personas.length}`);
  }
  return personas;
}

function resolvePersonaXmlPath(): string {
  const candidates = [
    path.resolve(process.cwd(), "../tests/e2e/swarm/userPersonas.xml"),
    path.resolve(process.cwd(), "tests/e2e/swarm/userPersonas.xml"),
  ];
  const xmlPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!xmlPath) {
    throw new Error(`Unable to locate userPersonas.xml from cwd ${process.cwd()}`);
  }
  return xmlPath;
}

function parsePersona(attributeText: string, body: string): SwarmUserPersona {
  const id = requiredAttribute(attributeText, "id");
  return {
    id,
    label: requiredAttribute(attributeText, "label"),
    archetype: requiredAttribute(attributeText, "archetype") as SwarmPersonaArchetype,
    gender: requiredText(body, "gender") as SwarmUserPersona["gender"],
    age: Number(requiredText(body, "age")),
    occupation: requiredText(body, "occupation"),
    hobbies: listText(body, "hobbies", "hobby"),
    personality: listText(body, "personality", "trait"),
    gameMotivation: requiredText(body, "gameMotivation"),
    playStyle: requiredText(body, "playStyle"),
    narrativePreference: requiredText(body, "narrativePreference"),
    frictionSensitivity: requiredText(body, "frictionSensitivity"),
    evaluationLens: requiredText(body, "evaluationLens"),
  };
}

function requiredAttribute(attributeText: string, name: string): string {
  const match = new RegExp(`${name}="([^"]+)"`).exec(attributeText);
  if (!match) {
    throw new Error(`Missing persona attribute: ${name}`);
  }
  return decodeXml(match[1]);
}

function requiredText(body: string, tag: string): string {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body);
  if (!match) {
    throw new Error(`Missing persona field: ${tag}`);
  }
  return decodeXml(match[1].trim());
}

function listText(body: string, parentTag: string, itemTag: string): string[] {
  const parent = requiredText(body, parentTag);
  return [...parent.matchAll(new RegExp(`<${itemTag}>([\\s\\S]*?)</${itemTag}>`, "g"))].map((match) =>
    decodeXml(match[1].trim()),
  );
}

function seededShuffle<T>(items: T[], seed: string): T[] {
  const result = [...items];
  let state = hashSeed(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function hashSeed(seed: string): number {
  return [...seed].reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) >>> 0, 0x811c9dc5);
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
