"""
ストーリーアーク管理サービス

複数セッションに跨る物語の管理を行う
"""

import uuid
from datetime import UTC, datetime
from typing import Optional

from sqlmodel import Session, desc, select

from app.core.logging import get_logger
from app.models.character import Character, GameSession
from app.models.story_arc import (
    StoryArc,
    StoryArcMilestone,
)

logger = get_logger(__name__)


class StoryArcService:
    """ストーリーアーク管理サービス"""

    def __init__(self, db: Session):
        self.db = db

    def create_story_arc(
        self,
        character: Character,
        title: str,
        description: str,
        arc_type: str,
        total_phases: int = 1,
        themes: Optional[list[str]] = None,
        central_conflict: Optional[str] = None,
    ) -> StoryArc:
        """
        新しいストーリーアークを作成

        Args:
            character: キャラクター
            title: アークのタイトル
            description: アークの説明
            arc_type: アークのタイプ
            total_phases: 総フェーズ数
            themes: テーマのリスト
            central_conflict: 中心的な対立

        Returns:
            作成されたストーリーアーク
        """
        story_arc = StoryArc(
            id=str(uuid.uuid4()),
            character_id=character.id,
            title=title,
            description=description,
            arc_type=arc_type,
            status="active",
            total_phases=total_phases,
            themes=themes or [],
            central_conflict=central_conflict,
            started_at=datetime.now(UTC),
        )

        self.db.add(story_arc)
        self.db.commit()

        logger.info(f"Created story arc: {story_arc.id} for character: {character.name}")
        return story_arc

    def get_active_story_arc(self, character: Character) -> Optional[StoryArc]:
        """
        キャラクターの現在アクティブなストーリーアークを取得

        Args:
            character: キャラクター

        Returns:
            アクティブなストーリーアーク（なければNone）
        """
        stmt = select(StoryArc).where(
            StoryArc.character_id == character.id,
            StoryArc.status == "active"
        ).order_by(desc(StoryArc.created_at))

        result = self.db.execute(stmt)
        return result.scalars().first()

    def update_arc_progress(
        self,
        story_arc: StoryArc,
        progress_delta: float = 0.0,
        phase_completed: bool = False,
    ) -> StoryArc:
        """
        ストーリーアークの進行状況を更新

        Args:
            story_arc: ストーリーアーク
            progress_delta: 進行率の増分
            phase_completed: フェーズが完了したか

        Returns:
            更新されたストーリーアーク
        """
        story_arc.progress_percentage = min(100.0, story_arc.progress_percentage + progress_delta)

        if phase_completed and story_arc.current_phase < story_arc.total_phases:
            story_arc.current_phase += 1
            logger.info(f"Story arc {story_arc.id} advanced to phase {story_arc.current_phase}")

        # 全フェーズ完了チェック
        if story_arc.current_phase >= story_arc.total_phases and story_arc.progress_percentage >= 100.0:
            self.complete_story_arc(story_arc)

        story_arc.updated_at = datetime.now(UTC)
        self.db.add(story_arc)
        self.db.commit()

        return story_arc

    def complete_story_arc(self, story_arc: StoryArc) -> StoryArc:
        """
        ストーリーアークを完了状態にする

        Args:
            story_arc: ストーリーアーク

        Returns:
            完了したストーリーアーク
        """
        story_arc.status = "completed"
        story_arc.completed_at = datetime.now(UTC)
        story_arc.progress_percentage = 100.0

        self.db.add(story_arc)
        self.db.commit()

        logger.info(f"Completed story arc: {story_arc.id}")
        return story_arc

    def create_milestone(
        self,
        story_arc: StoryArc,
        title: str,
        description: str,
        phase_number: int,
        achievement_criteria: dict,
        triggers_next_phase: bool = False,
        rewards: Optional[dict] = None,
    ) -> StoryArcMilestone:
        """
        ストーリーアークのマイルストーンを作成

        Args:
            story_arc: 親となるストーリーアーク
            title: マイルストーンのタイトル
            description: マイルストーンの説明
            phase_number: フェーズ番号
            achievement_criteria: 達成条件
            triggers_next_phase: 次フェーズへの移行トリガーか
            rewards: 達成報酬

        Returns:
            作成されたマイルストーン
        """
        milestone = StoryArcMilestone(
            id=str(uuid.uuid4()),
            story_arc_id=story_arc.id,
            title=title,
            description=description,
            phase_number=phase_number,
            achievement_criteria=achievement_criteria,
            triggers_next_phase=triggers_next_phase,
            rewards=rewards or {},
        )

        self.db.add(milestone)
        self.db.commit()

        logger.info(f"Created milestone: {milestone.id} for story arc: {story_arc.id}")
        return milestone

    def check_milestone_completion(
        self,
        milestone: StoryArcMilestone,
        context: dict,
    ) -> bool:
        """
        マイルストーンの達成条件をチェック

        Args:
            milestone: マイルストーン
            context: 達成条件チェック用のコンテキスト

        Returns:
            達成したかどうか
        """
        # 既に完了している場合はスキップ
        if milestone.is_completed:
            return False

        # 達成条件のチェック（簡易実装）
        # TODO: より複雑な条件チェックロジックの実装
        criteria = milestone.achievement_criteria

        # 例: クエスト完了条件
        if "completed_quests" in criteria:
            required_quests = set(criteria["completed_quests"])
            completed_quests = set(context.get("completed_quests", []))
            if not required_quests.issubset(completed_quests):
                return False

        # 例: 特定NPCとの会話条件
        if "talked_to_npcs" in criteria:
            required_npcs = set(criteria["talked_to_npcs"])
            talked_npcs = set(context.get("talked_to_npcs", []))
            if not required_npcs.issubset(talked_npcs):
                return False

        # 全条件を満たした場合
        milestone.is_completed = True
        milestone.completed_at = datetime.now(UTC)
        self.db.add(milestone)

        logger.info(f"Milestone completed: {milestone.id}")

        # 次フェーズへの移行トリガーの場合
        if milestone.triggers_next_phase:
            story_arc = self.db.get(StoryArc, milestone.story_arc_id)
            if story_arc:
                self.update_arc_progress(story_arc, phase_completed=True)

        self.db.commit()
        return True

    def associate_session_with_arc(
        self,
        session: GameSession,
        story_arc: StoryArc,
    ) -> None:
        """
        セッションをストーリーアークに関連付ける

        Args:
            session: ゲームセッション
            story_arc: ストーリーアーク
        """
        session.story_arc_id = story_arc.id
        story_arc.session_count += 1

        self.db.add(session)
        self.db.add(story_arc)
        self.db.commit()

        logger.info(f"Associated session {session.id} with story arc {story_arc.id}")

    def suggest_next_arc(
        self,
        character: Character,
        completed_arc: StoryArc,
    ) -> Optional[dict]:
        """
        完了したアークに基づいて次のアークを提案

        Args:
            character: キャラクター
            completed_arc: 完了したストーリーアーク

        Returns:
            次のアークの提案（タイトル、説明、タイプ）
        """
        # TODO: AIを使用してより高度な提案を生成

        suggestions = {
            "main_quest": {
                "title": "新たなる脅威",
                "description": "前回の冒険で得た知識が、より大きな陰謀の存在を示唆している...",
                "type": "main_quest",
                "themes": ["陰謀", "成長", "責任"],
            },
            "side_quest": {
                "title": "失われた絆",
                "description": "かつての仲間からの手紙が届いた。助けを求めているようだが...",
                "type": "character_arc",
                "themes": ["友情", "過去との対峙", "救済"],
            },
            "character_arc": {
                "title": "内なる闇との対話",
                "description": "最近の出来事があなたの心に影を落としている。自己を見つめ直す時が来た。",
                "type": "personal_story",
                "themes": ["内省", "成長", "自己発見"],
            },
        }

        # 完了したアークのタイプに基づいて次を提案
        suggestion = suggestions.get(
            completed_arc.arc_type,
            suggestions["side_quest"]
        )

        return suggestion
