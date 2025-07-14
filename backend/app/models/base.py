"""
基底モデルクラス
"""

from datetime import UTC, datetime
from typing import Any

from sqlmodel import Field, SQLModel


class TimestampedModel(SQLModel):
    """タイムスタンプフィールドを持つモデルの基底クラス"""

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        description="作成日時"
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        description="更新日時"
    )

    class Config:
        # SQLModelのテーブル生成を無効化（基底クラスなので）
        table = False


class BaseModel(TimestampedModel):
    """
    すべてのモデルの基底クラス
    
    ID生成とタイムスタンプフィールドを提供します。
    """

    # 注: IDフィールドは各モデルで異なる設定（UUID vs Auto-increment）があるため、
    # ここでは定義せず、各モデルで個別に定義する

    class Config:
        # SQLModelのテーブル生成を無効化（基底クラスなので）
        table = False

    def model_dump(self, **kwargs: Any) -> dict[str, Any]:
        """
        モデルを辞書形式にシリアライズ
        
        datetimeオブジェクトをISO形式の文字列に変換します。
        """
        data = super().model_dump(**kwargs)

        # datetimeフィールドを文字列に変換
        for key, value in data.items():
            if isinstance(value, datetime):
                data[key] = value.isoformat()

        return data
