# swarm-test report 2026-04-30T01-24-18-460Z

- created_at: 2026-04-30T01:28:34.513Z
- world_id: gestaloka_reference

## Hard Checks

- persona_profile_separation: fail
- runtime_privacy_leak_free: fail
- all_turns_return_event_ids: pass
- all_turn_events_same_world: pass
- canonical_sequence_unique: pass
- shared_impact_visible: fail
- resource_conflict_recorded: pass
- world_broadcast_or_constraint_visible: pass

## Personas

- novel-lover: gender=female, age=34, occupation=editor, hobbies=novels, tabletop RPGs, character analysis, personality=empathetic, observant, values foreshadowing and afterglow
- mmo-gamer: gender=male, age=29, occupation=sales, hobbies=MMOs, raid progression, build optimization, personality=goal-oriented, efficiency-minded, enjoys competition
- it-engineer: gender=unspecified, age=41, occupation=software engineer, hobbies=technical verification, simulation games, log analysis, personality=analytical, careful, causality-focused

## Derived Player Profiles

- novel-lover: Mio Archive Steward; gender=female; playLanguage=en
- mmo-gamer: Kaito Route Expediter; gender=male; playLanguage=en
- it-engineer: Sena Causality Auditor; gender=unspecified; playLanguage=en

## Persona Decisions

- novel-lover: shared-impact; choice; progress; reason=This persona values emotionally meaningful help that can become shared memory.
- novel-lover: resource-conflict; choice; progress; reason=This persona values emotionally meaningful help that can become shared memory.
- mmo-gamer: resource-conflict; choice; progress; reason=This persona pressure-tests progress paths and shared-resource contention.
- it-engineer: world-event; free_text; I compare the current gate reports with what travelers are saying and ask which recent action changed the local situation.; reason=This persona joins late and probes whether public world events have a traceable cause.

## Persona Experience Evaluation

- novel-lover: needs work; The helping action did not surface in the shared-world context probe.; evidence=0d429348-d1c1-45c9-bf14-487de94f3a3e | ops shared-world trace
- mmo-gamer: good; Concurrent pressure produced a recorded resource constraint.; evidence=e55f1972-30e4-45e2-a7ad-81f00c76cd6b | event payload resource_constraints scan
- it-engineer: good; Late join and follow-up exposed a world event or broadcast constraint.; evidence=72e16138-ef47-43f1-a2b9-0e88d3cd90ab | session state broadcast constraint scan

