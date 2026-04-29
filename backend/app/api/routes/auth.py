from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_container, get_current_user, get_db
from app.core.container import AppContainer
from app.modules.identity.oidc import UserIdentity

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me")
def auth_me(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, str]:
    container.economy_service.get_wallet(db, user_sub=user.sub, recent_limit=1)
    db.commit()
    return {
        "sub": user.sub,
        "email": user.email or "",
        "name": user.name,
        "preferred_username": user.preferred_username or "",
    }
