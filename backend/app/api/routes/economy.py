from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_container, get_current_user, get_db
from app.core.container import AppContainer
from app.modules.identity.oidc import UserIdentity


router = APIRouter(prefix="/economy", tags=["economy"])


@router.get("/sp/me")
def get_my_sp_wallet(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, object]:
    payload = container.economy_service.get_wallet(db, user_sub=user.sub)
    db.commit()
    return payload
