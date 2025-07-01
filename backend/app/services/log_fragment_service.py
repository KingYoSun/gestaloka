"""
ログフラグメント生成サービス

探索時やプレイヤーの行動から生成されるログフラグメントの
生成ロジックを管理するサービス
"""

import random
from typing import ClassVar, Optional

from app.models import (
    Character,
    EmotionalValence,
    ExplorationArea,
    Location,
    LogFragment,
    LogFragmentRarity,
)


class LogFragmentService:
    """ログフラグメント生成サービス"""

    # 場所タイプ別のキーワードテンプレート
    LOCATION_KEYWORDS: ClassVar[dict] = {
        "city": {
            "common": ["街の喧騒", "市場の記憶", "路地裏の密談", "守衛との会話", "商人の知恵"],
            "uncommon": ["夜の酒場", "ギルドの密約", "貴族の噂話", "地下組織", "古い看板"],
            "rare": ["権力者の秘密", "革命の火種", "古代の遺産", "失われた技術", "都市の起源"],
            "epic": ["王の陰謀", "都市国家の盟約", "魔法評議会", "英雄の凱旋", "大災害の記録"],
            "legendary": ["建国の真実", "神との契約", "世界の要", "運命の交差点", "時空の歪み"],
        },
        "town": {
            "common": ["平穏な日常", "村の祭り", "井戸端会議", "季節の移ろい", "家族の温もり"],
            "uncommon": ["村長の決断", "よそ者の来訪", "不作の年", "若者の旅立ち", "古い言い伝え"],
            "rare": ["村の守護者", "秘められた力", "古代の祭壇", "血の因縁", "禁じられた恋"],
            "epic": ["英雄の故郷", "魔女の予言", "龍の訪れ", "神隠しの真相", "村の変革"],
            "legendary": ["始まりの地", "世界樹の根", "時の止まった村", "神々の遊び場", "運命の種"],
        },
        "dungeon": {
            "common": ["暗闇の恐怖", "罠の痕跡", "探索者の遺品", "モンスターの巣", "朽ちた装備"],
            "uncommon": ["古代の機構", "封印の部屋", "地下水脈", "迷宮の法則", "先人の警告"],
            "rare": ["守護者の記憶", "宝物庫の鍵", "禁術の痕跡", "迷宮の心臓", "時空の亀裂"],
            "epic": ["魔王の玉座", "勇者の最期", "世界の裏側", "神器の封印", "深淵の声"],
            "legendary": ["創造の残滓", "虚無への扉", "因果の交点", "世界の終焉", "始原の力"],
        },
        "wild": {
            "common": ["野生の呼び声", "獣道の知識", "薬草の在処", "天候の変化", "生存の知恵"],
            "uncommon": ["精霊の囁き", "獣王の縄張り", "隠者の住処", "自然の脅威", "星座の導き"],
            "rare": ["大樹の記憶", "精霊王の加護", "獣人の集落", "自然の摂理", "元素の源泉"],
            "epic": ["世界樹の葉", "大地母神の恵み", "原初の獣", "自然の意志", "生命の循環"],
            "legendary": ["創世の息吹", "ガイアの鼓動", "原初の記憶", "世界の調和", "生命の起源"],
        },
        "special": {
            "common": ["不思議な感覚", "既視感", "時間の歪み", "空間の違和感", "記憶の混濁"],
            "uncommon": ["並行世界の影", "因果の綻び", "運命の分岐", "可能性の残響", "観測者の痕跡"],
            "rare": ["世界線の交差", "時空の狭間", "概念の具現", "法則の例外", "奇跡の残滓"],
            "epic": ["世界の真理", "神の視点", "全知の片鱗", "創造の瞬間", "終焉の予兆"],
            "legendary": ["アカシックレコード", "存在の根源", "全ての始まり", "無限の可能性", "究極の答え"],
        },
    }

    # 危険度別の感情価テンプレート
    DANGER_EMOTIONS: ClassVar[dict] = {
        "safe": {
            "keywords": ["安らぎ", "希望", "友情", "信頼", "喜び"],
            "valence_weights": {"positive": 0.7, "neutral": 0.25, "negative": 0.05, "mixed": 0.0},
        },
        "low": {
            "keywords": ["不安", "期待", "緊張", "興奮", "好奇心"],
            "valence_weights": {"positive": 0.4, "neutral": 0.4, "negative": 0.1, "mixed": 0.1},
        },
        "medium": {
            "keywords": ["恐怖", "勇気", "決意", "葛藤", "成長"],
            "valence_weights": {"positive": 0.2, "neutral": 0.3, "negative": 0.3, "mixed": 0.2},
        },
        "high": {
            "keywords": ["絶望", "憤怒", "執念", "覚悟", "犠牲"],
            "valence_weights": {"positive": 0.1, "neutral": 0.2, "negative": 0.5, "mixed": 0.2},
        },
        "extreme": {
            "keywords": ["狂気", "超越", "崩壊", "再生", "真理"],
            "valence_weights": {"positive": 0.05, "neutral": 0.1, "negative": 0.6, "mixed": 0.25},
        },
    }

    # バックストーリーテンプレート
    BACKSTORY_TEMPLATES: ClassVar[dict] = {
        LogFragmentRarity.COMMON: [
            "{location}で誰かが残した、ありふれた{emotion}の記憶。時の流れに色褪せながらも、確かにそこに存在している。",
            "かつて{area}を訪れた者の日常的な記録。{keyword}という言葉だけが、妙に心に引っかかる。",
            "{location}の片隅に漂う、名もなき者の思い出。それは{emotion}に満ちた、ささやかな物語の断片。",
        ],
        LogFragmentRarity.UNCOMMON: [
            "{area}に刻まれた、忘れがたい{emotion}の記憶。{keyword}という概念が、鮮明に浮かび上がる。",
            "この{location}で起きた出来事の、生々しい記録。当事者の{emotion}が、今も色濃く残っている。",
            "{keyword}——その言葉と共に蘇る、{area}での重要な瞬間。誰かの人生の転換点だったのかもしれない。",
        ],
        LogFragmentRarity.RARE: [
            "{location}の歴史に残る、{keyword}にまつわる重要な記憶。その{emotion}は、時を超えて響き続ける。",
            "この{area}で起きた、運命的な出来事の記録。{keyword}という真実が、ついに明らかになる。",
            "{emotion}の極致——{location}で刻まれた、忘れられない魂の叫び。それは{keyword}という形で結晶化している。",
        ],
        LogFragmentRarity.EPIC: [
            "{location}の運命を変えた、{keyword}の記憶。その{emotion}は、世界の在り方すら揺るがす力を持つ。",
            "英雄か、それとも破壊者か——{area}に刻まれた{keyword}の伝説。歴史はこの{emotion}を決して忘れない。",
            "この場所で交わされた、神々すら驚嘆する{keyword}の真実。{emotion}という名の業火が、永遠に燃え続ける。",
        ],
        LogFragmentRarity.LEGENDARY: [
            "世界の根幹に関わる、{keyword}という究極の真理。{location}はその啓示を受けた、選ばれし地。",
            "創世の記憶か、終焉の予言か——{area}に封じられた{keyword}の秘密。その{emotion}は、存在そのものを揺るがす。",
            "時空を超越した{keyword}の概念が、この{location}で具現化した瞬間の記録。全ての{emotion}の源がここにある。",
        ],
    }

    @classmethod
    def generate_exploration_fragment(
        cls,
        character_id: str,
        location: Location,
        area: ExplorationArea,
        rarity: LogFragmentRarity,
    ) -> LogFragment:
        """探索で発見されるログフラグメントを生成"""
        # レアリティに応じたキーワード選択
        location_type = location.location_type.value
        rarity_value = rarity.value

        # 場所タイプ別のキーワード取得
        keywords_by_rarity = cls.LOCATION_KEYWORDS.get(location_type, cls.LOCATION_KEYWORDS["special"])
        available_keywords = keywords_by_rarity.get(rarity_value, keywords_by_rarity["common"])

        # 危険度に応じた追加キーワード
        danger_level = location.danger_level.value
        danger_info = cls.DANGER_EMOTIONS.get(danger_level, cls.DANGER_EMOTIONS["medium"])

        # メインキーワード選択
        main_keyword = random.choice(available_keywords)

        # 感情価の決定
        valence = cls._determine_emotional_valence(danger_info["valence_weights"])
        emotion_keyword = random.choice(danger_info["keywords"])

        # バックストーリー生成
        backstory = cls._generate_backstory(
            rarity=rarity,
            location=location.name,
            area=area.name,
            keyword=main_keyword,
            emotion=emotion_keyword,
        )

        # キーワードリスト作成（メインキーワード + 感情キーワード + 場所タイプ）
        keywords_list = [main_keyword, emotion_keyword, location_type]
        if danger_level != "medium":
            keywords_list.append(f"{danger_level}_zone")

        return LogFragment(
            character_id=character_id,
            keyword=main_keyword,
            keywords=keywords_list,
            emotional_valence=valence,
            rarity=rarity,
            backstory=backstory,
            discovered_at=location.name,
            source_action=f"{area.name}の探索",
            action_description=f"{area.name}を探索中に発見された{rarity_value}な記憶の断片",
            importance_score=cls._calculate_importance_score(rarity),
            context_data={
                "location_id": location.id,
                "location_type": location_type,
                "area_id": area.id,
                "danger_level": danger_level,
                "discovery_method": "exploration",
            },
        )

    @classmethod
    def generate_action_fragment(
        cls,
        character: Character,
        action_type: str,
        action_description: str,
        context: dict,
        importance: float = 0.5,
    ) -> Optional[LogFragment]:
        """プレイヤーの行動からログフラグメントを生成"""
        # 重要度が閾値以下の場合は生成しない
        if importance < 0.3:
            return None

        # アクションタイプに基づくキーワード決定
        action_keywords = {
            "combat": ["戦闘", "勝利", "敗北", "死闘", "覚醒"],
            "dialogue": ["対話", "説得", "論破", "共感", "決別"],
            "choice": ["決断", "選択", "岐路", "運命", "因果"],
            "discovery": ["発見", "真実", "秘密", "啓示", "理解"],
            "sacrifice": ["犠牲", "献身", "代償", "救済", "贖罪"],
        }

        # レアリティ決定（重要度に基づく）
        if importance >= 0.9:
            rarity = LogFragmentRarity.LEGENDARY
        elif importance >= 0.8:
            rarity = LogFragmentRarity.EPIC
        elif importance >= 0.6:
            rarity = LogFragmentRarity.RARE
        elif importance >= 0.4:
            rarity = LogFragmentRarity.UNCOMMON
        else:
            rarity = LogFragmentRarity.COMMON

        # キーワード選択
        base_keywords = action_keywords.get(action_type, ["行動", "経験", "記憶"])
        main_keyword = random.choice(base_keywords)

        # 感情価決定（アクションの結果に基づく）
        if context.get("positive_outcome", False):
            valence = EmotionalValence.POSITIVE
        elif context.get("negative_outcome", False):
            valence = EmotionalValence.NEGATIVE
        elif context.get("mixed_outcome", False):
            valence = EmotionalValence.MIXED
        else:
            valence = EmotionalValence.NEUTRAL

        # バックストーリー生成
        backstory = f"{character.name}が{action_description}した瞬間の記憶。その{main_keyword}は、深い意味を持つ。"

        return LogFragment(
            character_id=character.id,
            keyword=main_keyword,
            keywords=[main_keyword, action_type],
            emotional_valence=valence,
            rarity=rarity,
            backstory=backstory,
            source_action=action_description,
            action_description=action_description,
            importance_score=importance,
            context_data=context,
        )

    @staticmethod
    def _determine_emotional_valence(valence_weights: dict) -> EmotionalValence:
        """重み付けに基づいて感情価を決定"""
        rand = random.random()
        cumulative = 0.0

        for valence, weight in valence_weights.items():
            cumulative += weight
            if rand < cumulative:
                return EmotionalValence(valence)

        return EmotionalValence.NEUTRAL

    @staticmethod
    def _generate_backstory(
        rarity: LogFragmentRarity,
        location: str,
        area: str,
        keyword: str,
        emotion: str,
    ) -> str:
        """バックストーリーを生成"""
        templates = LogFragmentService.BACKSTORY_TEMPLATES.get(rarity, LogFragmentService.BACKSTORY_TEMPLATES[LogFragmentRarity.COMMON])
        template = random.choice(templates)

        return str(template.format(
            location=location,
            area=area,
            keyword=keyword,
            emotion=emotion,
        ))

    @staticmethod
    def _calculate_importance_score(rarity: LogFragmentRarity) -> float:
        """レアリティに基づいて重要度スコアを計算"""
        scores = {
            LogFragmentRarity.COMMON: 0.2,
            LogFragmentRarity.UNCOMMON: 0.4,
            LogFragmentRarity.RARE: 0.6,
            LogFragmentRarity.EPIC: 0.8,
            LogFragmentRarity.LEGENDARY: 1.0,
        }
        return scores.get(rarity, 0.2)
