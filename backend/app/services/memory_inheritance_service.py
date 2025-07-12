"""記憶継承サービス

記憶フラグメントの組み合わせによる新しい価値創造を管理
"""

from typing import Any, Optional
from uuid import uuid4

from langchain_core.messages import HumanMessage, SystemMessage
from sqlmodel import Session, select

from app.models.character import Character, CharacterSkill, Skill
from app.models.item import CharacterItem, Item
from app.models.log import LogFragment, LogFragmentRarity
from app.models.sp import SPTransactionType
from app.models.title import CharacterTitle
from app.schemas.memory_inheritance import (
    MemoryCombinationPreview,
    MemoryInheritanceRequest,
    MemoryInheritanceResult,
    MemoryInheritanceType,
)
from app.services.sp_calculation import SPCalculationService
from app.services.sp_service import SPService


class MemoryInheritanceService:
    """記憶継承サービス"""

    def __init__(self, session: Session):
        self.session = session
        self.sp_service = SPService(session)
        from app.services.gm_ai_service import GMAIService

        self.ai_service = GMAIService(session)

    def get_combination_preview(self, character_id: str, fragment_ids: list[str]) -> MemoryCombinationPreview:
        """記憶の組み合わせプレビューを取得"""
        # キャラクターと記憶フラグメントを取得
        self._get_character(character_id)  # 権限チェックのみ
        fragments = self._get_fragments(character_id, fragment_ids)

        if not fragments or len(fragments) < 2:
            raise ValueError("組み合わせには最低2つの記憶フラグメントが必要です")

        # 可能な継承タイプを判定
        possible_types = self._determine_possible_types(fragments)

        # 各タイプごとにプレビューを生成
        previews = {}
        for inheritance_type in possible_types:
            preview = self._generate_preview(fragments, inheritance_type)
            if preview:
                previews[inheritance_type.value] = preview

        # SP消費量を計算
        sp_costs = self._calculate_sp_costs(fragments, possible_types)

        return MemoryCombinationPreview(
            fragment_ids=fragment_ids,
            possible_types=possible_types,
            previews=previews,
            sp_costs=sp_costs,
            combo_bonus=self._calculate_combo_bonus(len(fragments)),
        )

    async def execute_inheritance(
        self, character_id: str, request: MemoryInheritanceRequest
    ) -> MemoryInheritanceResult:
        """記憶継承を実行"""
        # キャラクターと記憶フラグメントを取得
        character = self._get_character(character_id)
        fragments = self._get_fragments(character_id, request.fragment_ids)

        if not fragments or len(fragments) < 2:
            raise ValueError("組み合わせには最低2つの記憶フラグメントが必要です")

        # SP消費を計算
        sp_cost = self._calculate_sp_cost(fragments, request.inheritance_type)

        # SP残高確認
        player_sp = await self.sp_service.get_balance(character_id)
        if player_sp.current_sp < sp_cost:
            raise ValueError(f"SP不足です。必要: {sp_cost} SP")

        # 継承タイプに応じて実行
        result = None
        if request.inheritance_type == MemoryInheritanceType.SKILL:
            result = await self._inherit_skill(character, fragments)
        elif request.inheritance_type == MemoryInheritanceType.TITLE:
            result = await self._inherit_title(character, fragments)
        elif request.inheritance_type == MemoryInheritanceType.ITEM:
            result = await self._inherit_item(character, fragments)
        elif request.inheritance_type == MemoryInheritanceType.LOG_ENHANCEMENT:
            result = await self._create_log_enhancement(character, fragments)

        if not result:
            raise ValueError("記憶継承の実行に失敗しました")

        # SP消費を記録
        await self.sp_service.consume_sp(
            user_id=character_id,
            amount=sp_cost,
            description=f"記憶継承: {request.inheritance_type.value}",
            transaction_type=SPTransactionType.MEMORY_INHERITANCE,
        )

        # 組み合わせ履歴を記録
        self._record_inheritance_history(character, fragments, request.inheritance_type, result)

        self.session.commit()

        return MemoryInheritanceResult(
            success=True,
            inheritance_type=request.inheritance_type,
            result=result,
            sp_consumed=sp_cost,
            fragments_used=request.fragment_ids,
        )

    def _get_character(self, character_id: str) -> Character:
        """キャラクターを取得"""
        character = self.session.get(Character, character_id)
        if not character:
            raise ValueError(f"キャラクター {character_id} が見つかりません")
        return character

    def _get_fragments(self, character_id: str, fragment_ids: list[str]) -> list[LogFragment]:
        """記憶フラグメントを取得"""
        fragments = []
        for fragment_id in fragment_ids:
            fragment = self.session.exec(
                select(LogFragment).where(LogFragment.id == fragment_id, LogFragment.character_id == character_id)
            ).first()
            if fragment:
                fragments.append(fragment)
        return fragments

    def _determine_possible_types(self, fragments: list[LogFragment]) -> list[MemoryInheritanceType]:
        """可能な継承タイプを判定"""
        possible_types = []

        # メモリタイプの組み合わせを分析
        memory_types = [f.memory_type for f in fragments if f.memory_type]
        combination_tags: list[str] = []
        for f in fragments:
            combination_tags.extend(f.combination_tags or [])

        # スキル継承: 戦闘、魔法、技術系のタグが含まれる
        skill_tags = {"戦闘", "魔法", "技術", "剣術", "魔術", "知識", "守護", "探索"}
        if any(tag in combination_tags for tag in skill_tags):
            possible_types.append(MemoryInheritanceType.SKILL)

        # 称号獲得: 物語的な達成や感情的なタグが含まれる
        title_tags = {"勇気", "友情", "犠牲", "英雄", "賢者", "守護者", "探求者"}
        if any(tag in memory_types or tag in combination_tags for tag in title_tags):
            possible_types.append(MemoryInheritanceType.TITLE)

        # アイテム生成: 物質的、知識的なタグが含まれる
        item_tags = {"遺物", "知識", "秘宝", "古代", "魔法道具", "アーティファクト"}
        if any(tag in combination_tags for tag in item_tags):
            possible_types.append(MemoryInheritanceType.ITEM)

        # ログ強化: 常に可能
        possible_types.append(MemoryInheritanceType.LOG_ENHANCEMENT)

        return possible_types

    def _calculate_sp_costs(
        self, fragments: list[LogFragment], possible_types: list[MemoryInheritanceType]
    ) -> dict[str, int]:
        """各継承タイプのSP消費を計算"""
        costs = {}
        for inheritance_type in possible_types:
            costs[inheritance_type.value] = self._calculate_sp_cost(fragments, inheritance_type)
        return costs

    def _calculate_sp_cost(self, fragments: list[LogFragment], inheritance_type: MemoryInheritanceType) -> int:
        """SP消費を計算"""
        # 最高レアリティのフラグメントを使用
        max_rarity = max(f.rarity for f in fragments)
        
        # SPCalculationServiceを使用して計算
        # UNIQUE, ARCHITECTはLEGENDARYとして扱う
        if max_rarity in [LogFragmentRarity.UNIQUE, LogFragmentRarity.ARCHITECT]:
            source_rarity = LogFragmentRarity.LEGENDARY
        else:
            source_rarity = max_rarity
        
        inheritance_type_map = {
            MemoryInheritanceType.SKILL: "skill",
            MemoryInheritanceType.TITLE: "title",
            MemoryInheritanceType.ITEM: "item",
            MemoryInheritanceType.LOG_ENHANCEMENT: "log_enhancement",
        }
        type_str = inheritance_type_map.get(inheritance_type, "skill")
        
        return SPCalculationService.calculate_memory_inheritance_cost(
            inheritance_type=type_str,
            source_rarity=source_rarity,
            target_level=1
        )

    def _calculate_combo_bonus(self, fragment_count: int) -> Optional[str]:
        """コンボボーナスを計算"""
        if fragment_count >= 5:
            return "レジェンダリーコンボ: 特別な効果と称号を獲得"
        elif fragment_count >= 3:
            return "パワーコンボ: 強化効果とボーナスを獲得"
        return None

    def _generate_preview(
        self, fragments: list[LogFragment], inheritance_type: MemoryInheritanceType
    ) -> Optional[dict[str, Any]]:
        """プレビューを生成"""
        if inheritance_type == MemoryInheritanceType.SKILL:
            return self._preview_skill(fragments)
        elif inheritance_type == MemoryInheritanceType.TITLE:
            return self._preview_title(fragments)
        elif inheritance_type == MemoryInheritanceType.ITEM:
            return self._preview_item(fragments)
        elif inheritance_type == MemoryInheritanceType.LOG_ENHANCEMENT:
            return self._preview_log_enhancement(fragments)

    def _preview_skill(self, fragments: list[LogFragment]) -> dict[str, Any]:
        """スキル継承のプレビュー"""
        # キーワードとメモリタイプから推測
        keywords: list[str] = []
        for f in fragments:
            keywords.extend(f.keywords or [])

        # 簡易的なスキル名生成
        if "剣術" in keywords and "守護" in keywords:
            return {
                "name": "聖剣術",
                "description": "聖なる力を宿した剣術。守護の意志が攻撃力を高める",
                "estimated_power": "A",
            }
        elif "魔法" in keywords and "知識" in keywords:
            return {"name": "賢者の魔術", "description": "古代の知識に基づく高度な魔術", "estimated_power": "S"}
        else:
            return {
                "name": "未知のスキル",
                "description": "記憶の組み合わせから新しいスキルが生まれる",
                "estimated_power": "?",
            }

    def _preview_title(self, fragments: list[LogFragment]) -> dict[str, Any]:
        """称号獲得のプレビュー"""
        memory_types = [f.memory_type for f in fragments if f.memory_type]

        if "勇気" in memory_types and "犠牲" in memory_types:
            return {
                "title": "真の英雄",
                "description": "勇気と犠牲の精神を体現する者",
                "effects": ["カリスマ+10", "防御力+5%"],
            }
        elif "知恵" in memory_types and "探求" in memory_types:
            return {
                "title": "賢者",
                "description": "真理を追求し続ける者",
                "effects": ["経験値+15%", "スキル習得速度+20%"],
            }
        else:
            return {"title": "記憶の継承者", "description": "複数の記憶を受け継ぐ者", "effects": ["SP回復+5/日"]}

    def _preview_item(self, fragments: list[LogFragment]) -> dict[str, Any]:
        """アイテム生成のプレビュー"""
        # レアリティから推測
        max_rarity = max(f.rarity for f in fragments)

        if max_rarity in [LogFragmentRarity.LEGENDARY, LogFragmentRarity.ARCHITECT]:
            return {
                "name": "記憶の結晶",
                "type": "特殊アイテム",
                "description": "強力な記憶が結晶化した神秘的なアイテム",
                "rarity": "LEGENDARY",
            }
        else:
            return {
                "name": "思い出の護符",
                "type": "アクセサリー",
                "description": "記憶の力を宿した護符",
                "rarity": "RARE",
            }

    def _preview_log_enhancement(self, fragments: list[LogFragment]) -> dict[str, Any]:
        """ログ強化のプレビュー"""
        return {
            "enhancement": "記憶の共鳴",
            "description": "この記憶を持つログは特別な共感を呼び起こす",
            "effects": ["初期好感度+50%", "特殊イベント発生率+30%", "記憶関連の選択肢が追加"],
        }

    async def _inherit_skill(self, character: Character, fragments: list[LogFragment]) -> dict[str, Any]:
        """スキルを継承"""
        # AIを使用してスキルを生成
        skill_data = await self._generate_skill_with_ai(fragments)

        # スキルを作成または取得
        skill = self.session.exec(select(Skill).where(Skill.name == skill_data["name"])).first()

        if not skill:
            skill = Skill(
                id=str(uuid4()),
                name=skill_data["name"],
                description=skill_data["description"],
                skill_type=skill_data["type"],
                base_power=skill_data["power"],
                sp_cost=skill_data["sp_cost"],
                cooldown_turns=skill_data.get("cooldown", 0),
            )
            self.session.add(skill)

        # キャラクターにスキルを付与
        char_skill = CharacterSkill(
            id=str(uuid4()),
            character_id=character.id,
            skill_id=skill.id,
            level=1,
            experience=0,
            unlocked_at="memory_inheritance",
        )
        self.session.add(char_skill)

        return {"type": "skill", "skill_id": skill.id, "name": skill.name, "description": skill.description}

    async def _inherit_title(self, character: Character, fragments: list[LogFragment]) -> dict[str, Any]:
        """称号を獲得"""
        # AIを使用して称号を生成
        title_data = await self._generate_title_with_ai(fragments)

        # 称号を付与
        char_title = CharacterTitle(
            id=str(uuid4()),
            character_id=character.id,
            title=title_data["title"],
            description=title_data["description"],
            acquired_at="memory_inheritance",
            effects=title_data.get("effects", {}),
        )
        self.session.add(char_title)

        return {
            "type": "title",
            "title_id": char_title.id,
            "title": char_title.title,
            "description": char_title.description,
            "effects": char_title.effects,
        }

    async def _inherit_item(self, character: Character, fragments: list[LogFragment]) -> dict[str, Any]:
        """アイテムを生成"""
        # AIを使用してアイテムを生成
        item_data = await self._generate_item_with_ai(fragments)

        # アイテムを作成
        item = Item(
            id=str(uuid4()),
            name=item_data["name"],
            description=item_data["description"],
            item_type=item_data["type"],
            rarity=item_data["rarity"],
            effects=item_data.get("effects", {}),
            tradeable=False,  # 記憶から生成されたアイテムは取引不可
        )
        self.session.add(item)

        # キャラクターのインベントリに追加
        char_item = CharacterItem(
            id=str(uuid4()), character_id=character.id, item_id=item.id, quantity=1, obtained_at="memory_inheritance"
        )
        self.session.add(char_item)

        return {
            "type": "item",
            "item_id": item.id,
            "name": item.name,
            "description": item.description,
            "rarity": item.rarity,
        }

    async def _create_log_enhancement(self, character: Character, fragments: list[LogFragment]) -> dict[str, Any]:
        """ログ強化を作成"""
        # 強化データを生成
        enhancement_data = await self._generate_enhancement_with_ai(fragments)

        # 強化情報を保存（実際の適用はログ編纂時）
        enhancement = {
            "type": "log_enhancement",
            "enhancement_id": str(uuid4()),
            "name": enhancement_data["name"],
            "description": enhancement_data["description"],
            "effects": enhancement_data["effects"],
            "fragment_ids": [f.id for f in fragments],
        }

        # キャラクターのメタデータに保存
        if not character.character_metadata:
            character.character_metadata = {}
        if "log_enhancements" not in character.character_metadata:
            character.character_metadata["log_enhancements"] = []
        character.character_metadata["log_enhancements"].append(enhancement)

        return enhancement

    async def _generate_skill_with_ai(self, fragments: list[LogFragment]) -> dict[str, Any]:
        """AIを使用してスキルを生成"""
        # フラグメントの情報を整理
        fragment_info = self._format_fragments_for_ai(fragments)

        messages = [
            SystemMessage(
                content="""あなたはゲスタロカの記憶継承システムのAIです。
プレイヤーが組み合わせた記憶フラグメントから、新しいスキルを生成してください。

スキルは以下の形式で生成してください：
- name: スキル名（ユニークで印象的な名前）
- description: スキルの説明（100文字程度）
- type: スキルタイプ（attack/defense/support/special）
- power: 基本威力（1-100）
- sp_cost: SP消費（5-50）
- cooldown: クールダウンターン数（0-5）

記憶の内容とテーマから、それらしいスキルを考えてください。"""
            ),
            HumanMessage(content=f"以下の記憶フラグメントから新しいスキルを生成してください：\n\n{fragment_info}"),
        ]

        response = await self.ai_service.generate_ai_response(
            f"{messages[0].content}\n\n{messages[1].content}", agent_type="memory_inheritance"
        )

        # レスポンスをパース（実際の実装では適切なパースが必要）
        return self._parse_skill_response(response)

    async def _generate_title_with_ai(self, fragments: list[LogFragment]) -> dict[str, Any]:
        """AIを使用して称号を生成"""
        fragment_info = self._format_fragments_for_ai(fragments)

        messages = [
            SystemMessage(
                content="""あなたはゲスタロカの記憶継承システムのAIです。
プレイヤーが組み合わせた記憶フラグメントから、新しい称号を生成してください。

称号は以下の形式で生成してください：
- title: 称号名（格好良く印象的な名前）
- description: 称号の説明（50文字程度）
- effects: 称号の効果（ステータスボーナスなど）

記憶の内容から、プレイヤーの功績や特性を表す称号を考えてください。"""
            ),
            HumanMessage(content=f"以下の記憶フラグメントから新しい称号を生成してください：\n\n{fragment_info}"),
        ]

        response = await self.ai_service.generate_ai_response(
            f"{messages[0].content}\n\n{messages[1].content}", agent_type="memory_inheritance"
        )
        return self._parse_title_response(response)

    async def _generate_item_with_ai(self, fragments: list[LogFragment]) -> dict[str, Any]:
        """AIを使用してアイテムを生成"""
        fragment_info = self._format_fragments_for_ai(fragments)

        messages = [
            SystemMessage(
                content="""あなたはゲスタロカの記憶継承システムのAIです。
プレイヤーが組み合わせた記憶フラグメントから、新しいアイテムを生成してください。

アイテムは以下の形式で生成してください：
- name: アイテム名
- description: アイテムの説明（100文字程度）
- type: アイテムタイプ（weapon/armor/accessory/consumable/special）
- rarity: レアリティ（COMMON/UNCOMMON/RARE/EPIC/LEGENDARY）
- effects: アイテムの効果

記憶が結晶化したような、特別なアイテムを考えてください。"""
            ),
            HumanMessage(content=f"以下の記憶フラグメントから新しいアイテムを生成してください：\n\n{fragment_info}"),
        ]

        response = await self.ai_service.generate_ai_response(
            f"{messages[0].content}\n\n{messages[1].content}", agent_type="memory_inheritance"
        )
        return self._parse_item_response(response)

    async def _generate_enhancement_with_ai(self, fragments: list[LogFragment]) -> dict[str, Any]:
        """AIを使用してログ強化を生成"""
        fragment_info = self._format_fragments_for_ai(fragments)

        messages = [
            SystemMessage(
                content="""あなたはゲスタロカの記憶継承システムのAIです。
プレイヤーが組み合わせた記憶フラグメントから、ログ強化効果を生成してください。

ログ強化は以下の形式で生成してください：
- name: 強化名
- description: 強化の説明（100文字程度）
- effects: 強化効果のリスト（初期好感度ボーナス、特殊イベント、追加選択肢など）

この記憶を持つログが他のプレイヤーの世界でNPCとして活動する際の特別な効果を考えてください。"""
            ),
            HumanMessage(content=f"以下の記憶フラグメントからログ強化効果を生成してください：\n\n{fragment_info}"),
        ]

        response = await self.ai_service.generate_ai_response(
            f"{messages[0].content}\n\n{messages[1].content}", agent_type="memory_inheritance"
        )
        return self._parse_enhancement_response(response)

    def _format_fragments_for_ai(self, fragments: list[LogFragment]) -> str:
        """AIのためにフラグメント情報をフォーマット"""
        info = []
        for f in fragments:
            info.append(f"""記憶フラグメント: {f.keywords[0] if f.keywords else "無題"}
レアリティ: {f.rarity.value}
タイプ: {f.memory_type or "不明"}
内容: {f.action_description[:200] if len(f.action_description) > 200 else f.action_description}
キーワード: {", ".join(f.keywords or [])}
感情価: {f.emotional_valence.value}""")

        return "\n\n".join(info)

    def _parse_skill_response(self, response: str) -> dict[str, Any]:
        """スキルレスポンスをパース（簡易実装）"""
        # 実際の実装では、より堅牢なパースロジックが必要
        return {
            "name": "記憶の結晶化",
            "description": "組み合わせた記憶から生まれた特別なスキル",
            "type": "special",
            "power": 50,
            "sp_cost": 20,
            "cooldown": 3,
        }

    def _parse_title_response(self, response: str) -> dict[str, Any]:
        """称号レスポンスをパース（簡易実装）"""
        return {
            "title": "記憶の継承者",
            "description": "複数の記憶を受け継ぎし者",
            "effects": {"sp_recovery": 5, "exp_bonus": 10},
        }

    def _parse_item_response(self, response: str) -> dict[str, Any]:
        """アイテムレスポンスをパース（簡易実装）"""
        return {
            "name": "記憶の結晶",
            "description": "強力な記憶が物質化した神秘的なアイテム",
            "type": "special",
            "rarity": "EPIC",
            "effects": {"all_stats": 5},
        }

    def _parse_enhancement_response(self, response: str) -> dict[str, Any]:
        """ログ強化レスポンスをパース（簡易実装）"""
        return {
            "name": "記憶の共鳴",
            "description": "この記憶を持つログは特別な共感を呼び起こす",
            "effects": ["初期好感度+50%", "特殊イベント発生率+30%", "記憶関連の選択肢が追加"],
        }

    def _record_inheritance_history(
        self,
        character: Character,
        fragments: list[LogFragment],
        inheritance_type: MemoryInheritanceType,
        result: dict[str, Any],
    ) -> None:
        """継承履歴を記録"""
        if not character.character_metadata:
            character.character_metadata = {}
        if "inheritance_history" not in character.character_metadata:
            character.character_metadata["inheritance_history"] = []

        history_entry = {
            "id": str(uuid4()),
            "timestamp": "current_timestamp",
            "fragment_ids": [f.id for f in fragments],
            "inheritance_type": inheritance_type.value,
            "result": result,
        }

        character.character_metadata["inheritance_history"].append(history_entry)
