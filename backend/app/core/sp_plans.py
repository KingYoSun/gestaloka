"""SP購入プラン定義"""

from typing import Dict

from pydantic import BaseModel


class SPPlan(BaseModel):
    """SPプラン"""

    id: str
    name: str
    sp_amount: int
    price_jpy: int
    bonus_percentage: int  # ボーナスSPの割合
    popular: bool = False  # 人気プラン表示用
    description: str = ""

    @property
    def base_sp(self) -> int:
        """基本SP（ボーナス除く）"""
        return int(self.sp_amount / (1 + self.bonus_percentage / 100))

    @property
    def bonus_sp(self) -> int:
        """ボーナスSP"""
        return self.sp_amount - self.base_sp


# SP購入プラン定義
SP_PLANS: Dict[str, SPPlan] = {
    "small": SPPlan(
        id="small",
        name="スモールパック",
        sp_amount=100,
        price_jpy=500,
        bonus_percentage=0,
        description="少しだけSPが欲しい時に",
    ),
    "medium": SPPlan(
        id="medium",
        name="ミディアムパック",
        sp_amount=250,
        price_jpy=1000,
        bonus_percentage=25,  # 25%ボーナス
        popular=True,
        description="一番人気！25%ボーナス付き",
    ),
    "large": SPPlan(
        id="large",
        name="ラージパック",
        sp_amount=600,
        price_jpy=2000,
        bonus_percentage=50,  # 50%ボーナス
        description="たっぷり遊びたい方に。50%ボーナス",
    ),
    "xlarge": SPPlan(
        id="xlarge",
        name="エクストララージパック",
        sp_amount=2000,
        price_jpy=5000,
        bonus_percentage=100,  # 100%ボーナス
        description="最大のお得！100%ボーナス",
    ),
}
