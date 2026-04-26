from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from typing import Callable

import pytest
import yaml
from fastapi.testclient import TestClient

from app.core.container import build_container
from app.core.config import Settings
from app.main import create_app
from app.models.base import Base
from app.models.entities import World
from app.modules.world_pack.cli import main as world_pack_main
from app.modules.world_pack.service import (
    PackRegistry,
    WorldPackError,
    configure_pack_registry,
    load_pack_from_dir,
    world_pack_metadata,
)


REPO_ROOT = next(parent for parent in Path(__file__).resolve().parents if (parent / "rebuild_plan_v2.md").exists())


def _copy_pack_dir(tmp_path: Path, pack_name: str = "ember_harbor") -> Path:
    pack_dir = tmp_path / "packs"
    shutil.copytree(REPO_ROOT / "packs" / pack_name, pack_dir / pack_name)
    return pack_dir


def _rewrite_world_template(pack_dir: Path, pack_name: str, mutate: Callable[[dict[str, object]], None]) -> None:
    template_path = pack_dir / pack_name / "world_templates.yaml"
    payload = yaml.safe_load(template_path.read_text(encoding="utf-8"))
    mutate(payload)
    template_path.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True), encoding="utf-8")


def _rewrite_pack_manifest(pack_dir: Path, pack_name: str, mutate: Callable[[dict[str, object]], None]) -> None:
    manifest_path = pack_dir / pack_name / "pack.yaml"
    payload = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
    mutate(payload)
    manifest_path.write_text(yaml.safe_dump(payload, sort_keys=False, allow_unicode=True), encoding="utf-8")


def _settings_for_pack_dir(tmp_path: Path, pack_dir: Path) -> Settings:
    return Settings(
        database_url=f"sqlite:///{tmp_path / 'gestaloka.db'}",
        alembic_database_url=f"sqlite:///{tmp_path / 'gestaloka.db'}",
        pack_dir=pack_dir,
        prompt_dir=REPO_ROOT / "prompts",
        eval_dataset_dir=REPO_ROOT / "evals" / "datasets",
        release_config_dir=REPO_ROOT / "config" / "release",
        oidc_dev_mode=True,
        otel_metrics_port=0,
    )


def _only_failure(registry: PackRegistry) -> dict[str, object]:
    diagnostic = registry.catalog_diagnostic()
    assert diagnostic["status"] == "error"
    assert diagnostic["pack_count"] == 0
    assert diagnostic["failure_count"] == 1
    return diagnostic["failures"][0]


def _build_client_for_pack_dir(tmp_path: Path, pack_dir: Path) -> tuple[TestClient, object]:
    container = build_container(_settings_for_pack_dir(tmp_path, pack_dir))
    Base.metadata.create_all(bind=container.session_factory.kw["bind"])
    return TestClient(create_app(container)), container


def test_world_pack_registry_lists_reference_and_sample_pack(client, auth_headers):
    response = client.get("/worlds/packs", headers=auth_headers)

    assert response.status_code == 200
    items = response.json()["items"]
    assert {item["pack_id"] for item in items} >= {"founders_reach", "ember_harbor"}
    ember = next(item for item in items if item["pack_id"] == "ember_harbor")
    assert ember["world_templates"][0]["template_id"] == "ember_harbor"


def test_ops_world_pack_catalog_reports_paths_for_admin(client, auth_headers):
    response = client.get("/ops/world-packs", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["pack_dir"].endswith("/packs")
    assert payload["pack_count"] >= 2
    assert payload["template_count"] >= 2
    ember = next(item for item in payload["items"] if item["pack_id"] == "ember_harbor")
    assert ember["root_dir"].endswith("/packs/ember_harbor")
    assert ember["world_templates"][0]["template_id"] == "ember_harbor"


def test_pack_registry_exposes_branch_metadata_from_pack_contract():
    registry = PackRegistry(REPO_ROOT / "packs")
    assert registry.pack_dir == (REPO_ROOT / "packs").resolve()
    template = registry.get_template("ember_harbor", "ember_harbor")
    branch = template.roles.followup_branches.formal_path

    assert branch.summary
    assert branch.committed_summary
    assert branch.player_hint
    assert branch.signal_weights["kept_formal_promise"] > 0


def test_world_pack_metadata_rejects_worlds_without_explicit_pack_metadata():
    world = World(id="world-missing-pack", name="Missing Pack", status="active", state={})

    with pytest.raises(ValueError, match="missing pack_id/world_template_id"):
        world_pack_metadata(world)


def test_pack_registry_rejects_missing_followup_branches(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        del payload["world_templates"]["ember_harbor"]["roles"]["followup_branches"]  # type: ignore[index]

    _rewrite_world_template(pack_dir, "ember_harbor", mutate)

    failure = _only_failure(PackRegistry(pack_dir))
    assert failure["error"] == "invalid_content"
    assert "followup_branches" in failure["message"]


def test_pack_registry_rejects_missing_followup_branch_slot(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        del payload["world_templates"]["ember_harbor"]["roles"]["followup_branches"]["undercurrent_path"]  # type: ignore[index]

    _rewrite_world_template(pack_dir, "ember_harbor", mutate)

    failure = _only_failure(PackRegistry(pack_dir))
    assert failure["error"] == "invalid_content"
    assert "undercurrent_path" in failure["message"]


def test_pack_registry_rejects_duplicate_followup_branch_keys(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        roles = payload["world_templates"]["ember_harbor"]["roles"]  # type: ignore[index]
        roles["followup_branches"]["undercurrent_path"]["branch_key"] = "beacon_oath"  # type: ignore[index]

    _rewrite_world_template(pack_dir, "ember_harbor", mutate)

    failure = _only_failure(PackRegistry(pack_dir))
    assert failure["error"] == "invalid_content"
    assert "unique" in failure["message"]


def test_pack_registry_rejects_unknown_followup_branch_anchor_npc(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        roles = payload["world_templates"]["ember_harbor"]["roles"]  # type: ignore[index]
        roles["followup_branches"]["formal_path"]["anchor_npcs"] = ["Unknown Anchor"]  # type: ignore[index]

    _rewrite_world_template(pack_dir, "ember_harbor", mutate)

    failure = _only_failure(PackRegistry(pack_dir))
    assert failure["error"] == "unknown_anchor_npc"
    assert "anchor_npcs" in failure["message"]


def test_explicit_missing_pack_dir_does_not_fallback_to_bundled_packs(tmp_path: Path):
    missing_pack_dir = tmp_path / "missing-packs"
    settings = _settings_for_pack_dir(tmp_path, missing_pack_dir)

    assert settings.pack_dir == missing_pack_dir
    registry = PackRegistry(settings.pack_dir)
    assert registry.status == "error"
    assert registry.pack_summary_items() == []
    assert registry.catalog_diagnostic()["failures"][0]["error"] == "pack_dir_not_found"


def test_pack_registry_catalog_diagnostic_reports_external_pack_dir(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    diagnostic = PackRegistry(pack_dir).catalog_diagnostic()

    assert diagnostic["status"] == "ready"
    assert diagnostic["pack_dir"] == str(pack_dir.resolve())
    assert diagnostic["engine_api_version"] == "v2"
    assert diagnostic["pack_count"] == 1
    assert diagnostic["template_count"] == 1
    assert diagnostic["failure_count"] == 0
    assert diagnostic["failures"] == []
    assert diagnostic["items"][0]["pack_id"] == "ember_harbor"
    assert diagnostic["items"][0]["root_dir"] == str((pack_dir / "ember_harbor").resolve())
    assert diagnostic["items"][0]["world_templates"][0]["template_id"] == "ember_harbor"


def test_pack_registry_reports_degraded_external_pack_dir_and_keeps_valid_packs(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)
    shutil.copytree(REPO_ROOT / "packs" / "founders_reach", pack_dir / "founders_reach")

    def mutate(payload: dict[str, object]) -> None:
        payload["pack_id"] = "not_founders_reach"

    _rewrite_pack_manifest(pack_dir, "founders_reach", mutate)

    registry = PackRegistry(pack_dir)
    diagnostic = registry.catalog_diagnostic()

    assert registry.status == "degraded"
    assert diagnostic["pack_count"] == 1
    assert diagnostic["failure_count"] == 1
    assert [item["pack_id"] for item in diagnostic["items"]] == ["ember_harbor"]
    assert diagnostic["failures"][0]["error"] == "pack_id_mismatch"
    assert registry.get_template("ember_harbor", "ember_harbor").template_id == "ember_harbor"
    with pytest.raises(WorldPackError, match="Unknown pack_id"):
        registry.get_pack("founders_reach")


def test_pack_registry_reports_empty_and_not_directory_pack_dir(tmp_path: Path):
    empty_dir = tmp_path / "empty-packs"
    empty_dir.mkdir()
    empty_diagnostic = PackRegistry(empty_dir).catalog_diagnostic()
    assert empty_diagnostic["status"] == "error"
    assert empty_diagnostic["failures"][0]["error"] == "empty_pack_dir"
    assert empty_diagnostic["failures"][0]["severity"] == "critical"

    not_directory = tmp_path / "packs.txt"
    not_directory.write_text("not a directory\n", encoding="utf-8")
    file_diagnostic = PackRegistry(not_directory).catalog_diagnostic()
    assert file_diagnostic["status"] == "error"
    assert file_diagnostic["failures"][0]["error"] == "pack_dir_not_directory"
    assert file_diagnostic["failures"][0]["severity"] == "critical"


def test_pack_registry_rejects_symlink_pack_roots_and_escaped_pack_ids(tmp_path: Path):
    pack_dir = tmp_path / "packs"
    pack_dir.mkdir()
    outside_dir = tmp_path / "outside"
    shutil.copytree(REPO_ROOT / "packs" / "ember_harbor", outside_dir / "ember_harbor")
    (pack_dir / "linked_pack").symlink_to(outside_dir / "ember_harbor", target_is_directory=True)

    symlink_failure = _only_failure(PackRegistry(pack_dir))
    assert symlink_failure["error"] == "pack_root_symlink_not_allowed"
    assert symlink_failure["severity"] == "error"

    with pytest.raises(WorldPackError) as exc:
        load_pack_from_dir(pack_dir, "../outside/ember_harbor")
    assert exc.value.code == "invalid_pack_id"


def test_pack_registry_rejects_pack_manifest_that_is_not_a_file(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)
    manifest_path = pack_dir / "ember_harbor" / "pack.yaml"
    manifest_path.unlink()
    manifest_path.mkdir()

    failure = _only_failure(PackRegistry(pack_dir))
    assert failure["error"] == "pack_manifest_not_file"
    assert str(failure["path"]).endswith("ember_harbor/pack.yaml")


def test_pack_catalog_apis_sanitize_public_failures_and_expose_admin_paths(tmp_path: Path, auth_headers):
    pack_dir = _copy_pack_dir(tmp_path)
    shutil.copytree(REPO_ROOT / "packs" / "founders_reach", pack_dir / "founders_reach")

    def mutate(payload: dict[str, object]) -> None:
        payload["pack_id"] = "not_founders_reach"

    _rewrite_pack_manifest(pack_dir, "founders_reach", mutate)
    test_client, _ = _build_client_for_pack_dir(tmp_path, pack_dir)
    try:
        public_response = test_client.get("/worlds/packs", headers=auth_headers)
        admin_response = test_client.get("/ops/world-packs", headers=auth_headers)
        session_response = test_client.post(
            "/sessions",
            json={
                "world_id": "external-valid-world",
                "pack_id": "ember_harbor",
                "world_template_id": "ember_harbor",
                "world_name": "External Valid World",
            },
            headers=auth_headers,
        )
    finally:
        test_client.close()

    assert public_response.status_code == 200
    public_payload = public_response.json()
    assert public_payload["status"] == "degraded"
    assert public_payload["failure_count"] == 1
    assert "failures" not in public_payload
    assert [item["pack_id"] for item in public_payload["items"]] == ["ember_harbor"]

    assert admin_response.status_code == 200
    admin_payload = admin_response.json()
    assert admin_payload["status"] == "degraded"
    assert admin_payload["failures"][0]["error"] == "pack_id_mismatch"
    assert admin_payload["failures"][0]["severity"] == "error"
    assert admin_payload["failures"][0]["path"].endswith("founders_reach/pack.yaml")
    assert session_response.status_code == 200


def test_pack_registry_cache_reuses_current_pack_dir_and_switches_when_config_changes(tmp_path: Path):
    good_pack_dir = _copy_pack_dir(tmp_path / "good")
    registry = configure_pack_registry(good_pack_dir)
    missing_pack_dir = tmp_path / "missing-packs"

    missing_registry = configure_pack_registry(missing_pack_dir)
    assert missing_registry.status == "error"
    assert configure_pack_registry(missing_pack_dir) is missing_registry

    restored_registry = configure_pack_registry(good_pack_dir)
    assert restored_registry.status == "ready"
    assert restored_registry.pack_dir == registry.pack_dir


def test_pack_registry_rejects_invalid_manifest_pack_id_slug(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        payload["pack_id"] = "Bad Pack"

    _rewrite_pack_manifest(pack_dir, "ember_harbor", mutate)

    failure = _only_failure(PackRegistry(pack_dir))
    assert failure["error"] == "invalid_pack_id"
    assert "invalid pack_id" in failure["message"]


def test_pack_registry_rejects_invalid_manifest_template_id_slug(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        payload["world_templates"][0]["template_id"] = "Bad Template"  # type: ignore[index]

    _rewrite_pack_manifest(pack_dir, "ember_harbor", mutate)

    failure = _only_failure(PackRegistry(pack_dir))
    assert failure["error"] == "invalid_template_id"
    assert "invalid world_template_id" in failure["message"]


def test_pack_registry_rejects_duplicate_manifest_template_ids(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        payload["world_templates"].append(dict(payload["world_templates"][0]))  # type: ignore[index,union-attr]

    _rewrite_pack_manifest(pack_dir, "ember_harbor", mutate)

    failure = _only_failure(PackRegistry(pack_dir))
    assert failure["error"] == "duplicate_template_id"
    assert "duplicate world_template_id" in failure["message"]


def test_pack_registry_rejects_manifest_pack_id_mismatch(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        payload["pack_id"] = "not_ember_harbor"

    _rewrite_pack_manifest(pack_dir, "ember_harbor", mutate)

    failure = _only_failure(PackRegistry(pack_dir))
    assert failure["error"] == "pack_id_mismatch"
    assert "must match" in failure["message"]


def test_pack_registry_rejects_unsafe_content_refs(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate_absolute(payload: dict[str, object]) -> None:
        payload["content_refs"]["npcs"] = str(tmp_path / "outside.yaml")  # type: ignore[index]

    _rewrite_pack_manifest(pack_dir, "ember_harbor", mutate_absolute)
    absolute_failure = _only_failure(PackRegistry(pack_dir))
    assert absolute_failure["error"] == "invalid_content_ref"
    assert "must be relative" in absolute_failure["message"]

    pack_dir = _copy_pack_dir(tmp_path / "parent-ref")

    def mutate_parent(payload: dict[str, object]) -> None:
        payload["content_refs"]["npcs"] = "../outside.yaml"  # type: ignore[index]

    _rewrite_pack_manifest(pack_dir, "ember_harbor", mutate_parent)
    parent_failure = _only_failure(PackRegistry(pack_dir))
    assert parent_failure["error"] == "invalid_content_ref"
    assert "escapes pack root" in parent_failure["message"]


def test_pack_registry_rejects_missing_and_non_yaml_content_refs(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate_missing(payload: dict[str, object]) -> None:
        payload["content_refs"]["npcs"] = "missing.yaml"  # type: ignore[index]

    _rewrite_pack_manifest(pack_dir, "ember_harbor", mutate_missing)
    missing_failure = _only_failure(PackRegistry(pack_dir))
    assert missing_failure["error"] == "content_file_not_found"
    assert "file not found" in missing_failure["message"]

    pack_dir = _copy_pack_dir(tmp_path / "non-yaml")
    non_yaml = pack_dir / "ember_harbor" / "npcs.txt"
    non_yaml.write_text("not yaml\n", encoding="utf-8")

    def mutate_non_yaml(payload: dict[str, object]) -> None:
        payload["content_refs"]["npcs"] = "npcs.txt"  # type: ignore[index]

    _rewrite_pack_manifest(pack_dir, "ember_harbor", mutate_non_yaml)
    non_yaml_failure = _only_failure(PackRegistry(pack_dir))
    assert non_yaml_failure["error"] == "invalid_content_ref"
    assert "YAML file" in non_yaml_failure["message"]


def test_pack_registry_rejects_invalid_yaml_with_diagnostic(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)
    (pack_dir / "ember_harbor" / "npcs.yaml").write_text("npcs: [\n", encoding="utf-8")

    failure = _only_failure(PackRegistry(pack_dir))
    assert failure["error"] == "invalid_yaml"
    assert str(failure["path"]).endswith("ember_harbor/npcs.yaml")


def test_pack_cli_lists_discovered_packs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    pack_dir = _copy_pack_dir(tmp_path)
    shutil.copytree(REPO_ROOT / "packs" / "founders_reach", pack_dir / "founders_reach")
    settings = _settings_for_pack_dir(tmp_path, pack_dir)
    monkeypatch.setattr("app.modules.world_pack.cli.get_settings", lambda: settings)
    monkeypatch.setattr(sys, "argv", ["world_pack", "list"])

    world_pack_main()

    payload = yaml.safe_load(capsys.readouterr().out)
    assert payload["pack_dir"] == str(pack_dir)
    assert payload["status"] == "ready"
    assert payload["failure_count"] == 0
    assert {item["pack_id"] for item in payload["items"]} == {"ember_harbor", "founders_reach"}


def test_pack_cli_validates_single_pack(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    pack_dir = _copy_pack_dir(tmp_path)
    settings = _settings_for_pack_dir(tmp_path, pack_dir)
    monkeypatch.setattr("app.modules.world_pack.cli.get_settings", lambda: settings)
    monkeypatch.setattr(sys, "argv", ["world_pack", "validate", "--pack", "ember_harbor"])

    world_pack_main()

    payload = yaml.safe_load(capsys.readouterr().out)
    assert payload["pack_dir"] == str(pack_dir)
    assert [item["pack_id"] for item in payload["validated"]] == ["ember_harbor"]


def test_pack_cli_validate_reports_multiple_failures(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
):
    pack_dir = _copy_pack_dir(tmp_path)
    shutil.copytree(REPO_ROOT / "packs" / "founders_reach", pack_dir / "founders_reach")

    def mutate_ember(payload: dict[str, object]) -> None:
        payload["pack_id"] = "not_ember_harbor"

    def mutate_founders(payload: dict[str, object]) -> None:
        payload["engine_api_version"] = "v1"

    _rewrite_pack_manifest(pack_dir, "ember_harbor", mutate_ember)
    _rewrite_pack_manifest(pack_dir, "founders_reach", mutate_founders)
    settings = _settings_for_pack_dir(tmp_path, pack_dir)
    monkeypatch.setattr("app.modules.world_pack.cli.get_settings", lambda: settings)
    monkeypatch.setattr(sys, "argv", ["world_pack", "validate"])

    with pytest.raises(SystemExit) as exc:
        world_pack_main()

    assert exc.value.code == 1
    payload = yaml.safe_load(capsys.readouterr().out)
    assert payload["status"] == "error"
    assert payload["failure_count"] == 2
    assert payload["validated"] == []
    assert {item["error"] for item in payload["failures"]} == {"pack_id_mismatch", "engine_api_version_mismatch"}


def test_pack_cli_validate_failure_writes_json_diagnostic(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        payload["pack_id"] = "not_ember_harbor"

    _rewrite_pack_manifest(pack_dir, "ember_harbor", mutate)
    settings = _settings_for_pack_dir(tmp_path, pack_dir)
    monkeypatch.setattr("app.modules.world_pack.cli.get_settings", lambda: settings)
    monkeypatch.setattr(sys, "argv", ["world_pack", "validate", "--pack", "ember_harbor"])

    with pytest.raises(SystemExit) as exc:
        world_pack_main()

    assert exc.value.code == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    diagnostic = json.loads(captured.err)
    assert diagnostic["error"] == "pack_id_mismatch"
    assert diagnostic["pack_dir"] == str(pack_dir)
    assert diagnostic["path"].endswith("ember_harbor/pack.yaml")


def test_pack_cli_scans_runtime_source_for_pack_specific_literals(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
):
    pack_dir = _copy_pack_dir(tmp_path)
    shutil.copytree(REPO_ROOT / "packs" / "founders_reach", pack_dir / "founders_reach")
    scan_root = tmp_path / "runtime"
    scan_root.mkdir()
    runtime_file = scan_root / "service.py"
    runtime_file.write_text('DEFAULT_WORLD_LABEL = "current world"\n', encoding="utf-8")
    settings = _settings_for_pack_dir(tmp_path, pack_dir)
    monkeypatch.setattr("app.modules.world_pack.cli.get_settings", lambda: settings)
    monkeypatch.setattr(sys, "argv", ["world_pack", "scan-leaks", "--scan-root", str(scan_root)])

    world_pack_main()

    clean_payload = yaml.safe_load(capsys.readouterr().out)
    assert clean_payload["leak_count"] == 0
    assert clean_payload["term_count"] > 0

    runtime_file.write_text('DEFAULT_WORLD_LABEL = "Founders Reach"\n', encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["world_pack", "scan-leaks", "--scan-root", str(scan_root)])

    with pytest.raises(SystemExit) as exc:
        world_pack_main()

    assert exc.value.code == 1
    leak_payload = yaml.safe_load(capsys.readouterr().out)
    assert leak_payload["leak_count"] == 1
    assert leak_payload["leaks"][0]["term"] == "Founders Reach"
