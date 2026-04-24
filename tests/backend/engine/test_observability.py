from __future__ import annotations


def engine_session_payload() -> dict[str, str]:
    return {
        "world_id": "world-alpha",
        "pack_id": "ember_harbor",
        "world_template_id": "ember_harbor",
        "world_name": "Ember Harbor",
    }


def test_turn_execution_updates_observability_traces_and_metrics(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()

    turn_response = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_text": "広場で灯をともす"},
        headers=auth_headers,
    )
    assert turn_response.status_code == 200
    turn_payload = turn_response.json()

    summary_response = client.get("/ops/observability/summary", headers=auth_headers)
    assert summary_response.status_code == 200
    summary_payload = summary_response.json()
    assert {"primary", "canary", "recent_traces", "metrics"} <= set(summary_payload)

    traces = container.observability_service.recent_trace_attributes(limit=40)
    llm_trace = next(item for item in traces if item["name"] == "llm.attempt")
    turn_trace = next(item for item in traces if item["name"] == "turn.resolve")

    assert {"prompt_id", "model_id", "lane", "runtime_role"} <= set(llm_trace["attributes"])
    assert llm_trace["attributes"]["world_id"] == session_payload["world_id"]
    assert {"world_id", "session_id", "turn_id", "graph_context_status", "runtime_role"} <= set(
        turn_trace["attributes"]
    )
    assert turn_trace["attributes"]["session_id"] == session_payload["session_id"]
    assert turn_trace["attributes"]["turn_id"] == turn_payload["turn_id"]

    metrics = container.observability_service.metric_snapshot()
    assert {
        "projection_lag_seconds",
        "outbox_pending_count",
        "outbox_failed_count",
        "llm_schema_valid_rate",
        "llm_fallback_rate",
        "release_gate_verdict",
    } <= set(metrics)
