from __future__ import annotations

from collections.abc import Generator

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.container import AppContainer
from app.models.entities import AdminAppUser
from app.modules.identity.oidc import UserIdentity


def get_container(request: Request) -> AppContainer:
    return request.app.state.container  # type: ignore[return-value]


def get_db(container: AppContainer = Depends(get_container)) -> Generator[Session, None, None]:
    session = container.session_factory()
    try:
        yield session
    finally:
        session.close()


def get_current_user(
    authorization: str | None = Header(default=None),
    container: AppContainer = Depends(get_container),
) -> UserIdentity:
    token = require_bearer_token(authorization)
    return resolve_current_user_from_token(container, token)


def require_bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    return authorization.removeprefix("Bearer ").strip()


def resolve_current_user_from_token(container: AppContainer, token: str) -> UserIdentity:
    return container.oidc_adapter.resolve_token(token)


def get_current_ops_user(
    user: UserIdentity = Depends(get_current_user),
    container: AppContainer = Depends(get_container),
    db: Session = Depends(get_db),
) -> UserIdentity:
    if container.settings.oidc_dev_mode:
        return user
    if user.sub in container.settings.ops_admin_sub_list:
        return user
    admin_user = db.execute(select(AdminAppUser).where(AdminAppUser.user_sub == user.sub)).scalar_one_or_none()
    if admin_user is not None and admin_user.status == "active" and admin_user.role in {"admin", "operator"}:
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Ops access is restricted")


def ensure_primary_runtime(container: AppContainer) -> None:
    if container.settings.app_runtime_role != "primary":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This runtime only accepts eval and ops traffic",
        )
