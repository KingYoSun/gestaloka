"""
Neo4jグラフデータベースモデル定義
"""

from datetime import datetime, UTC
from typing import Optional

from neomodel import (
    BooleanProperty,
    DateTimeProperty,
    FloatProperty,
    IntegerProperty,
    JSONProperty,
    RelationshipFrom,
    RelationshipTo,
    StringProperty,
    StructuredNode,
    StructuredRel,
    UniqueIdProperty,
)


# 関係性モデル
class InteractedWith(StructuredRel):
    """相互作用関係"""

    interaction_type = StringProperty(required=True)  # 例: "conversation", "battle", "trade"
    timestamp = DateTimeProperty(default_now=True)
    emotional_impact = FloatProperty(default=0.0)  # -1.0 to 1.0
    details = JSONProperty()


class LocatedIn(StructuredRel):
    """位置関係"""

    since = DateTimeProperty(default_now=True)
    is_current = BooleanProperty(default=True)


class OriginatedFrom(StructuredRel):
    """起源関係（ログNPCの元となったログ）"""

    created_at = DateTimeProperty(default_now=True)
    contamination_level = IntegerProperty(required=True)


# ノードモデル
class Location(StructuredNode):
    """場所ノード"""

    uid = UniqueIdProperty()
    name = StringProperty(required=True, unique_index=True)
    layer = IntegerProperty(required=True)  # 階層（0-9）
    description = StringProperty()
    coordinates = JSONProperty()  # {"x": 0, "y": 0}
    properties = JSONProperty()  # 場所の特性

    # 関係性
    npcs = RelationshipFrom("NPC", "LOCATED_IN", model=LocatedIn)
    connected_to = RelationshipTo("Location", "CONNECTED_TO")


class Player(StructuredNode):
    """プレイヤーノード"""

    uid = UniqueIdProperty()
    user_id = StringProperty(required=True, unique_index=True)
    character_name = StringProperty(required=True)
    current_session_id = StringProperty()

    # 関係性
    npcs_created = RelationshipTo("NPC", "CREATED")
    interactions = RelationshipTo("NPC", "INTERACTED_WITH", model=InteractedWith)
    current_location = RelationshipTo("Location", "LOCATED_IN", model=LocatedIn)


class CompletedLogNode(StructuredNode):
    """完成ログノード（PostgreSQLのCompletedLogと連携）"""

    uid = UniqueIdProperty()
    log_id = StringProperty(required=True, unique_index=True)  # PostgreSQLのUUID
    name = StringProperty(required=True)
    title = StringProperty()
    contamination_level = IntegerProperty(required=True)

    # 関係性
    npcs = RelationshipTo("NPC", "MANIFESTED_AS")
    created_by = RelationshipFrom("Player", "CREATED")


class NPC(StructuredNode):
    """NPCノード"""

    uid = UniqueIdProperty()
    npc_id = StringProperty(required=True, unique_index=True)
    name = StringProperty(required=True)
    title = StringProperty()
    npc_type = StringProperty(required=True)  # "LOG_NPC", "PERMANENT_NPC", "TEMPORARY_NPC"

    # 基本属性
    personality_traits = JSONProperty()  # 性格特性のリスト
    behavior_patterns = JSONProperty()  # 行動パターンのリスト
    skills = JSONProperty()  # スキルのリスト
    appearance = StringProperty()  # 外見の説明
    backstory = StringProperty()  # 背景ストーリー

    # ログNPC固有
    original_player = StringProperty()  # 元のプレイヤーID（ログNPCの場合）
    log_source = StringProperty()  # 元のログID（ログNPCの場合）
    contamination_level = IntegerProperty(default=0)  # 汚染度

    # ステータス
    persistence_level = IntegerProperty(default=5)  # 永続性レベル（1-10）
    is_active = BooleanProperty(default=True)
    last_active = DateTimeProperty(default_now=True)
    created_at = DateTimeProperty(default_now=True)

    # メタデータ
    memory_summary = StringProperty()  # AIが保持する記憶の要約
    interaction_count = IntegerProperty(default=0)
    emotional_state = JSONProperty()  # 現在の感情状態

    # 関係性
    current_location = RelationshipTo("Location", "LOCATED_IN", model=LocatedIn)
    interactions = RelationshipFrom("Player", "INTERACTED_WITH", model=InteractedWith)
    other_npcs = RelationshipTo("NPC", "KNOWS")
    originated_from = RelationshipTo("CompletedLogNode", "ORIGINATED_FROM", model=OriginatedFrom)


class Event(StructuredNode):
    """イベントノード（世界で起きた出来事）"""

    uid = UniqueIdProperty()
    event_type = StringProperty(required=True)
    description = StringProperty(required=True)
    timestamp = DateTimeProperty(default_now=True)
    location_id = StringProperty()

    # 関係性
    participants = RelationshipTo("NPC", "PARTICIPATED_IN")
    affected_players = RelationshipTo("Player", "AFFECTED")
    location = RelationshipTo("Location", "OCCURRED_AT")


# ヘルパー関数
def create_npc_from_log(completed_log_data: dict, location: Optional[Location] = None) -> NPC:
    """CompletedLogデータからNPCノードを作成"""

    npc = NPC(
        npc_id=f"log_npc_{completed_log_data['id']}",
        name=completed_log_data["name"],
        title=completed_log_data.get("title", ""),
        npc_type="LOG_NPC",
        personality_traits=completed_log_data.get("personality_traits", []),
        behavior_patterns=completed_log_data.get("behavior_patterns", []),
        skills=completed_log_data.get("skills", []),
        appearance=completed_log_data.get("description", ""),
        backstory=completed_log_data.get("description", ""),
        original_player=completed_log_data.get("player_id", ""),
        log_source=str(completed_log_data["id"]),
        contamination_level=completed_log_data.get("contamination_level", 0),
        persistence_level=min(7, max(3, 5 + completed_log_data.get("contamination_level", 0) // 20)),
    ).save()

    # 場所に配置
    if location:
        npc.current_location.connect(location, {"is_current": True})

    # ログノードとの関連付け
    log_node = CompletedLogNode.nodes.get_or_none(log_id=str(completed_log_data["id"]))
    if not log_node:
        log_node = CompletedLogNode(
            log_id=str(completed_log_data["id"]),
            name=completed_log_data["name"],
            title=completed_log_data.get("title", ""),
            contamination_level=completed_log_data.get("contamination_level", 0),
        ).save()

    npc.originated_from.connect(
        log_node,
        {
            "created_at": datetime.now(UTC),
            "contamination_level": completed_log_data.get("contamination_level", 0),
        },
    )

    return npc  # type: ignore[no-any-return]
