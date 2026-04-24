from __future__ import annotations

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
from app.modules.world_pack.service import PackRegistry, world_pack_metadata


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


def test_world_pack_registry_lists_reference_and_sample_pack(client, auth_headers):
    response = client.get("/worlds/packs", headers=auth_headers)

    assert response.status_code == 200
    items = response.json()["items"]
    assert {item["pack_id"] for item in items} >= {"founders_reach", "ember_harbor"}
    ember = next(item for item in items if item["pack_id"] == "ember_harbor")
    assert ember["world_templates"][0]["template_id"] == "ember_harbor"


def test_pack_registry_exposes_branch_metadata_from_pack_contract():
    registry = PackRegistry(REPO_ROOT / "packs")
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


def test_pack_cli_lists_discovered_packs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    pack_dir = _copy_pack_dir(tmp_path)
    shutil.copytree(REPO_ROOT / "packs" / "founders_reach", pack_dir / "founders_reach")
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'gestaloka.db'}",
        alembic_database_url=f"sqlite:///{tmp_path / 'gestaloka.db'}",
        pack_dir=pack_dir,
        prompt_dir=REPO_ROOT / "prompts",
        eval_dataset_dir=REPO_ROOT / "evals" / "datasets",
        release_config_dir=REPO_ROOT / "config" / "release",
        oidc_dev_mode=True,
        otel_metrics_port=0,
    )
    monkeypatch.setattr("app.modules.world_pack.cli.get_settings", lambda: settings)
    monkeypatch.setattr(sys, "argv", ["world_pack", "list"])

    world_pack_main()

    payload = yaml.safe_load(capsys.readouterr().out)
    assert payload["pack_dir"] == str(pack_dir)
    assert {item["pack_id"] for item in payload["items"]} == {"ember_harbor", "founders_reach"}


def test_pack_cli_validates_single_pack(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]):
    pack_dir = _copy_pack_dir(tmp_path)
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'gestaloka.db'}",
        alembic_database_url=f"sqlite:///{tmp_path / 'gestaloka.db'}",
        pack_dir=pack_dir,
        prompt_dir=REPO_ROOT / "prompts",
        eval_dataset_dir=REPO_ROOT / "evals" / "datasets",
        release_config_dir=REPO_ROOT / "config" / "release",
        oidc_dev_mode=True,
        otel_metrics_port=0,
    )
    monkeypatch.setattr("app.modules.world_pack.cli.get_settings", lambda: settings)
    monkeypatch.setattr(sys, "argv", ["world_pack", "validate", "--pack", "ember_harbor"])

    world_pack_main()

    payload = yaml.safe_load(capsys.readouterr().out)
    assert payload["pack_dir"] == str(pack_dir)
    assert [item["pack_id"] for item in payload["validated"]] == ["ember_harbor"]
