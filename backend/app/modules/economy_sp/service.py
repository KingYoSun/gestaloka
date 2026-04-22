from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.entities import SPAccount, SPLedgerEntry


ALLOWED_SP_REASON_CODES = {
    "wallet_seed",
    "turn_cost",
    "retry_cost",
    "eval_cost",
    "reindex_cost",
    "turn_refund",
    "request_refund",
    "eval_refund",
    "admin_adjustment",
}


class InsufficientSPError(Exception):
    def __init__(self, *, balance: int, required: int, detail: str = "Insufficient SP balance") -> None:
        super().__init__(detail)
        self.balance = balance
        self.required = required
        self.detail = detail


@dataclass(frozen=True)
class SPMutationResult:
    ledger_entry: SPLedgerEntry
    balance_after: int
    delta: int


class EconomyService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def get_wallet(self, db: Session, *, user_sub: str, recent_limit: int = 10) -> dict[str, object]:
        account = self._ensure_account(db, user_sub=user_sub)
        recent_entries = self.list_ledger(db, user_sub=user_sub, limit=recent_limit)
        return {
            "user_sub": user_sub,
            "balance": account.balance,
            "turn_cost": self.settings.choice_turn_sp_cost,
            "choice_turn_cost": self.settings.choice_turn_sp_cost,
            "free_text_turn_cost": self.settings.free_text_turn_sp_cost,
            "budget_scope": "execution_only",
            "usage_policy": "SP is external execution budget, not in-world currency.",
            "recent_entries": recent_entries,
        }

    def debit_turn_cost(
        self,
        db: Session,
        *,
        user_sub: str,
        world_id: str,
        actor_id: str,
        reference_id: str,
        cost: int | None = None,
    ) -> SPMutationResult:
        resolved_cost = self.settings.choice_turn_sp_cost if cost is None else cost
        return self._apply_delta(
            db,
            user_sub=user_sub,
            delta=-resolved_cost,
            world_id=world_id,
            actor_id=actor_id,
            reason_code="turn_cost",
            reference_type="turn",
            reference_id=reference_id,
        )

    def refund_turn_cost(
        self,
        db: Session,
        *,
        user_sub: str,
        world_id: str,
        actor_id: str,
        reference_id: str,
        note: str | None,
        cost: int | None = None,
    ) -> SPMutationResult:
        resolved_cost = self.settings.choice_turn_sp_cost if cost is None else cost
        return self._apply_delta(
            db,
            user_sub=user_sub,
            delta=resolved_cost,
            world_id=world_id,
            actor_id=actor_id,
            reason_code="turn_refund",
            reference_type="turn",
            reference_id=reference_id,
            note=note,
        )

    def apply_adjustment(
        self,
        db: Session,
        *,
        user_sub: str,
        delta: int,
        reason_code: str,
        world_id: str | None,
        actor_id: str | None,
        created_by_sub: str,
        note: str | None,
    ) -> SPMutationResult:
        if reason_code != "admin_adjustment":
            raise ValueError("Admin adjustments must use reason_code=admin_adjustment")
        return self._apply_delta(
            db,
            user_sub=user_sub,
            delta=delta,
            world_id=world_id,
            actor_id=actor_id,
            reason_code=reason_code,
            reference_type="admin_adjustment",
            reference_id=created_by_sub,
            created_by_sub=created_by_sub,
            note=note,
        )

    def overview(self, db: Session) -> dict[str, object]:
        total_accounts = db.execute(select(func.count(SPAccount.user_sub))).scalar_one()
        total_ledger_entries = db.execute(select(func.count(SPLedgerEntry.id))).scalar_one()
        recent_adjustments = [
            self._entry_to_dict(entry)
            for entry in db.execute(
                select(SPLedgerEntry)
                .where(SPLedgerEntry.reference_type == "admin_adjustment")
                .order_by(SPLedgerEntry.created_at.desc(), SPLedgerEntry.id.desc())
                .limit(10)
            ).scalars()
        ]
        return {
            "default_balance": self.settings.sp_default_balance,
            "turn_cost": self.settings.choice_turn_sp_cost,
            "choice_turn_cost": self.settings.choice_turn_sp_cost,
            "free_text_turn_cost": self.settings.free_text_turn_sp_cost,
            "budget_scope": "execution_only",
            "total_accounts": int(total_accounts),
            "total_ledger_entries": int(total_ledger_entries),
            "recent_adjustments": recent_adjustments,
        }

    def list_ledger(
        self,
        db: Session,
        *,
        user_sub: str | None = None,
        world_id: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, object]]:
        stmt = select(SPLedgerEntry)
        if user_sub is not None:
            stmt = stmt.where(SPLedgerEntry.user_sub == user_sub)
        if world_id is not None:
            stmt = stmt.where(SPLedgerEntry.world_id == world_id)
        stmt = stmt.order_by(SPLedgerEntry.created_at.desc(), SPLedgerEntry.id.desc()).limit(limit)
        return [self._entry_to_dict(entry) for entry in db.execute(stmt).scalars()]

    def health_snapshot(self) -> dict[str, object]:
        return {
            "default_balance": self.settings.sp_default_balance,
            "turn_cost": self.settings.choice_turn_sp_cost,
            "choice_turn_cost": self.settings.choice_turn_sp_cost,
            "free_text_turn_cost": self.settings.free_text_turn_sp_cost,
            "budget_scope": "execution_only",
            "economy_status": "ready",
        }

    def _ensure_account(self, db: Session, *, user_sub: str) -> SPAccount:
        account = db.execute(select(SPAccount).where(SPAccount.user_sub == user_sub)).scalar_one_or_none()
        if account is not None:
            return account

        account = SPAccount(user_sub=user_sub, balance=self.settings.sp_default_balance)
        db.add(account)
        db.flush()
        db.add(
            SPLedgerEntry(
                user_sub=user_sub,
                world_id=None,
                actor_id=None,
                delta=self.settings.sp_default_balance,
                reason_code="wallet_seed",
                reference_type="wallet_seed",
                reference_id=user_sub,
                balance_after=account.balance,
                created_by_sub=None,
                note="Initial SP balance",
            )
        )
        db.flush()
        return account

    def _apply_delta(
        self,
        db: Session,
        *,
        user_sub: str,
        delta: int,
        world_id: str | None,
        actor_id: str | None,
        reason_code: str,
        reference_type: str,
        reference_id: str,
        created_by_sub: str | None = None,
        note: str | None = None,
    ) -> SPMutationResult:
        if delta == 0:
            raise ValueError("SP delta must be non-zero")
        if reason_code not in ALLOWED_SP_REASON_CODES:
            raise ValueError("SP reason_code is reserved for execution-budget accounting only")

        account = self._ensure_account(db, user_sub=user_sub)
        next_balance = account.balance + delta
        if next_balance < 0:
            raise InsufficientSPError(balance=account.balance, required=abs(delta))

        account.balance = next_balance
        db.flush()
        entry = SPLedgerEntry(
            user_sub=user_sub,
            world_id=world_id,
            actor_id=actor_id,
            delta=delta,
            reason_code=reason_code,
            reference_type=reference_type,
            reference_id=reference_id,
            balance_after=next_balance,
            created_by_sub=created_by_sub,
            note=note,
        )
        db.add(entry)
        db.flush()
        return SPMutationResult(ledger_entry=entry, balance_after=next_balance, delta=delta)

    @staticmethod
    def _entry_to_dict(entry: SPLedgerEntry) -> dict[str, object]:
        return {
            "id": entry.id,
            "user_sub": entry.user_sub,
            "world_id": entry.world_id,
            "actor_id": entry.actor_id,
            "delta": entry.delta,
            "reason_code": entry.reason_code,
            "reference_type": entry.reference_type,
            "reference_id": entry.reference_id,
            "balance_after": entry.balance_after,
            "created_by_sub": entry.created_by_sub,
            "note": entry.note,
            "created_at": entry.created_at.isoformat(),
        }
