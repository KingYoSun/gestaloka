from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.entities import SPAccount, SPLedgerEntry


ALLOWED_SP_REASON_CODES = {
    "wallet_seed",
    "bonus_grant_signup",
    "paid_purchase_grant",
    "turn_cost",
    "retry_cost",
    "eval_cost",
    "reindex_cost",
    "turn_refund",
    "request_refund",
    "eval_refund",
    "admin_adjustment",
}

SP_BUCKETS = {"paid", "bonus"}


class InsufficientSPError(Exception):
    def __init__(
        self,
        *,
        paid_sp: int,
        bonus_sp: int,
        required: int,
        detail: str = "Insufficient SP balance",
    ) -> None:
        super().__init__(detail)
        self.paid_sp = paid_sp
        self.bonus_sp = bonus_sp
        self.balance = paid_sp + bonus_sp
        self.required = required
        self.detail = detail


@dataclass(frozen=True)
class SPMutationResult:
    ledger_entry: SPLedgerEntry
    balance_after: int
    paid_balance_after: int
    bonus_balance_after: int
    delta: int
    paid_delta: int
    bonus_delta: int


class EconomyService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def get_wallet(self, db: Session, *, user_sub: str, recent_limit: int = 10) -> dict[str, object]:
        account = self._ensure_account(db, user_sub=user_sub)
        recent_entries = self.list_ledger(db, user_sub=user_sub, limit=recent_limit)
        return {
            "user_sub": user_sub,
            "balance": account.paid_balance + account.bonus_balance,
            "paid_sp": account.paid_balance,
            "bonus_sp": account.bonus_balance,
            "initial_bonus_sp": self.settings.sp_initial_bonus_balance,
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
        return self._apply_turn_debit(
            db,
            user_sub=user_sub,
            cost=resolved_cost,
            world_id=world_id,
            actor_id=actor_id,
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
        debit_entry = db.execute(
            select(SPLedgerEntry).where(
                SPLedgerEntry.user_sub == user_sub,
                SPLedgerEntry.reference_type == "turn",
                SPLedgerEntry.reference_id == reference_id,
                SPLedgerEntry.reason_code == "turn_cost",
            )
        ).scalar_one_or_none()
        if debit_entry is not None:
            paid_delta = -debit_entry.paid_delta
            bonus_delta = -debit_entry.bonus_delta
        else:
            paid_delta = 0
            bonus_delta = resolved_cost
        return self._apply_bucket_deltas(
            db,
            user_sub=user_sub,
            paid_delta=paid_delta,
            bonus_delta=bonus_delta,
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
        sp_bucket: str,
        world_id: str | None,
        actor_id: str | None,
        created_by_sub: str,
        note: str | None,
    ) -> SPMutationResult:
        if reason_code != "admin_adjustment":
            raise ValueError("Admin adjustments must use reason_code=admin_adjustment")
        return self._apply_single_bucket_delta(
            db,
            user_sub=user_sub,
            delta=delta,
            sp_bucket=sp_bucket,
            world_id=world_id,
            actor_id=actor_id,
            reason_code=reason_code,
            reference_type="admin_adjustment",
            reference_id=created_by_sub,
            created_by_sub=created_by_sub,
            note=note,
        )

    def grant_paid_purchase(
        self,
        db: Session,
        *,
        user_sub: str,
        amount: int,
        reference_id: str,
        note: str | None = None,
    ) -> SPMutationResult:
        return self._apply_single_bucket_delta(
            db,
            user_sub=user_sub,
            delta=amount,
            sp_bucket="paid",
            world_id=None,
            actor_id=None,
            reason_code="paid_purchase_grant",
            reference_type="sp_purchase",
            reference_id=reference_id,
            created_by_sub=None,
            note=note,
        )

    def overview(self, db: Session) -> dict[str, object]:
        total_accounts = db.execute(select(func.count(SPAccount.user_sub))).scalar_one()
        total_ledger_entries = db.execute(select(func.count(SPLedgerEntry.id))).scalar_one()
        totals = db.execute(select(func.coalesce(func.sum(SPAccount.paid_balance), 0), func.coalesce(func.sum(SPAccount.bonus_balance), 0))).one()
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
            "initial_bonus_sp": self.settings.sp_initial_bonus_balance,
            "turn_cost": self.settings.choice_turn_sp_cost,
            "choice_turn_cost": self.settings.choice_turn_sp_cost,
            "free_text_turn_cost": self.settings.free_text_turn_sp_cost,
            "budget_scope": "execution_only",
            "total_paid_sp": int(totals[0]),
            "total_bonus_sp": int(totals[1]),
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
            "initial_bonus_sp": self.settings.sp_initial_bonus_balance,
            "turn_cost": self.settings.choice_turn_sp_cost,
            "choice_turn_cost": self.settings.choice_turn_sp_cost,
            "free_text_turn_cost": self.settings.free_text_turn_sp_cost,
            "budget_scope": "execution_only",
            "economy_status": "ready",
        }

    def _ensure_account(self, db: Session, *, user_sub: str) -> SPAccount:
        account = db.execute(select(SPAccount).where(SPAccount.user_sub == user_sub)).scalar_one_or_none()
        if account is not None:
            self._normalize_account_balance(account)
            return account

        initial_bonus = self.settings.sp_initial_bonus_balance
        account = SPAccount(user_sub=user_sub, balance=initial_bonus, paid_balance=0, bonus_balance=initial_bonus)
        db.add(account)
        db.flush()
        if initial_bonus != 0:
            db.add(
                SPLedgerEntry(
                    user_sub=user_sub,
                    world_id=None,
                    actor_id=None,
                    delta=initial_bonus,
                    paid_delta=0,
                    bonus_delta=initial_bonus,
                    reason_code="bonus_grant_signup",
                    reference_type="bonus_grant_signup",
                    reference_id=user_sub,
                    balance_after=initial_bonus,
                    paid_balance_after=0,
                    bonus_balance_after=initial_bonus,
                    created_by_sub=None,
                    note="Initial bonus SP grant",
                )
            )
            db.flush()
        return account

    def _apply_single_bucket_delta(
        self,
        db: Session,
        *,
        user_sub: str,
        delta: int,
        sp_bucket: str,
        world_id: str | None,
        actor_id: str | None,
        reason_code: str,
        reference_type: str,
        reference_id: str,
        created_by_sub: str | None = None,
        note: str | None = None,
    ) -> SPMutationResult:
        if sp_bucket not in SP_BUCKETS:
            raise ValueError("sp_bucket must be paid or bonus")
        return self._apply_bucket_deltas(
            db,
            user_sub=user_sub,
            paid_delta=delta if sp_bucket == "paid" else 0,
            bonus_delta=delta if sp_bucket == "bonus" else 0,
            world_id=world_id,
            actor_id=actor_id,
            reason_code=reason_code,
            reference_type=reference_type,
            reference_id=reference_id,
            created_by_sub=created_by_sub,
            note=note,
        )

    def _apply_turn_debit(
        self,
        db: Session,
        *,
        user_sub: str,
        cost: int,
        world_id: str | None,
        actor_id: str | None,
        reference_type: str,
        reference_id: str,
    ) -> SPMutationResult:
        if cost <= 0:
            raise ValueError("SP cost must be positive")
        account = self._ensure_account(db, user_sub=user_sub)
        if account.paid_balance + account.bonus_balance < cost:
            raise InsufficientSPError(paid_sp=account.paid_balance, bonus_sp=account.bonus_balance, required=cost)
        bonus_spent = min(account.bonus_balance, cost)
        paid_spent = cost - bonus_spent
        return self._apply_bucket_deltas(
            db,
            user_sub=user_sub,
            paid_delta=-paid_spent,
            bonus_delta=-bonus_spent,
            world_id=world_id,
            actor_id=actor_id,
            reason_code="turn_cost",
            reference_type=reference_type,
            reference_id=reference_id,
        )

    def _apply_bucket_deltas(
        self,
        db: Session,
        *,
        user_sub: str,
        paid_delta: int,
        bonus_delta: int,
        world_id: str | None,
        actor_id: str | None,
        reason_code: str,
        reference_type: str,
        reference_id: str,
        created_by_sub: str | None = None,
        note: str | None = None,
    ) -> SPMutationResult:
        delta = paid_delta + bonus_delta
        if delta == 0:
            raise ValueError("SP delta must be non-zero")
        if reason_code not in ALLOWED_SP_REASON_CODES:
            raise ValueError("SP reason_code is reserved for execution-budget accounting only")

        account = self._ensure_account(db, user_sub=user_sub)
        next_paid_balance = account.paid_balance + paid_delta
        next_bonus_balance = account.bonus_balance + bonus_delta
        if next_paid_balance < 0 or next_bonus_balance < 0:
            raise InsufficientSPError(
                paid_sp=account.paid_balance,
                bonus_sp=account.bonus_balance,
                required=abs(delta),
            )

        account.paid_balance = next_paid_balance
        account.bonus_balance = next_bonus_balance
        account.balance = next_paid_balance + next_bonus_balance
        db.flush()
        entry = SPLedgerEntry(
            user_sub=user_sub,
            world_id=world_id,
            actor_id=actor_id,
            delta=delta,
            paid_delta=paid_delta,
            bonus_delta=bonus_delta,
            reason_code=reason_code,
            reference_type=reference_type,
            reference_id=reference_id,
            balance_after=account.balance,
            paid_balance_after=next_paid_balance,
            bonus_balance_after=next_bonus_balance,
            created_by_sub=created_by_sub,
            note=note,
        )
        db.add(entry)
        db.flush()
        return SPMutationResult(
            ledger_entry=entry,
            balance_after=account.balance,
            paid_balance_after=next_paid_balance,
            bonus_balance_after=next_bonus_balance,
            delta=delta,
            paid_delta=paid_delta,
            bonus_delta=bonus_delta,
        )

    @staticmethod
    def _normalize_account_balance(account: SPAccount) -> None:
        if account.paid_balance == 0 and account.bonus_balance == 0 and account.balance:
            account.bonus_balance = account.balance
        account.balance = account.paid_balance + account.bonus_balance

    @staticmethod
    def _entry_to_dict(entry: SPLedgerEntry) -> dict[str, object]:
        return {
            "id": entry.id,
            "user_sub": entry.user_sub,
            "world_id": entry.world_id,
            "actor_id": entry.actor_id,
            "delta": entry.delta,
            "paid_delta": entry.paid_delta,
            "bonus_delta": entry.bonus_delta,
            "reason_code": entry.reason_code,
            "reference_type": entry.reference_type,
            "reference_id": entry.reference_id,
            "balance_after": entry.balance_after,
            "paid_balance_after": entry.paid_balance_after,
            "bonus_balance_after": entry.bonus_balance_after,
            "created_by_sub": entry.created_by_sub,
            "note": entry.note,
            "created_at": entry.created_at.isoformat(),
        }
