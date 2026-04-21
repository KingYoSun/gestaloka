from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass(frozen=True)
class PromptDefinition:
    prompt_id: str
    owner_module: str
    schema_version: str
    model_lane: str
    expected_output_schema: str
    world_invariants: list[str]
    instructions: str


class PromptRegistry:
    def __init__(self, prompt_dir: Path) -> None:
        self.prompt_dir = Path(prompt_dir)
        self._cache: dict[str, PromptDefinition] = {}

    def get(self, prompt_id: str) -> PromptDefinition:
        if prompt_id in self._cache:
            return self._cache[prompt_id]

        for prompt_file in self.prompt_dir.glob("*.yaml"):
            with prompt_file.open("r", encoding="utf-8") as handle:
                raw = yaml.safe_load(handle)
            if raw["prompt_id"] == prompt_id:
                definition = PromptDefinition(**raw)
                self._cache[prompt_id] = definition
                return definition
        raise KeyError(f"Prompt not found: {prompt_id}")
