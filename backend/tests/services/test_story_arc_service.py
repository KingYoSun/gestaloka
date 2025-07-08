"""
ストーリーアークサービスのテスト
"""

import pytest
from sqlmodel import Session

from app.models.character import Character
from app.models.story_arc import StoryArcStatus, StoryArcType
from app.services.story_arc_service import StoryArcService


@pytest.fixture
def story_arc_service(session: Session):
    """ストーリーアークサービスのフィクスチャ"""
    return StoryArcService(session)


@pytest.fixture
def test_character(session: Session):
    """テスト用キャラクター"""
    character = Character(
        id="test-character-1",
        user_id="test-user-1",
        name="テスト冒険者",
        level=5,
        experience=1000,
    )
    session.add(character)
    session.commit()
    return character


def test_create_story_arc(story_arc_service: StoryArcService, test_character: Character):
    """ストーリーアーク作成のテスト"""
    arc = story_arc_service.create_story_arc(
        character=test_character,
        title="テストアーク",
        description="これはテスト用のストーリーアークです",
        arc_type=StoryArcType.PERSONAL_STORY,
        total_phases=3,
        themes=["冒険", "成長"],
        central_conflict="内なる葛藤との対峙",
    )
    
    assert arc.id is not None
    assert arc.title == "テストアーク"
    assert arc.arc_type == StoryArcType.PERSONAL_STORY
    assert arc.status == StoryArcStatus.ACTIVE
    assert arc.total_phases == 3
    assert arc.current_phase == 1
    assert arc.progress_percentage == 0.0
    assert "冒険" in arc.themes
    assert arc.started_at is not None


def test_get_active_story_arc(story_arc_service: StoryArcService, test_character: Character):
    """アクティブなストーリーアーク取得のテスト"""
    # アークがない場合
    arc = story_arc_service.get_active_story_arc(test_character)
    assert arc is None
    
    # アークを作成
    created_arc = story_arc_service.create_story_arc(
        character=test_character,
        title="アクティブアーク",
        description="アクティブなアーク",
        arc_type=StoryArcType.MAIN_QUEST,
    )
    
    # 取得できることを確認
    arc = story_arc_service.get_active_story_arc(test_character)
    assert arc is not None
    assert arc.id == created_arc.id
    assert arc.status == StoryArcStatus.ACTIVE


def test_update_arc_progress(story_arc_service: StoryArcService, test_character: Character):
    """アーク進行状況更新のテスト"""
    arc = story_arc_service.create_story_arc(
        character=test_character,
        title="進行テストアーク",
        description="進行状況のテスト",
        arc_type=StoryArcType.SIDE_QUEST,
        total_phases=3,
    )
    
    # 進行率を更新
    updated_arc = story_arc_service.update_arc_progress(arc, progress_delta=25.0)
    assert updated_arc.progress_percentage == 25.0
    assert updated_arc.current_phase == 1
    
    # フェーズ完了
    updated_arc = story_arc_service.update_arc_progress(arc, phase_completed=True)
    assert updated_arc.current_phase == 2
    
    # 100%到達で自動完了
    arc.progress_percentage = 95.0
    arc.current_phase = 3
    updated_arc = story_arc_service.update_arc_progress(arc, progress_delta=10.0)
    assert updated_arc.status == StoryArcStatus.COMPLETED
    assert updated_arc.completed_at is not None


def test_create_milestone(story_arc_service: StoryArcService, test_character: Character):
    """マイルストーン作成のテスト"""
    arc = story_arc_service.create_story_arc(
        character=test_character,
        title="マイルストーンテスト",
        description="マイルストーンのテスト",
        arc_type=StoryArcType.CHARACTER_ARC,
    )
    
    milestone = story_arc_service.create_milestone(
        story_arc=arc,
        title="最初の試練",
        description="最初の大きな挑戦を乗り越える",
        phase_number=1,
        achievement_criteria={"boss_defeated": "ゴブリンリーダー"},
        triggers_next_phase=True,
        rewards={"experience": 500, "item": "勇者の証"},
    )
    
    assert milestone.id is not None
    assert milestone.story_arc_id == arc.id
    assert milestone.title == "最初の試練"
    assert milestone.triggers_next_phase is True
    assert not milestone.is_completed
    assert milestone.rewards["experience"] == 500


def test_check_milestone_completion(story_arc_service: StoryArcService, test_character: Character):
    """マイルストーン達成チェックのテスト"""
    arc = story_arc_service.create_story_arc(
        character=test_character,
        title="達成テスト",
        description="マイルストーン達成のテスト",
        arc_type=StoryArcType.MAIN_QUEST,
        total_phases=2,
    )
    
    milestone = story_arc_service.create_milestone(
        story_arc=arc,
        title="クエスト完了",
        description="特定のクエストを完了する",
        phase_number=1,
        achievement_criteria={
            "completed_quests": ["quest1", "quest2"],
            "talked_to_npcs": ["npc1"],
        },
        triggers_next_phase=True,
    )
    
    # 条件不足
    context = {
        "completed_quests": ["quest1"],
        "talked_to_npcs": ["npc1"],
    }
    completed = story_arc_service.check_milestone_completion(milestone, context)
    assert not completed
    assert not milestone.is_completed
    
    # 条件達成
    context["completed_quests"] = ["quest1", "quest2", "quest3"]
    completed = story_arc_service.check_milestone_completion(milestone, context)
    assert completed
    assert milestone.is_completed
    assert milestone.completed_at is not None
    
    # フェーズも進行
    arc = story_arc_service.db.get(arc.__class__, arc.id)
    assert arc.current_phase == 2