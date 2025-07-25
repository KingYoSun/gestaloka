"""
ゲームセッションサービス
"""

import json
import random
import uuid
from datetime import UTC, datetime
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlmodel import Session, col, desc, select

from app.ai.coordination_models import Choice
from app.ai.coordinator import CoordinatorAI
from app.ai.shared_context import PlayerAction
from app.core.logging import get_logger
from app.models.character import SESSION_STATUS_ACTIVE, SESSION_STATUS_COMPLETED, Character, GameSession
from app.models.game_message import (
    MESSAGE_TYPE_GM_NARRATIVE,
    MESSAGE_TYPE_PLAYER_ACTION,
    MESSAGE_TYPE_SYSTEM_EVENT,
    SENDER_TYPE_GM,
    SENDER_TYPE_PLAYER,
    SENDER_TYPE_SYSTEM,
    GameMessage,
)
from app.models.location import Location
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
    SessionEndingAcceptResponse,
    SessionEndingProposal,
    SessionEndingRejectResponse,
    SessionResultResponse,
)
from app.services.ai.agents import (
    AnomalyAgent,
    DramatistAgent,
    HistorianAgent,
    NPCManagerAgent,
    StateManagerAgent,
    TheWorldAI,
)
from app.services.ai.gemini_factory import get_gemini_client_for_agent
from app.services.ai.model_types import AIAgentType

# from app.services.ai.prompt_manager import PromptContext  # 現在未使用
from app.services.battle import BattleService

# from app.services.first_session_initializer import FirstSessionInitializer  # join_gameイベントで使用
from app.services.story_arc_service import StoryArcService
from app.websocket.events import GameEventEmitter

logger = get_logger(__name__)


class GameSessionService:
    """ゲームセッションサービス"""

    def __init__(self, db: Session, websocket_manager=None):
        self.db = db

        # 各AIエージェントに適したGeminiクライアントを取得
        dramatist_client = get_gemini_client_for_agent(AIAgentType.DRAMATIST)
        state_manager_client = get_gemini_client_for_agent(AIAgentType.STATE_MANAGER)
        historian_client = get_gemini_client_for_agent(AIAgentType.HISTORIAN)
        npc_manager_client = get_gemini_client_for_agent(AIAgentType.NPC_MANAGER)
        the_world_client = get_gemini_client_for_agent(AIAgentType.THE_WORLD)
        anomaly_client = get_gemini_client_for_agent(AIAgentType.THE_ANOMALY)

        # 個別のAIエージェントを初期化（互換性のため保持）
        self.dramatist_agent = DramatistAgent(gemini_client=dramatist_client)
        self.state_manager_agent = StateManagerAgent(gemini_client=state_manager_client)

        # CoordinatorAIを初期化
        agents = {
            "dramatist": DramatistAgent(gemini_client=dramatist_client),
            "state_manager": StateManagerAgent(gemini_client=state_manager_client),
            "historian": HistorianAgent(gemini_client=historian_client),
            "npc_manager": NPCManagerAgent(gemini_client=npc_manager_client),
            "the_world": TheWorldAI(gemini_client=the_world_client),
            "anomaly": AnomalyAgent(gemini_client=anomaly_client),
        }
        self.coordinator = CoordinatorAI(agents=agents, websocket_manager=websocket_manager)

        # 戦闘サービスを初期化
        self.battle_service = BattleService(db)

        # ストーリーアークサービスを初期化
        self.story_arc_service = StoryArcService(db)

    async def create_session(self, character: Character, session_data: GameSessionCreate) -> GameSessionResponse:
        """新しいゲームセッションを作成"""
        try:
            # 既存のアクティブなセッションを非アクティブ化
            stmt = select(GameSession).where(GameSession.character_id == character.id, GameSession.is_active == True)  # noqa: E712
            result = self.db.execute(stmt)
            existing_sessions = result.scalars().all()

            for session in existing_sessions:
                session.is_active = False
                session.updated_at = datetime.now(UTC)
                self.db.add(session)

            # キャラクターのセッション数を取得
            from sqlalchemy import func

            session_count_stmt = (
                select(func.count()).select_from(GameSession).where(GameSession.character_id == character.id)
            )
            result = self.db.execute(session_count_stmt)
            session_count = result.scalar_one()
            # Ensure session_count is an integer
            session_count = int(session_count) if session_count is not None else 0

            # セッション作成（初回かどうかに関わらず同じ処理）
            new_session = GameSession(
                id=str(uuid.uuid4()),
                character_id=character.id,
                is_active=True,
                current_scene=self._get_initial_scene(character),
                session_data=json.dumps({"turn_count": 0, "actions_history": [], "game_state": "started"}),
                session_status=SESSION_STATUS_ACTIVE,
                session_number=session_count + 1,
                is_first_session=(session_count == 0),  # 初回セッションフラグを設定
                turn_count=0,
                word_count=0,
                play_duration_minutes=0,
                ending_proposal_count=0,
            )

            self.db.add(new_session)
            self.db.commit()
            self.db.refresh(new_session)

            # ストーリーアークの処理
            # アクティブなストーリーアークがない場合は新規作成を検討
            active_arc = self.story_arc_service.get_active_story_arc(character)
            if not active_arc and not new_session.is_first_session:
                # 初回セッション以外でアークがない場合、基本的な個人の物語アークを作成
                active_arc = self.story_arc_service.create_story_arc(
                    character=character,
                    title="新たなる旅立ち",
                    description="あなたの新しい物語が始まる。どのような冒険が待っているのだろうか。",
                    arc_type="personal_story",
                    total_phases=3,
                    themes=["成長", "発見", "冒険"],
                )

            # セッションをアークに関連付け
            if active_arc:
                self.story_arc_service.associate_session_with_arc(new_session, active_arc)

            # 初回セッション以外の場合のみシステムメッセージを保存
            # （初回セッションはjoin_game時にFirstSessionInitializerで処理される）
            if not new_session.is_first_session:
                system_message_metadata = {
                    "session_number": new_session.session_number,
                    "is_first_session": new_session.is_first_session,
                    "character_id": character.id,
                    "character_name": character.name,
                }
                self.save_message(
                    session_id=new_session.id,
                    message_type=MESSAGE_TYPE_SYSTEM_EVENT,
                    sender_type=SENDER_TYPE_SYSTEM,
                    content=f"セッション #{new_session.session_number} を開始しました。",
                    turn_number=0,
                    metadata=system_message_metadata,
                )
            self.db.commit()  # メッセージも一緒にコミット

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
            character = self.db.exec(select(Character).where(Character.id == session.character_id)).first()
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
            character = self.db.exec(select(Character).where(Character.id == session.character_id)).first()
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
            character = self.db.exec(select(Character).where(Character.id == session.character_id)).first()
            if not character:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="キャラクターが見つかりません")

            # セッションを非アクティブ化
            session.is_active = False
            session.session_status = SESSION_STATUS_COMPLETED
            session.updated_at = datetime.utcnow()

            # セッションデータに終了情報を追加
            if session.session_data:
                session_data = json.loads(session.session_data)
            else:
                session_data = {}

            session_data["game_state"] = "ended"
            session_data["ended_at"] = datetime.utcnow().isoformat()
            session.session_data = json.dumps(session_data)

            # セッション終了のシステムメッセージを保存
            end_message_metadata = {
                "session_number": session.session_number,
                "total_turns": session.turn_count,
                "total_words": session.word_count,
                "play_duration_minutes": session.play_duration_minutes,
            }
            self.save_message(
                session_id=session.id,
                message_type=MESSAGE_TYPE_SYSTEM_EVENT,
                sender_type=SENDER_TYPE_SYSTEM,
                content=f"セッション #{session.session_number} を終了しました。（総ターン数: {session.turn_count}）",
                turn_number=session.turn_count,
                metadata=end_message_metadata,
            )

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
        # 実際の場所情報を取得
        if character.location_id:
            location = self.db.exec(select(Location).where(Location.id == character.location_id)).first()
            if location:
                return f"{character.name}は{location.name}にいます。{location.description}"

        location_scenes = {
            "starting_village": f"{character.name}は静かな始まりの村にいます。新たな冒険が始まろうとしています。",
            "tavern": f"{character.name}は賑やかな酒場にいます。旅人たちの話し声が聞こえてきます。",
            "forest": f"{character.name}は深い森の中にいます。木々の間から差し込む光が幻想的です。",
            "city": f"{character.name}は大都市の中心部にいます。人々が忙しく行き交っています。",
        }

        return location_scenes.get(
            character.location, f"{character.name}は{character.location}にいます。新たな物語が始まります。"
        )

    async def execute_action(self, session: GameSession, action_request: ActionExecuteRequest) -> ActionExecuteResponse:
        """プレイヤーのアクションを実行しAIレスポンスを生成"""
        try:
            logger.debug(f"[DEBUG] execute_action called - session_id: {session.id}, action_request: {action_request}")
            
            # キャラクター情報を取得
            character = self.db.exec(select(Character).where(Character.id == session.character_id)).first()
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
                        "character_id": character.id,
                    },
                )
            except Exception as sp_error:
                logger.warning(f"SP consumption failed: {sp_error}", user_id=character.user_id)
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"SP不足です。必要SP: {sp_cost}")

            # セッションデータの取得
            session_data = json.loads(session.session_data) if session.session_data else {}
            actions_history = session_data.get("actions_history", []) if session_data else []

            # 現在のターン番号を取得
            current_turn = session_data.get("turn_count", 0) + 1 if session_data else 1

            # プレイヤーのアクションをメッセージとして保存
            player_message_metadata = {
                "action_type": action_request.action_type,
                "choice_id": action_request.choice_id,
                "sp_cost": sp_cost,
            }
            player_message = self.save_message(
                session_id=session.id,
                message_type=MESSAGE_TYPE_PLAYER_ACTION,
                sender_type=SENDER_TYPE_PLAYER,
                content=action_request.action_text,
                turn_number=current_turn,
                metadata=player_message_metadata,
            )

            # プロンプトコンテキストの構築（現在未使用）
            # context = PromptContext(
            #     character_name=character.name,
            #     character_stats={
            #         "hp": character_stats.health if character_stats else 100,
            #         "max_hp": character_stats.max_health if character_stats else 100,
            #         "mp": character_stats.mp if character_stats else 100,
            #         "max_mp": character_stats.max_mp if character_stats else 100,
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

            # クエストの暗黙的推測
            from app.services.quest_service import QuestService

            quest_service = QuestService(self.db)

            # 行動パターンから暗黙的クエストを推測
            implicit_quest = await quest_service.infer_implicit_quest(character_id=character.id, session_id=session.id)

            if implicit_quest:
                logger.info(f"Implicit quest inferred: {implicit_quest.title}")

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

            # AI処理開始の通知
            await GameEventEmitter.emit_custom_event(
                session.id,
                "processing_started",
                {
                    "action": action_request.action_text,
                    "status": "AI処理を開始しています..."
                }
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

            # 探索アクションかどうかをチェック
            is_exploration_action = self._is_exploration_action(action_request)
            if is_exploration_action:
                # 探索アクションを処理
                coordinator_response = await self._process_exploration_action(
                    character, session, action_request, player_action, session_response_for_process
                )
            else:
                # 通常のアクションを処理
                coordinator_response = await self.coordinator.process_action(
                    player_action, session_response_for_process
                )

            # coordinator_responseが誤ってlistとして返される場合の対処
            if isinstance(coordinator_response, list):
                logger.error(
                    "Coordinator returned list instead of FinalResponse", response_type=type(coordinator_response)
                )
                # リストからFinalResponseを構築する緊急対処
                from app.ai.coordination_models import FinalResponse

                coordinator_response = FinalResponse(narrative="物語は続きます...", choices=[])

            # WebSocketで物語更新を送信（この時点では送信しない。メッセージ保存後に送信）

            # GMの物語をメッセージとして保存
            gm_message_metadata = {
                "choices": [
                    {"id": choice.id, "text": choice.text, "description": getattr(choice, "description", None)}
                    for choice in coordinator_response.choices
                ]
                if hasattr(coordinator_response, "choices") and coordinator_response.choices
                else [],
                "state_changes": getattr(coordinator_response, "state_changes", {}),
                "battle_data": session_data.get("battle_data"),
            }
            gm_message = self.save_message(
                session_id=session.id,
                message_type=MESSAGE_TYPE_GM_NARRATIVE,
                sender_type=SENDER_TYPE_GM,
                content=getattr(coordinator_response, "narrative", "物語は続きます...") or "物語は続きます...",
                turn_number=current_turn,
                metadata=gm_message_metadata,
            )
            
            # WebSocketでメッセージ更新を送信（ID付き）
            await GameEventEmitter.emit_custom_event(
                session.id,
                "message_added",
                {
                    "message": {
                        "id": gm_message.id,
                        "content": gm_message.content,
                        "message_type": gm_message.message_type,
                        "sender_type": gm_message.sender_type,
                        "turn_number": gm_message.turn_number,
                        "metadata": gm_message.message_metadata,
                        "created_at": gm_message.created_at.isoformat(),
                    },
                    "choices": gm_message_metadata["choices"],
                }
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
                    if hasattr(coordinator_response, "choices"):
                        coordinator_response.choices = battle_choices
            else:
                # 通常のアクション処理後、戦闘開始をチェック
                if self.battle_service.check_battle_trigger(
                    {
                        "narrative": getattr(coordinator_response, "narrative", ""),
                        "state_changes": getattr(coordinator_response, "state_changes", {}),
                    },
                    session_data,
                ):
                    # 戦闘を開始
                    enemy_data = (
                        getattr(coordinator_response, "state_changes", {}).get("enemy_data")
                        if hasattr(coordinator_response, "state_changes") and coordinator_response.state_changes
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
                        session_data["battle_data"] = battle_data.model_dump()

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
                        if hasattr(coordinator_response, "choices"):
                            coordinator_response.choices = converted_choices

                        # 戦闘開始メッセージを追加
                        if hasattr(coordinator_response, "narrative"):
                            coordinator_response.narrative += (
                                f"\n\n戦闘開始！{battle_data.combatants[1].name}が現れた！"
                            )

                        # WebSocketで戦闘開始を通知
                        await GameEventEmitter.emit_custom_event(
                            session.id, "battle_start", {"battle_data": battle_data.model_dump()}
                        )

            # アクション履歴の更新
            action_record: dict[str, Any] = {
                "turn": session_data.get("turn_count", 0) + 1 if session_data else 1,
                "action": action_request.action_text,
                "action_type": action_request.action_type,
                "timestamp": datetime.utcnow().isoformat(),
                "narrative": getattr(coordinator_response, "narrative", "物語は続きます..."),
                "choices": [
                    {"id": choice.id, "text": choice.text, "description": getattr(choice, "description", None)}
                    for choice in coordinator_response.choices
                ]
                if hasattr(coordinator_response, "choices") and coordinator_response.choices
                else [],
                "success": getattr(coordinator_response, "state_changes", {}).get("success", True)
                if hasattr(coordinator_response, "state_changes") and coordinator_response.state_changes
                else True,
                "state_changes": getattr(coordinator_response, "state_changes", {}),
            }

            actions_history.append(action_record)

            # アクティブなクエストの進行状況を更新
            from sqlmodel import and_

            from app.models.quest import Quest, QuestStatus

            active_quests = self.db.exec(
                select(Quest).where(
                    and_(
                        Quest.character_id == character.id,
                        Quest.status.in_([QuestStatus.ACTIVE, QuestStatus.PROGRESSING]),  # type: ignore
                    )
                )
            ).all()

            # 最新のアクションログを取得（クエスト更新用）
            from app.models.log import ActionLog

            latest_action_log = self.db.exec(
                select(ActionLog)
                .where(ActionLog.session_id == session.id)
                .order_by(ActionLog.created_at.desc())  # type: ignore
                .limit(1)
            ).first()

            # 各アクティブクエストの進行状況を更新
            for quest in active_quests:
                updated_quest = await quest_service.update_quest_progress(
                    quest_id=quest.id, character_id=character.id, recent_action=latest_action_log
                )
                if updated_quest and updated_quest.status == QuestStatus.COMPLETED:
                    logger.info(f"Quest completed: {updated_quest.title}")

            # セッションデータの更新
            session_data["turn_count"] = current_turn
            session_data["actions_history"] = actions_history
            session_data["last_action_at"] = datetime.utcnow().isoformat()

            # セッションのメトリクスを更新
            session.turn_count = current_turn
            session.word_count = (
                session.word_count
                + len(action_request.action_text)
                + len(getattr(coordinator_response, "narrative", ""))
            )

            # 状態変更の適用（もしあれば）
            if (
                hasattr(coordinator_response, "state_changes")
                and coordinator_response.state_changes
                and character_stats
            ):
                self._apply_state_changes(character_stats, coordinator_response.state_changes)

            # セッションの更新
            session.session_data = json.dumps(session_data)
            session.current_scene = (
                getattr(coordinator_response, "narrative", "物語は続きます...")[:200] + "..."
                if hasattr(coordinator_response, "narrative")
                and coordinator_response.narrative
                and len(coordinator_response.narrative) > 200
                else (getattr(coordinator_response, "narrative", "物語は続きます...") or "物語は続きます...")
            )
            session.updated_at = datetime.utcnow()

            self.db.add(session)
            self.db.add(character)
            if character_stats:
                self.db.add(character_stats)
            self.db.commit()

            # AI処理完了の通知
            await GameEventEmitter.emit_custom_event(
                session.id,
                "processing_completed",
                {
                    "status": "AI処理が完了しました"
                }
            )

            # アクション結果をWebSocketで送信
            await GameEventEmitter.emit_action_result(
                session.id,
                character.user_id,
                action_request.action_text,
                {
                    "message_id": gm_message.id,  # 保存されたメッセージのID
                    "success": coordinator_response.state_changes.get("success", True)
                    if coordinator_response.state_changes
                    else True,
                    "narrative": getattr(coordinator_response, "narrative", "物語は続きます..."),
                    "choices": [
                        {"id": choice.id, "text": choice.text, "description": getattr(choice, "description", None)}
                        for choice in coordinator_response.choices
                    ]
                    if hasattr(coordinator_response, "choices") and coordinator_response.choices
                    else [],
                    "turn": action_record["turn"],
                    "state_changes": getattr(coordinator_response, "state_changes", {}),
                },
            )

            # キャラクター状態更新を送信
            await GameEventEmitter.emit_player_status_update(
                session.id,
                character.user_id,
                {
                    "hp": character_stats.health if character_stats else 100,
                    "mp": character_stats.mp if character_stats else 100,
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
            if hasattr(coordinator_response, "choices") and coordinator_response.choices:
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
                success=getattr(coordinator_response, "state_changes", {}).get("success", True)
                if hasattr(coordinator_response, "state_changes") and coordinator_response.state_changes
                else True,
                turn_number=int(action_record["turn"]),
                narrative=getattr(coordinator_response, "narrative", "物語は続きます...") or "物語は続きます...",
                choices=action_choices,
                character_state={
                    "hp": character_stats.health if character_stats else 100,
                    "mp": character_stats.mp if character_stats else 100,
                    "location": character.location,
                },
                metadata={
                    **getattr(coordinator_response, "metadata", {}),
                    "state_changes": getattr(coordinator_response, "state_changes", {}),
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
            if hasattr(coordinator_response, "narrative"):
                coordinator_response.narrative += f"\n\n{result.narrative}"

            # 戦闘終了チェック
            battle_ended, victory, rewards = self.battle_service.check_battle_end(updated_battle_data)

            if battle_ended:
                # 戦闘終了処理
                updated_battle_data.state = BattleState.FINISHED
                session_data["battle_data"] = updated_battle_data.model_dump()

                if victory is not None:
                    if victory:
                        if hasattr(coordinator_response, "narrative"):
                            coordinator_response.narrative += "\n\n戦闘に勝利した！"
                        if rewards:
                            if hasattr(coordinator_response, "narrative"):
                                coordinator_response.narrative += f"\n経験値 {rewards['experience']} を獲得！"
                            # 報酬を状態変更に追加
                            if hasattr(coordinator_response, "state_changes"):
                                if not coordinator_response.state_changes:
                                    coordinator_response.state_changes = {}
                                coordinator_response.state_changes["parameter_changes"] = {
                                    "experience": rewards["experience"]
                                }
                    else:
                        if hasattr(coordinator_response, "narrative"):
                            coordinator_response.narrative += "\n\n戦闘に敗北した..."
                else:
                    if hasattr(coordinator_response, "narrative"):
                        coordinator_response.narrative += "\n\n戦闘から逃走した。"

                # 通常の選択肢に戻す
                return None
            else:
                # ターンを進める
                next_actor_id, is_player_turn = self.battle_service.advance_turn(updated_battle_data)
                session_data["battle_data"] = updated_battle_data.model_dump()

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
                        if hasattr(coordinator_response, "narrative"):
                            coordinator_response.narrative += f"\n\n{enemy_result.narrative}"

                        # 再度ターンを進める（プレイヤーに戻す）
                        next_actor_id, is_player_turn = self.battle_service.advance_turn(updated_battle_data)
                        session_data["battle_data"] = updated_battle_data.model_dump()

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
            character_stats.mp = max(0, min(character_stats.max_mp, character_stats.mp + parameter_changes["mp"]))

        if "experience" in parameter_changes:
            character_stats.experience += parameter_changes["experience"]
            # レベルアップチェック（簡易版）
            while character_stats.experience >= character_stats.level * 100:
                character_stats.experience -= character_stats.level * 100
                character_stats.level += 1
                character_stats.max_health += 10
                character_stats.max_mp += 5
                character_stats.health = character_stats.max_health
                character_stats.mp = character_stats.max_mp

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
        # 現在地に派遣中のログを検索
        from sqlalchemy import and_

        from app.models.log import CompletedLog
        from app.models.log_dispatch import DispatchStatus, LogDispatch

        stmt = (
            select(LogDispatch, CompletedLog)
            .join(CompletedLog, col(LogDispatch.completed_log_id) == col(CompletedLog.id))
            .where(
                and_(
                    col(LogDispatch.status) == DispatchStatus.DISPATCHED,
                    col(LogDispatch.current_location) == character.location,
                )
            )
        )

        results = self.db.exec(stmt).all()

        encounters = []
        for dispatch, completed_log in results:
            # 自分が派遣したログとは遭遇しない
            if dispatch.dispatcher_id == character.id:
                continue

            # 遭遇確率の計算
            encounter_chance = self._calculate_encounter_chance(character, dispatch, completed_log)

            # 確率に基づいて遭遇判定
            if random.random() <= encounter_chance:
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
                    "encounter_chance": encounter_chance,  # デバッグ用
                }
                encounters.append(encounter_data)

                # 最大遭遇数の制限（デフォルト: 3体まで）
                if len(encounters) >= 3:
                    break

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

    def _calculate_encounter_chance(self, character: Character, dispatch: Any, completed_log: Any) -> float:
        """
        遭遇確率を計算

        Args:
            character: プレイヤーキャラクター
            dispatch: 派遣データ
            completed_log: 完成ログデータ

        Returns:
            遭遇確率（0.0～1.0）
        """
        from app.models.log_dispatch import DispatchObjectiveType

        # 基本遭遇確率
        base_chance = 0.3

        # 目的タイプによる確率修正
        objective_modifiers = {
            DispatchObjectiveType.INTERACT: 0.5,  # 交流型は高確率
            DispatchObjectiveType.TRADE: 0.3,  # 商業型は中確率
            DispatchObjectiveType.EXPLORE: 0.2,  # 探索型は低確率
            DispatchObjectiveType.GUARD: 0.1,  # 護衛型は極低確率
            DispatchObjectiveType.FREE: 0.3,  # 自由型は中確率
            DispatchObjectiveType.RESEARCH: 0.15,  # 研究型は低確率
            DispatchObjectiveType.MEMORY_PRESERVE: 0.2,  # 記憶保存型は低確率
        }

        objective_modifier = objective_modifiers.get(dispatch.objective_type, 0.2)

        # 性格特性による修正
        personality_modifier = 0.0
        if completed_log.personality_traits:
            if "社交的" in completed_log.personality_traits or "友好的" in completed_log.personality_traits:
                personality_modifier += 0.1
            if "人見知り" in completed_log.personality_traits or "慎重" in completed_log.personality_traits:
                personality_modifier -= 0.1
            if "好奇心旺盛" in completed_log.personality_traits:
                personality_modifier += 0.05

        # 汚染度による修正（高汚染度は予測不能な遭遇を増やす）
        contamination_modifier = completed_log.contamination_level * 0.1

        # 時間帯による修正（将来実装用のプレースホルダー）
        time_modifier = 0.0
        # TODO: セッションデータから時間帯を取得して修正を計算

        # 最終確率の計算
        final_chance = base_chance + objective_modifier + personality_modifier + contamination_modifier + time_modifier

        # 0.0～1.0の範囲に制限
        return float(max(0.0, min(1.0, final_chance)))

    def _is_exploration_action(self, action_request: ActionExecuteRequest) -> bool:
        """アクションが探索関連かどうかを判定"""
        exploration_keywords = ["探索", "調べる", "探す", "捜索", "移動", "向かう", "行く"]
        return any(keyword in action_request.action_text for keyword in exploration_keywords)

    async def _process_exploration_action(
        self,
        character: Character,
        session: GameSession,
        action_request: ActionExecuteRequest,
        player_action: PlayerAction,
        session_response: GameSessionResponse,
    ) -> Any:
        """探索アクションを物語として処理"""

        # 探索結果の判定
        exploration_result = await self._perform_exploration(character)

        # 探索結果を物語のコンテキストに追加
        player_action.metadata = player_action.metadata or {}
        player_action.metadata["exploration_result"] = exploration_result

        # CoordinatorAIで物語を生成
        coordinator_response = await self.coordinator.process_action(player_action, session_response)

        # 探索で何か見つかった場合、それを物語に組み込む
        if exploration_result.get("found_fragment"):
            fragment_data = exploration_result["fragment"]
            additional_narrative = f"\n\n探索中に、{fragment_data['rarity']}な記憶の欠片を発見しました。それは「{fragment_data['description'][:50]}...」という記憶でした。"

            if hasattr(coordinator_response, "narrative"):
                coordinator_response.narrative += additional_narrative

        return coordinator_response

    async def _perform_exploration(self, character: Character) -> dict:
        """探索を実行してフラグメントを発見する可能性がある"""
        import random

        from app.models.log import EmotionalValence, LogFragment, LogFragmentRarity

        # 基本発見確率
        discovery_chance = 0.3

        # 場所による確率修正
        if character.location_id:
            location = self.db.exec(select(Location).where(Location.id == character.location_id)).first()
            if location and hasattr(location, "fragment_discovery_rate"):
                discovery_chance = location.fragment_discovery_rate

        # フラグメント発見判定
        if random.random() <= discovery_chance:
            # レアリティ判定
            rarity_roll = random.random()
            if rarity_roll < 0.6:
                rarity = LogFragmentRarity.COMMON
            elif rarity_roll < 0.85:
                rarity = LogFragmentRarity.UNCOMMON
            elif rarity_roll < 0.95:
                rarity = LogFragmentRarity.RARE
            else:
                rarity = LogFragmentRarity.EPIC

            # フラグメントを生成
            fragment = LogFragment(
                character_id=character.id,
                action_description=f"{character.name}が探索中に発見した記憶",
                response_description="古い記憶の断片が見つかった",
                location=character.location,
                emotional_valence=random.choice([EmotionalValence.NEUTRAL, EmotionalValence.POSITIVE, EmotionalValence.POSITIVE]),  # ポジティブ寄り
                rarity=rarity,
                keywords=["探索", "発見", character.location],
            )

            self.db.add(fragment)
            self.db.commit()
            self.db.refresh(fragment)

            return {
                "found_fragment": True,
                "fragment": {
                    "id": fragment.id,
                    "rarity": rarity.value,
                    "description": fragment.action_description,
                    "emotional_valence": fragment.emotional_valence,
                },
            }

        return {"found_fragment": False}

    def save_message(
        self,
        session_id: str,
        message_type: str,
        sender_type: str,
        content: str,
        turn_number: int,
        metadata: Optional[dict] = None,
    ) -> GameMessage:
        """ゲームメッセージをデータベースに保存"""
        message = GameMessage(
            id=str(uuid.uuid4()),
            session_id=session_id,
            message_type=message_type,
            sender_type=sender_type,
            content=content,
            turn_number=turn_number,
            message_metadata=metadata,
        )

        self.db.add(message)
        # コミットはexecute_actionメソッドで一括で行う

        return message

    def get_session_history(
        self, character_id: str, page: int = 1, per_page: int = 20, status_filter: Optional[str] = None
    ) -> dict[str, Any]:
        """キャラクターのセッション履歴を取得（ページネーション付き）"""
        # ベースクエリ
        query = select(GameSession).where(GameSession.character_id == character_id)

        # ステータスフィルタ
        if status_filter:
            query = query.where(GameSession.session_status == status_filter)

        # 合計件数を取得
        from sqlalchemy import func

        count_query = select(func.count()).where(GameSession.character_id == character_id)
        if status_filter:
            count_query = count_query.where(GameSession.session_status == status_filter)
        total = self.db.scalar(count_query) or 0

        # ページネーション
        offset = (page - 1) * per_page
        query = query.order_by(desc(GameSession.created_at)).offset(offset).limit(per_page)

        sessions = self.db.exec(query).all()

        # ページ情報計算
        total_pages = (total + per_page - 1) // per_page
        has_next = page < total_pages
        has_prev = page > 1

        return {
            "sessions": sessions,
            "total": total,
            "page": page,
            "per_page": per_page,
            "has_next": has_next,
            "has_prev": has_prev,
        }

    async def continue_session(self, character: Character, previous_session_id: str) -> GameSessionResponse:
        """前回のセッション結果を引き継いで新しいセッションを開始"""
        # 前回のセッションを取得
        stmt = select(GameSession).where(
            GameSession.id == previous_session_id, GameSession.character_id == character.id
        )
        previous_session = self.db.exec(stmt).first()

        if not previous_session:
            raise ValueError("指定されたセッションが見つかりません")

        if previous_session.session_status != "completed":
            raise ValueError("前回のセッションが完了していません")

        # セッション結果を取得
        from app.models.game.session_result import SessionResult

        stmt_result = select(SessionResult).where(SessionResult.session_id == previous_session_id)
        session_result = self.db.exec(stmt_result).first()

        # 既存のアクティブセッションを終了
        stmt_active = select(GameSession).where(GameSession.character_id == character.id, GameSession.is_active)
        existing_sessions = self.db.exec(stmt_active).all()
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
            session_data=json.dumps(
                {
                    "turn_count": 0,
                    "actions_history": [],
                    "game_state": "started",
                    "previous_session_summary": session_result.story_summary if session_result else None,
                    "continuation_context": session_result.continuation_context if session_result else None,
                    "unresolved_plots": session_result.unresolved_plots if session_result else [],
                }
            ),
            session_status=SESSION_STATUS_ACTIVE,
            session_number=previous_session.session_number + 1,
            previous_session_id=previous_session_id,
            story_arc_id=previous_session.story_arc_id,  # ストーリーアークを引き継ぐ
            is_first_session=False,
            turn_count=0,
            word_count=0,
            play_duration_minutes=0,
            ending_proposal_count=0,
        )

        self.db.add(new_session)
        self.db.commit()
        self.db.refresh(new_session)

        # ストーリーアークの処理
        # 既存のアクティブなアークがあればそれを引き継ぐ
        active_arc = self.story_arc_service.get_active_story_arc(character)
        if active_arc:
            # アークが完了に近い場合は新しいアークの提案を検討
            if active_arc.progress_percentage >= 80.0:
                # TODO: AIを使用して次のアークを提案
                pass

            # セッションをアークに関連付け
            self.story_arc_service.associate_session_with_arc(new_session, active_arc)

        # セッション開始のシステムメッセージを保存
        continuation_info = {
            "session_number": new_session.session_number,
            "previous_session_id": previous_session_id,
            "character_id": character.id,
            "character_name": character.name,
            "has_continuation_context": bool(session_result and session_result.continuation_context),
            "unresolved_plots_count": len(session_result.unresolved_plots) if session_result else 0,
        }

        self.save_message(
            session_id=new_session.id,
            message_type=MESSAGE_TYPE_SYSTEM_EVENT,
            sender_type=SENDER_TYPE_SYSTEM,
            content=f"セッション #{new_session.session_number} を開始しました。前回のセッションから物語を継続します。",
            turn_number=0,
            metadata=continuation_info,
        )

        # 継続コンテキストがある場合、GMナラティブとして最初のメッセージを生成
        if session_result and session_result.continuation_context:
            # AIによる継続ナラティブ生成
            try:
                narrative = await self.coordinator.generate_continuation_narrative(
                    character=character,
                    story_summary=session_result.story_summary or "",
                    continuation_context=session_result.continuation_context,
                    unresolved_plots=session_result.unresolved_plots or [],
                )
            except Exception as e:
                logger.error(f"Failed to generate continuation narrative: {e}")
                # フォールバックナラティブ
                narrative = (
                    f"前回の冒険から時間が経ち、あなたは再び動き出す準備ができた。{session_result.continuation_context}"
                )
        else:
            # 継続コンテキストがない場合のデフォルトナラティブ
            narrative = "新たな冒険の幕開けです。あなたの前には無限の可能性が広がっています。"

        self.save_message(
            session_id=new_session.id,
            message_type=MESSAGE_TYPE_GM_NARRATIVE,
            sender_type=SENDER_TYPE_GM,
            content=narrative,
            turn_number=1,
            metadata={"is_continuation": True},
        )

        self.db.commit()

        logger.info(
            "Session continued",
            new_session_id=new_session.id,
            previous_session_id=previous_session_id,
            character_id=character.id,
            session_number=new_session.session_number,
        )

        return self.get_session_response(new_session)

    async def get_ending_proposal(self, session_id: str, character: Character) -> Optional[SessionEndingProposal]:
        """
        セッション終了提案を取得

        Args:
            session_id: セッションID
            character: キャラクター

        Returns:
            終了提案（提案がない場合はNone）
        """
        # セッション取得
        session = self.db.get(GameSession, session_id)
        if not session or session.character_id != character.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

        if not session.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session is not active")

        # セッション統計を収集
        session_stats = {
            "turn_count": session.turn_count,
            "play_duration_minutes": int((datetime.utcnow() - session.created_at).total_seconds() / 60),
            "word_count": session.word_count,
        }

        # プロンプトコンテキストを構築
        from app.services.ai.prompt_manager import PromptContext

        # 最近のメッセージを取得
        recent_messages = self.db.exec(
            select(GameMessage)
            .where(GameMessage.session_id == session_id)
            .order_by(desc(GameMessage.turn_number))
            .limit(10)
        ).all()

        recent_actions = []
        for msg in reversed(recent_messages):
            if msg.message_type == MESSAGE_TYPE_PLAYER_ACTION:
                recent_actions.append(msg.content)

        # キャラクターステータス
        # CharacterからCharacterStatsを取得
        if character.stats:
            character_stats = {
                "hp": character.stats.health,
                "max_hp": character.stats.max_health,
                "mp": character.stats.mp,
                "max_mp": character.stats.max_mp,
                "sp": 100,  # SPはCharacterStatsに含まれていないのでデフォルト値
                "level": character.stats.level,
            }
        else:
            # statsがない場合のデフォルト値
            character_stats = {
                "hp": 100,
                "max_hp": 100,
                "mp": 100,
                "max_mp": 100,
                "sp": 100,
                "level": 1,
            }

        # セッションデータから世界の状態を取得
        session_data = json.loads(session.session_data) if session.session_data else {}
        world_state = session_data.get("world_state", {})

        context = PromptContext(
            character_name=character.name,
            character_stats=character_stats,
            location=character.location,
            recent_actions=recent_actions,
            world_state=world_state,
            additional_context={},
        )

        # 脚本家AIに終了判定を依頼
        proposal = await self.dramatist_agent.evaluate_session_ending(
            context=context, session_stats=session_stats, proposal_count=session.ending_proposal_count
        )

        return proposal

    async def accept_ending(self, session_id: str, character: Character) -> SessionEndingAcceptResponse:
        """
        セッション終了を承認

        Args:
            session_id: セッションID
            character: キャラクター

        Returns:
            終了承認レスポンス
        """
        # セッション取得
        session = self.db.get(GameSession, session_id)
        if not session or session.character_id != character.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

        if not session.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session is not active")

        # セッションを終了状態に更新
        session.is_active = False
        session.session_status = SESSION_STATUS_COMPLETED
        session.updated_at = datetime.utcnow()

        # リザルトIDを生成（実際のリザルト処理は非同期で実行）
        result_id = str(uuid.uuid4())

        # セッション終了のシステムメッセージを保存
        self.save_message(
            session_id=session.id,
            message_type=MESSAGE_TYPE_SYSTEM_EVENT,
            sender_type=SENDER_TYPE_SYSTEM,
            content=f"セッション #{session.session_number} が終了しました。",
            turn_number=session.turn_count + 1,
            metadata={
                "event_type": "session_ended",
                "result_id": result_id,
                "ending_accepted": True,
            },
        )

        self.db.commit()

        # Celeryタスクでリザルト処理を開始
        from app.tasks.session_result_tasks import process_session_result

        process_session_result.delay(session_id)

        logger.info("Session ending accepted", session_id=session_id, character_id=character.id, result_id=result_id)

        return SessionEndingAcceptResponse(result_id=result_id, processing_status="processing")

    async def reject_ending(self, session_id: str, character: Character) -> SessionEndingRejectResponse:
        """
        セッション終了を拒否

        Args:
            session_id: セッションID
            character: キャラクター

        Returns:
            終了拒否レスポンス
        """
        # セッション取得
        session = self.db.get(GameSession, session_id)
        if not session or session.character_id != character.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

        if not session.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session is not active")

        # 提案回数をインクリメント
        session.ending_proposal_count += 1
        session.last_proposal_at = datetime.utcnow()
        session.updated_at = datetime.utcnow()

        # 次回も拒否可能かチェック
        can_reject_next = session.ending_proposal_count < 3

        # 拒否のシステムメッセージを保存
        self.save_message(
            session_id=session.id,
            message_type=MESSAGE_TYPE_SYSTEM_EVENT,
            sender_type=SENDER_TYPE_SYSTEM,
            content="セッション終了提案を拒否しました。冒険を続けます。",
            turn_number=session.turn_count + 1,
            metadata={
                "event_type": "ending_rejected",
                "proposal_count": session.ending_proposal_count,
                "can_reject_next": can_reject_next,
            },
        )

        self.db.commit()

        # メッセージを構築
        if can_reject_next:
            message = "冒険を続けます。次回の区切りで再度終了を提案させていただきます。"
        else:
            message = "冒険を続けます。次回の区切りでは必ず終了となりますのでご了承ください。"

        logger.info(
            "Session ending rejected",
            session_id=session_id,
            character_id=character.id,
            proposal_count=session.ending_proposal_count,
        )

        return SessionEndingRejectResponse(
            proposal_count=session.ending_proposal_count, can_reject_next=can_reject_next, message=message
        )

    async def get_session_result(self, session_id: str, character: Character) -> Optional[SessionResultResponse]:
        """
        セッション結果を取得

        Args:
            session_id: セッションID
            character: キャラクター

        Returns:
            セッション結果（まだ処理されていない場合はNone）
        """
        # セッション取得
        session = self.db.get(GameSession, session_id)
        if not session or session.character_id != character.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

        # 結果が処理されているかチェック
        if session.session_status != SESSION_STATUS_COMPLETED:
            return None

        # SessionResultを取得
        from app.models.game.session_result import SessionResult

        stmt = select(SessionResult).where(SessionResult.session_id == session_id)
        result = self.db.exec(stmt).first()

        if not result:
            # リザルトがまだ生成されていない場合
            return None

        # レスポンスを構築
        return SessionResultResponse(
            id=result.id,
            session_id=result.session_id,
            story_summary=result.story_summary,
            key_events=result.key_events if result.key_events else [],
            experience_gained=result.experience_gained,
            skills_improved=result.skills_improved if result.skills_improved else {},
            items_acquired=result.items_acquired if result.items_acquired else [],
            continuation_context=result.continuation_context,
            unresolved_plots=result.unresolved_plots if result.unresolved_plots else [],
            created_at=result.created_at,
        )
