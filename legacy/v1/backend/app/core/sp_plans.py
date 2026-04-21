"""SP購入プラン定義"""

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
SP_PLANS: dict[str, SPPlan] = {
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
        sp_amount=300,
        price_jpy=1200,
        bonus_percentage=20,  # 50 SP (20%ボーナス)
        popular=True,
        description="一番人気！50 SPボーナス付き",
    ),
    "large": SPPlan(
        id="large",
        name="ラージパック",
        sp_amount=500,
        price_jpy=2000,
        bonus_percentage=25,  # 100 SP (25%ボーナス)
        description="たっぷり遊びたい方に。100 SPボーナス",
    ),
    "xlarge": SPPlan(
        id="xlarge",
        name="エクストララージパック",
        sp_amount=1000,
        price_jpy=3500,
        bonus_percentage=43,  # 300 SP (約43%ボーナス)
        description="お得！300 SPボーナス",
    ),
    "xxlarge": SPPlan(
        id="xxlarge",
        name="ウルトラパック",
        sp_amount=3000,
        price_jpy=8000,
        bonus_percentage=67,  # 1200 SP (約67%ボーナス)
        description="最大のお得！1200 SPボーナス",
    ),
}
