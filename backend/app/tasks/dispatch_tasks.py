"""
ログ派遣システムのCeleryタスク

派遣中のログの活動をシミュレートし、報告書を生成するタスク群
"""

import asyncio
import random
from datetime import datetime
from typing import Any, Optional

import structlog
from celery import current_app
from sqlmodel import Session, select

from app.core.database import SessionLocal
from app.models.log import CompletedLog
from app.models.log_dispatch import (
    DispatchEncounter,
    DispatchObjectiveType,
    DispatchReport,
    DispatchStatus,
    LogDispatch,
)
from app.services.ai.dispatch_interaction import DispatchInteractionManager
from app.services.ai.dispatch_simulator import DispatchSimulator

logger = structlog.get_logger(__name__)


@current_app.task(name="app.tasks.dispatch_tasks.process_dispatch_activities")
def process_dispatch_activities(dispatch_id: str) -> dict[str, Any]:
    """
    派遣中のログの活動を処理

    定期的に実行され、ログの活動をシミュレートします。
    """
    # セッションを直接作成（Celeryタスク内のため）
    db = SessionLocal()
    try:
        # 派遣記録を取得
        stmt = select(LogDispatch).where(LogDispatch.id == dispatch_id)
        result = db.exec(stmt)
        dispatch = result.first()

        if not dispatch or dispatch.status != DispatchStatus.DISPATCHED:
            return {"status": "skipped", "reason": "Dispatch not active"}

        # 完成ログの情報を取得
        log_stmt = select(CompletedLog).where(CompletedLog.id == dispatch.completed_log_id)
        result = db.exec(log_stmt)
        completed_log = result.first()

        if not completed_log:
            return {"status": "error", "reason": "Completed log not found"}

        # 活動をシミュレート（非同期関数を同期的に実行）
        activity = asyncio.run(simulate_dispatch_activity(dispatch, completed_log, db))

        # 活動記録を追加
        dispatch.travel_log.append(activity)

        # 現在位置を更新
        if activity.get("location"):
            dispatch.current_location = activity["location"]
            dispatch.last_location_update = datetime.utcnow()

        # 目的に応じた成果を記録
        if dispatch.objective_type == DispatchObjectiveType.EXPLORE and activity.get("discovered_location"):
            dispatch.discovered_locations.append(activity["discovered_location"])
        elif dispatch.objective_type == DispatchObjectiveType.COLLECT and activity.get("collected_item"):
            dispatch.collected_items.append(activity["collected_item"])

        # 派遣期限を確認
        if dispatch.expected_return_at and datetime.utcnow() >= dispatch.expected_return_at:
            # 派遣完了
            dispatch.status = DispatchStatus.COMPLETED
            dispatch.actual_return_at = datetime.utcnow()

            # 成果を計算
            dispatch.achievement_score = calculate_achievement_score(dispatch)
            dispatch.sp_refund_amount = int(dispatch.sp_cost * dispatch.achievement_score * 0.2)

            db.commit()

            # 報告書生成タスクをスケジュール
            generate_dispatch_report.delay(dispatch_id)

            return {"status": "completed", "achievement_score": dispatch.achievement_score}
        else:
            db.commit()

            # 次の活動をスケジュール（1-3時間後）
            next_activity_delay = random.randint(3600, 10800)  # 1-3時間
            process_dispatch_activities.apply_async(
                args=[dispatch_id],
                countdown=next_activity_delay,
            )

            return {"status": "continued", "next_activity_in": next_activity_delay}
    finally:
        db.close()


async def simulate_dispatch_activity(
    dispatch: LogDispatch,
    completed_log: CompletedLog,
    db: Session,
) -> dict[str, Any]:
    """
    派遣中の活動をシミュレート（AI駆動版）
    """
    try:
        # AI駆動のシミュレーターを使用
        simulator = DispatchSimulator()
        simulated_activity = await simulator.simulate_activity(
            dispatch=dispatch,
            completed_log=completed_log,
            db=db,
        )

        # 既存のフォーマットに変換
        activity = {
            "timestamp": simulated_activity.timestamp.isoformat(),
            "location": simulated_activity.location,
            "action": simulated_activity.action,
            "result": simulated_activity.result,
            "narrative": simulated_activity.narrative,
            "success_level": simulated_activity.success_level,
        }

        # 発見した場所を追加
        if simulated_activity.discovered_location:
            activity["discovered_location"] = simulated_activity.discovered_location

        # 収集したアイテムを追加
        if simulated_activity.collected_item:
            activity["collected_item"] = simulated_activity.collected_item

        # 遭遇情報を追加
        if simulated_activity.encounter:
            activity["encounter_id"] = simulated_activity.encounter.id

        # 経験値情報を追加
        if simulated_activity.experience_gained:
            activity["experience_gained"] = simulated_activity.experience_gained

        # 関係性の変化を追加
        if simulated_activity.relationship_changes:
            activity["relationship_changes"] = simulated_activity.relationship_changes

        return activity

    except Exception as e:
        # エラー時はフォールバック（従来の単純な実装）
        logger.error("AI simulation failed, using fallback", error=str(e))
        return simulate_dispatch_activity_fallback(dispatch, completed_log, db)


def simulate_dispatch_activity_fallback(
    dispatch: LogDispatch,
    completed_log: CompletedLog,
    db: Session,
) -> dict[str, Any]:
    """
    派遣中の活動をシミュレート（フォールバック版）
    """
    activity = {
        "timestamp": datetime.utcnow().isoformat(),
        "location": generate_location_name(),
        "action": "",
        "result": "",
    }

    # 目的に応じた活動を生成
    if dispatch.objective_type == DispatchObjectiveType.EXPLORE:
        if random.random() < 0.3:
            # 新しい場所を発見
            new_location = generate_unique_location_name()
            activity["action"] = "Explored unknown territory"
            activity["result"] = f"Discovered {new_location}"
            activity["discovered_location"] = new_location
        else:
            activity["action"] = "Surveyed the area"
            activity["result"] = "Gathered environmental data"

    elif dispatch.objective_type == DispatchObjectiveType.INTERACT:
        if random.random() < 0.4:
            # 他のキャラクターと遭遇
            encounter = create_random_encounter(dispatch, db)
            if encounter:
                activity["action"] = f"Encountered {encounter.encountered_npc_name or 'a traveler'}"
                activity["result"] = encounter.outcome
                activity["encounter_id"] = encounter.id
        else:
            activity["action"] = "Searched for other travelers"
            activity["result"] = "No encounters"

    elif dispatch.objective_type == DispatchObjectiveType.COLLECT:
        if random.random() < 0.25:
            # アイテムを収集
            item = generate_random_item()
            activity["action"] = "Searched for valuable items"
            activity["result"] = f"Found {item['name']}"
            activity["collected_item"] = item  # type: ignore[assignment]
        else:
            activity["action"] = "Searched for resources"
            activity["result"] = "Nothing of value found"

    elif dispatch.objective_type == DispatchObjectiveType.GUARD:
        activity["action"] = "Patrolled the designated area"
        if random.random() < 0.1:
            activity["result"] = "Deterred potential threats"
        else:
            activity["result"] = "Area remains secure"

    else:  # FREE
        # ログの性格に基づいた自由行動
        actions = [
            ("Wandered through the wilderness", "Enjoyed the scenery"),
            ("Practiced combat techniques", "Improved skills"),
            ("Meditated on past experiences", "Gained new insights"),
            ("Helped local villagers", "Earned gratitude"),
        ]
        action, result = random.choice(actions)
        activity["action"] = action
        activity["result"] = result

    return activity


def create_random_encounter(dispatch: LogDispatch, db: Session) -> Optional[DispatchEncounter]:
    """
    ランダムな遭遇を作成
    """
    encounter_types = [
        ("conversation", "Had a pleasant conversation", "friendly"),
        ("trade", "Exchanged goods", "neutral"),
        ("conflict", "Had a disagreement", "hostile"),
        ("cooperation", "Worked together", "friendly"),
    ]

    interaction_type, summary, outcome = random.choice(encounter_types)

    encounter = DispatchEncounter(
        dispatch_id=dispatch.id,
        encountered_npc_name=generate_npc_name(),
        location=generate_location_name(),
        interaction_type=interaction_type,
        interaction_summary=summary,
        outcome=outcome,
        relationship_change=random.uniform(-0.5, 0.5) if outcome == "hostile" else random.uniform(0, 1),
        items_exchanged=[],
        occurred_at=datetime.utcnow(),
    )

    db.add(encounter)
    db.commit()

    return encounter


def calculate_achievement_score(dispatch: LogDispatch) -> float:
    """
    派遣の達成度を計算
    """
    score = 0.5  # 基本スコア

    # 目的別の達成度計算
    if dispatch.objective_type == DispatchObjectiveType.EXPLORE:
        # 発見した場所の数に応じて
        score += min(0.5, len(dispatch.discovered_locations) * 0.1)

    elif dispatch.objective_type == DispatchObjectiveType.INTERACT:
        # 遭遇の数に応じて
        encounter_count = len([log for log in dispatch.travel_log if isinstance(log, dict) and "encounter_id" in log])
        score += min(0.5, encounter_count * 0.1)

    elif dispatch.objective_type == DispatchObjectiveType.COLLECT:
        # 収集したアイテムの数に応じて
        score += min(0.5, len(dispatch.collected_items) * 0.15)

    elif dispatch.objective_type == DispatchObjectiveType.GUARD:
        # 守護任務は期間完了で高スコア
        score = 0.9

    elif dispatch.objective_type == DispatchObjectiveType.TRADE:
        # 商業活動は利益率で評価
        # Note: objective_detail is a string, not a dict, so this logic might need revision
        score += 0.3  # 基本スコアを追加

    elif dispatch.objective_type == DispatchObjectiveType.MEMORY_PRESERVE:
        # 記憶保存は成功率で評価
        # Note: objective_detail is a string, not a dict, so this logic might need revision
        score += 0.3  # 基本スコアを追加

    elif dispatch.objective_type == DispatchObjectiveType.RESEARCH:
        # 研究は解明度で評価
        # Note: objective_detail is a string, not a dict, so this logic might need revision
        score += 0.3  # 基本スコアを追加

    else:  # FREE
        # 自由行動は基本スコアに少し追加
        score = 0.7

    return min(1.0, score)


@current_app.task(name="app.tasks.dispatch_tasks.generate_dispatch_report")
def generate_dispatch_report(dispatch_id: str) -> dict[str, Any]:
    """
    派遣報告書を生成
    """
    # セッションを直接作成（Celeryタスク内のため）
    db = SessionLocal()
    try:
        # 派遣記録を取得
        stmt = select(LogDispatch).where(LogDispatch.id == dispatch_id)
        result = db.exec(stmt)
        dispatch = result.first()

        if not dispatch:
            return {"status": "error", "reason": "Dispatch not found"}

        # 既存の報告書を確認
        report_stmt = select(DispatchReport).where(DispatchReport.dispatch_id == dispatch_id)
        result = db.exec(report_stmt)
        existing_report = result.first()

        if existing_report:
            return {"status": "skipped", "reason": "Report already exists"}

        # 完成ログの情報を取得
        log_stmt = select(CompletedLog).where(CompletedLog.id == dispatch.completed_log_id)
        result = db.exec(log_stmt)
        completed_log = result.first()

        if not completed_log:
            return {"status": "error", "reason": "Completed log not found"}

        # 遭遇記録を集計
        encounter_stmt = select(DispatchEncounter).where(DispatchEncounter.dispatch_id == dispatch_id)
        result = db.exec(encounter_stmt)
        encounters = result.all()

        # 派遣タイプ別の詳細データを生成
        economic_details = None
        special_achievements = None

        if dispatch.objective_type == DispatchObjectiveType.TRADE:
            economic_details = generate_economic_details(dispatch)
        elif dispatch.objective_type in [
            DispatchObjectiveType.MEMORY_PRESERVE,
            DispatchObjectiveType.RESEARCH
        ]:
            special_achievements = generate_special_achievements(dispatch)

        # 報告書を生成
        report = DispatchReport(
            dispatch_id=dispatch_id,
            total_distance_traveled=len(dispatch.travel_log) * random.randint(5, 20),  # 仮の計算
            total_encounters=len(encounters),
            total_items_collected=len(dispatch.collected_items),
            total_locations_discovered=len(dispatch.discovered_locations),
            objective_completion_rate=dispatch.achievement_score,
            memorable_moments=extract_memorable_moments(dispatch, encounters),
            personality_changes=generate_personality_changes(completed_log, dispatch),
            new_skills_learned=generate_new_skills(dispatch),
            narrative_summary=asyncio.run(generate_narrative_summary(dispatch, completed_log, encounters)),
            epilogue=generate_epilogue(dispatch, completed_log) if dispatch.achievement_score > 0.7 else None,
            economic_details=economic_details,
            special_achievements=special_achievements,
            created_at=datetime.utcnow(),
        )

        db.add(report)
        db.commit()

        return {"status": "success", "report_id": report.id}
    finally:
        db.close()


def extract_memorable_moments(dispatch: LogDispatch, encounters: list[DispatchEncounter]) -> list[dict]:
    """
    印象的な出来事を抽出
    """
    moments = []

    # 最初の発見
    if dispatch.discovered_locations:
        moments.append({
            "type": "discovery",
            "description": f"Discovered {dispatch.discovered_locations[0]}",
            "impact": "high",
        })

    # 重要な遭遇
    for encounter in encounters:
        if encounter.relationship_change > 0.7:
            moments.append({
                "type": "encounter",
                "description": f"Formed a strong bond with {encounter.encountered_npc_name}",
                "impact": "high",
            })
        elif encounter.relationship_change < -0.5:
            moments.append({
                "type": "conflict",
                "description": f"Had a serious conflict with {encounter.encountered_npc_name}",
                "impact": "medium",
            })

    # レアアイテムの発見
    for item in dispatch.collected_items:
        if item.get("rarity") == "rare":
            moments.append({
                "type": "treasure",
                "description": f"Found rare item: {item['name']}",
                "impact": "high",
            })

    return moments[:5]  # 最大5つまで


def generate_personality_changes(completed_log: CompletedLog, dispatch: LogDispatch) -> list[str]:
    """
    派遣による性格の変化を生成
    """
    changes = []

    if dispatch.objective_type == DispatchObjectiveType.EXPLORE:
        changes.append("Became more curious and adventurous")
    elif dispatch.objective_type == DispatchObjectiveType.INTERACT:
        if dispatch.achievement_score > 0.7:
            changes.append("Improved social skills and empathy")
    elif dispatch.objective_type == DispatchObjectiveType.GUARD:
        changes.append("Developed a stronger sense of duty")

    # 汚染度による変化
    if completed_log.contamination_level > 0.5:
        changes.append("Showed signs of inner conflict")

    return changes


def generate_new_skills(dispatch: LogDispatch) -> list[str]:
    """
    派遣で習得した新スキルを生成
    """
    skills = []

    if dispatch.objective_type == DispatchObjectiveType.EXPLORE:
        skills.append("Navigation")
        if len(dispatch.discovered_locations) > 3:
            skills.append("Cartography")

    elif dispatch.objective_type == DispatchObjectiveType.INTERACT:
        encounter_count = sum(1 for log in dispatch.travel_log if isinstance(log, dict) and "encounter_id" in log)
        if encounter_count > 5:
            skills.append("Diplomacy")

    elif dispatch.objective_type == DispatchObjectiveType.COLLECT:
        if len(dispatch.collected_items) > 3:
            skills.append("Treasure Hunting")

    return skills


async def generate_narrative_summary(
    dispatch: LogDispatch,
    completed_log: CompletedLog,
    encounters: list[DispatchEncounter],
) -> str:
    """
    物語の要約を生成（AI駆動版）
    """
    try:
        from app.services.ai.agents.dramatist import DramatistAgent
        from app.services.ai.prompt_manager import PromptContext

        # 脚本家AIを使用して物語を生成
        dramatist = DramatistAgent()

        # 派遣活動の詳細をまとめる
        duration_str = "0:00:00"
        if dispatch.dispatched_at:
            end_time = dispatch.actual_return_at or datetime.utcnow()
            duration_str = str(end_time - dispatch.dispatched_at)
        
        activity_summary = {
            "objective_type": dispatch.objective_type.value,
            "duration": duration_str,
            "discovered_locations": dispatch.discovered_locations,
            "collected_items": dispatch.collected_items,
            "encounters": len(encounters),
            "achievement_score": dispatch.achievement_score,
            "travel_log_entries": len(dispatch.travel_log),
        }

        # プロンプトコンテキストの構築
        context = PromptContext(
            character_name=completed_log.name,
            location="帰還地点",
            recent_actions=[log.get("action", "") for log in dispatch.travel_log[-5:] if isinstance(log, dict)],
            world_state={},
            additional_context={
                "task": "generate_dispatch_summary",
                "dispatch_details": activity_summary,
                "personality": completed_log.personality_traits,
                "contamination_level": completed_log.contamination_level,
                "memorable_moments": extract_memorable_moments(dispatch, encounters),
            },
        )

        # AIレスポンスを取得
        response = await dramatist.process(
            context,
            narrative_style="dispatch_summary",
        )

        return response.narrative or generate_narrative_summary_fallback(dispatch, completed_log, encounters)

    except Exception as e:
        logger.error("AI narrative generation failed", error=str(e))
        return generate_narrative_summary_fallback(dispatch, completed_log, encounters)


def generate_narrative_summary_fallback(
    dispatch: LogDispatch,
    completed_log: CompletedLog,
    encounters: list[DispatchEncounter],
) -> str:
    """
    物語の要約を生成（フォールバック版）
    """
    summary = f"{completed_log.name}は"

    if dispatch.objective_type == DispatchObjectiveType.EXPLORE:
        summary += "未知の領域を探索する旅に出た。"
        if dispatch.discovered_locations:
            summary += f"その旅は{len(dispatch.discovered_locations)}の新たな場所の発見をもたらした。"
    elif dispatch.objective_type == DispatchObjectiveType.INTERACT:
        summary += "新たな出会いと繋がりを求める旅に出た。"
        if encounters:
            summary += f"道中、{len(encounters)}回の意味深い出会いが旅を彩った。"
    elif dispatch.objective_type == DispatchObjectiveType.COLLECT:
        summary += "貴重な資源を収集する旅に出た。"
        if dispatch.collected_items:
            summary += f"探索の結果、{len(dispatch.collected_items)}個の興味深いアイテムを発見した。"
    elif dispatch.objective_type == DispatchObjectiveType.GUARD:
        summary += "指定された地域を守護する任務に就いた。"
        summary += "その責務は献身的に果たされた。"
    elif dispatch.objective_type == DispatchObjectiveType.TRADE:
        summary += "商業活動のために各地を巡った。"
        # Note: objective_detail is a string, economic details would need to be stored elsewhere
        summary += "様々な取引を行い、経験を積んだ。"
    elif dispatch.objective_type == DispatchObjectiveType.MEMORY_PRESERVE:
        summary += "失われゆく記憶を保存する旅に出た。"
        # Note: objective_detail is a string, memory details would need to be stored elsewhere
        summary += "多くの貴重な記憶を保護することができた。"
    elif dispatch.objective_type == DispatchObjectiveType.RESEARCH:
        summary += "古代の謎を解明する研究の旅に出た。"
        # Note: objective_detail is a string, research details would need to be stored elsewhere
        summary += "研究は着実な進展を見せた。"
    else:
        summary += "自由な道を歩む旅に出た。"
        summary += "その旅は予期せぬ経験に満ちていた。"

    if dispatch.achievement_score > 0.8:
        summary += "任務は驚くべき成功を収めた。"
    elif dispatch.achievement_score > 0.5:
        summary += "目的はおおむね達成された。"
    else:
        summary += "困難はあったが、貴重な教訓を得た。"

    return summary


def generate_economic_details(dispatch: LogDispatch) -> dict:
    """
    商業活動の詳細を生成
    """
    # 基本的な売買データ
    total_sales = random.randint(100, 1000)
    total_costs = int(total_sales * random.uniform(0.3, 0.7))
    profit = total_sales - total_costs

    details = {
        "total_sales": total_sales,
        "total_costs": total_costs,
        "net_profit": profit,
        "profit_rate": profit / total_sales if total_sales > 0 else 0,
        "best_selling_items": [
            {"name": "Healing Potion", "quantity": random.randint(5, 20), "revenue": random.randint(50, 200)},
            {"name": "Mana Crystal", "quantity": random.randint(2, 10), "revenue": random.randint(100, 500)},
        ],
        "trade_partners": [
            {"name": "Merchant Guild", "transactions": random.randint(3, 10)},
            {"name": "Local Adventurers", "transactions": random.randint(5, 15)},
        ],
        "market_insights": [
            "High demand for healing items in the lower levels",
            "Rare materials fetch premium prices in corporate districts",
        ]
    }

    return details


def generate_special_achievements(dispatch: LogDispatch) -> dict:
    """
    特殊な成果を生成（記憶保存、研究など）
    """
    achievements = {}

    if dispatch.objective_type == DispatchObjectiveType.MEMORY_PRESERVE:
        memories_collected = random.randint(5, 30)
        memories_preserved = int(memories_collected * random.uniform(0.6, 0.95))

        achievements = {
            "type": "memory_preservation",
            "memories_collected": memories_collected,
            "memories_preserved": memories_preserved,
            "preservation_rate": memories_preserved / memories_collected if memories_collected > 0 else 0,
            "notable_memories": [
                {"title": "Last Mayor's Speech", "rarity": "Legendary", "emotional_impact": "High"},
                {"title": "Children's Lullaby", "rarity": "Rare", "emotional_impact": "Medium"},
            ],
            "fading_delayed": f"{random.randint(3, 15)}%",
            "contribution_to_library": random.randint(1, 5),
        }

    elif dispatch.objective_type == DispatchObjectiveType.RESEARCH:
        research_progress = random.uniform(0.2, 0.8)

        achievements = {
            "type": "research",
            "research_target": "Ancient Crystal Formation",
            "completion_rate": research_progress,
            "discoveries": [
                {"finding": "Energy resonance pattern identified", "significance": "High"},
                {"finding": "Partial translation of Designer script", "significance": "Medium"},
            ],
            "samples_collected": random.randint(3, 15),
            "academic_evaluation": random.choice(["A", "A+", "S"]),
            "published_papers": random.randint(0, 2),
        }

    return achievements


def generate_epilogue(dispatch: LogDispatch, completed_log: CompletedLog) -> str:
    """
    エピローグを生成（高達成度の場合のみ）
    """
    epilogue = f"As {completed_log.name} returns from their journey, "

    if dispatch.objective_type == DispatchObjectiveType.EXPLORE:
        epilogue += "the maps they created will guide future travelers. "
    elif dispatch.objective_type == DispatchObjectiveType.INTERACT:
        epilogue += "the bonds formed during the journey continue to flourish. "
    elif dispatch.objective_type == DispatchObjectiveType.COLLECT:
        epilogue += "the treasures found tell stories of distant lands. "
    elif dispatch.objective_type == DispatchObjectiveType.GUARD:
        epilogue += "their vigilance ensured peace for those they protected. "
    else:
        epilogue += "their experiences have become part of the world's tapestry. "

    epilogue += f"This chapter of {completed_log.name}'s story comes to a close, but their legend continues to grow."

    return epilogue


# ヘルパー関数（仮実装）
def generate_location_name() -> str:
    """場所名を生成"""
    locations = ["Crystal Valley", "Whispering Woods", "Azure Coast", "Silent Hills", "Golden Plains"]
    return random.choice(locations)


def generate_unique_location_name() -> str:
    """ユニークな場所名を生成"""
    prefixes = ["Hidden", "Ancient", "Mystical", "Forgotten", "Sacred"]
    suffixes = ["Ruins", "Temple", "Grove", "Cavern", "Sanctuary"]
    return f"{random.choice(prefixes)} {random.choice(suffixes)}"


def generate_npc_name() -> str:
    """NPC名を生成"""
    names = ["Elara the Wanderer", "Marcus the Merchant", "Luna the Scholar", "Rex the Guardian", "Iris the Healer"]
    return random.choice(names)


def generate_random_item() -> dict[str, Any]:
    """ランダムなアイテムを生成"""
    items = [
        {"name": "Ancient Coin", "rarity": "common", "value": 10},
        {"name": "Mysterious Crystal", "rarity": "uncommon", "value": 50},
        {"name": "Enchanted Ring", "rarity": "rare", "value": 200},
        {"name": "Healing Herb", "rarity": "common", "value": 5},
        {"name": "Old Map Fragment", "rarity": "uncommon", "value": 30},
    ]
    return random.choice(items)


@current_app.task(name="app.tasks.dispatch_tasks.check_dispatch_interactions")
def check_dispatch_interactions() -> dict[str, Any]:
    """
    派遣ログ同士の相互作用をチェックし処理する定期タスク
    Returns:
        処理結果の辞書
    """
    db = SessionLocal()
    try:
        # 相互作用マネージャーを初期化
        interaction_manager = DispatchInteractionManager()

        # 相互作用をチェックして処理（非同期関数を同期的に実行）
        interactions = asyncio.run(
            interaction_manager.check_and_process_interactions(db)
        )

        # 結果をまとめる
        result = {
            "status": "success",
            "interactions_processed": len(interactions),
            "interactions": [
                {
                    "dispatch_1": interaction.dispatch_id_1,
                    "dispatch_2": interaction.dispatch_id_2,
                    "type": interaction.interaction_type,
                    "outcome": interaction.outcome,
                    "location": interaction.location,
                }
                for interaction in interactions
            ],
        }

        logger.info(
            "Dispatch interactions checked",
            interactions_count=len(interactions),
        )

        return result

    except Exception as e:
        logger.error("Failed to check dispatch interactions", error=str(e))
        return {
            "status": "error",
            "error": str(e),
        }
    finally:
        db.close()
