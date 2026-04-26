from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from typing import Callable

import pytest
import yaml
from sqlalchemy import select

from app.core.config import Settings
from app.models.entities import World
from app.modules.world_pack.cli import main as world_pack_main
from app.modules.world_pack.service import PackRegistry, WorldPackError, configure_pack_registry, world_pack_metadata


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


def test_world_pack_registry_lists_reference_and_sample_pack(client, auth_headers):
    response = client.get("/worlds/packs", headers=auth_headers)

    assert response.status_code == 200
    items = response.json()["items"]
    assert {item["pack_id"] for item in items} >= {"founders_reach", "ember_harbor"}
    ember = next(item for item in items if item["pack_id"] == "ember_harbor")
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

    with pytest.raises(ValueError, match="followup_branches"):
        PackRegistry(pack_dir)


def test_pack_registry_rejects_missing_followup_branch_slot(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        del payload["world_templates"]["ember_harbor"]["roles"]["followup_branches"]["undercurrent_path"]  # type: ignore[index]

    _rewrite_world_template(pack_dir, "ember_harbor", mutate)

    with pytest.raises(ValueError, match="undercurrent_path"):
        PackRegistry(pack_dir)


def test_pack_registry_rejects_duplicate_followup_branch_keys(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        roles = payload["world_templates"]["ember_harbor"]["roles"]  # type: ignore[index]
        roles["followup_branches"]["undercurrent_path"]["branch_key"] = "beacon_oath"  # type: ignore[index]

    _rewrite_world_template(pack_dir, "ember_harbor", mutate)

    with pytest.raises(ValueError, match="unique"):
        PackRegistry(pack_dir)


def test_pack_registry_rejects_unknown_followup_branch_anchor_npc(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        roles = payload["world_templates"]["ember_harbor"]["roles"]  # type: ignore[index]
        roles["followup_branches"]["formal_path"]["anchor_npcs"] = ["Unknown Anchor"]  # type: ignore[index]

    _rewrite_world_template(pack_dir, "ember_harbor", mutate)

    with pytest.raises(ValueError, match="anchor_npcs"):
        PackRegistry(pack_dir)


def test_explicit_missing_pack_dir_does_not_fallback_to_bundled_packs(tmp_path: Path):
    missing_pack_dir = tmp_path / "missing-packs"
    settings = _settings_for_pack_dir(tmp_path, missing_pack_dir)

    assert settings.pack_dir == missing_pack_dir
    with pytest.raises(WorldPackError, match="Pack directory not found") as exc:
        PackRegistry(settings.pack_dir)
    assert exc.value.diagnostic()["error"] == "pack_dir_not_found"


def test_pack_registry_cache_is_not_updated_after_failed_configure(tmp_path: Path):
    good_pack_dir = _copy_pack_dir(tmp_path / "good")
    registry = configure_pack_registry(good_pack_dir)
    missing_pack_dir = tmp_path / "missing-packs"

    with pytest.raises(WorldPackError, match="Pack directory not found"):
        configure_pack_registry(missing_pack_dir)
    with pytest.raises(WorldPackError, match="Pack directory not found"):
        configure_pack_registry(missing_pack_dir)

    assert configure_pack_registry(good_pack_dir) is registry


def test_pack_registry_rejects_manifest_pack_id_mismatch(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate(payload: dict[str, object]) -> None:
        payload["pack_id"] = "not_ember_harbor"

    _rewrite_pack_manifest(pack_dir, "ember_harbor", mutate)

    with pytest.raises(WorldPackError, match="must match") as exc:
        PackRegistry(pack_dir)
    assert exc.value.diagnostic()["error"] == "pack_id_mismatch"


def test_pack_registry_rejects_unsafe_content_refs(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate_absolute(payload: dict[str, object]) -> None:
        payload["content_refs"]["npcs"] = str(tmp_path / "outside.yaml")  # type: ignore[index]

    _rewrite_pack_manifest(pack_dir, "ember_harbor", mutate_absolute)
    with pytest.raises(WorldPackError, match="must be relative") as absolute_exc:
        PackRegistry(pack_dir)
    assert absolute_exc.value.diagnostic()["error"] == "invalid_content_ref"

    pack_dir = _copy_pack_dir(tmp_path / "parent-ref")

    def mutate_parent(payload: dict[str, object]) -> None:
        payload["content_refs"]["npcs"] = "../outside.yaml"  # type: ignore[index]

    _rewrite_pack_manifest(pack_dir, "ember_harbor", mutate_parent)
    with pytest.raises(WorldPackError, match="escapes pack root") as parent_exc:
        PackRegistry(pack_dir)
    assert parent_exc.value.diagnostic()["error"] == "invalid_content_ref"


def test_pack_registry_rejects_missing_and_non_yaml_content_refs(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)

    def mutate_missing(payload: dict[str, object]) -> None:
        payload["content_refs"]["npcs"] = "missing.yaml"  # type: ignore[index]

    _rewrite_pack_manifest(pack_dir, "ember_harbor", mutate_missing)
    with pytest.raises(WorldPackError, match="file not found") as missing_exc:
        PackRegistry(pack_dir)
    assert missing_exc.value.diagnostic()["error"] == "content_file_not_found"

    pack_dir = _copy_pack_dir(tmp_path / "non-yaml")
    non_yaml = pack_dir / "ember_harbor" / "npcs.txt"
    non_yaml.write_text("not yaml\n", encoding="utf-8")

    def mutate_non_yaml(payload: dict[str, object]) -> None:
        payload["content_refs"]["npcs"] = "npcs.txt"  # type: ignore[index]

    _rewrite_pack_manifest(pack_dir, "ember_harbor", mutate_non_yaml)
    with pytest.raises(WorldPackError, match="YAML file") as non_yaml_exc:
        PackRegistry(pack_dir)
    assert non_yaml_exc.value.diagnostic()["error"] == "invalid_content_ref"


def test_pack_registry_rejects_invalid_yaml_with_diagnostic(tmp_path: Path):
    pack_dir = _copy_pack_dir(tmp_path)
    (pack_dir / "ember_harbor" / "npcs.yaml").write_text("npcs: [\n", encoding="utf-8")

    with pytest.raises(WorldPackError, match="invalid npcs YAML") as exc:
        PackRegistry(pack_dir)
    assert exc.value.diagnostic()["error"] == "invalid_yaml"
    assert exc.value.diagnostic()["path"].endswith("ember_harbor/npcs.yaml")


def test_pack_cli_lists_discovered_packs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    pack_dir = _copy_pack_dir(tmp_path)
    shutil.copytree(REPO_ROOT / "packs" / "founders_reach", pack_dir / "founders_reach")
    settings = _settings_for_pack_dir(tmp_path, pack_dir)
    monkeypatch.setattr("app.modules.world_pack.cli.get_settings", lambda: settings)
    monkeypatch.setattr(sys, "argv", ["world_pack", "list"])

    world_pack_main()

    payload = yaml.safe_load(capsys.readouterr().out)
    assert payload["pack_dir"] == str(pack_dir)
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
