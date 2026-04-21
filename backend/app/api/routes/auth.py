from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.modules.identity.oidc import UserIdentity

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me")
def auth_me(user: UserIdentity = Depends(get_current_user)) -> dict[str, str]:
    return {
        "sub": user.sub,
        "email": user.email or "",
        "name": user.name,
        "preferred_username": user.preferred_username or "",
    }
