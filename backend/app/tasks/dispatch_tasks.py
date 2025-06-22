"""
ログ派遣システムのCeleryタスク

派遣中のログの活動をシミュレートし、報告書を生成するタスク群
"""

import random
from datetime import datetime
from typing import Any, Optional

from celery import current_app
from sqlmodel import Session, select

# from app.core.ai.gm_council import GMCouncil  # TODO: GM AI統合時に有効化
from app.core.database import SessionLocal
from app.models.log import CompletedLog
from app.models.log_dispatch import (
    DispatchEncounter,
    DispatchObjectiveType,
    DispatchReport,
    DispatchStatus,
    LogDispatch,
)


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

        # 活動をシミュレート
        activity = simulate_dispatch_activity(dispatch, completed_log, db)

        # 活動記録を追加
        dispatch.travel_log.append(activity)

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


def simulate_dispatch_activity(
    dispatch: LogDispatch,
    completed_log: CompletedLog,
    db: Session,
) -> dict[str, Any]:
    """
    派遣中の活動をシミュレート
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
        encounter_count = len([log for log in dispatch.travel_log if "encounter_id" in log])
        score += min(0.5, encounter_count * 0.1)

    elif dispatch.objective_type == DispatchObjectiveType.COLLECT:
        # 収集したアイテムの数に応じて
        score += min(0.5, len(dispatch.collected_items) * 0.15)

    elif dispatch.objective_type == DispatchObjectiveType.GUARD:
        # 守護任務は期間完了で高スコア
        score = 0.9
        
    elif dispatch.objective_type == DispatchObjectiveType.TRADE:
        # 商業活動は利益率で評価
        if "economic_details" in dispatch.objective_details:
            profit_rate = dispatch.objective_details["economic_details"].get("profit_rate", 0)
            score += min(0.5, profit_rate * 0.01)  # 利益率50%で満点
        
    elif dispatch.objective_type == DispatchObjectiveType.MEMORY_PRESERVE:
        # 記憶保存は成功率で評価
        if "memory_details" in dispatch.objective_details:
            success_rate = dispatch.objective_details["memory_details"].get("success_rate", 0)
            score += min(0.5, success_rate)
            
    elif dispatch.objective_type == DispatchObjectiveType.RESEARCH:
        # 研究は解明度で評価
        if "research_details" in dispatch.objective_details:
            completion_rate = dispatch.objective_details["research_details"].get("completion_rate", 0)
            score += min(0.5, completion_rate)

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
            narrative_summary=generate_narrative_summary(dispatch, completed_log, encounters),
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
        encounter_count = sum(1 for log in dispatch.travel_log if "encounter_id" in log)
        if encounter_count > 5:
            skills.append("Diplomacy")

    elif dispatch.objective_type == DispatchObjectiveType.COLLECT:
        if len(dispatch.collected_items) > 3:
            skills.append("Treasure Hunting")

    return skills


def generate_narrative_summary(
    dispatch: LogDispatch,
    completed_log: CompletedLog,
    encounters: list[DispatchEncounter],
) -> str:
    """
    物語の要約を生成
    """
    # 簡易的な物語生成（本来はGM AIを使用）
    summary = f"{completed_log.name} embarked on a journey with the purpose of "

    if dispatch.objective_type == DispatchObjectiveType.EXPLORE:
        summary += "exploring unknown territories. "
        if dispatch.discovered_locations:
            summary += f"The journey led to the discovery of {len(dispatch.discovered_locations)} new locations. "
    elif dispatch.objective_type == DispatchObjectiveType.INTERACT:
        summary += "meeting new people and forming connections. "
        if encounters:
            summary += f"Along the way, {len(encounters)} meaningful encounters shaped the journey. "
    elif dispatch.objective_type == DispatchObjectiveType.COLLECT:
        summary += "gathering valuable resources. "
        if dispatch.collected_items:
            summary += f"The search yielded {len(dispatch.collected_items)} items of interest. "
    elif dispatch.objective_type == DispatchObjectiveType.GUARD:
        summary += "protecting a designated area. "
        summary += "The duty was fulfilled with dedication. "
    else:
        summary += "following their own path. "
        summary += "The journey was filled with unexpected experiences. "

    if dispatch.achievement_score > 0.8:
        summary += "The mission was a remarkable success."
    elif dispatch.achievement_score > 0.5:
        summary += "The objectives were largely achieved."
    else:
        summary += "Though challenges arose, valuable lessons were learned."

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
