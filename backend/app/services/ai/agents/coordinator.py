"""
Coordinator AI - すべてのAIエージェントを統括する中央調整役

各種サービスからのAI呼び出しを適切なエージェントにルーティングし、
レスポンスを統合して返します。
"""

import json
from typing import Any, Dict, Optional

import structlog
from pydantic import BaseModel

from app.services.ai.agents.base import BaseAgent, AgentResponse
from app.services.ai.agents.dramatist import DramatistAgent
from app.services.ai.agents.state_manager import StateManagerAgent
from app.services.ai.agents.historian import HistorianAgent
from app.services.ai.prompt_manager import PromptContext, AIAgentRole
from app.services.ai.gemini_client import GeminiClient

logger = structlog.get_logger(__name__)


class CoordinatorRequest(BaseModel):
    """Coordinator AIへのリクエスト"""
    prompt: str
    agent_type: str
    character_name: str
    metadata: Optional[Dict[str, Any]] = None


class CoordinatorAI(BaseAgent):
    """
    Coordinator AI
    
    すべてのAIエージェントを統括し、適切なエージェントに
    タスクを振り分けてレスポンスを統合します。
    """
    
    def __init__(self, **kwargs):
        """Coordinator AIの初期化"""
        # BaseAgentの初期化（ROLEはDRAMATISTを暫定的に使用）
        super().__init__(role=AIAgentRole.DRAMATIST, **kwargs)
        
        # 各エージェントの初期化
        self.agents = {
            "dramatist": DramatistAgent(gemini_client=self.gemini_client),
            "state_manager": StateManagerAgent(gemini_client=self.gemini_client),
            "historian": HistorianAgent(gemini_client=self.gemini_client),
        }
        
        # エージェントタイプのマッピング
        self.agent_mapping = {
            # quest_service.py
            "quest_proposal": "dramatist",
            "quest_progress": "state_manager",
            "quest_completion": "state_manager",
            "implicit_quest": "dramatist",
            
            # memory_inheritance_service.py
            "memory_inheritance": "historian",
            
            # encounter_manager.py / story_progression_manager.py
            "dramatist": "dramatist",
            "state_manager": "state_manager",
        }
    
    async def process(self, context: PromptContext, **kwargs: Any) -> AgentResponse:
        """
        BaseAgentのインターフェースに準拠した処理
        """
        # generate_responseメソッドを内部的に呼び出す
        agent_type = kwargs.get("agent_type", "dramatist")
        response = await self.generate_response(
            prompt=context.custom_prompt or "",
            agent_type=agent_type,
            character_name=context.character_name,
            metadata=kwargs
        )
        
        return AgentResponse(
            agent_role="coordinator",
            narrative=response,
            metadata={"agent_type": agent_type}
        )
    
    async def generate_response(  # type: ignore[override]
        self,
        prompt: str,
        agent_type: str,
        character_name: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        各サービスから呼び出されるレスポンス生成メソッド
        
        Args:
            prompt: プロンプト
            agent_type: エージェントタイプ
            character_name: キャラクター名
            metadata: 追加のメタデータ
            
        Returns:
            生成されたレスポンス
        """
        try:
            # エージェントタイプから適切なエージェントを選択
            agent_name = self.agent_mapping.get(agent_type, "dramatist")
            agent = self.agents.get(agent_name)
            
            if not agent:
                logger.warning(f"Unknown agent type: {agent_type}, using dramatist")
                agent = self.agents["dramatist"]
            
            # PromptContextを構築
            context = PromptContext(
                character_name=character_name,
                location="unknown",  # 必要に応じて metadata から取得
                world_state={},
                recent_actions=[],
                custom_prompt=prompt
            )
            
            # メタデータをコンテキストに追加
            if metadata:
                context.world_state.update(metadata)
            
            # エージェントに処理を委譲
            logger.info(f"Delegating to {agent_name} agent for {agent_type}")
            
            # エージェント固有の処理
            if agent_type == "quest_proposal":
                # クエスト提案の場合はJSON形式で返す
                response = await agent.generate_response(context)
                # JSONとして解析可能な形式に整形
                try:
                    # すでにJSON形式の場合はそのまま返す
                    json.loads(response)
                    return str(response)
                except json.JSONDecodeError:
                    # JSON形式でない場合は適切な形式に変換
                    proposals = [{
                        "title": "生成されたクエスト",
                        "description": response[:200],  # 最初の200文字を説明として使用
                        "reasoning": "AIにより自動生成されたクエスト",
                        "difficulty_estimate": 0.5,
                        "relevance_score": 0.7,
                        "suggested_rewards": []
                    }]
                    return json.dumps(proposals, ensure_ascii=False)
            
            elif agent_type in ["quest_progress", "quest_completion"]:
                # 進行状況の判定
                response = await agent.generate_response(context)
                # レスポンスから進行状況を抽出（簡易実装）
                progress_data = {
                    "progress": 50,
                    "completed": agent_type == "quest_completion" and "完了" in response,
                    "description": response[:100]
                }
                return json.dumps(progress_data, ensure_ascii=False)
            
            else:
                # その他の場合は生のレスポンスを返す
                response = await agent.generate_response(context)
                return str(response)
                
        except Exception as e:
            logger.error(f"Error in Coordinator AI: {e}")
            # エラー時のフォールバック
            if agent_type == "quest_proposal":
                return '[{"title": "エラー", "description": "クエスト生成中にエラーが発生しました", "reasoning": "", "difficulty_estimate": 0.5, "relevance_score": 0.5, "suggested_rewards": []}]'
            elif agent_type in ["quest_progress", "quest_completion"]:
                return '{"progress": 0, "completed": false, "description": "エラーが発生しました"}'
            else:
                return f"エラーが発生しました: {str(e)}"
    
    async def generate_continuation_narrative(
        self,
        character_name: str,
        location: str,
        previous_summary: str,
        continuation_context: str,
        unresolved_plots: list[str]
    ) -> str:
        """
        セッション継続時のナラティブ生成
        
        既存のコードとの互換性のために残しています。
        """
        prompt = f"""
        キャラクター: {character_name}
        現在地: {location}
        
        前回のあらすじ:
        {previous_summary}
        
        継続コンテキスト:
        {continuation_context}
        
        未解決のプロット:
        {', '.join(unresolved_plots)}
        
        上記の情報を基に、セッション再開時の導入ナラティブを生成してください。
        200-300文字程度で、臨場感のある描写をしてください。
        """
        
        return await self.generate_response(
            prompt=prompt,
            agent_type="dramatist",
            character_name=character_name,
            metadata={
                "context_type": "continuation_narrative",
                "location": location
            }
        )