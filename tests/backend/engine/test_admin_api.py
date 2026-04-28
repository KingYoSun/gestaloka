from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.deps import get_current_ops_user
from app.models.entities import AdminAppUser, AdminPromptOverride, AdminRuntimeConfig
from app.modules.identity.oidc import UserIdentity


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
