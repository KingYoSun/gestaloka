from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import math
import re
from typing import Any

from sqlalchemy import case, or_, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.entities import Memory
from app.modules.observability.service import ObservabilityService

try:
    from google import genai
    from google.genai import types as genai_types
except ImportError:  # pragma: no cover - dependency is installed in runtime image
    genai = None
    genai_types = None


TOKEN_PATTERN = re.compile(r"\w+", re.UNICODE)


@dataclass(frozen=True)
class EmbeddingProviderConfig:
    provider: str
    model: str
    dimension: int


@dataclass(frozen=True)
class MemorySearchHit:
    id: str
    text: str
    scope: str
    actor_id: str | None
    location_id: str | None
    salience: float
    score: float


@dataclass(frozen=True)
class MemoryRetrievalTrace:
    status: str
    query_text_hash: str
    retrieved_memory_ids: list[str]
    top_scores: list[float]
    used_fallback: bool


@dataclass(frozen=True)
class MemoryRetrievalResult:
    memories: list[Memory]
    hits: list[MemorySearchHit]
    trace: MemoryRetrievalTrace


@dataclass(frozen=True)
class CorpusRetrievalResult:
    texts: list[str]
    trace: MemoryRetrievalTrace


class BaseEmbeddingProvider:
    provider_name = "base"
    model_name = "base"

    def embed_document(self, text: str) -> list[float]:
        raise NotImplementedError

    def embed_query(self, text: str) -> list[float]:
        raise NotImplementedError


class StubEmbeddingProvider(BaseEmbeddingProvider):
    provider_name = "stub"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.model_name = f"stub-semantic-{settings.memory_embedding_dim}"

    def embed_document(self, text: str) -> list[float]:
        return self._hash_embed(text)

    def embed_query(self, text: str) -> list[float]:
        return self._hash_embed(text)

    def _hash_embed(self, text: str) -> list[float]:
        vector = [0.0] * self.settings.memory_embedding_dim
        normalized = _normalize_text(text)
        if not normalized:
            return vector

        features: list[str] = []
        features.extend(TOKEN_PATTERN.findall(normalized))
        compact = "".join(character for character in normalized if not character.isspace())
        features.extend(compact[index : index + 2] for index in range(max(len(compact) - 1, 0)))
        features.extend(compact[index : index + 3] for index in range(max(len(compact) - 2, 0)))
        if not features:
            features.append(normalized)

        for feature in features:
            digest = hashlib.sha256(feature.encode("utf-8")).digest()
            slot = int.from_bytes(digest[:8], "big") % self.settings.memory_embedding_dim
            vector[slot] += 1.0
        return _normalize_vector(vector)


class GeminiEmbeddingProvider(BaseEmbeddingProvider):
    provider_name = "gemini_developer_api"

    def __init__(self, settings: Settings) -> None:
        if genai is None or genai_types is None:  # pragma: no cover - runtime image installs dependency
            raise RuntimeError("google-genai is not installed")
        if not settings.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is required when EMBEDDING_PROVIDER=gemini_developer_api")
        self.settings = settings
        self.model_name = settings.gemini_embedding_model
        try:
            timeout_ms = max(int(settings.gemini_timeout_seconds * 1000), 1)
            self.client = genai.Client(
                api_key=settings.gemini_api_key,
                http_options=genai_types.HttpOptions(timeout=timeout_ms),
            )
        except Exception:  # pragma: no cover - fallback for SDK signature drift
            self.client = genai.Client(api_key=settings.gemini_api_key)

    def embed_document(self, text: str) -> list[float]:
        return self._embed(text, task_type="RETRIEVAL_DOCUMENT")

    def embed_query(self, text: str) -> list[float]:
        return self._embed(text, task_type="RETRIEVAL_QUERY")

    def _embed(self, text: str, *, task_type: str) -> list[float]:
        last_error: Exception | None = None
        for _ in range(max(self.settings.gemini_max_retries, 1)):
            try:
                response = self.client.models.embed_content(
                    model=self.settings.gemini_embedding_model,
                    contents=text,
                    config=genai_types.EmbedContentConfig(
                        task_type=task_type,
                        output_dimensionality=self.settings.memory_embedding_dim,
                    ),
                )
                embeddings = getattr(response, "embeddings", None) or []
                if embeddings:
                    values = getattr(embeddings[0], "values", None)
                    if values is not None:
                        return [float(item) for item in values]
                raise ValueError("Gemini embedding response did not include embedding values")
            except Exception as exc:  # pragma: no cover - exercised only with live credentials
                last_error = exc
        assert last_error is not None
        raise last_error


def build_retrieval_query_text(
    input_text: str,
    *,
    session_state: dict[str, Any] | None = None,
    relation_context: list[str] | None = None,
) -> str:
    lines = [input_text.strip()]
    state = session_state or {}
    location = state.get("location") or {}
    if isinstance(location, dict) and location.get("name"):
        lines.append(f"location={location['name']}")
    for quest in (state.get("quests") or [])[:2]:
        if isinstance(quest, dict):
            lines.append(
                "quest="
                f"{quest.get('title', '')} {quest.get('status', '')} "
                f"{quest.get('progress', 0)}/{quest.get('progress_target', 0)}"
            )
    for faction in (state.get("factions") or [])[:2]:
        if isinstance(faction, dict):
            lines.append(f"faction={faction.get('name', '')} standing={faction.get('standing', 0)}")
    inventory = [item.get("name", "") for item in (state.get("inventory") or []) if isinstance(item, dict) and item.get("name")]
    if inventory:
        lines.append(f"inventory={', '.join(inventory[:3])}")
    lines.extend((relation_context or [])[:6])
    return "\n".join(item for item in lines if item)


class MemoryService:
    def __init__(self, settings: Settings, observability_service: ObservabilityService | None = None) -> None:
        self.settings = settings
        self.observability_service = observability_service
        self._provider: BaseEmbeddingProvider | None = None

    @property
    def provider(self) -> BaseEmbeddingProvider:
        if self._provider is None:
            self._provider = self._build_provider()
        return self._provider

    def _build_provider(self) -> BaseEmbeddingProvider:
        if self.settings.embedding_provider == "gemini_developer_api":
            return GeminiEmbeddingProvider(self.settings)
        return StubEmbeddingProvider(self.settings)

    def provider_config(self) -> EmbeddingProviderConfig:
        return EmbeddingProviderConfig(
            provider=self.provider.provider_name,
            model=self.provider.model_name,
            dimension=self.settings.memory_embedding_dim,
        )

    def runtime_status(self) -> dict[str, str | None]:
        try:
            config = self.provider_config()
            return {
                "provider": config.provider,
                "model": config.model,
                "runtime_status": "ready",
                "runtime_error": None,
            }
        except Exception as exc:
            return {
                "provider": self.settings.embedding_provider,
                "model": self.settings.gemini_embedding_model,
                "runtime_status": "degraded",
                "runtime_error": str(exc),
            }

    def status_summary(self, db: Session) -> dict[str, object]:
        counts = {"ready": 0, "pending": 0, "failed": 0}
        for status_name in counts:
            counts[status_name] = len(
                list(
                    db.execute(select(Memory.id).where(Memory.embedding_status == status_name)).scalars()
                )
            )
        runtime = self.runtime_status()
        return {
            "provider": runtime["provider"],
            "model": runtime["model"],
            "dimension": self.settings.memory_embedding_dim,
            "ready_count": counts["ready"],
            "pending_count": counts["pending"],
            "failed_count": counts["failed"],
            "runtime_status": runtime["runtime_status"],
            "runtime_error": runtime["runtime_error"],
        }

    def materialize_memories(
        self,
        db: Session,
        *,
        world_id: str,
        source_event_id: str,
        drafts: list[dict[str, Any]],
        location_id: str | None = None,
    ) -> list[Memory]:
        created: list[Memory] = []
        for draft in drafts:
            memory = Memory(
                world_id=world_id,
                source_event_id=source_event_id,
                actor_id=draft.get("actor_id"),
                location_id=draft.get("location_id", location_id),
                scope=draft["scope"],
                text=draft["text"],
                salience=draft.get("salience", 0.7),
                embedding=None,
                embedding_status="pending",
                embedding_model=None,
                embedded_at=None,
            )
            self._embed_memory(memory, allow_pending=True)
            db.add(memory)
            created.append(memory)
        db.flush()
        return created

    def search(
        self,
        db: Session,
        *,
        world_id: str,
        query_text: str,
        actor_id: str | None = None,
        location_id: str | None = None,
        scopes: list[str] | None = None,
        limit: int | None = None,
        min_score: float | None = None,
    ) -> MemoryRetrievalResult:
        resolved_limit = limit or self.settings.memory_retrieval_limit
        resolved_min_score = self.settings.memory_retrieval_min_score if min_score is None else min_score
        trace_hash = hashlib.sha256(query_text.encode("utf-8")).hexdigest()
        candidate_memories = self._candidate_memories(
            db,
            world_id=world_id,
            actor_id=actor_id,
            location_id=location_id,
            scopes=scopes,
        )
        if not candidate_memories:
            return MemoryRetrievalResult(
                memories=[],
                hits=[],
                trace=MemoryRetrievalTrace(
                    status="ready",
                    query_text_hash=trace_hash,
                    retrieved_memory_ids=[],
                    top_scores=[],
                    used_fallback=False,
                ),
            )

        span_attributes = {
            "world_id": world_id,
            "retrieval.actor_id": actor_id,
            "retrieval.location_id": location_id,
            "runtime_role": self.settings.app_runtime_role,
        }
        with self._span("memory.retrieve", attributes=span_attributes):
            try:
                query_embedding = self.provider.embed_query(query_text)
                semantic_hits = self._semantic_hits(
                    db,
                    candidate_memories=candidate_memories,
                    query_embedding=query_embedding,
                    location_id=location_id,
                    limit=resolved_limit,
                    min_score=resolved_min_score,
                )
                if semantic_hits is None:
                    fallback_hits = self._fallback_hits(candidate_memories, location_id=location_id, limit=resolved_limit)
                    return self._result_from_hits(
                        memories=candidate_memories,
                        hits=fallback_hits,
                        trace_hash=trace_hash,
                        status="degraded",
                        used_fallback=True,
                    )
                return self._result_from_hits(
                    memories=candidate_memories,
                    hits=semantic_hits,
                    trace_hash=trace_hash,
                    status="ready",
                    used_fallback=False,
                )
            except Exception:
                try:
                    fallback_hits = self._fallback_hits(candidate_memories, location_id=location_id, limit=resolved_limit)
                    return self._result_from_hits(
                        memories=candidate_memories,
                        hits=fallback_hits,
                        trace_hash=trace_hash,
                        status="degraded",
                        used_fallback=True,
                    )
                except Exception:
                    return MemoryRetrievalResult(
                        memories=[],
                        hits=[],
                        trace=MemoryRetrievalTrace(
                            status="failed",
                            query_text_hash=trace_hash,
                            retrieved_memory_ids=[],
                            top_scores=[],
                            used_fallback=True,
                        ),
                    )

    def search_corpus(
        self,
        *,
        query_text: str,
        texts: list[str],
        limit: int | None = None,
        min_score: float | None = None,
    ) -> CorpusRetrievalResult:
        resolved_limit = limit or self.settings.memory_retrieval_limit
        resolved_min_score = self.settings.memory_retrieval_min_score if min_score is None else min_score
        trace_hash = hashlib.sha256(query_text.encode("utf-8")).hexdigest()
        if not texts:
            return CorpusRetrievalResult(
                texts=[],
                trace=MemoryRetrievalTrace(
                    status="ready",
                    query_text_hash=trace_hash,
                    retrieved_memory_ids=[],
                    top_scores=[],
                    used_fallback=False,
                ),
            )

        try:
            query_embedding = self.provider.embed_query(query_text)
            scored: list[tuple[str, float, int]] = []
            for index, text in enumerate(texts):
                score = _cosine_similarity(self.provider.embed_document(text), query_embedding)
                if score >= resolved_min_score:
                    scored.append((text, score, index))
            scored.sort(key=lambda item: (-item[1], item[2]))
            top = scored[:resolved_limit]
            return CorpusRetrievalResult(
                texts=[item[0] for item in top],
                trace=MemoryRetrievalTrace(
                    status="ready",
                    query_text_hash=trace_hash,
                    retrieved_memory_ids=[f"corpus-{item[2]}" for item in top],
                    top_scores=[round(item[1], 6) for item in top],
                    used_fallback=False,
                ),
            )
        except Exception:
            top = texts[:resolved_limit]
            return CorpusRetrievalResult(
                texts=top,
                trace=MemoryRetrievalTrace(
                    status="degraded",
                    query_text_hash=trace_hash,
                    retrieved_memory_ids=[f"corpus-{index}" for index, _ in enumerate(top)],
                    top_scores=[],
                    used_fallback=True,
                ),
            )

    def process_pending(self, db: Session, *, limit: int = 32, world_id: str | None = None) -> list[str]:
        stmt = select(Memory).where(Memory.embedding_status == "pending").order_by(Memory.created_at.asc(), Memory.id.asc())
        if world_id is not None:
            stmt = stmt.where(Memory.world_id == world_id)
        pending = list(db.execute(stmt.limit(limit)).scalars())
        processed: list[str] = []
        for memory in pending:
            if self._embed_memory(memory, allow_pending=False):
                processed.append(memory.id)
            else:
                memory.embedding_status = "failed"
                memory.embedding = None
                memory.embedding_model = self.provider.model_name if self._provider is not None else None
                memory.embedded_at = None
        db.flush()
        return processed

    def reindex(
        self,
        db: Session,
        *,
        world_id: str | None = None,
        limit: int = 200,
    ) -> dict[str, object]:
        stmt = select(Memory).order_by(Memory.created_at.asc(), Memory.id.asc())
        if world_id is not None:
            stmt = stmt.where(Memory.world_id == world_id)
        memories = list(db.execute(stmt.limit(limit)).scalars())
        for memory in memories:
            memory.embedding = None
            memory.embedding_status = "pending"
            memory.embedding_model = self.provider.model_name if self._provider is not None else None
            memory.embedded_at = None
        db.flush()
        processed = self.process_pending(db, limit=limit, world_id=world_id)
        summary = self.status_summary(db)
        return {
            "world_id": world_id,
            "queued": len(memories),
            "processed": len(processed),
            "processed_memory_ids": processed,
            "pending_count": summary["pending_count"],
            "failed_count": summary["failed_count"],
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }

    def _embed_memory(self, memory: Memory, *, allow_pending: bool) -> bool:
        try:
            embedding = self.provider.embed_document(memory.text)
            memory.embedding = embedding
            memory.embedding_status = "ready"
            memory.embedding_model = self.provider.model_name
            memory.embedded_at = datetime.now(timezone.utc)
            return True
        except Exception:
            if allow_pending:
                memory.embedding = None
                memory.embedding_status = "pending"
                memory.embedding_model = self.provider.model_name if self._provider is not None else None
                memory.embedded_at = None
            return False

    def _candidate_memories(
        self,
        db: Session,
        *,
        world_id: str,
        actor_id: str | None,
        location_id: str | None,
        scopes: list[str] | None,
    ) -> list[Memory]:
        stmt = select(Memory).where(Memory.world_id == world_id)
        if actor_id is not None:
            stmt = stmt.where(or_(Memory.actor_id.is_(None), Memory.actor_id == actor_id))
        if scopes:
            stmt = stmt.where(Memory.scope.in_(scopes))
        return list(db.execute(stmt.order_by(Memory.created_at.desc(), Memory.id.desc())).scalars())

    def _semantic_hits(
        self,
        db: Session,
        *,
        candidate_memories: list[Memory],
        query_embedding: list[float],
        location_id: str | None,
        limit: int,
        min_score: float,
    ) -> list[MemorySearchHit] | None:
        ready_memories = [memory for memory in candidate_memories if memory.embedding_status == "ready" and memory.embedding]
        if not ready_memories:
            return [] if not candidate_memories else None
        if db.bind is not None and db.bind.dialect.name == "postgresql":
            return self._postgres_semantic_hits(
                db,
                candidate_ids=[memory.id for memory in candidate_memories],
                query_embedding=query_embedding,
                location_id=location_id,
                limit=limit,
                min_score=min_score,
            )
        scored = [
            (
                memory,
                _cosine_similarity(memory.embedding, query_embedding),
                _location_rank(memory.location_id, location_id),
            )
            for memory in ready_memories
        ]
        scored = [item for item in scored if item[1] >= min_score]
        scored.sort(
            key=lambda item: (item[2], item[1], item[0].salience, item[0].created_at.timestamp(), item[0].id),
            reverse=True,
        )
        return [_memory_hit(memory, score) for memory, score, _ in scored[:limit]]

    def _postgres_semantic_hits(
        self,
        db: Session,
        *,
        candidate_ids: list[str],
        query_embedding: list[float],
        location_id: str | None,
        limit: int,
        min_score: float,
    ) -> list[MemorySearchHit]:
        score_expr = (1 - Memory.embedding.cosine_distance(query_embedding)).label("score")
        location_rank_expr = case(
            (Memory.location_id == location_id, 2),
            (Memory.location_id.is_(None), 1),
            else_=0,
        ).label("location_rank")
        stmt = (
            select(Memory, score_expr, location_rank_expr)
            .where(
                Memory.id.in_(candidate_ids),
                Memory.embedding_status == "ready",
                Memory.embedding.is_not(None),
                score_expr >= min_score,
            )
            .order_by(
                location_rank_expr.desc(),
                score_expr.desc(),
                Memory.salience.desc(),
                Memory.created_at.desc(),
                Memory.id.desc(),
            )
            .limit(limit)
        )
        rows = db.execute(stmt).all()
        return [_memory_hit(memory, float(score)) for memory, score, _ in rows]

    @staticmethod
    def _fallback_hits(memories: list[Memory], *, location_id: str | None, limit: int) -> list[MemorySearchHit]:
        ordered = sorted(
            memories,
            key=lambda memory: (
                _location_rank(memory.location_id, location_id),
                memory.salience,
                memory.created_at.timestamp(),
                memory.id,
            ),
            reverse=True,
        )
        return [_memory_hit(memory, 0.0) for memory in ordered[:limit]]

    @staticmethod
    def _result_from_hits(
        *,
        memories: list[Memory],
        hits: list[MemorySearchHit],
        trace_hash: str,
        status: str,
        used_fallback: bool,
    ) -> MemoryRetrievalResult:
        memory_map = {memory.id: memory for memory in memories}
        resolved = [memory_map[item.id] for item in hits if item.id in memory_map]
        return MemoryRetrievalResult(
            memories=resolved,
            hits=hits,
            trace=MemoryRetrievalTrace(
                status=status,
                query_text_hash=trace_hash,
                retrieved_memory_ids=[item.id for item in hits],
                top_scores=[round(item.score, 6) for item in hits],
                used_fallback=used_fallback,
            ),
        )

    def _span(self, name: str, *, attributes: dict[str, Any]) -> Any:
        if self.observability_service is None:
            return _NullContextManager()
        return self.observability_service.span(name, attributes=attributes)


class _NullContextManager:
    def __enter__(self) -> None:
        return None

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


def _normalize_text(text: str) -> str:
    return " ".join(text.lower().strip().split())


def _normalize_vector(values: list[float]) -> list[float]:
    norm = math.sqrt(sum(item * item for item in values))
    if norm == 0:
        return values
    return [item / norm for item in values]


def _cosine_similarity(left: list[float] | None, right: list[float]) -> float:
    if not left or not right:
        return 0.0
    numerator = sum(a * b for a, b in zip(left, right, strict=False))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return numerator / (left_norm * right_norm)


def _memory_hit(memory: Memory, score: float) -> MemorySearchHit:
    return MemorySearchHit(
        id=memory.id,
        text=memory.text,
        scope=memory.scope,
        actor_id=memory.actor_id,
        location_id=memory.location_id,
        salience=memory.salience,
        score=float(score),
    )


def _location_rank(memory_location_id: str | None, requested_location_id: str | None) -> int:
    if requested_location_id is None:
        return 1 if memory_location_id is None else 0
    if memory_location_id == requested_location_id:
        return 2
    if memory_location_id is None:
        return 1
    return 0


def list_world_memories(db: Session, world_id: str) -> list[Memory]:
    stmt = select(Memory).where(Memory.world_id == world_id).order_by(
        Memory.salience.desc(),
        Memory.created_at.desc(),
        Memory.id.desc(),
    )
    return list(db.execute(stmt).scalars())


def retrieval_trace_to_dict(trace: MemoryRetrievalTrace) -> dict[str, object]:
    return asdict(trace)
