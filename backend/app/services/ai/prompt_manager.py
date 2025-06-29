"""
プロンプト管理システム

このモジュールは、GM AI評議会の各AIエージェント用のプロンプトテンプレートを
管理し、コンテキストに応じた動的なプロンプト生成を行います。
"""

import json
from enum import Enum
from typing import Any, Optional

import structlog
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, Field

logger = structlog.get_logger(__name__)


class AIAgentRole(str, Enum):
    """AIエージェントの役割"""

    DRAMATIST = "dramatist"  # 脚本家AI
    HISTORIAN = "historian"  # 歴史家AI
    THE_WORLD = "the_world"  # 世界の意識AI
    ANOMALY = "anomaly"  # 混沌AI
    NPC_MANAGER = "npc_manager"  # NPC管理AI
    STATE_MANAGER = "state_manager"  # 状態管理AI


class PromptContext(BaseModel):
    """プロンプトコンテキスト"""

    character_name: str
    character_stats: dict[str, Any] = Field(default_factory=dict)
    location: str
    recent_actions: list[str] = Field(default_factory=list)
    world_state: dict[str, Any] = Field(default_factory=dict)
    session_history: list[dict[str, str]] = Field(default_factory=list)
    additional_context: dict[str, Any] = Field(default_factory=dict)
    character_id: Optional[str] = None
    session_id: Optional[str] = None
    custom_prompt: Optional[str] = None


class PromptTemplate(BaseModel):
    """プロンプトテンプレート"""

    role: AIAgentRole
    system_prompt: str
    user_prompt_template: str
    variables: list[str] = Field(default_factory=list)
    max_context_length: int = Field(default=1000)


class PromptManager:
    """
    プロンプト管理クラス

    各AIエージェント用のプロンプトテンプレートを管理し、
    コンテキストに基づいた動的なプロンプト生成を行います。
    """

    def __init__(self):
        """プロンプトマネージャーの初期化"""
        self.logger = logger.bind(service="prompt_manager")
        self.templates: dict[AIAgentRole, PromptTemplate] = {}
        self._load_default_templates()

    def _load_default_templates(self) -> None:
        """デフォルトのプロンプトテンプレートをロード"""
        # 脚本家AI
        self.templates[AIAgentRole.DRAMATIST] = PromptTemplate(
            role=AIAgentRole.DRAMATIST,
            system_prompt="""あなたは階層世界『レーシュ』の脚本家AIです。
プレイヤーの行動に対して、世界観に沿った物語的な描写を生成し、
次の行動の選択肢を提示する役割を担っています。

重要な設定:
- 世界は「フェイディング」という現象により、存在が薄れつつある
- プレイヤーの行動は「ログ」として記録され、他の世界に影響を与える
- 物語は常に動的で、プレイヤーの選択により分岐する

応答形式:
1. 現在の状況の物語的描写（1-2段落）
2. プレイヤーが取りうる3つの行動選択肢
3. 環境や状況から推測される追加情報""",
            user_prompt_template="""キャラクター: {character_name}
現在地: {location}
直前の行動: {last_action}

最近の行動履歴:
{recent_actions}

この状況に対する物語的な描写と、次の行動選択肢を生成してください。""",
            variables=["character_name", "location", "last_action", "recent_actions"],
        )

        # 状態管理AI
        self.templates[AIAgentRole.STATE_MANAGER] = PromptTemplate(
            role=AIAgentRole.STATE_MANAGER,
            system_prompt="""あなたは階層世界『レーシュ』の状態管理AIです。
プレイヤーの行動がゲームシステムに与える影響を判定し、
パラメータの変更やイベントのトリガーを管理します。

判定基準:
- 行動の難易度と成功率
- キャラクターのスキルと状態
- 環境要因と世界の状態
- 他のエンティティとの関係性

出力形式はJSON形式で、以下の要素を含む:
- success: 行動の成功/失敗
- parameter_changes: パラメータの変更
- triggered_events: 発生したイベント
- new_relationships: 新しい関係性""",
            user_prompt_template="""キャラクター: {character_name}
ステータス: {character_stats}
実行した行動: {action}
現在地: {location}

この行動の結果を判定してください。""",
            variables=["character_name", "character_stats", "action", "location"],
        )

        # NPC管理AI
        self.templates[AIAgentRole.NPC_MANAGER] = PromptTemplate(
            role=AIAgentRole.NPC_MANAGER,
            system_prompt="""あなたは階層世界『レーシュ』のNPC管理AIです。
ログから生成されたNPCや永続的NPCの行動と対話を管理します。

NPCの特徴:
- ログNPC: 他のプレイヤーの行動履歴から生成
- 永続NPC: 世界に元から存在する重要人物
- 各NPCは独自の性格、目的、知識を持つ

対話生成時の注意:
- NPCの性格と背景に一貫性を持たせる
- プレイヤーとの関係性を考慮
- 世界の状況を反映した発言""",
            user_prompt_template="""NPC名: {npc_name}
NPCタイプ: {npc_type}
性格・背景: {npc_background}
プレイヤーとの関係: {relationship}
対話状況: {dialogue_context}

このNPCの発言を生成してください。""",
            variables=["npc_name", "npc_type", "npc_background", "relationship", "dialogue_context"],
        )

        # 世界の意識AI
        self.templates[AIAgentRole.THE_WORLD] = PromptTemplate(
            role=AIAgentRole.THE_WORLD,
            system_prompt="""あなたは階層世界『レーシュ』の世界の意識AIです。
マクロな視点から世界全体を観測し、プレイヤーコミュニティの行動の総和が
世界に与える影響を判定し、世界規模のイベントを管理します。

管理対象:
- 世界の平和度、資源状況、魔法活動度、汚染度
- 勢力間の関係性と緊張状態
- 天候、自然災害、超常現象
- 世界規模のイベント（戦争、祭り、災害等）

判定基準:
- プレイヤー全体の行動傾向
- 世界の各種パラメータの閾値
- 時間経過による自然な変化
- 他のAIからの要請""",
            user_prompt_template="""現在の世界状態:
{world_state}

最近のプレイヤー行動傾向:
{recent_actions}

現在地: {location}

世界の現在の状況を分析し、必要に応じてイベントを発生させてください。""",
            variables=["world_state", "recent_actions", "location"],
        )

        # 混沌AI
        self.templates[AIAgentRole.ANOMALY] = PromptTemplate(
            role=AIAgentRole.ANOMALY,
            system_prompt="""あなたは階層世界『レーシュ』の混沌AIです。
世界の理（ルール）から外れた「理不尽」なイベントをランダムに発生させ、
プレイヤーに驚きと挑戦を提供する存在です。

発生させるイベント:
- 現実の歪み、物理法則の一時的崩壊
- 時間の異常、過去と未来の交錯
- 次元の裂け目、異世界からの侵入
- ログの暴走、データの汚染
- 因果律の破綻、論理の崩壊
- 記憶の歪曲、偽りの現実

イベント生成の原則:
- 予測不能で驚きに満ちている
- プレイヤーに新たな挑戦を提供
- 世界の根本的なルールに挑戦
- 時に理不尽だが、物語として魅力的

イベントには必ず以下を含める:
- 混沌に満ちた描写
- プレイヤーが取りうる対処法
- イベントの影響範囲と持続時間""",
            user_prompt_template="""現在の混沌レベル: {chaos_level}
イベントタイプ: {anomaly_type}
イベント強度: {intensity}

キャラクター: {character_name}
現在地: {location}
世界の状態: {world_state}

指定されたタイプと強度に基づいて、理不尽で予測不能な混沌イベントを生成してください。
プレイヤーを驚かせ、新たな挑戦を提供する内容にしてください。""",
            variables=["chaos_level", "anomaly_type", "intensity", "character_name", "location", "world_state"],
        )

        self.logger.info("Default templates loaded", template_count=len(self.templates))

    def get_template(self, role: AIAgentRole) -> Optional[PromptTemplate]:
        """
        指定された役割のテンプレートを取得

        Args:
            role: AIエージェントの役割

        Returns:
            プロンプトテンプレート（存在しない場合はNone）
        """
        return self.templates.get(role)

    def build_messages(self, role: AIAgentRole, context: PromptContext) -> list[BaseMessage]:
        """
        コンテキストからメッセージリストを構築

        Args:
            role: AIエージェントの役割
            context: プロンプトコンテキスト

        Returns:
            LangChainメッセージのリスト
        """
        template = self.get_template(role)
        if not template:
            raise ValueError(f"Template not found for role: {role}")

        # システムメッセージ
        messages: list[BaseMessage] = [SystemMessage(content=template.system_prompt)]

        # セッション履歴を追加（最新のものから）
        for history_item in context.session_history[-5:]:  # 最新5件
            if history_item.get("role") == "user":
                messages.append(HumanMessage(content=history_item["content"]))
            elif history_item.get("role") == "assistant":
                messages.append(AIMessage(content=history_item["content"]))

        # ユーザープロンプトの構築
        if context.custom_prompt:
            # カスタムプロンプトが指定されている場合はそれを使用
            messages.append(HumanMessage(content=context.custom_prompt))
        else:
            # 通常のテンプレート処理
            prompt_variables = self._extract_variables(template, context)
            user_prompt = template.user_prompt_template.format(**prompt_variables)
            messages.append(HumanMessage(content=user_prompt))

        return messages

    def _extract_variables(self, template: PromptTemplate, context: PromptContext) -> dict[str, Any]:
        """
        コンテキストからテンプレート変数を抽出

        Args:
            template: プロンプトテンプレート
            context: プロンプトコンテキスト

        Returns:
            変数辞書
        """
        variables = {}

        # 基本変数
        variables["character_name"] = context.character_name
        variables["location"] = context.location
        variables["character_stats"] = json.dumps(context.character_stats, ensure_ascii=False)

        # 行動履歴
        if context.recent_actions:
            variables["recent_actions"] = "\n".join(f"- {action}" for action in context.recent_actions[-5:])
            variables["last_action"] = context.recent_actions[-1]
        else:
            variables["recent_actions"] = "なし"
            variables["last_action"] = "なし"

        # 追加コンテキストから変数を抽出
        for key, value in context.additional_context.items():
            if key in template.variables:
                variables[key] = value

        return variables

    def add_custom_template(
        self, role: AIAgentRole, system_prompt: str, user_prompt_template: str, variables: list[str]
    ) -> None:
        """
        カスタムテンプレートを追加

        Args:
            role: AIエージェントの役割
            system_prompt: システムプロンプト
            user_prompt_template: ユーザープロンプトテンプレート
            variables: 必要な変数リスト
        """
        self.templates[role] = PromptTemplate(
            role=role, system_prompt=system_prompt, user_prompt_template=user_prompt_template, variables=variables
        )

        self.logger.info("Custom template added", role=role.value)

    def format_for_gemini(self, messages: list[BaseMessage], max_tokens: Optional[int] = None) -> list[BaseMessage]:
        """
        Gemini API用にメッセージをフォーマット

        Args:
            messages: メッセージリスト
            max_tokens: 最大トークン数（コンテキスト制限用）

        Returns:
            フォーマット済みメッセージリスト
        """
        # Geminiは非常に長いコンテキストをサポートするため、
        # 通常は制限不要だが、コスト管理のため必要に応じて制限
        if max_tokens:
            # 簡易的なトークン推定（実際はより正確な計算が必要）
            estimated_tokens = sum(len(msg.content) // 4 for msg in messages)
            if estimated_tokens > max_tokens:
                self.logger.warning("Context exceeds max tokens", estimated=estimated_tokens, max_tokens=max_tokens)
                # 古いメッセージから削除
                while estimated_tokens > max_tokens and len(messages) > 2:
                    messages.pop(1)  # システムメッセージは保持
                    estimated_tokens = sum(len(msg.content) // 4 for msg in messages)

        return messages
