"""
物語主導型探索システムAPIエンドポイント
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.api.deps import get_current_active_user, get_user_character
from app.core.database import get_session as get_db
from app.models import (
    Character,
    CharacterLocationHistory,
    Location,
    LocationConnection,
    SPTransactionType,
)
from app.schemas.narrative import (
    ActionChoice,
    ActionRequest,
    NarrativeResponse,
)
from app.schemas.user import User
from app.services.gm_ai_service import GMAIService
from app.services.log_fragment_service import LogFragmentService
from app.services.sp_service import SPService
from app.services.websocket_service import WebSocketService

router = APIRouter()


@router.post("/{character_id}/action", response_model=NarrativeResponse)
async def perform_narrative_action(
    character_id: str,
    action: ActionRequest,
    *,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    current_character: Character = Depends(get_user_character),
) -> NarrativeResponse:
    """物語主導の行動処理"""
    # 権限チェック
    if current_character.id != character_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You can only perform actions for your own character"
        )

    # 現在地を取得
    current_location = db.get(Location, current_character.location_id)
    if not current_location:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Current location not found")

    # GM AIサービスを初期化
    gm_ai_service = GMAIService(db)

    # 物語生成と場所遷移の判定
    narrative_result = await gm_ai_service.process_narrative_action(
        character=current_character, action=action.text, current_location=current_location, context=action.context
    )

    # 重要な行動からログフラグメントを生成する可能性を判定
    fragment_service = LogFragmentService(db)

    # 行動の重要度を評価（場所移動、特殊なイベント、重要な選択など）
    importance = 0.3  # 基本重要度

    if narrative_result.location_changed:
        importance += 0.2  # 場所移動は重要

    if narrative_result.events and any(
        event_name in [e.type for e in narrative_result.events] for event_name in ["discovery", "encounter", "choice"]
    ):
        importance += 0.3  # 特殊イベントは重要

    # 重要な行動の場合、ログフラグメント生成
    if importance >= 0.5:
        context_data = {
            "location_id": str(current_location.id),
            "location_name": current_location.name,
            "action_type": action.context.get("action_type", "narrative") if action.context else "narrative",
            "narrative_events": narrative_result.events,
        }

        if narrative_result.location_changed:
            context_data["moved_to"] = narrative_result.new_location_id
            context_data["positive_outcome"] = True

        fragment = fragment_service.generate_action_fragment(
            character=current_character,
            action_type=action.context.get("action_type", "narrative") if action.context else "narrative",
            action_description=f"{action.text} - {narrative_result.narrative[:100]}...",
            context=context_data,
            importance=importance,
        )

        if fragment:
            db.add(fragment)
            db.commit()

    # 場所が変わった場合の処理
    if narrative_result.location_changed and narrative_result.new_location_id:
        # 新しい場所を取得
        new_location = db.get(Location, narrative_result.new_location_id)
        if not new_location:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Invalid new location")

        # SP消費処理
        if narrative_result.sp_cost > 0:
            sp_service = SPService(db)
            player_sp = await sp_service.get_or_create_player_sp(current_character.user_id)

            if player_sp.current_sp < narrative_result.sp_cost:
                # SP不足の場合は物語を調整
                narrative_result.narrative += "\n\nしかし、あなたは疲労を感じ、これ以上進むことができなかった。"
                narrative_result.location_changed = False
                narrative_result.new_location_id = None
            else:
                # SP消費
                await sp_service.consume_sp(
                    user_id=current_character.user_id,
                    amount=narrative_result.sp_cost,
                    transaction_type=SPTransactionType.MOVEMENT,
                    description=f"Narrative movement to {new_location.name}",
                )

                # 移動履歴を更新
                await update_location_history(db, current_character, new_location, narrative_result.sp_cost)

                # キャラクターの現在地を更新
                current_character.location_id = new_location.id
                current_character.location = new_location.name  # 後方互換性
                current_character.updated_at = datetime.utcnow()
                db.add(current_character)
                db.commit()

                # WebSocketで更新を配信
                ws_service = WebSocketService()
                await ws_service.broadcast_to_user(
                    current_character.user_id,
                    "narrative:location_changed",
                    {
                        "from": {
                            "id": str(current_location.id),
                            "name": current_location.name,
                            "coordinates": {"x": current_location.x_coordinate, "y": current_location.y_coordinate},
                        },
                        "to": {
                            "id": str(new_location.id),
                            "name": new_location.name,
                            "coordinates": {"x": new_location.x_coordinate, "y": new_location.y_coordinate},
                        },
                        "narrative": narrative_result.movement_description,
                    },
                )

    # 次の行動選択肢を生成
    action_choices = await generate_action_choices(
        db,
        current_character,
        narrative_result.narrative,
        str(current_character.location_id) if current_character.location_id else "",
    )

    return NarrativeResponse(
        narrative=narrative_result.narrative,
        location_changed=narrative_result.location_changed,
        new_location_id=narrative_result.new_location_id,
        new_location_name=(
            new_loc.name
            if narrative_result.new_location_id and (new_loc := db.get(Location, narrative_result.new_location_id))
            else None
        ),
        sp_consumed=narrative_result.sp_cost if narrative_result.location_changed else 0,
        action_choices=action_choices,
        events=narrative_result.events,
    )


@router.get("/{character_id}/actions", response_model=list[ActionChoice])
async def get_available_actions(
    character_id: str,
    *,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    current_character: Character = Depends(get_user_character),
) -> list[ActionChoice]:
    """現在の状況に応じた行動選択肢を取得"""
    # 権限チェック
    if current_character.id != character_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You can only view actions for your own character"
        )

    # 現在地と文脈から選択肢を生成
    return await generate_action_choices(
        db,
        current_character,
        "",  # 現在の物語文脈（セッションから取得する実装が必要）
        str(current_character.location_id) if current_character.location_id else "",
    )


async def update_location_history(db: Session, character: Character, new_location: Location, sp_cost: int) -> None:
    """場所移動の履歴を更新"""
    # 現在地の履歴を終了
    current_history = db.exec(
        select(CharacterLocationHistory).where(
            CharacterLocationHistory.character_id == character.id,
            CharacterLocationHistory.departed_at == None,  # noqa: E711
        )
    ).first()

    if current_history:
        current_history.departed_at = datetime.utcnow()
        db.add(current_history)

    # 新しい履歴を作成
    new_history = CharacterLocationHistory(character_id=character.id, location_id=new_location.id, sp_consumed=sp_cost)
    db.add(new_history)


async def generate_action_choices(
    db: Session, character: Character, narrative_context: str, location_id: str
) -> list[ActionChoice]:
    """現在の文脈に応じた行動選択肢を生成"""
    choices = []

    # 基本行動
    choices.append(
        ActionChoice(
            text="周囲を詳しく調べる", action_type="investigate", description="この場所の詳細を探索します", metadata={}
        )
    )

    choices.append(
        ActionChoice(text="休憩する", action_type="rest", description="少し休んで体力を回復します", metadata={})
    )

    # 場所の接続に基づく選択肢
    location = db.get(Location, location_id)
    if location:
        # 移動可能な接続を取得
        connections = db.exec(
            select(LocationConnection).where(
                LocationConnection.from_location_id == location.id,
                LocationConnection.is_blocked == False,  # noqa: E712
            )
        ).all()

        for conn in connections:
            to_location = db.get(Location, conn.to_location_id)
            if to_location and to_location.is_discovered:
                # 物語的な選択肢として提示
                if conn.path_type == "stairs":
                    choices.append(
                        ActionChoice(
                            text=f"階段を{('上る' if to_location.hierarchy_level > location.hierarchy_level else '下る')}",
                            action_type="move",
                            description=None,
                            metadata={"connection_id": str(conn.id)},
                        )
                    )
                elif conn.path_type == "direct":
                    choices.append(
                        ActionChoice(
                            text=f"{to_location.name}へ向かう道を進む",
                            action_type="move",
                            description=None,
                            metadata={"connection_id": str(conn.id)},
                        )
                    )

    # 文脈依存の選択肢
    if "扉" in narrative_context:
        choices.append(
            ActionChoice(text="扉を開ける", action_type="interact", description=None, metadata={"object": "door"})
        )

    if "人影" in narrative_context or "誰か" in narrative_context:
        choices.append(
            ActionChoice(text="人影に近づく", action_type="approach", description=None, metadata={"target": "figure"})
        )

    return choices[:5]  # 最大5つの選択肢
