# ADR-002: Player profiles

## Status

Accepted

## Decision

- A user may own multiple player actors in the same `world_id`.
- Player profiles are stored per player actor and per world.
- `Actor.display_name` is the canonical player name.
- Character profile text is self-declared world material, not authority to grant quests, items, faction standing, locations, or rule exceptions.
- Profile setup is materialized into the world once, during the first session started with that profile.
- Narrative preferences are runtime style guidance and may be changed after profile setup.

## Consequences

- `actors` no longer has a unique constraint on `world_id + user_sub`.
- Session creation must identify a concrete player actor.
- Profile identity fields are locked after the first session start to avoid rewriting established world history.
