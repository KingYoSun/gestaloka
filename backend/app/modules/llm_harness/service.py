from __future__ import annotations

import hashlib
from dataclasses import dataclass

from app.core.config import Settings
from app.core.prompts import PromptRegistry


@dataclass(frozen=True)
class TurnResolution:
    prompt_id: str
    schema_version: str
    model_lane: str
    model_id: str
    input_hash: str
    narrative: str
    npc_reaction: str
    event_type: str
    event_payload: dict
    memories: list[dict]


class ModelRouter:
    def __init__(self, settings: Settings, prompt_registry: PromptRegistry) -> None:
        self.settings = settings
        self.prompt_registry = prompt_registry

    def resolve_turn(
        self,
        *,
        world_id: str,
        player_name: str,
        npc_name: str,
        input_text: str,
        relevant_memories: list[str],
    ) -> TurnResolution:
        prompt = self.prompt_registry.get("session.turn_resolution")
        joined_memories = " / ".join(relevant_memories[:2])
        if joined_memories:
            npc_reaction = f"{npc_name}は同じ世界に沈殿した記憶をたどり、「{joined_memories}」を踏まえて応じた。"
        else:
            npc_reaction = f"{npc_name}はこの世界で起きた新しい出来事として受け止め、慎重に応じた。"

        narrative = (
            f"{player_name}は『{input_text}』と行動した。"
            f"{npc_name}はその結果を世界の事実として記録し、次の行動に影響する記憶へ変換した。"
        )
        memory_text = f"{player_name}は{input_text}。{npc_reaction}"
        event_payload = {
            "action": input_text,
            "npc_reaction": npc_reaction,
            "world_id": world_id,
        }
        input_hash = hashlib.sha256(f"{world_id}|{input_text}|{joined_memories}|{prompt.instructions}".encode()).hexdigest()

        return TurnResolution(
            prompt_id=prompt.prompt_id,
            schema_version=prompt.schema_version,
            model_lane=prompt.model_lane,
            model_id=self.settings.model_main_id,
            input_hash=input_hash,
            narrative=narrative,
            npc_reaction=npc_reaction,
            event_type="player.turn.resolved",
            event_payload=event_payload,
            memories=[
                {"scope": "world", "text": memory_text, "salience": 0.92},
                {"scope": "actor", "text": f"{npc_name} remembers: {memory_text}", "salience": 0.88},
            ],
        )
