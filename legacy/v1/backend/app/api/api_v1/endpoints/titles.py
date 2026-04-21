"""Character titles API endpoints."""

from typing import Optional

from fastapi import APIRouter, Depends
from sqlmodel import Session, desc, select

from app.api import deps
from app.core.logging import get_logger
from app.models.character import Character
from app.models.title import CharacterTitle
from app.models.user import User
from app.schemas.title import (
    CharacterTitleRead,
)
from app.utils.exceptions import get_by_condition_or_404

logger = get_logger(__name__)
router = APIRouter()


@router.get("/", response_model=list[CharacterTitleRead])
async def get_character_titles(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> list[CharacterTitleRead]:
    """Get all titles for the current user's character."""
    character = get_by_condition_or_404(
        db,
        select(Character).where(Character.user_id == current_user.id),
        "Character not found"
    )

    titles = db.exec(
        select(CharacterTitle)
        .where(CharacterTitle.character_id == character.id)
        .order_by(desc(CharacterTitle.acquired_at))
    ).all()

    return [CharacterTitleRead.model_validate(title) for title in titles]


@router.get("/equipped", response_model=Optional[CharacterTitleRead])
async def get_equipped_title(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> Optional[CharacterTitleRead]:
    """Get the currently equipped title."""
    character = get_by_condition_or_404(
        db,
        select(Character).where(Character.user_id == current_user.id),
        "Character not found"
    )

    equipped_title = db.exec(
        select(CharacterTitle).where(CharacterTitle.character_id == character.id).where(CharacterTitle.is_equipped)
    ).first()

    return CharacterTitleRead.model_validate(equipped_title) if equipped_title else None


@router.put("/{title_id}/equip", response_model=CharacterTitleRead)
async def equip_title(
    *,
    db: Session = Depends(deps.get_db),
    title_id: str,
    current_user: User = Depends(deps.get_current_active_user),
) -> CharacterTitleRead:
    """Equip a specific title."""
    character = get_by_condition_or_404(
        db,
        select(Character).where(Character.user_id == current_user.id),
        "Character not found"
    )

    # Get the title to equip
    title = get_by_condition_or_404(
        db,
        select(CharacterTitle).where(CharacterTitle.id == title_id).where(CharacterTitle.character_id == character.id),
        "Title not found"
    )

    # Unequip all current titles
    current_titles = db.exec(
        select(CharacterTitle).where(CharacterTitle.character_id == character.id).where(CharacterTitle.is_equipped)
    ).all()

    for current_title in current_titles:
        current_title.is_equipped = False
        db.add(current_title)

    # Equip the new title
    title.is_equipped = True
    db.add(title)
    db.commit()
    db.refresh(title)

    logger.info(f"Character {character.id} equipped title: {title.title}")

    return CharacterTitleRead.model_validate(title)


@router.put("/unequip", response_model=dict)
async def unequip_all_titles(
    *,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_active_user),
) -> dict:
    """Unequip all titles."""
    character = get_by_condition_or_404(
        db,
        select(Character).where(Character.user_id == current_user.id),
        "Character not found"
    )

    # Unequip all titles
    equipped_titles = db.exec(
        select(CharacterTitle).where(CharacterTitle.character_id == character.id).where(CharacterTitle.is_equipped)
    ).all()

    for title in equipped_titles:
        title.is_equipped = False
        db.add(title)

    db.commit()

    logger.info(f"Character {character.id} unequipped all titles")

    return {"message": "All titles unequipped"}
