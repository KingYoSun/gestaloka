"""
ゲームセッションサービス
"""

import json
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlmodel import Session, desc, select

from app.ai.coordination_models import Choice
from app.ai.coordinator import CoordinatorAI
from app.ai.shared_context import PlayerAction
from app.core.logging import get_logger
from app.models.character import Character, GameSession
from app.schemas.battle import (
    BattleAction,
    BattleActionType,
    BattleData,
    BattleState,
)
from app.schemas.game_session import (
    ActionExecuteRequest,
    ActionExecuteResponse,
    GameSessionCreate,
    GameSessionListResponse,
    GameSessionResponse,
    GameSessionUpdate,
)
from app.services.ai.agents import (
    AnomalyAgent,
    DramatistAgent,
    HistorianAgent,
    NPCManagerAgent,
    StateManagerAgent,
    TheWorldAI,
)

# from app.services.ai.prompt_manager import PromptContext  # 現在未使用
from app.services.battle import BattleService
from app.websocket.events import GameEventEmitter

logger = get_logger(__name__)


class GameSessionService:
    """ゲームセッションサービス"""

    def __init__(self, db: Session, websocket_manager=None):
        self.db = db

        # 個別のAIエージェントを初期化（互換性のため保持）
        self.dramatist_agent = DramatistAgent()
        self.state_manager_agent = StateManagerAgent()

        # CoordinatorAIを初期化
        agents = {
            "dramatist": DramatistAgent(),
            "state_manager": StateManagerAgent(),
            "historian": HistorianAgent(),
            "npc_manager": NPCManagerAgent(),
            "the_world": TheWorldAI(),
            "anomaly": AnomalyAgent(),
        }
        self.coordinator = CoordinatorAI(agents=agents, websocket_manager=websocket_manager)

        # 戦闘サービスを初期化
        self.battle_service = BattleService(db)

    async def create_session(self, character: Character, session_data: GameSessionCreate) -> GameSessionResponse:
        """新しいゲームセッションを作成"""
        try:

            # 既存のアクティブなセッションを非アクティブ化
            stmt = select(GameSession).where(
                GameSession.character_id == character.id, GameSession.is_active is True
            )
            existing_sessions = self.db.exec(stmt).all()

            for session in existing_sessions:
                session.is_active = False
                session.updated_at = datetime.utcnow()
                self.db.add(session)

            # 新しいセッションを作成
            new_session = GameSession(
                id=str(uuid.uuid4()),
                character_id=character.id,
                is_active=True,
                current_scene=self._get_initial_scene(character),
                session_data=json.dumps({"turn_count": 0, "actions_history": [], "game_state": "started"}),
            )

            self.db.add(new_session)
            self.db.commit()
            self.db.refresh(new_session)

            logger.info(
                "Game session created",
                session_id=new_session.id,
                character_id=character.id,
                user_id=character.user_id,
            )

            session_data_parsed = json.loads(new_session.session_data) if new_session.session_data else {}

            return GameSessionResponse(
                id=new_session.id,
                character_id=new_session.character_id,
                character_name=character.name,
                is_active=new_session.is_active,
                current_scene=new_session.current_scene,
                session_data=session_data_parsed,
                created_at=new_session.created_at,
                updated_at=new_session.updated_at,
                turn_number=session_data_parsed.get("turn_count", 0),
            )

        except HTTPException:
            raise
        except Exception as e:
            logger.error(
                "Failed to create game session", character_id=character.id, user_id=character.user_id, error=str(e)
            )
            self.db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="ゲームセッションの作成に失敗しました"
            )

    def get_user_sessions(self, user_id: str) -> GameSessionListResponse:
        """ユーザーのゲームセッション一覧を取得"""
        try:
            stmt = (
                select(GameSession, Character)
                .join(Character)
                .where(Character.user_id == user_id)
                .order_by(desc(GameSession.updated_at))
            )

            results = self.db.exec(stmt).all()

            sessions = []
            for session, character in results:
                session_data = json.loads(session.session_data) if session.session_data else None
                sessions.append(
                    GameSessionResponse(
                        id=session.id,
                        character_id=session.character_id,
                        character_name=character.name,
                        is_active=session.is_active,
                        current_scene=session.current_scene,
                        session_data=session_data,
                        created_at=session.created_at,
                        updated_at=session.updated_at,
                    )
                )

            return GameSessionListResponse(sessions=sessions, total=len(sessions))

        except Exception as e:
            logger.error("Failed to get user sessions", user_id=user_id, error=str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="セッション一覧の取得に失敗しました"
            )

    def get_session_response(self, session: GameSession) -> GameSessionResponse:
        """ゲームセッションレスポンスを生成"""
        try:
            # キャラクター情報を取得
            character = self.db.exec(
                select(Character).where(Character.id == session.character_id)
            ).first()
            if not character:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="キャラクターが見つかりません")
            session_data = json.loads(session.session_data) if session.session_data else None

            return GameSessionResponse(
                id=session.id,
                character_id=session.character_id,
                character_name=character.name,
                is_active=session.is_active,
                current_scene=session.current_scene,
                session_data=session_data,
                created_at=session.created_at,
                updated_at=session.updated_at,
                turn_number=session_data.get("turn_count", 0) if session_data else 0,
            )

        except HTTPException:
            raise
        except Exception as e:
            logger.error("Failed to get session response", session_id=session.id, error=str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="セッションの取得に失敗しました"
            )

    def update_session(self, session: GameSession, update_data: GameSessionUpdate) -> GameSessionResponse:
        """ゲームセッションを更新"""
        try:
            # キャラクター情報を取得
            character = self.db.exec(
                select(Character).where(Character.id == session.character_id)
            ).first()
            if not character:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="キャラクターが見つかりません")

            # セッションデータの更新
            if update_data.current_scene is not None:
                session.current_scene = update_data.current_scene

            if update_data.session_data is not None:
                session.session_data = json.dumps(update_data.session_data)

            session.updated_at = datetime.utcnow()

            self.db.add(session)
            self.db.commit()
            self.db.refresh(session)

            session_data = json.loads(session.session_data) if session.session_data else None

            return GameSessionResponse(
                id=session.id,
                character_id=session.character_id,
                character_name=character.name,
                is_active=session.is_active,
                current_scene=session.current_scene,
                session_data=session_data,
                created_at=session.created_at,
                updated_at=session.updated_at,
                turn_number=session_data.get("turn_count", 0) if session_data else 0,
            )

        except HTTPException:
            raise
        except Exception as e:
            logger.error("Failed to update session", session_id=session.id, error=str(e))
            self.db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="セッションの更新に失敗しました"
            )

    def end_session(self, session: GameSession) -> GameSessionResponse:
        """ゲームセッションを終了"""
        try:
            # キャラクター情報を取得
            character = self.db.exec(
                select(Character).where(Character.id == session.character_id)
            ).first()
            if not character:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="キャラクターが見つかりません")

            # セッションを非アクティブ化
            session.is_active = False
            session.updated_at = datetime.utcnow()

            # セッションデータに終了情報を追加
            if session.session_data:
                session_data = json.loads(session.session_data)
            else:
                session_data = {}

            session_data["game_state"] = "ended"
            session_data["ended_at"] = datetime.utcnow().isoformat()
            session.session_data = json.dumps(session_data)

            self.db.add(session)
            self.db.commit()
            self.db.refresh(session)

            logger.info("Game session ended", session_id=session.id, user_id=character.user_id)

            session_data_final = json.loads(session.session_data) if session.session_data else {}

            return GameSessionResponse(
                id=session.id,
                character_id=session.character_id,
                character_name=character.name,
                is_active=session.is_active,
                current_scene=session.current_scene,
                session_data=session_data_final,
                created_at=session.created_at,
                updated_at=session.updated_at,
                turn_number=session_data_final.get("turn_count", 0),
            )

        except HTTPException:
            raise
        except Exception as e:
            logger.error("Failed to end session", session_id=session.id, error=str(e))
            self.db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="セッションの終了に失敗しました"
            )

    def _get_initial_scene(self, character: Character) -> str:
        """キャラクターの初期シーンを取得"""
        location_scenes = {
            "starting_village": f"{character.name}は静かな始まりの村にいます。新たな冒険が始まろうとしています。",
            "tavern": f"{character.name}は賑やかな酒場にいます。旅人たちの話し声が聞こえてきます。",
            "forest": f"{character.name}は深い森の中にいます。木々の間から差し込む光が幻想的です。",
            "city": f"{character.name}は大都市の中心部にいます。人々が忙しく行き交っています。",
        }

        return location_scenes.get(
            character.location, f"{character.name}は{character.location}にいます。新たな物語が始まります。"
        )

    async def execute_action(
        self, session: GameSession, action_request: ActionExecuteRequest
    ) -> ActionExecuteResponse:
        """プレイヤーのアクションを実行しAIレスポンスを生成"""
        try:
            # キャラクター情報を取得
            character = self.db.exec(
                select(Character).where(Character.id == session.character_id)
            ).first()
            if not character:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="キャラクターが見つかりません")

            # キャラクターの統計情報を取得
            from app.models.character import CharacterStats

            character_stats = self.db.exec(
                select(CharacterStats).where(CharacterStats.character_id == character.id)
            ).first()

            if not session.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="このセッションは既に終了しています"
                )

            # SP消費処理
            from app.core.config import get_settings
            from app.models.sp import SPTransactionType
            from app.services.sp_service import SPService

            settings = get_settings()
            sp_service = SPService(self.db)

            # アクションタイプに応じたSP消費量を決定
            if action_request.action_type == "free_action":
                sp_cost = settings.SP_COST_FREE_ACTION
                transaction_type = SPTransactionType.FREE_ACTION
                sp_description = f"自由行動: {action_request.action_text}"
            else:  # choice_action
                sp_cost = settings.SP_COST_CHOICE_ACTION
                transaction_type = SPTransactionType.SYSTEM_FUNCTION
                sp_description = f"選択肢選択: {action_request.action_text}"

            # SP消費を実行
            try:
                await sp_service.consume_sp(
                    user_id=character.user_id,
                    amount=sp_cost,
                    transaction_type=transaction_type,
                    description=sp_description,
                    related_entity_type="game_session",
                    related_entity_id=session.id,
                    metadata={
                        "action_type": action_request.action_type,
                        "action_text": action_request.action_text[:100],  # 最初の100文字のみ保存
                        "session_id": session.id,
                        "character_id": character.id
                    }
                )
            except Exception as sp_error:
                logger.warning(f"SP consumption failed: {sp_error}", user_id=character.user_id)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"SP不足です。必要SP: {sp_cost}"
                )

            # セッションデータの取得
            session_data = json.loads(session.session_data) if session.session_data else {}
            actions_history = session_data.get("actions_history", []) if session_data else []

            # プロンプトコンテキストの構築（現在未使用）
            # context = PromptContext(
            #     character_name=character.name,
            #     character_stats={
            #         "hp": character_stats.health if character_stats else 100,
            #         "max_hp": character_stats.max_health if character_stats else 100,
            #         "mp": character_stats.energy if character_stats else 100,
            #         "max_mp": character_stats.max_energy if character_stats else 100,
            #         "level": character_stats.level if character_stats else 1,
            #         "experience": character_stats.experience if character_stats else 0,
            #     },
            #     location=character.location,
            #     recent_actions=[item["action"] for item in actions_history[-5:]],
            #     world_state={
            #         "time_of_day": session_data.get("time_of_day", "昼") if session_data else "昼",
            #         "weather": session_data.get("weather", "晴れ") if session_data else "晴れ",
            #     },
            #     session_history=[],
            #     additional_context={"action": action_request.action_text, "action_type": action_request.action_type},
            # )

            # CoordinatorAIでセッションを初期化（必要な場合）
            if not hasattr(self.coordinator, "shared_context") or self.coordinator.shared_context is None:
                # GameSessionResponseを作成
                session_response = GameSessionResponse(
                    id=session.id,
                    character_id=session.character_id,
                    character_name=character.name,
                    is_active=session.is_active,
                    current_scene=session.current_scene,
                    session_data=session_data,
                    created_at=session.created_at,
                    updated_at=session.updated_at,
                    turn_number=session_data.get("turn_count", 0) if session_data else 0,
                )
                await self.coordinator.initialize_session(session_response)

            # CoordinatorAIを使ってアクションを処理
            player_action = PlayerAction(
                action_id=str(uuid.uuid4()),
                action_type=action_request.action_type,
                action_text=action_request.action_text,
            )

            # 協調動作システムでアクションを処理
            # セッションレスポンスを更新（ターン数が増える可能性があるため）
            session_response_for_process = GameSessionResponse(
                id=session.id,
                character_id=session.character_id,
                character_name=character.name,
                is_active=session.is_active,
                current_scene=session.current_scene,
                session_data=session_data,
                created_at=session.created_at,
                updated_at=session.updated_at,
                turn_number=session_data.get("turn_count", 0) if session_data else 0,
            )
            # NPC遭遇チェック
            npc_encounters = await self.check_npc_encounters(character)

            # NPC遭遇情報を追加コンテキストとして設定
            if npc_encounters:
                player_action.metadata = player_action.metadata or {}
                player_action.metadata["npc_encounters"] = npc_encounters

            coordinator_response = await self.coordinator.process_action(player_action, session_response_for_process)

            # WebSocketで物語更新を送信
            await GameEventEmitter.emit_narrative_update(
                session.id, coordinator_response.narrative or "物語は続きます...", narrative_type="action_result"
            )

            # 戦闘システムの処理
            battle_data = session_data.get("battle_data")
            current_battle_state = BattleState(battle_data["state"]) if battle_data else BattleState.NONE

            # 戦闘中の場合、特別な処理を行う
            if current_battle_state != BattleState.NONE and current_battle_state != BattleState.FINISHED:
                # 戦闘アクションの処理
                battle_choices = self._process_battle_turn(
                    session_data, character, character_stats, action_request, coordinator_response
                )
                if battle_choices:
                    coordinator_response.choices = battle_choices
            else:
                # 通常のアクション処理後、戦闘開始をチェック
                if self.battle_service.check_battle_trigger(
                    {"narrative": coordinator_response.narrative, "state_changes": coordinator_response.state_changes},
                    session_data,
                ):
                    # 戦闘を開始
                    enemy_data = (
                        coordinator_response.state_changes.get("enemy_data")
                        if coordinator_response.state_changes
                        else None
                    )
                    environment_data = {
                        "terrain": session_data.get("terrain", "平地"),
                        "weather": session_data.get("weather", "晴れ"),
                        "time_of_day": session_data.get("time_of_day", "昼"),
                    }

                    if not character_stats:
                        # character_statsがない場合はスキップ
                        logger.warning("Character stats not found, skipping battle initialization")
                    else:
                        battle_data = self.battle_service.initialize_battle(
                            character, character_stats, enemy_data, environment_data
                        )

                        # 戦闘を開始（プレイヤーターンに設定）
                        battle_data.state = BattleState.PLAYER_TURN
                        session_data["battle_data"] = battle_data.dict()

                        # 戦闘開始の選択肢を生成
                        initial_battle_choices = self.battle_service.get_battle_choices(battle_data, True)
                        # ActionChoiceをChoiceに変換
                        converted_choices: list[Choice] = []
                        for action_choice in initial_battle_choices:
                            converted_choices.append(
                                Choice(
                                    id=action_choice.id,
                                    text=action_choice.text,
                                    description=action_choice.difficulty if action_choice.difficulty else None,
                                    requirements=action_choice.requirements if action_choice.requirements else None,
                                )
                            )
                        coordinator_response.choices = converted_choices

                        # 戦闘開始メッセージを追加
                        coordinator_response.narrative += f"\n\n戦闘開始！{battle_data.combatants[1].name}が現れた！"

                        # WebSocketで戦闘開始を通知
                        await GameEventEmitter.emit_custom_event(
                            session.id, "battle_start", {"battle_data": battle_data.dict()}
                        )

            # アクション履歴の更新
            action_record: dict[str, Any] = {
                "turn": session_data.get("turn_count", 0) + 1 if session_data else 1,
                "action": action_request.action_text,
                "action_type": action_request.action_type,
                "timestamp": datetime.utcnow().isoformat(),
                "narrative": coordinator_response.narrative,
                "choices": [
                    {"id": choice.id, "text": choice.text, "description": getattr(choice, "description", None)}
                    for choice in coordinator_response.choices
                ]
                if coordinator_response.choices
                else [],
                "success": coordinator_response.state_changes.get("success", True)
                if coordinator_response.state_changes
                else True,
                "state_changes": coordinator_response.state_changes,
            }

            actions_history.append(action_record)

            # セッションデータの更新
            session_data["turn_count"] = session_data.get("turn_count", 0) + 1 if session_data else 1
            session_data["actions_history"] = actions_history
            session_data["last_action_at"] = datetime.utcnow().isoformat()

            # 状態変更の適用（もしあれば）
            if coordinator_response.state_changes and character_stats:
                self._apply_state_changes(character_stats, coordinator_response.state_changes)

            # セッションの更新
            session.session_data = json.dumps(session_data)
            session.current_scene = (
                coordinator_response.narrative[:200] + "..."
                if coordinator_response.narrative and len(coordinator_response.narrative) > 200
                else (coordinator_response.narrative or "物語は続きます...")
            )
            session.updated_at = datetime.utcnow()

            self.db.add(session)
            self.db.add(character)
            if character_stats:
                self.db.add(character_stats)
            self.db.commit()

            # アクション結果をWebSocketで送信
            await GameEventEmitter.emit_action_result(
                session.id,
                character.user_id,
                action_request.action_text,
                {
                    "success": coordinator_response.state_changes.get("success", True)
                    if coordinator_response.state_changes
                    else True,
                    "narrative": coordinator_response.narrative,
                    "choices": [
                        {"id": choice.id, "text": choice.text, "description": getattr(choice, "description", None)}
                        for choice in coordinator_response.choices
                    ]
                    if coordinator_response.choices
                    else [],
                    "turn": action_record["turn"],
                    "state_changes": coordinator_response.state_changes,
                },
            )

            # キャラクター状態更新を送信
            await GameEventEmitter.emit_player_status_update(
                session.id,
                character.user_id,
                {
                    "hp": character_stats.health if character_stats else 100,
                    "mp": character_stats.energy if character_stats else 100,
                    "location": character.location,
                    "level": character_stats.level if character_stats else 1,
                },
            )

            logger.info(
                "Action executed successfully",
                session_id=session.id,
                turn=action_record["turn"],
                action_type=action_request.action_type,
            )

            # ChoiceをActionChoiceに変換
            from app.schemas.game_session import ActionChoice

            action_choices = None
            if coordinator_response.choices:
                action_choices = [
                    ActionChoice(
                        id=choice.id,
                        text=choice.text,
                        difficulty=getattr(choice, "difficulty", None),
                        requirements=getattr(choice, "requirements", {}),
                    )
                    for choice in coordinator_response.choices
                ]

            return ActionExecuteResponse(
                success=coordinator_response.state_changes.get("success", True)
                if coordinator_response.state_changes
                else True,
                turn_number=int(action_record["turn"]),
                narrative=coordinator_response.narrative or "物語は続きます...",
                choices=action_choices,
                character_state={
                    "hp": character_stats.health if character_stats else 100,
                    "mp": character_stats.energy if character_stats else 100,
                    "location": character.location,
                },
                metadata={
                    **coordinator_response.metadata,
                    "state_changes": coordinator_response.state_changes,
                    "battle_data": session_data.get("battle_data"),
                },
            )

        except HTTPException:
            raise
        except Exception as e:
            logger.error("Failed to execute action", session_id=session.id, error=str(e))
            self.db.rollback()
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"アクションの実行に失敗しました: {e!s}"
            )

    def _process_battle_turn(
        self,
        session_data: dict[str, Any],
        character: Character,
        character_stats,
        action_request: ActionExecuteRequest,
        coordinator_response,
    ) -> Optional[list[Choice]]:
        """戦闘ターンを処理"""
        battle_data_dict = session_data.get("battle_data", {})
        battle_data = BattleData(**battle_data_dict)

        # プレイヤーのターンの場合
        if battle_data.state == BattleState.PLAYER_TURN:
            # アクションタイプを判定
            action_type = BattleActionType.ATTACK  # デフォルト
            if "防御" in action_request.action_text or action_request.choice_id == "battle_defend":
                action_type = BattleActionType.DEFEND
            elif "逃" in action_request.action_text or action_request.choice_id == "battle_escape":
                action_type = BattleActionType.ESCAPE
            elif action_request.choice_id and action_request.choice_id.startswith("battle_use_"):
                action_type = BattleActionType.ENVIRONMENT

            # 戦闘アクションを作成
            battle_action = BattleAction(
                actor_id=character.id,
                action_type=action_type,
                target_id=battle_data.combatants[1].id if len(battle_data.combatants) > 1 else None,
                action_text=action_request.action_text,
            )

            # アクションを処理
            result, updated_battle_data = self.battle_service.process_battle_action(battle_data, battle_action)

            # 結果を物語に追加
            coordinator_response.narrative += f"\n\n{result.narrative}"

            # 戦闘終了チェック
            battle_ended, victory, rewards = self.battle_service.check_battle_end(updated_battle_data)

            if battle_ended:
                # 戦闘終了処理
                updated_battle_data.state = BattleState.FINISHED
                session_data["battle_data"] = updated_battle_data.dict()

                if victory is not None:
                    if victory:
                        coordinator_response.narrative += "\n\n戦闘に勝利した！"
                        if rewards:
                            coordinator_response.narrative += f"\n経験値 {rewards['experience']} を獲得！"
                            # 報酬を状態変更に追加
                            if not coordinator_response.state_changes:
                                coordinator_response.state_changes = {}
                            coordinator_response.state_changes["parameter_changes"] = {
                                "experience": rewards["experience"]
                            }
                    else:
                        coordinator_response.narrative += "\n\n戦闘に敗北した..."
                else:
                    coordinator_response.narrative += "\n\n戦闘から逃走した。"

                # 通常の選択肢に戻す
                return None
            else:
                # ターンを進める
                next_actor_id, is_player_turn = self.battle_service.advance_turn(updated_battle_data)
                session_data["battle_data"] = updated_battle_data.dict()

                if is_player_turn:
                    # プレイヤーのターン - 選択肢を返す
                    battle_choices = self.battle_service.get_battle_choices(updated_battle_data, True)
                    return [
                        Choice(
                            id=choice.id,
                            text=choice.text,
                            description=choice.difficulty,
                            requirements=choice.requirements,
                        )
                        for choice in battle_choices
                    ]
                else:
                    # 敵のターン - 自動で行動
                    enemy = next((c for c in updated_battle_data.combatants if c.id == next_actor_id), None)
                    if enemy:
                        # 敵の行動を決定（簡易版）
                        enemy_action = BattleAction(
                            actor_id=enemy.id,
                            action_type=BattleActionType.ATTACK,
                            target_id=character.id,
                            action_text=f"{enemy.name}の攻撃",
                        )

                        enemy_result, updated_battle_data = self.battle_service.process_battle_action(
                            updated_battle_data, enemy_action
                        )
                        coordinator_response.narrative += f"\n\n{enemy_result.narrative}"

                        # 再度ターンを進める（プレイヤーに戻す）
                        next_actor_id, is_player_turn = self.battle_service.advance_turn(updated_battle_data)
                        session_data["battle_data"] = updated_battle_data.dict()

                        # プレイヤーのターンの選択肢を返す
                        battle_choices = self.battle_service.get_battle_choices(updated_battle_data, True)
                        return [
                            Choice(
                                id=choice.id,
                                text=choice.text,
                                description=choice.difficulty,
                                requirements=choice.requirements,
                            )
                            for choice in battle_choices
                        ]

        return None

    def _apply_state_changes(self, character_stats, state_changes: dict[str, Any]):
        """キャラクターの状態変更を適用"""

        # パラメータ変更の適用
        parameter_changes = state_changes.get("parameter_changes", {})

        if "hp" in parameter_changes:
            character_stats.health = max(
                0, min(character_stats.max_health, character_stats.health + parameter_changes["hp"])
            )

        if "mp" in parameter_changes:
            character_stats.energy = max(
                0, min(character_stats.max_energy, character_stats.energy + parameter_changes["mp"])
            )

        if "experience" in parameter_changes:
            character_stats.experience += parameter_changes["experience"]
            # レベルアップチェック（簡易版）
            while character_stats.experience >= character_stats.level * 100:
                character_stats.experience -= character_stats.level * 100
                character_stats.level += 1
                character_stats.max_health += 10
                character_stats.max_energy += 5
                character_stats.health = character_stats.max_health
                character_stats.energy = character_stats.max_energy

        # イベントのトリガー処理（今後の拡張用）
        triggered_events = state_changes.get("triggered_events", [])
        for event in triggered_events:
            logger.info("Event triggered", event_type=event.get("type"), description=event.get("description"))

    async def check_npc_encounters(self, character: Character) -> list[dict]:
        """
        現在地のNPC遭遇をチェック
        派遣中のログNPCが同じ場所にいるか確認し、
        遭遇イベントを発生させる
        """
        from app.models.log import CompletedLog
        from app.models.log_dispatch import DispatchStatus, LogDispatch

        # 現在地に派遣中のログを検索
        stmt = select(LogDispatch, CompletedLog).join(
            CompletedLog,
            LogDispatch.completed_log_id == CompletedLog.id
        ).where(
            LogDispatch.status == DispatchStatus.DISPATCHED,
            LogDispatch.current_location == character.location
        )

        results = self.db.exec(stmt).all()

        encounters = []
        for dispatch, completed_log in results:
            # 自分が派遣したログとは遭遇しない
            if dispatch.dispatcher_id == character.id:
                continue

            # 遭遇データを構築
            encounter_data = {
                "dispatch_id": dispatch.id,
                "log_id": completed_log.id,
                "log_name": completed_log.name,
                "log_title": completed_log.title,
                "personality_traits": completed_log.personality_traits,
                "behavior_patterns": completed_log.behavior_patterns,
                "objective_type": dispatch.objective_type,
                "contamination_level": completed_log.contamination_level,
            }

            encounters.append(encounter_data)

            # 遭遇確率の計算（将来的な拡張用）
            # encounter_chance = self._calculate_encounter_chance(character, dispatch, completed_log)

        return encounters

    async def record_npc_encounter(
        self,
        character: Character,
        dispatch_id: str,
        interaction_type: str,
        interaction_summary: str,
        outcome: str,
        relationship_change: float = 0.0,
        items_exchanged: list[str] | None = None,
    ) -> dict:
        """
        NPCとの遭遇を記録
        Args:
            character: プレイヤーキャラクター
            dispatch_id: 派遣ID
            interaction_type: 交流の種類
            interaction_summary: 交流の概要
            outcome: 結果
            relationship_change: 関係性の変化
            items_exchanged: 交換したアイテム
        Returns:
            記録された遭遇データ
        """
        from app.models.log_dispatch import DispatchEncounter

        # 遭遇記録を作成
        encounter = DispatchEncounter(
            dispatch_id=dispatch_id,
            encountered_character_id=character.id,
            location=character.location,
            interaction_type=interaction_type,
            interaction_summary=interaction_summary,
            outcome=outcome,
            relationship_change=relationship_change,
            items_exchanged=items_exchanged or [],
        )

        self.db.add(encounter)
        self.db.commit()
        self.db.refresh(encounter)

        logger.info(
            "NPC encounter recorded",
            encounter_id=encounter.id,
            character_id=character.id,
            dispatch_id=dispatch_id,
            interaction_type=interaction_type,
        )

        return {
            "encounter_id": encounter.id,
            "dispatch_id": dispatch_id,
            "character_id": character.id,
            "location": encounter.location,
            "interaction_type": interaction_type,
            "outcome": outcome,
        }
