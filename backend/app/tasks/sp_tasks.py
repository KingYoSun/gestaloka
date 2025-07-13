"""
SP関連のCeleryタスク
"""

from datetime import UTC, datetime
from typing import Any

from celery import shared_task
from sqlalchemy import and_
from sqlmodel import col, select

from app.core.database import get_session
from app.core.logging import get_logger
from app.models.sp import PlayerSP
from app.models.user import User
from app.services.sp_service import SPServiceSync

logger = get_logger(__name__)


@shared_task
def process_daily_sp_recovery() -> dict[str, Any]:
    """
    全プレイヤーの日次SP回復を処理するタスク

    毎日午前4時（UTC）に実行され、アクティブな全プレイヤーに
    自然回復SPを付与します。

    Returns:
        処理結果のサマリー
    """
    with next(get_session()) as db:
        try:
            sp_service = SPServiceSync(db)
            processed_count = 0
            error_count = 0

            # アクティブなユーザーを取得
            stmt = select(User).where(col(User.is_active).is_(True))
            users = db.exec(stmt).all()

            logger.info(f"Processing daily SP recovery for {len(users)} active users")

            for user in users:
                try:
                    # 日次回復処理
                    result = sp_service.process_daily_recovery_sync(user.id)

                    if result["success"]:
                        processed_count += 1
                        logger.info(
                            "Daily SP recovery processed",
                            user_id=user.id,
                            recovered_amount=result["recovered_amount"],
                            total_amount=result["total_amount"],
                            consecutive_days=result["consecutive_days"],
                        )
                    else:
                        logger.debug("Daily SP recovery skipped", user_id=user.id, reason=result["message"])

                except Exception as e:
                    error_count += 1
                    logger.error("Failed to process daily SP recovery for user", user_id=user.id, error=str(e))

            # 結果をコミット
            db.commit()

            summary = {
                "total_users": len(users),
                "processed": processed_count,
                "errors": error_count,
                "timestamp": datetime.now(UTC).isoformat(),
            }

            logger.info("Daily SP recovery batch completed", **summary)

            return summary

        except Exception as e:
            logger.error("Failed to process daily SP recovery batch", error=str(e))
            db.rollback()
            raise


@shared_task
def check_subscription_expiry() -> dict[str, Any]:
    """
    期限切れのサブスクリプションをチェックして無効化する

    Returns:
        処理結果のサマリー
    """
    with next(get_session()) as db:
        try:
            now = datetime.now(UTC)
            expired_count = 0

            # 期限切れのサブスクリプションを持つプレイヤーを取得
            stmt = select(PlayerSP).where(
                and_(col(PlayerSP.active_subscription).is_not(None), col(PlayerSP.subscription_expires_at) <= now)
            )
            expired_players = db.exec(stmt).all()

            logger.info(f"Found {len(expired_players)} expired subscriptions")

            for player_sp in expired_players:
                player_sp.active_subscription = None
                player_sp.subscription_expires_at = None
                player_sp.updated_at = now
                expired_count += 1

                logger.info("Subscription expired", user_id=player_sp.user_id, player_sp_id=player_sp.id)

            db.commit()

            summary = {"expired": expired_count, "timestamp": now.isoformat()}

            logger.info("Subscription expiry check completed", **summary)

            return summary

        except Exception as e:
            logger.error("Failed to check subscription expiry", error=str(e))
            db.rollback()
            raise


@shared_task
def grant_login_bonus(user_id: str) -> dict[str, Any]:
    """
    特定のユーザーにログインボーナスを付与する

    Args:
        user_id: ユーザーID

    Returns:
        処理結果
    """
    with next(get_session()) as db:
        try:
            sp_service = SPServiceSync(db)

            # 日次回復処理（ログインボーナスを含む）
            result = sp_service.process_daily_recovery_sync(user_id)

            db.commit()

            logger.info("Login bonus granted", user_id=user_id, result=result)

            return result

        except Exception as e:
            logger.error("Failed to grant login bonus", user_id=user_id, error=str(e))
            db.rollback()
            raise
