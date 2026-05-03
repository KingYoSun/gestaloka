from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select

from app.api.deps import get_current_ops_user
from app.models.entities import AdminAppUser, AdminPromptOverride, AdminRuntimeConfig, LLMRun, Turn
from app.modules.identity.oidc import UserIdentity
from tests.backend.turn_async_helpers import post_turn_and_wait


def test_admin_overview_is_management_shaped(client, auth_headers):
    response = client.get("/admin/overview", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert {"packs", "projection", "sp", "release"} <= set(payload)
    assert "recent_traces" not in payload
    assert "raw" not in payload
    assert payload["packs"]["pack_count"] >= 1


def test_admin_settings_and_prompt_overrides_persist_without_secrets(client, container, auth_headers):
    settings_response = client.put(
        "/admin/settings/llm",
        headers=auth_headers,
        json={
            "provider": "openai_compatible",
            "base_url_secret_ref": "OPENAI_COMPAT_BASE_URL",
            "api_key_secret_ref": "OPENAI_COMPAT_API_KEY",
            "embedding_provider": "openai_compatible",
            "embedding_base_url_secret_ref": "OPENAI_COMPAT_EMBEDDING_BASE_URL",
            "embedding_api_key_secret_ref": "OPENAI_COMPAT_EMBEDDING_API_KEY",
            "admin_debug_enabled": True,
        },
    )
    lanes_response = client.put(
        "/admin/model-lanes",
        headers=auth_headers,
        json={"model_ids": {"main_lane": "admin-main-model"}},
    )
    prompt_response = client.put(
        "/admin/prompts/council.narrative/override",
        headers=auth_headers,
        json={"enabled": True, "instructions": "Keep admin-managed prompt policy active."},
    )

    assert settings_response.status_code == 200
    assert lanes_response.status_code == 200
    assert prompt_response.status_code == 200

    with container.session_factory() as db:
        runtime_config = db.get(AdminRuntimeConfig, "default")
        prompt_override = db.get(AdminPromptOverride, "council.narrative")

    assert runtime_config.api_key_secret_ref == "OPENAI_COMPAT_API_KEY"
    assert runtime_config.model_ids == {"main_lane": "admin-main-model"}
    assert "sk-" not in runtime_config.api_key_secret_ref
    assert prompt_override.enabled is True
    assert prompt_override.instructions == "Keep admin-managed prompt policy active."


def test_admin_prompts_lists_situation_mapper(client, auth_headers):
    response = client.get("/admin/prompts", headers=auth_headers)

    assert response.status_code == 200
    prompt_ids = {item["prompt_id"] for item in response.json()["items"]}
    assert "council.situation_mapper" in prompt_ids


def test_admin_user_permissions_authorize_ops_when_not_bootstrapped(container):
    settings = container.settings.model_copy(update={"oidc_dev_mode": False, "ops_admin_subs": ""})
    fake_container = SimpleNamespace(settings=settings)
    user = UserIdentity(sub="ops-user", name="Ops User", email="ops@example.test")

    with container.session_factory() as db:
        db.add(AdminAppUser(user_sub="ops-user", email="ops@example.test", display_name="Ops User", role="operator", status="active"))
        db.commit()
        resolved = get_current_ops_user(user=user, container=fake_container, db=db)

    assert resolved.sub == "ops-user"


def test_disabled_admin_user_is_rejected_when_not_bootstrapped(container):
    settings = container.settings.model_copy(update={"oidc_dev_mode": False, "ops_admin_subs": ""})
    fake_container = SimpleNamespace(settings=settings)
    user = UserIdentity(sub="disabled-user", name="Disabled User")

    with container.session_factory() as db:
        db.add(AdminAppUser(user_sub="disabled-user", role="operator", status="disabled"))
        db.commit()
        with pytest.raises(HTTPException) as exc_info:
            get_current_ops_user(user=user, container=fake_container, db=db)

    assert exc_info.value.status_code == 403


def test_admin_pack_and_template_lists_are_available(client, auth_headers):
    packs = client.get("/admin/packs", headers=auth_headers)
    templates = client.get("/admin/world-templates", headers=auth_headers)
    users = client.get("/admin/users", headers=auth_headers)

    assert packs.status_code == 200
    assert templates.status_code == 200
    assert users.status_code == 200
    assert packs.json()["items"][0]["pack_id"] == "gestaloka_reference"
    assert templates.json()["items"][0]["template_id"] == "nexus_foundation"
    assert all("raw" not in item for item in templates.json()["items"])


def test_admin_llm_usage_returns_model_timeline(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json={
            "world_id": "gestaloka_reference",
            "world_name": "GESTALOKA: Nexus Foundation",
            "player_display_name": "Demo Player",
        },
        headers=auth_headers,
    )
    assert session_response.status_code == 200
    post_turn_and_wait(
        client,
        session_id=session_response.json()["session_id"],
        auth_headers=auth_headers,
        payload={"input_mode": "choice", "choice_id": "safe"},
    )

    now = datetime.now(timezone.utc)
    with container.session_factory() as db:
        turn = db.execute(select(Turn).order_by(Turn.created_at.desc(), Turn.id.desc()).limit(1)).scalar_one()
        db.execute(delete(LLMRun).where(LLMRun.turn_id == turn.id, LLMRun.world_id == turn.world_id))
        db.add_all(
            [
                LLMRun(
                    world_id=turn.world_id,
                    turn_id=turn.id,
                    prompt_id="test.prompt",
                    workflow_name="gm_council",
                    model_id="model-a",
                    model_lane="main_lane",
                    provider_name="openai_compatible",
                    provider_response_id="response-a",
                    prompt_tokens=100,
                    completion_tokens=50,
                    total_tokens=150,
                    prompt_cache_hit_tokens=20,
                    prompt_cache_miss_tokens=80,
                    input_hash="hash-a",
                    input_context_hash="context-a",
                    schema_version="1",
                    graph_context_status="ready",
                    output_schema_status="valid",
                    output_payload={"status": "resolved"},
                    created_at=now - timedelta(minutes=20),
                ),
                LLMRun(
                    world_id=turn.world_id,
                    turn_id=turn.id,
                    prompt_id="test.prompt",
                    workflow_name="gm_council",
                    model_id="model-b",
                    model_lane="pro_lane",
                    provider_name="openai_compatible",
                    provider_response_id="response-b",
                    prompt_tokens=40,
                    completion_tokens=10,
                    total_tokens=50,
                    prompt_cache_hit_tokens=10,
                    prompt_cache_miss_tokens=30,
                    input_hash="hash-b",
                    input_context_hash="context-b",
                    schema_version="1",
                    graph_context_status="ready",
                    output_schema_status="valid",
                    output_payload={"status": "resolved"},
                    created_at=now - timedelta(hours=2),
                ),
                LLMRun(
                    world_id=turn.world_id,
                    turn_id=turn.id,
                    prompt_id="test.prompt",
                    workflow_name="gm_council",
                    model_id="model-a",
                    model_lane="main_lane",
                    provider_name="stub",
                    provider_response_id=None,
                    input_hash="hash-missing",
                    input_context_hash="context-missing",
                    schema_version="1",
                    graph_context_status="ready",
                    output_schema_status="valid",
                    output_payload={"status": "resolved"},
                    created_at=now - timedelta(minutes=10),
                ),
            ]
        )
        db.commit()

    response = client.get("/admin/llm-usage?range=24h", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["range"] == "24h"
    assert payload["bucket"] == "hour"
    assert payload["totals"]["run_count"] == 3
    assert payload["totals"]["total_tokens"] == 200
    assert payload["totals"]["prompt_tokens"] == 140
    assert payload["totals"]["completion_tokens"] == 60
    assert payload["totals"]["cache_hit_tokens"] == 30
    assert payload["totals"]["cache_miss_tokens"] == 110
    assert payload["totals"]["cache_hit_rate"] == pytest.approx(30 / 140)
    assert payload["totals"]["missing_usage_count"] == 1
    assert len(payload["models"]) == 3
    assert payload["models"][0]["model_id"] == "model-a"
    assert payload["models"][0]["total_tokens"] == 150
    assert sum(item["total_tokens"] for item in payload["models"][0]["series"]) == 150

    daily_response = client.get("/admin/llm-usage?range=30d", headers=auth_headers)
    assert daily_response.status_code == 200
    assert daily_response.json()["bucket"] == "day"
