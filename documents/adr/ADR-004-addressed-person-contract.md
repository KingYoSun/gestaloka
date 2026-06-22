# ADR-004: addressed person contract for public turns

## Status

Accepted

## Context

Public AI GM turns can mention people in several ways. A person may be physically present in the scene, merely mentioned in rumor or memory, or directly targeted by the player's action. Previously the public turn contract exposed `present_people` and actor claims with `role=present` or `role=mentioned`, but did not distinguish the literal person the player tried to address.

This allowed a consistency failure: when the player addressed a real NPC who was not at the canonical current location, the AI GM could silently substitute a different visible NPC. The substituted NPC was valid as `present`, so the deterministic harness had no rejected claim to repair or audit.

## Decision

Public GM turn payloads include `addressed_people`, a list of person names that the exact `player_action_text` tries to address, ask, meet, visit, call to, or otherwise contact. Actor public claims may use `role=addressed`.

The roles are interpreted as follows:

- `present`: the person is physically present in the resolved scene.
- `addressed`: the person is the literal contact target of the player's action, whether or not they are present.
- `mentioned`: the person is only referenced through rumor, memory, background, or indirect narration.

The AI GM judges whether a name is addressed or merely mentioned from public context and the exact player text. Deterministic code does not infer contact intent from language markers. Deterministic code only validates the resulting public claims against canonical state.

When an addressed person is a real NPC but is not at the canonical resolved location, the consistency harness rejects silent substitution with `reason=addressed_absent`. Repair must resolve at the current location, keep the absent person out of `present_people`, and state in narrative that the addressed person is not here or must be reached elsewhere. If repair still contradicts canonical state, deterministic fallback resolves the turn in place and names the person as absent.

The canonical source for NPC location is PostgreSQL (`actors.current_location_id`). Graph stores are projections rebuilt from PostgreSQL and are not required by synchronous turn validation.

## Consequences

- Non-present addressed NPCs are handled consistently instead of being silently replaced by visible NPCs.
- Rumor and memory references remain valid when marked `mentioned`.
- Successful turns can audit `addressed_absent` interventions even when final `rejected_claims` are empty after repair or fallback.
- The public contract changes without restoring hidden action metadata or legacy `/turns` payloads.
