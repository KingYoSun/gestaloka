from __future__ import annotations

from collections.abc import Generator

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.container import AppContainer
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
