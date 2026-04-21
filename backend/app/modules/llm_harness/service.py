from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from app.core.config import Settings
from app.core.prompts import PromptRegistry


@dataclass(frozen=True)
class TurnResolutionAttempt:
    prompt_id: str
    schema_version: str
    model_lane: str
    model_id: str
    input_hash: str
    status: str
    output_schema_status: str
    output_payload: dict


class MemoryDraft(BaseModel):
    scope: Literal["world", "actor"]
    text: str = Field(min_length=1)
    salience: float = Field(ge=0.0, le=1.0)


class TurnResolutionPayload(BaseModel):
    narrative: str = Field(min_length=1)
    npc_reaction: str = Field(min_length=1)
    event_type: Literal["player.turn.resolved"]
    event_payload: dict
    memories: list[MemoryDraft] = Field(min_length=1)


@dataclass(frozen=True)
class TurnResolutionOutcome:
    attempts: list[TurnResolutionAttempt]
    final_lane: str
    final_payload: TurnResolutionPayload | None
    failure_reason: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.final_payload is not None


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
    ) -> TurnResolutionOutcome:
        prompt = self.prompt_registry.get("session.turn_resolution")
        input_hash = hashlib.sha256(f"{world_id}|{input_text}|{'|'.join(relevant_memories)}|{prompt.instructions}".encode()).hexdigest()
        attempts: list[TurnResolutionAttempt] = []
        failure_reason: str | None = None

        for lane in self._lane_sequence(prompt.model_lane):
            raw_output = self._generate_output(
                lane=lane,
                world_id=world_id,
                player_name=player_name,
                npc_name=npc_name,
                input_text=input_text,
                relevant_memories=relevant_memories,
            )
            model_id = self._model_id_for_lane(lane)
            try:
                payload = TurnResolutionPayload.model_validate(raw_output)
            except ValidationError as exc:
                failure_reason = f"{lane} output failed schema validation"
                attempts.append(
                    TurnResolutionAttempt(
                        prompt_id=prompt.prompt_id,
                        schema_version=prompt.schema_version,
                        model_lane=lane,
                        model_id=model_id,
                        input_hash=input_hash,
                        status="schema_invalid",
                        output_schema_status="invalid",
                        output_payload={
                            "status": "schema_invalid",
                            "reason": failure_reason,
                            "errors": exc.errors(),
                            "raw_output": raw_output,
                        },
                    )
                )
                continue

            attempts.append(
                TurnResolutionAttempt(
                    prompt_id=prompt.prompt_id,
                    schema_version=prompt.schema_version,
                    model_lane=lane,
                    model_id=model_id,
                    input_hash=input_hash,
                    status="resolved",
                    output_schema_status="valid",
                    output_payload={
                        "status": "resolved",
                        "raw_output": payload.model_dump(),
                    },
                )
            )
            return TurnResolutionOutcome(attempts=attempts, final_lane=lane, final_payload=payload)

        return TurnResolutionOutcome(
            attempts=attempts,
            final_lane=attempts[-1].model_lane if attempts else prompt.model_lane,
            final_payload=None,
            failure_reason=failure_reason or "No LLM lane executed",
        )

    def _lane_sequence(self, requested_lane: str) -> list[str]:
        if requested_lane == "pro_lane":
            return ["pro_lane"]
        return [requested_lane, "pro_lane"]

    def _model_id_for_lane(self, lane: str) -> str:
        if lane == "lite_lane":
            return self.settings.model_lite_id
        if lane == "pro_lane":
            return self.settings.model_pro_id
        return self.settings.model_main_id

    def _generate_output(
        self,
        *,
        lane: str,
        world_id: str,
        player_name: str,
        npc_name: str,
        input_text: str,
        relevant_memories: list[str],
    ) -> dict:
        if "__force_invalid_all__" in input_text:
            return {"event_type": "player.turn.resolved"}
        if lane == "main_lane" and "__force_invalid_main__" in input_text:
            return {"event_type": "player.turn.resolved"}
        return self._build_valid_output(
            lane=lane,
            world_id=world_id,
            player_name=player_name,
            npc_name=npc_name,
            input_text=input_text,
            relevant_memories=relevant_memories,
        )

    def _build_valid_output(
        self,
        *,
        lane: str,
        world_id: str,
        player_name: str,
        npc_name: str,
        input_text: str,
        relevant_memories: list[str],
    ) -> dict:
        joined_memories = " / ".join(relevant_memories[:2])
        if joined_memories:
            npc_reaction = f"{npc_name}は同じ世界に沈殿した記憶をたどり、「{joined_memories}」を踏まえて応じた。"
        else:
            npc_reaction = f"{npc_name}はこの世界で起きた新しい出来事として受け止め、慎重に応じた。"

        narrative = (
            f"{player_name}は『{input_text}』と行動した。"
            f"{npc_name}はその結果を世界の事実として記録し、次の行動に影響する記憶へ変換した。"
        )
        if lane == "lite_lane":
            narrative = f"{player_name}は『{input_text}』と行動し、{npc_name}はその出来事を記録した。"
        if lane == "pro_lane" and joined_memories:
            npc_reaction = f"{npc_name}は世界記憶「{joined_memories}」を参照し、整合した反応を返した。"

        memory_text = f"{player_name}は{input_text}。{npc_reaction}"
        return {
            "narrative": narrative,
            "npc_reaction": npc_reaction,
            "event_type": "player.turn.resolved",
            "event_payload": {
                "action": input_text,
                "npc_reaction": npc_reaction,
                "world_id": world_id,
                "lane": lane,
            },
            "memories": [
                {"scope": "world", "text": memory_text, "salience": 0.92},
                {"scope": "actor", "text": f"{npc_name} remembers: {memory_text}", "salience": 0.88},
            ],
        }
