"""
Celery設定
"""

from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

# Celeryインスタンスを作成
celery_app = Celery(
    "gestaloka",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.tasks.ai_tasks", "app.tasks.log_tasks", "app.tasks.notification_tasks", "app.tasks.cleanup_tasks", "app.tasks.sp_tasks"],
)

# Celery設定
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Tokyo",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=30 * 60,  # 30分
    task_soft_time_limit=25 * 60,  # 25分
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    worker_disable_rate_limits=False,
    task_compression="gzip",
    result_compression="gzip",
    task_routes={
        "app.tasks.ai_tasks.*": {"queue": "ai_tasks"},
        "app.tasks.log_tasks.*": {"queue": "log_tasks"},
        "app.tasks.notification_tasks.*": {"queue": "notification_tasks"},
    },
    beat_schedule={
        "cleanup-expired-sessions": {
            "task": "app.tasks.cleanup_tasks.cleanup_expired_sessions",
            "schedule": 300.0,  # 5分ごと
        },
        "generate-world-events": {
            "task": "app.tasks.ai_tasks.generate_world_events",
            "schedule": 3600.0,  # 1時間ごと
        },
        "process-accepted-contracts": {
            "task": "app.tasks.log_tasks.process_accepted_contracts",
            "schedule": 60.0,  # 1分ごと
        },
        "daily-sp-recovery": {
            "task": "app.tasks.sp_tasks.process_daily_sp_recovery",
            "schedule": crontab(hour=4, minute=0),  # UTC 4時 = JST 13時
        },
        "check-subscription-expiry": {
            "task": "app.tasks.sp_tasks.check_subscription_expiry",
            "schedule": 3600.0,  # 1時間ごと
        },
    },
)

if __name__ == "__main__":
    celery_app.start()
