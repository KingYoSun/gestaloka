# ADR-001 Embedding Policy

## Status

Accepted

## Decision

GESTALOKA v2 fixes semantic memory retrieval to the following policy:

- provider model: `gemini-embedding-001`
- embedding dimension: `768`
- document task type: `RETRIEVAL_DOCUMENT`
- query task type: `RETRIEVAL_QUERY`
- retrieval order: `local location first -> same world fallback`
- PostgreSQL index policy: HNSW on `memories.embedding`
- SQLite policy: JSON/vector fallback for lightweight local tests only

## Consequences

- `memories.embedding` remains the canonical semantic retrieval field for v2.
- Retrieval and reindex diagnostics must report this policy verbatim.
- Eval and release gate checks may assume local-first retrieval before same-world fallback.
- Future embedding changes require a new ADR and matching test updates.
