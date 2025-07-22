"""
Game Session Service

ゲームセッションの管理とビジネスロジックを提供するサービス
"""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.models.character import Character
from app.models.game_session import GameSession, SessionStatus
from app.models.session_result import SessionResult
from app.schemas.game_session import (
    GameSessionCreate,
    GameSessionUpdate,
    SessionContinueRequest,
)
from app.utils.exceptions import raise_bad_request, raise_not_found

logger = get_logger(__name__)


class GameSessionService:
    """ゲームセッション管理サービス"""

    async def create_session(
        self,
        db: AsyncSession,
        character_id: str,
        request: GameSessionCreate
    ) -> GameSession:
        """新規ゲームセッションを作成"""
        try:
            # キャラクターの存在確認
            stmt = select(Character).where(Character.id == character_id)
            result = await db.execute(stmt)
            character = result.scalar_one_or_none()
            if not character:
                raise_not_found(f"Character not found: {character_id}")

            # アクティブなセッションがないか確認
            active_stmt = select(GameSession).where(
                and_(
                    GameSession.character_id == character_id,
                    GameSession.is_active == True  # noqa: E712
                )
            )
            active_result = await db.execute(active_stmt)
            active_session = active_result.scalar_one_or_none()
            if active_session:
                raise_bad_request("Character already has an active session")

            # セッション番号を計算
            count_stmt = select(func.count()).select_from(GameSession).where(
                GameSession.character_id == character_id
            )
            count_result = await db.execute(count_stmt)
            session_count = count_result.scalar() or 0

            # 新規セッション作成
            session = GameSession(
                character_id=character_id,
                session_number=session_count + 1,
                is_first_session=(session_count == 0),
                current_scene=request.current_scene or "town_square",
                session_data="{}",  # 初期状態は空のJSON
                session_status=SessionStatus.ACTIVE,
                is_active=True
            )

            db.add(session)
            await db.commit()
            await db.refresh(session)

            logger.info(f"Created new game session: {session.id} for character: {character_id}")
            return session

        except HTTPException:
            await db.rollback()
            raise
        except Exception as e:
            await db.rollback()
            logger.error(f"Failed to create session: {e!s}")
            raise

    async def get_session(
        self,
        db: AsyncSession,
        session_id: str
    ) -> GameSession:
        """セッションを取得"""
        stmt = select(GameSession).where(GameSession.id == session_id)
        result = await db.execute(stmt)
        session = result.scalar_one_or_none()

        if not session:
            raise_not_found(f"Session not found: {session_id}")

        return session

    async def get_session_history(
        self,
        db: AsyncSession,
        user_id: str,
        character_id: Optional[str] = None,
        skip: int = 0,
        limit: int = 20
    ) -> tuple[list[GameSession], int]:
        """セッション履歴を取得"""
        # ベースクエリ
        query = select(GameSession).join(Character).where(
            Character.user_id == user_id
        )

        # キャラクターIDでフィルター
        if character_id:
            query = query.where(GameSession.character_id == character_id)

        # 総数を取得
        count_stmt = select(func.count()).select_from(query.subquery())
        count_result = await db.execute(count_stmt)
        total = count_result.scalar() or 0

        # ページネーション適用
        from sqlalchemy import desc
        query = query.order_by(desc(GameSession.created_at))
        query = query.offset(skip).limit(limit)

        # 結果を取得
        result = await db.execute(query)
        sessions = result.scalars().all()

        return list(sessions), total

    async def continue_session(
        self,
        db: AsyncSession,
        session_id: str,
        request: SessionContinueRequest
    ) -> GameSession:
        """セッションを継続"""
        session = await self.get_session(db, session_id)

        # セッションがアクティブか確認
        if not session.is_active:
            raise_bad_request("Session is not active")

        # セッション状態を更新（必要に応じて）
        if session.session_status == SessionStatus.ENDING_PROPOSED.value:
            session.session_status = SessionStatus.ACTIVE.value
            session.ending_proposal_count = 0
            session.last_proposal_at = None

        await db.commit()
        await db.refresh(session)

        logger.info(f"Continued session: {session_id}")
        return session

    async def end_session(
        self,
        db: AsyncSession,
        session_id: str,
        reason: Optional[str] = None
    ) -> SessionResult:
        """セッションを終了"""
        session = await self.get_session(db, session_id)

        # セッションがアクティブか確認
        if not session.is_active:
            raise_bad_request("Session is already ended")

        # セッション終了処理
        session.is_active = False
        session.session_status = SessionStatus.COMPLETED.value

        # セッション結果の作成（簡易版）
        import uuid
        result = SessionResult(
            id=str(uuid.uuid4()),
            session_id=session_id,
            story_summary="Session ended",  # TODO: AI生成のサマリー
            key_events=[],
            experience_gained=0,  # TODO: 実際の経験値を計算
            skills_improved={},
            items_acquired=[],
            continuation_context=reason or "Player ended session",
            unresolved_plots=[]
        )

        db.add(result)
        await db.commit()
        await db.refresh(result)

        logger.info(f"Ended session: {session_id}")
        return result

    async def update_session(
        self,
        db: AsyncSession,
        session_id: str,
        update_data: GameSessionUpdate
    ) -> GameSession:
        """セッション情報を更新"""
        session = await self.get_session(db, session_id)

        # 更新可能なフィールドのみ更新
        update_dict = update_data.model_dump(exclude_unset=True)
        for field, value in update_dict.items():
            if hasattr(session, field):
                setattr(session, field, value)

        await db.commit()
        await db.refresh(session)

        return session
