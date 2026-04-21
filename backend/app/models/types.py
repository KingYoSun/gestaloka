from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy import JSON
from sqlalchemy.types import TypeDecorator

try:
    from pgvector.sqlalchemy import Vector
except ImportError:  # pragma: no cover - dependency is available in runtime image
    Vector = None


class EmbeddingType(TypeDecorator[list[float]]):
    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):  # type: ignore[override]
        if dialect.name == "postgresql" and Vector is not None:
            return dialect.type_descriptor(Vector(8))
        return dialect.type_descriptor(JSON())

    def process_bind_param(self, value: Sequence[float] | None, dialect) -> Any:  # type: ignore[override]
        if value is None:
            return None
        return list(value)

    def process_result_value(self, value: Any, dialect) -> list[float] | None:  # type: ignore[override]
        if value is None:
            return None
        return list(value)
