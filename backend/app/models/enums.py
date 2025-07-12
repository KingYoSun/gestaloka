"""
ゲーム内で使用される列挙型の定義
"""

from enum import Enum


class Weather(str, Enum):
    """天候の種類"""

    CLEAR = "clear"  # 晴れ
    RAIN = "rain"  # 雨
    STORM = "storm"  # 嵐
    FOG = "fog"  # 霧
    SNOW = "snow"  # 雪


class TimeOfDay(str, Enum):
    """時間帯"""

    DAWN = "dawn"  # 夜明け (05:00-07:00)
    MORNING = "morning"  # 朝 (07:00-12:00)
    AFTERNOON = "afternoon"  # 午後 (12:00-17:00)
    EVENING = "evening"  # 夕方 (17:00-19:00)
    NIGHT = "night"  # 夜 (19:00-05:00)


class ItemType(str, Enum):
    """アイテムの種類"""

    WEAPON = "weapon"  # 武器
    ARMOR = "armor"  # 防具
    CONSUMABLE = "consumable"  # 消費アイテム
    MATERIAL = "material"  # 素材
    KEY_ITEM = "key_item"  # キーアイテム
    CURRENCY = "currency"  # 通貨


class QuestStatus(str, Enum):
    """クエストの状態"""

    NOT_STARTED = "not_started"  # 未開始
    IN_PROGRESS = "in_progress"  # 進行中
    COMPLETED = "completed"  # 完了
    FAILED = "failed"  # 失敗
    ABANDONED = "abandoned"  # 放棄