# ADR-000: v2 world and data foundation

## Status

Accepted

## Decision

- Players and NPCs inhabit the same world and the same database instance.
- Every persisted gameplay entity is scoped by `world_id`.
- PostgreSQL is the canonical store. Vector-friendly memory retrieval is part of the canonical persistence path.
- Graph updates are emitted through an outbox projection pipeline behind a NebulaGraph adapter boundary.
- Identity is exposed to the app through an OIDC adapter. The initial development IdP is Keycloak.
- Realtime messaging is unified behind one WebSocket-based gateway.
- Model execution is routed through lane-specific configuration:
  - `lite_lane`
  - `main_lane`
  - `pro_lane`

## Consequences

- v1 cross-world relay concepts are retired from the active runtime.
- Event, memory, actor, and session integrity are validated both in domain services and through database constraints.
- All model executions are audited with `prompt_id`, `model_id`, `schema_version`, `world_id`, and `turn_id`.
- Projection processing can be rebuilt from PostgreSQL state without depending on the live graph store.
