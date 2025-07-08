"""
初回セッション初期化サービス

キャラクターの最初のセッションに特別な初期化処理を提供
"""

from datetime import UTC, datetime

from sqlmodel import Session

from app.core.logging import get_logger
from app.models.character import Character, GameSession
from app.models.game_message import (
    MESSAGE_TYPE_SYSTEM_EVENT,
    SENDER_TYPE_SYSTEM,
)
from app.models.quest import Quest, QuestOrigin, QuestStatus

logger = get_logger(__name__)


# ゲスタロカ世界への導入テキスト
GESTALOKA_INTRO_TEMPLATE = """ようこそ、{character_name}。

あなたは今、基点都市ネクサスの入口に立っている。
高い城壁に囲まれたこの都市は、あらゆる世界と次元が交差する特別な場所だ。

この世界「ゲスタロカ」では、すべての行動が「ログ」として記録され、
あなたの物語は永遠に残り、他の冒険者たちの世界にも影響を与えることになる。

街の入口から見える景色は活気に満ちている。
商人たちの呼び声、冒険者たちの談笑、どこからか漂う料理の香り...

さあ、あなたの物語を始めよう。これからどうする？"""


class FirstSessionInitializer:
    """初回セッション初期化サービス"""

    def __init__(self, db: Session):
        self.db = db

    def create_first_session(self, character: Character) -> GameSession:
        """
        キャラクターの最初のセッションを作成

        Args:
            character: 対象キャラクター

        Returns:
            作成されたゲームセッション
        """
        logger.info(f"Creating first session for character: {character.name}")

        # セッションを作成
        import json
        import uuid

        session = GameSession(
            id=str(uuid.uuid4()),
            character_id=character.id,
            is_active=True,
            is_first_session=True,
            session_number=1,
            session_status="ACTIVE",
            turn_number=0,
            word_count=0,
            play_duration_minutes=0,
            current_scene="基点都市ネクサス・入口",
            session_data=json.dumps(
                {
                    "intro_completed": False,
                    "tutorial_stage": "world_introduction",
                    "initial_location": "nexus_entrance",
                    "turn_count": 0,
                    "actions_history": [],
                    "game_state": "started",
                }
            ),
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )

        self.db.add(session)
        self.db.flush()  # IDを取得するため

        # 初期クエストを付与
        self._assign_initial_quests(character)

        # システムメッセージを保存（GameMessageモデルを直接使用）
        from app.models.game_message import GameMessage

        system_message = GameMessage(
            id=str(uuid.uuid4()),
            session_id=session.id,
            message_type=MESSAGE_TYPE_SYSTEM_EVENT,
            sender_type=SENDER_TYPE_SYSTEM,
            content="初回セッションが開始されました",
            turn_number=0,
            message_metadata={"event_type": "first_session_start"},
            created_at=datetime.now(UTC),
        )
        self.db.add(system_message)

        return session

    def generate_introduction(self, character: Character) -> str:
        """
        世界観の導入テキストを生成

        Args:
            character: 対象キャラクター

        Returns:
            導入テキスト
        """
        return GESTALOKA_INTRO_TEMPLATE.format(character_name=character.name)

    def generate_initial_choices(self) -> list[dict]:
        """
        最初の選択肢を生成

        Returns:
            選択肢のリスト
        """
        return [
            {
                "id": "explore_city",
                "text": "街を探索して、どんな場所があるか見て回る",
                "description": "基点都市ネクサスの主要な施設を巡ります",
            },
            {
                "id": "talk_to_people",
                "text": "近くにいる人に話しかけて、この街について聞く",
                "description": "地元の人々から情報を集めます",
            },
            {
                "id": "observe_surroundings",
                "text": "まずは周囲を観察して、状況を把握する",
                "description": "慎重に周りの様子を確認します",
            },
        ]

    def _assign_initial_quests(self, character: Character) -> None:
        """
        初期クエストを一括で付与

        Args:
            character: 対象キャラクター
        """
        initial_quests = [
            self._create_exploration_quest(character.id),
            self._create_first_steps_quest(character.id),
            self._create_city_social_quest(character.id),
            self._create_small_errands_quest(character.id),
            self._create_log_fragments_quest(character.id),
            self._create_beyond_walls_quest(character.id),
        ]

        for quest in initial_quests:
            self.db.add(quest)

        logger.info(f"Assigned {len(initial_quests)} initial quests to character: {character.name}")

    def _create_exploration_quest(self, character_id: str) -> Quest:
        """「探求」クエストを作成"""
        quest = Quest(
            character_id=character_id,
            title="探求",
            description="ゲスタロカの世界について理解を深める",
            status=QuestStatus.ACTIVE,
            origin=QuestOrigin.GM_PROPOSED,
            progress_percentage=0.0,
            narrative_completeness=0.0,
            emotional_satisfaction=0.5,
            key_events=[],
            progress_indicators={
                "talk_to_npcs": {
                    "description": "3人のNPCと会話する",
                    "current": 0,
                    "target": 3,
                    "completed": False,
                },
                "visit_facilities": {
                    "description": "主要施設を訪問する",
                    "current": 0,
                    "target": 5,
                    "completed": False,
                },
            },
            context_summary="初回セッション開始時に付与される基本クエスト",
            started_at=datetime.now(UTC),
        )
        return quest

    def _create_first_steps_quest(self, character_id: str) -> Quest:
        """「最初の一歩」クエストを作成"""
        quest = Quest(
            character_id=character_id,
            title="最初の一歩",
            description="ゲームの基本的な操作とシステムを学ぶ",
            status=QuestStatus.ACTIVE,
            origin=QuestOrigin.GM_PROPOSED,
            progress_percentage=0.0,
            narrative_completeness=0.0,
            emotional_satisfaction=0.5,
            key_events=[],
            progress_indicators={
                "complete_battle": {
                    "description": "戦闘を1回完了する",
                    "current": 0,
                    "target": 1,
                    "completed": False,
                },
                "use_skill": {
                    "description": "スキルを使用する",
                    "current": 0,
                    "target": 1,
                    "completed": False,
                },
                "manage_inventory": {
                    "description": "インベントリを開く",
                    "current": 0,
                    "target": 1,
                    "completed": False,
                },
            },
            context_summary="基本操作を学ぶチュートリアルクエスト",
            started_at=datetime.now(UTC),
        )
        return quest

    def _create_city_social_quest(self, character_id: str) -> Quest:
        """「シティボーイ/シティガール」クエストを作成"""
        quest = Quest(
            character_id=character_id,
            title="シティボーイ/シティガール",
            description="NPCとの交流システムを理解する",
            status=QuestStatus.ACTIVE,
            origin=QuestOrigin.GM_PROPOSED,
            progress_percentage=0.0,
            narrative_completeness=0.0,
            emotional_satisfaction=0.5,
            key_events=[],
            progress_indicators={
                "meet_npcs": {
                    "description": "3人の異なるNPCと出会う",
                    "current": 0,
                    "target": 3,
                    "completed": False,
                },
                "gain_affinity": {
                    "description": "誰かとの好感度を上げる",
                    "current": 0,
                    "target": 1,
                    "completed": False,
                },
            },
            context_summary="社交システムを学ぶクエスト",
            started_at=datetime.now(UTC),
        )
        return quest

    def _create_small_errands_quest(self, character_id: str) -> Quest:
        """「小さな依頼」クエストを作成"""
        quest = Quest(
            character_id=character_id,
            title="小さな依頼",
            description="サブクエストの受注と完了の流れを学ぶ",
            status=QuestStatus.ACTIVE,
            origin=QuestOrigin.GM_PROPOSED,
            progress_percentage=0.0,
            narrative_completeness=0.0,
            emotional_satisfaction=0.5,
            key_events=[],
            progress_indicators={
                "deliver_item": {
                    "description": "アイテムを配達する",
                    "current": 0,
                    "target": 1,
                    "completed": False,
                },
                "gather_info": {
                    "description": "情報を収集する",
                    "current": 0,
                    "target": 1,
                    "completed": False,
                },
            },
            context_summary="サブクエストシステムを学ぶクエスト",
            started_at=datetime.now(UTC),
        )
        return quest

    def _create_log_fragments_quest(self, character_id: str) -> Quest:
        """「ログの欠片」クエストを作成"""
        quest = Quest(
            character_id=character_id,
            title="ログの欠片",
            description="ログ収集システムの基礎を理解する",
            status=QuestStatus.ACTIVE,
            origin=QuestOrigin.GM_PROPOSED,
            progress_percentage=0.0,
            narrative_completeness=0.0,
            emotional_satisfaction=0.5,
            key_events=[],
            progress_indicators={
                "find_fragment": {
                    "description": "最初のログフラグメントを発見する",
                    "current": 0,
                    "target": 1,
                    "completed": False,
                },
                "collect_fragment": {
                    "description": "ログフラグメントを収集する",
                    "current": 0,
                    "target": 1,
                    "completed": False,
                },
            },
            context_summary="ゲスタロカのコアメカニクスを学ぶ重要クエスト",
            started_at=datetime.now(UTC),
        )
        return quest

    def _create_beyond_walls_quest(self, character_id: str) -> Quest:
        """「街の外へ」クエストを作成"""
        quest = Quest(
            character_id=character_id,
            title="街の外へ",
            description="ネクサス外の世界への興味を喚起",
            status=QuestStatus.ACTIVE,
            origin=QuestOrigin.GM_PROPOSED,
            progress_percentage=0.0,
            narrative_completeness=0.0,
            emotional_satisfaction=0.5,
            key_events=[],
            progress_indicators={
                "reach_gate": {
                    "description": "街の外門に到達する",
                    "current": 0,
                    "target": 1,
                    "completed": False,
                },
                "survive_encounter": {
                    "description": "野外での遭遇を生き延びる",
                    "current": 0,
                    "target": 1,
                    "completed": False,
                },
            },
            context_summary="次の冒険への導入クエスト",
            started_at=datetime.now(UTC),
        )
        return quest
