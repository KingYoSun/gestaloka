export type SwarmUserPersona = {
  id: "novel-lover" | "mmo-gamer" | "it-engineer";
  label: string;
  user: {
    username: string;
    password: string;
  };
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

export const swarmUserPersonas: SwarmUserPersona[] = [
  {
    id: "novel-lover",
    label: "Persona A: novel lover",
    user: { username: "swarm-a", password: "swarm-password" },
    gender: "female",
    age: 34,
    occupation: "editor",
    hobbies: ["novels", "tabletop RPGs", "character analysis"],
    personality: ["empathetic", "observant", "values foreshadowing and afterglow"],
    gameMotivation: "Wants actions to become rumor, memory, and relationship texture for other players.",
    playStyle: "Helps local figures and chooses emotionally legible stabilizing actions.",
    narrativePreference: "Lyrical, relationship-aware prose with clear echoes of prior acts.",
    frictionSensitivity: "Accepts slower play if the story remembers why it happened.",
    evaluationLens: "Can I feel that my action became part of someone else's story?",
  },
  {
    id: "mmo-gamer",
    label: "Persona B: MMO gamer",
    user: { username: "swarm-b", password: "swarm-password" },
    gender: "male",
    age: 29,
    occupation: "sales",
    hobbies: ["MMOs", "raid progression", "build optimization"],
    personality: ["goal-oriented", "efficiency-minded", "enjoys competition"],
    gameMotivation: "Wants visible progress, fair contention, and readable consequences under pressure.",
    playStyle: "Pushes progress quickly, accepts conflict, and probes shared resources.",
    narrativePreference: "Concise, actionable feedback that still explains world-state changes.",
    frictionSensitivity: "Low tolerance for unexplained blocking or hidden state changes.",
    evaluationLens: "Did contention around the same goal resolve fairly and keep play moving?",
  },
  {
    id: "it-engineer",
    label: "Persona C: IT engineer",
    user: { username: "swarm-c", password: "swarm-password" },
    gender: "unspecified",
    age: 41,
    occupation: "software engineer",
    hobbies: ["technical verification", "simulation games", "log analysis"],
    personality: ["analytical", "careful", "causality-focused"],
    gameMotivation: "Wants to inspect whether world events and memories are causally consistent.",
    playStyle: "Observes first, then asks targeted follow-up questions about public consequences.",
    narrativePreference: "Clear cause and effect, visible continuity, and minimal contradiction.",
    frictionSensitivity: "High tolerance for complex systems, low tolerance for inconsistent records.",
    evaluationLens: "Do broadcasts, memories, timeline sequence, and constraints line up?",
  },
];

export function personaById(id: SwarmUserPersona["id"]): SwarmUserPersona {
  const persona = swarmUserPersonas.find((item) => item.id === id);
  if (!persona) {
    throw new Error(`Unknown swarm persona: ${id}`);
  }
  return persona;
}

