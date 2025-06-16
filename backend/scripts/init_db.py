#!/usr/bin/env python3
"""
データベース初期化スクリプト
"""

import asyncio
import os
import sys

# パスを追加
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from app.core.database import init_db
from app.core.logging import get_logger, setup_logging


async def main():
    """メイン処理"""
    # ログ設定
    setup_logging()
    logger = get_logger(__name__)

    try:
        logger.info("Starting database initialization")

        # データベース初期化
        await init_db()

        logger.info("Database initialization completed successfully")

    except Exception as e:
        logger.error("Database initialization failed", error=str(e))
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
