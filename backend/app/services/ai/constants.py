"""AI関連の共通定数定義"""

# Geminiモデル設定
DEFAULT_TEMPERATURE = 0.8
DEFAULT_MAX_TOKENS = 1500
HIGH_CREATIVITY_TEMPERATURE = 0.9
LOW_CREATIVITY_TEMPERATURE = 0.5

# レート制限
MAX_RETRIES = 3
RETRY_DELAY = 1.0

# レスポンス設定
JSON_BLOCK_PATTERN = r"```json\s*(.*?)\s*```"
MIN_CHOICES = 2
MAX_CHOICES = 5

# 世界観設定
WORLD_NAME = "ゲスタロカ"
WORLD_DESCRIPTION = "混沌と秩序が織りなす物語の世界"

# システムプロンプトの共通部分
BASE_SYSTEM_PROMPT = """あなたは物語世界「{world_name}」のGMです。
この世界は{world_description}です。
プレイヤーの行動に対して、適切な物語展開を提供してください。"""

# アノマリー設定
ANOMALY_COOLDOWN_ACTIONS = 10
ANOMALY_BASE_PROBABILITY = 0.15
ANOMALY_INTENSITY_LEVELS = {
    "minor": {"min": 1, "max": 3},
    "moderate": {"min": 4, "max": 6},
    "major": {"min": 7, "max": 9},
    "catastrophic": {"min": 10, "max": 10}
}

# NPC設定
NPC_SPAWN_PROBABILITY = 0.3
MAX_NPCS_PER_LOCATION = 10
TEMPORARY_NPC_DURATION_DAYS = 7

# ストーリー設定
STORY_MIN_LENGTH = 100
STORY_MAX_LENGTH = 300
CONTINUATION_NARRATIVE_LENGTH = 200

# タスク実行時間（秒）
TASK_EXECUTION_TIMES = {
    "dramatist": 3.0,
    "historian": 2.0,
    "state_manager": 1.5,
    "anomaly": 2.5,
    "the_world": 3.0,
    "npc_manager": 2.0
}
