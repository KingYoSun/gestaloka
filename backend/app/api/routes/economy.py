from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_container, get_current_user, get_db
from app.core.container import AppContainer
from app.modules.identity.oidc import UserIdentity


router = APIRouter(prefix="/economy", tags=["economy"])

SP_PURCHASE_OPTIONS = (5, 15, 30, 60, 120)


class SPPurchaseRequest(BaseModel):
    amount: int = Field(ge=1, le=10000)


@router.get("/sp/me")
def get_my_sp_wallet(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, object]:
    payload = container.economy_service.get_wallet(db, user_sub=user.sub)
    db.commit()
    return payload


@router.get("/sp/purchase-options")
def get_sp_purchase_options(
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, object]:
    wallet = container.economy_service.get_wallet(db, user_sub=user.sub)
    db.commit()
    return {
        "wallet": wallet,
        "options": [{"amount": amount, "label": f"{amount} SP"} for amount in SP_PURCHASE_OPTIONS],
    }


@router.post("/sp/mock-purchases")
def post_mock_sp_purchase(
    payload: SPPurchaseRequest,
    db: Session = Depends(get_db),
    container: AppContainer = Depends(get_container),
    user: UserIdentity = Depends(get_current_user),
) -> dict[str, object]:
    if payload.amount not in SP_PURCHASE_OPTIONS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unsupported SP purchase amount")
    result = container.economy_service.grant_paid_purchase(
        db,
        user_sub=user.sub,
        amount=payload.amount,
        reference_id=f"mock:{user.sub}:{payload.amount}",
        note="Mock paid SP purchase",
    )
    wallet = container.economy_service.get_wallet(db, user_sub=user.sub)
    db.commit()
    return {
        "status": "completed",
        "amount": payload.amount,
        "ledger_entry_id": result.ledger_entry.id,
        "wallet": wallet,
    }
