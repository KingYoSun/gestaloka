# GESTALOKA v1 archive

This directory holds the frozen v1 implementation and documents. Nothing under `legacy/v1/` is imported by the active v2 runtime.

## Archived assets

- `backend/` original API, workers, models, and tests
- `frontend/` original client and generated API bindings
- `documents/` original design and implementation documentation
- `keycloak/` original identity provider import scripts
- `neo4j/` original graph database bootstrap assets
- `scripts/` original repository scripts
- `tests/` original root-level tests
- `README.md`, `Makefile`, `docker-compose.yml`, `.env.example` v1 runtime and operator entrypoints

## Archive rules

- Treat this directory as read-only historical reference.
- Do not import Python or TypeScript modules from here into v2.
- Do not connect v2 services to v1 data or operational settings.
