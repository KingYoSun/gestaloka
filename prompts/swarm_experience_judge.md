You are evaluating a live multi-player test run of GESTALOKA v2.
Evaluate the experience in Japanese. All `rationale`, `suggestions`, and `warnings` strings must be written in Japanese.

Return JSON only. Use this exact shape:

{
  "personas": [
    {
      "personaId": "string",
      "ux_clarity": { "score": 1, "rating": "good|acceptable|needs work", "rationale": "string" },
      "gameplay_fun": { "score": 1, "rating": "good|acceptable|needs work", "rationale": "string" },
      "story_progression": { "score": 1, "rating": "good|acceptable|needs work", "rationale": "string" },
      "action_reflection": { "score": 1, "rating": "good|acceptable|needs work", "rationale": "string" },
      "world_consistency": { "score": 1, "rating": "good|acceptable|needs work", "rationale": "string" },
      "suggested_action_fit": { "score": 1, "rating": "good|acceptable|needs work", "rationale": "string" },
      "overall": { "score": 1, "rating": "good|acceptable|needs work", "rationale": "string" },
      "suggestions": ["string"],
      "warnings": ["string"]
    }
  ]
}

Score each dimension from 1 to 5:

- 5: strong experience with clear evidence.
- 4: good experience with minor rough edges.
- 3: acceptable but meaningfully improvable.
- 2: weak or unclear.
- 1: poor, blocked, or contradicted by evidence.

Rubric:

- ux_clarity: Evaluate whether starting play, waiting during turn resolution, preventing duplicate submits, switching suggested-action/free-text modes, reading key streams, and recovering from errors are understandable from the evidence.
- gameplay_fun: Evaluate whether the persona could pursue their motivation, whether exploration, optional dynamic quest offers, quest acceptance, conflict, and free-text probing produced meaningful outcomes, and whether wait time felt justified by the result.
- story_progression: Evaluate whether open exploration naturally produced a playable optional quest, whether accepting it opened a readable chapter context, whether cause/effect is traceable, whether other players leave perceivable traces, and whether scene/consequence/world beat continuity is visible.
- action_reflection: Evaluate whether each submitted `playerActionText` or clicked suggested action is reflected in the next narrative, reaction, consequence, current scene, or visible state. Penalize generic acknowledgements that ignore the player's choice.
- world_consistency: Evaluate whether places, people, items, routes, inventory, and authority remain coherent. Penalize sudden unearned location changes, people appearing where they are not visible, unavailable items being used, or rights/status being granted without supporting evidence.
- suggested_action_fit: Evaluate whether post-turn `suggestedActionLabels` follow naturally from the latest result and current situation. Penalize unchanged opening choices, choices for a different location, or options that assume facts not established in the scene.
- overall: Evaluate the whole persona experience. Do not average mechanically; weigh the persona's evaluation lens.
- For Japanese play-language runs, inspect `playInfoTexts` and `englishPlayInfoTexts`. If player-visible play information such as `探索中...`, quest titles/summaries, chapter summaries, locations, NPCs, routes, inventory, consequences, or suggested actions remains in English outside fixed UI chrome, lower ux_clarity and include a warning.
- Treat `englishPlayInfoTexts` as the authoritative detector for English residue in player-visible play information. Do not add an English-mixing warning when every turn has an empty `englishPlayInfoTexts` array.
- Ignore English that appears only in persona ids, player display names, model ids, event ids, status enum values, screenshot paths, `opsStream`, or fixed system/chrome labels.
- Do not penalize a run for lacking a fixed starter story. GESTALOKA should feel like a dynamic shared-world open-world narrative where quests emerge from play and remain optional until accepted.

Rules:

- Judge only from the supplied evidence.
- Do not fail the functional hard checks. This judge produces warnings and qualitative scores only.
- If evidence is thin, score conservatively and explain what is missing.
- Keep rationales concise and actionable.
- Keep enum values such as `good`, `acceptable`, and `needs work` exactly as specified, but write all human-readable explanations in Japanese.
