from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock
from time import perf_counter
from typing import Any

import httpx
from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.prometheus import PrometheusMetricReader
from opentelemetry.metrics import Observation
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import Status, StatusCode
from prometheus_client import start_http_server
from sqlalchemy import event
from sqlalchemy.engine import Engine

from app.core.config import Settings


@dataclass(frozen=True)
class CanaryProbeResult:
    status: str
    url: str | None
    http_status: int | None
    detail: str | None
    graph_runtime_status: str | None = None
    release_gate_verdict: str | None = None
    projection_lag_seconds: float | None = None
    outbox_pending_count: int | None = None
    outbox_failed_count: int | None = None
    llm_schema_valid_rate: float | None = None
    llm_fallback_rate: float | None = None


class ObservabilityService:
    _instrumented_engines: set[int] = set()
    _metrics_servers: set[tuple[str, int]] = set()

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = Lock()
        self._metric_state: dict[str, float] = {
            "projection_lag_seconds": 0.0,
            "outbox_pending_count": 0.0,
            "outbox_failed_count": 0.0,
            "llm_schema_valid_rate": 0.0,
            "llm_fallback_rate": 0.0,
            "release_gate_verdict": 0.0,
        }
        self._resource = Resource.create(
            {
                "service.name": settings.otel_service_name,
                "deployment.environment": settings.app_env,
                "gestaloka.runtime_role": settings.app_runtime_role,
            }
        )
        self._span_exporter = InMemorySpanExporter()
        self.tracer_provider = TracerProvider(resource=self._resource)
        self.tracer_provider.add_span_processor(SimpleSpanProcessor(self._span_exporter))

        if settings.otel_exporter_otlp_endpoint:
            endpoint = settings.otel_exporter_otlp_endpoint.rstrip("/")
            self.tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces")))

        self.tracer = self.tracer_provider.get_tracer("gestaloka.observability")

        metric_readers = []
        self.metric_reader: PrometheusMetricReader | None = None
        if settings.otel_metrics_port > 0:
            self.metric_reader = PrometheusMetricReader()
            metric_readers.append(self.metric_reader)

        self.meter_provider = MeterProvider(resource=self._resource, metric_readers=metric_readers)
        self.meter = self.meter_provider.get_meter("gestaloka.observability")
        self.turn_resolution_duration = self.meter.create_histogram("turn_resolution_duration", unit="s")
        self.llm_attempts = self.meter.create_counter("llm_attempt_count")
        self.llm_schema_valid = self.meter.create_counter("llm_schema_valid_count")
        self.llm_fallbacks = self.meter.create_counter("llm_fallback_count")
        self.release_gate_checks = self.meter.create_counter("release_gate_check_count")

        for name in (
            "projection_lag_seconds",
            "outbox_pending_count",
            "outbox_failed_count",
            "llm_schema_valid_rate",
            "llm_fallback_rate",
            "release_gate_verdict",
        ):
            self.meter.create_observable_gauge(name, callbacks=[self._make_observer(name)])

        if settings.otel_metrics_port > 0:
            key = (settings.otel_metrics_host, settings.otel_metrics_port)
            if key not in self._metrics_servers:
                start_http_server(port=settings.otel_metrics_port, addr=settings.otel_metrics_host)
                self._metrics_servers.add(key)

    def _make_observer(self, name: str):
        def observe(options: object) -> list[Observation]:
            del options
            with self._lock:
                value = self._metric_state.get(name, 0.0)
            return [Observation(value)]

        return observe

    def instrument_sqlalchemy(self, engine: Engine) -> None:
        engine_id = id(engine)
        if engine_id in self._instrumented_engines:
            return

        @event.listens_for(engine, "before_cursor_execute")
        def before_cursor_execute(conn, cursor, statement, parameters, context, executemany) -> None:  # type: ignore[no-untyped-def]
            del conn, cursor, parameters, executemany
            span = self.tracer.start_span(
                "sql.query",
                attributes={
                    "db.system": engine.name,
                    "db.statement": statement[:500],
                    "runtime_role": self.settings.app_runtime_role,
                },
            )
            context._otel_span = span

        @event.listens_for(engine, "after_cursor_execute")
        def after_cursor_execute(conn, cursor, statement, parameters, context, executemany) -> None:  # type: ignore[no-untyped-def]
            del conn, statement, parameters, executemany
            span = getattr(context, "_otel_span", None)
            if span is None:
                return
            if cursor.rowcount >= 0:
                span.set_attribute("db.rowcount", cursor.rowcount)
            span.end()

        @event.listens_for(engine, "handle_error")
        def handle_error(exception_context) -> None:  # type: ignore[no-untyped-def]
            execution_context = exception_context.execution_context
            if execution_context is None:
                return
            span = getattr(execution_context, "_otel_span", None)
            if span is None:
                return
            span.record_exception(exception_context.original_exception)
            span.set_status(Status(StatusCode.ERROR))
            span.end()

        self._instrumented_engines.add(engine_id)

    @contextmanager
    def span(self, name: str, *, attributes: dict[str, Any] | None = None) -> Iterator[Any]:
        with self.tracer.start_as_current_span(name) as span:
            for key, value in (attributes or {}).items():
                if value is not None:
                    span.set_attribute(key, value)
            yield span

    def trace_http_request(self, method: str, path: str, status_code: int, duration_seconds: float) -> None:
        with self.span(
            "http.request",
            attributes={
                "http.method": method,
                "http.route": path,
                "http.status_code": status_code,
                "runtime_role": self.settings.app_runtime_role,
            },
        ):
            pass
        self.turn_resolution_duration.record(duration_seconds, {"http.route": path, "runtime_role": self.settings.app_runtime_role})

    def trace_websocket_session(
        self,
        *,
        session_id: str,
        world_id: str | None,
        close_code: int | None,
        outcome: str,
    ) -> None:
        with self.span(
            "websocket.session",
            attributes={
                "session_id": session_id,
                "world_id": world_id,
                "websocket.close_code": close_code,
                "websocket.outcome": outcome,
                "runtime_role": self.settings.app_runtime_role,
            },
        ):
            pass

    def record_turn_resolution(
        self,
        *,
        duration_seconds: float,
        world_id: str,
        session_id: str,
        turn_id: str,
        final_lane: str,
        graph_context_status: str,
    ) -> None:
        with self.span(
            "turn.resolve",
            attributes={
                "world_id": world_id,
                "session_id": session_id,
                "turn_id": turn_id,
                "lane": final_lane,
                "graph_context_status": graph_context_status,
                "runtime_role": self.settings.app_runtime_role,
            },
        ):
            pass
        self.turn_resolution_duration.record(
            duration_seconds,
            {
                "world_id": world_id,
                "session_id": session_id,
                "turn_id": turn_id,
                "lane": final_lane,
                "graph_context_status": graph_context_status,
                "runtime_role": self.settings.app_runtime_role,
            },
        )

    def record_llm_attempt(
        self,
        *,
        world_id: str | None,
        turn_id: str | None,
        prompt_id: str,
        model_id: str,
        lane: str,
        graph_context_status: str,
        schema_valid: bool,
        used_fallback: bool,
    ) -> None:
        attributes = {
            "world_id": world_id or "",
            "turn_id": turn_id or "",
            "prompt_id": prompt_id,
            "model_id": model_id,
            "lane": lane,
            "graph_context_status": graph_context_status,
            "runtime_role": self.settings.app_runtime_role,
        }
        with self.span("llm.attempt", attributes=attributes):
            pass
        self.llm_attempts.add(1, attributes)
        if schema_valid:
            self.llm_schema_valid.add(1, attributes)
        if used_fallback:
            self.llm_fallbacks.add(1, attributes)

    def record_projection_processing(
        self,
        *,
        duration_seconds: float,
        pending_count: int,
        failed_count: int,
        lag_seconds: float,
        processed_count: int,
    ) -> None:
        with self._lock:
            self._metric_state["projection_lag_seconds"] = lag_seconds
            self._metric_state["outbox_pending_count"] = float(pending_count)
            self._metric_state["outbox_failed_count"] = float(failed_count)
        with self.span(
            "projection.process_pending",
            attributes={
                "projection.pending_count": pending_count,
                "projection.failed_count": failed_count,
                "projection.lag_seconds": lag_seconds,
                "projection.processed_count": processed_count,
                "runtime_role": self.settings.app_runtime_role,
            },
        ):
            pass
        self.turn_resolution_duration.record(
            duration_seconds,
            {"operation": "projection.process_pending", "runtime_role": self.settings.app_runtime_role},
        )

    def record_eval_run(
        self,
        *,
        eval_run_id: str,
        dataset_name: str | None,
        trigger_type: str,
        runtime_role: str,
    ) -> None:
        with self.span(
            "eval.run",
            attributes={
                "eval_run_id": eval_run_id,
                "eval.dataset_name": dataset_name,
                "eval.trigger_type": trigger_type,
                "runtime_role": runtime_role,
            },
        ):
            pass

    def record_release_gate(
        self,
        *,
        report_id: str,
        verdict: str,
        blocked_reasons: list[str],
        trigger_type: str,
    ) -> None:
        with self._lock:
            self._metric_state["release_gate_verdict"] = 1.0 if verdict == "passed" else 0.0
        with self.span(
            "release.gate",
            attributes={
                "release_gate_report_id": report_id,
                "release_gate_verdict": verdict,
                "release_gate_blocked_reasons": ",".join(blocked_reasons),
                "release_gate_trigger_type": trigger_type,
                "runtime_role": self.settings.app_runtime_role,
            },
        ):
            pass
        self.release_gate_checks.add(
            1,
            {
                "verdict": verdict,
                "trigger_type": trigger_type,
                "runtime_role": self.settings.app_runtime_role,
            },
        )

    def sync_outbox_metrics(self, *, pending_count: int, failed_count: int, lag_seconds: float) -> None:
        with self._lock:
            self._metric_state["projection_lag_seconds"] = lag_seconds
            self._metric_state["outbox_pending_count"] = float(pending_count)
            self._metric_state["outbox_failed_count"] = float(failed_count)

    def sync_llm_rates(self, *, schema_valid_rate: float, fallback_rate: float) -> None:
        with self._lock:
            self._metric_state["llm_schema_valid_rate"] = schema_valid_rate
            self._metric_state["llm_fallback_rate"] = fallback_rate

    def metric_snapshot(self) -> dict[str, float]:
        with self._lock:
            return dict(self._metric_state)

    def recent_trace_attributes(self, limit: int = 12) -> list[dict[str, object]]:
        spans = self._span_exporter.get_finished_spans()
        recent = spans[-limit:]
        return [
            {
                "name": span.name,
                "attributes": {key: value for key, value in span.attributes.items()},
            }
            for span in recent
        ]

    def probe_canary_health(self) -> CanaryProbeResult:
        if not self.settings.canary_health_url:
            return CanaryProbeResult(status="not_configured", url=None, http_status=None, detail="Canary health URL is unset")

        try:
            response = httpx.get(self.settings.canary_health_url, timeout=2.0)
        except Exception as exc:
            return CanaryProbeResult(
                status="unhealthy",
                url=self.settings.canary_health_url,
                http_status=None,
                detail=str(exc),
            )

        if response.status_code != 200:
            return CanaryProbeResult(
                status="unhealthy",
                url=self.settings.canary_health_url,
                http_status=response.status_code,
                detail=response.text[:200],
            )

        payload = response.json()
        observability = payload.get("observability", {})
        return CanaryProbeResult(
            status="healthy",
            url=self.settings.canary_health_url,
            http_status=response.status_code,
            detail="ok",
            graph_runtime_status=payload.get("projection_runtime", {}).get("graph_runtime_status"),
            release_gate_verdict=payload.get("release_gate", {}).get("verdict"),
            projection_lag_seconds=observability.get("projection_lag_seconds"),
            outbox_pending_count=observability.get("outbox_pending_count"),
            outbox_failed_count=observability.get("outbox_failed_count"),
            llm_schema_valid_rate=observability.get("llm_schema_valid_rate"),
            llm_fallback_rate=observability.get("llm_fallback_rate"),
        )

    @staticmethod
    def now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def timer() -> float:
        return perf_counter()

    @staticmethod
    def elapsed(started_at: float) -> float:
        return perf_counter() - started_at
