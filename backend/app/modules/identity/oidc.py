from __future__ import annotations

from dataclasses import dataclass
from functools import cached_property
from typing import Protocol

import httpx
import jwt
from fastapi import HTTPException, status
from jwt import PyJWKClient

from app.core.config import Settings


@dataclass(frozen=True)
class UserIdentity:
    sub: str
    name: str
    email: str | None = None
    preferred_username: str | None = None


class BaseOIDCAdapter(Protocol):
    def resolve_token(self, access_token: str) -> UserIdentity: ...


class DevelopmentOIDCAdapter:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def resolve_token(self, access_token: str) -> UserIdentity:
        if access_token != "dev-local-token":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid development token")
        return UserIdentity(
            sub=self.settings.dev_oidc_sub,
            name=self.settings.dev_oidc_name,
            email=self.settings.dev_oidc_email,
            preferred_username=self.settings.dev_oidc_name.lower().replace(" ", "-"),
        )


class KeycloakOIDCAdapter:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @cached_property
    def _openid_configuration(self) -> dict:
        issuer = self.settings.oidc_issuer_url.rstrip("/")
        response = httpx.get(f"{issuer}/.well-known/openid-configuration", timeout=5.0)
        response.raise_for_status()
        raw = response.json()
        public_issuer = self.settings.oidc_public_issuer_url.rstrip("/")
        internal_issuer = self.settings.oidc_issuer_url.rstrip("/")
        if raw.get("jwks_uri", "").startswith(public_issuer):
            raw["jwks_uri"] = raw["jwks_uri"].replace(public_issuer, internal_issuer, 1)
        return raw

    @cached_property
    def _jwk_client(self) -> PyJWKClient:
        return PyJWKClient(self._openid_configuration["jwks_uri"])

    def resolve_token(self, access_token: str) -> UserIdentity:
        try:
            signing_key = self._jwk_client.get_signing_key_from_jwt(access_token)
            decoded = jwt.decode(
                access_token,
                signing_key.key,
                algorithms=["RS256"],
                options={"verify_aud": False},
                issuer=self.settings.oidc_public_issuer_url.rstrip("/"),
            )
        except Exception as exc:  # pragma: no cover - exercised in integration environments
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token validation failed") from exc

        audience = decoded.get("aud")
        audience_values = audience if isinstance(audience, list) else [audience]
        allowed = (
            self.settings.oidc_audience in audience_values
            or decoded.get("azp") in self.settings.oidc_allowed_client_id_list
        )
        if not allowed:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unexpected token audience")

        return UserIdentity(
            sub=decoded["sub"],
            name=decoded.get("name") or decoded.get("preferred_username") or decoded["sub"],
            email=decoded.get("email"),
            preferred_username=decoded.get("preferred_username"),
        )


def build_oidc_adapter(settings: Settings) -> BaseOIDCAdapter:
    if settings.oidc_dev_mode:
        return DevelopmentOIDCAdapter(settings)
    return KeycloakOIDCAdapter(settings)
