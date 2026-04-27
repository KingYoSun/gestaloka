# ADR-001: Pack catalog visibility

## Status

Accepted

## Decision

- Authenticated player-facing pack catalogs only expose pack/templates that are `visibility: public` and `publish_status: playable`.
- Template metadata overrides pack-level metadata. Missing template metadata inherits from the pack.
- Packs with registry failures are not playable in player-facing catalogs.
- Ops catalog access remains behind the existing Ops admin boundary and may expose hidden packs, diagnostics, and filesystem paths.

## Consequences

- `GET /worlds/packs` and `GET /worlds/playable` are product-visible catalogs, not diagnostics endpoints.
- `GET /ops/world-packs` is the diagnostic catalog for external `PACK_DIR` operation.
- Private, draft, and archived packs may be loaded by the engine, but session bootstrap rejects them as unavailable.
