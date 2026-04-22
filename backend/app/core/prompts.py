from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

SUPPORTED_PROMPT_SCHEMAS = {
    "turn_resolution_v1": "1",
    "turn_resolution_v2": "2",
    "council_turn_resolution_v1": "1",
    "council_memory_manager_v1": "1",
    "council_npc_manager_v1": "1",
    "council_world_progress_v1": "1",
    "council_rules_arbiter_v1": "1",
    "council_safety_guard_v1": "1",
    "council_narrative_v1": "1",
}
SUPPORTED_MODEL_LANES = {"lite_lane", "main_lane", "pro_lane"}


@dataclass(frozen=True)
class PromptDefinition:
    prompt_id: str
    owner_module: str
    schema_version: str
    model_lane: str
    expected_output_schema: str
    eval_dataset_ref: str
    world_invariants: list[str]
    instructions: str


class PromptRegistry:
    def __init__(self, prompt_dir: Path, eval_dataset_dir: Path) -> None:
        self.prompt_dir = Path(prompt_dir)
        self.eval_dataset_dir = Path(eval_dataset_dir)
        self._cache = self._load_definitions()

    def get(self, prompt_id: str) -> PromptDefinition:
        try:
            return self._cache[prompt_id]
        except KeyError as exc:
            raise KeyError(f"Prompt not found: {prompt_id}") from exc

    def _load_definitions(self) -> dict[str, PromptDefinition]:
        if not self.prompt_dir.exists():
            raise FileNotFoundError(f"Prompt directory not found: {self.prompt_dir}")

        definitions: dict[str, PromptDefinition] = {}
        for prompt_file in sorted(self.prompt_dir.glob("*.yaml")):
            with prompt_file.open("r", encoding="utf-8") as handle:
                raw = yaml.safe_load(handle) or {}

            try:
                definition = PromptDefinition(**raw)
            except TypeError as exc:
                raise ValueError(f"Prompt file is missing required fields: {prompt_file.name}") from exc

            if definition.prompt_id in definitions:
                raise ValueError(f"Duplicate prompt_id detected: {definition.prompt_id}")

            self._validate_definition(definition, prompt_file)
            definitions[definition.prompt_id] = definition

        if not definitions:
            raise ValueError(f"No prompt definitions found in {self.prompt_dir}")
        return definitions

    def _validate_definition(self, definition: PromptDefinition, prompt_file: Path) -> None:
        expected_version = SUPPORTED_PROMPT_SCHEMAS.get(definition.expected_output_schema)
        if expected_version is None:
            raise ValueError(
                f"Prompt {definition.prompt_id} references unknown schema {definition.expected_output_schema}"
            )
        if definition.schema_version != expected_version:
            raise ValueError(
                f"Prompt {definition.prompt_id} uses schema_version {definition.schema_version}, "
                f"expected {expected_version}"
            )
        if definition.model_lane not in SUPPORTED_MODEL_LANES:
            raise ValueError(f"Prompt {definition.prompt_id} uses unsupported model lane {definition.model_lane}")
        if not definition.eval_dataset_ref.strip():
            raise ValueError(f"Prompt {definition.prompt_id} is missing eval_dataset_ref in {prompt_file.name}")
        dataset_path = self.eval_dataset_dir / f"{definition.eval_dataset_ref}.yaml"
        if not dataset_path.exists():
            raise ValueError(
                f"Prompt {definition.prompt_id} references missing eval dataset {definition.eval_dataset_ref}"
            )
        if not definition.instructions.strip():
            raise ValueError(f"Prompt {definition.prompt_id} has empty instructions in {prompt_file.name}")
