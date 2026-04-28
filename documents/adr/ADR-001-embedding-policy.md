# ADR-001 Embedding Policy

## Status

Accepted

## Decision

GESTALOKA v2 fixes semantic memory retrieval to the following policy:

- provider: `openai_compatible`
- provider base URL: configured by `OPENAI_COMPAT_EMBEDDING_BASE_URL`, falling back to `OPENAI_COMPAT_BASE_URL`
- provider API key: configured by `OPENAI_COMPAT_EMBEDDING_API_KEY`, falling back to `OPENAI_COMPAT_API_KEY`
- provider model: configured by `OPENAI_COMPAT_EMBEDDING_MODEL`
- embedding dimension: `768`
- dimension request: send `dimensions=768` when `OPENAI_COMPAT_SEND_EMBEDDING_DIMENSIONS=true`
- dimension validation: reject provider responses that do not return exactly `768` values
- retrieval order: `local location first -> same world fallback`
- PostgreSQL index policy: HNSW on `memories.embedding`
- SQLite policy: JSON/vector fallback for lightweight local tests only

## Consequences

- `memories.embedding` remains the canonical semantic retrieval field for v2.
- Existing memories do not require re-embedding for the OpenAI-compatible provider migration because the vector dimension remains unchanged.
- Retrieval and reindex diagnostics must report this policy verbatim.
- Eval and release gate checks may assume local-first retrieval before same-world fallback.
- Future embedding changes require a new ADR and matching test updates.
