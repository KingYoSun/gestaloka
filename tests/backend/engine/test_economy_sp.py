from __future__ import annotations

from sqlalchemy import func, select

from app.models.entities import Event, Memory, SPAccount, SPLedgerEntry, Turn
from tests.backend.turn_async_helpers import post_turn_and_wait


def engine_session_payload() -> dict[str, str]:
    return {
        "world_id": "gestaloka_world_reference",
        "world_name": "GESTALOKA: Layered World Foundation",
        "player_display_name": "Demo Player",
    }


def test_sp_wallet_lazy_seed_only_once(client, container, auth_headers):
    first = client.get("/economy/sp/me", headers=auth_headers)
    second = client.get("/economy/sp/me", headers=auth_headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["balance"] == 30
    assert first.json()["paid_sp"] == 0
    assert first.json()["bonus_sp"] == 30
    assert first.json()["initial_bonus_sp"] == 30
    assert second.json()["balance"] == 30
    assert second.json()["paid_sp"] == 0
    assert second.json()["bonus_sp"] == 30
    assert first.json()["budget_scope"] == "execution_only"
    assert first.json()["choice_turn_cost"] == 1
    assert first.json()["free_text_turn_cost"] == 3

    with container.session_factory() as db:
        seed_count = db.execute(
            select(func.count(SPLedgerEntry.id)).where(SPLedgerEntry.reason_code == "bonus_grant_signup")
        ).scalar_one()

    assert seed_count == 1


def test_sp_wallet_lazy_seed_survives_insert_race(container, monkeypatch):
    user_sub = "raced-player"

    with container.session_factory() as db:
        original_flush = db.flush
        raced = {"done": False}

        def racing_flush(*args, **kwargs):
            creating_raced_account = any(
                isinstance(item, SPAccount) and item.user_sub == user_sub
                for item in db.new
            )
            if creating_raced_account and not raced["done"]:
                raced["done"] = True
                with container.session_factory() as other_db:
                    container.economy_service.get_wallet(other_db, user_sub=user_sub)
                    other_db.commit()
            return original_flush(*args, **kwargs)

        monkeypatch.setattr(db, "flush", racing_flush)
        wallet = container.economy_service.get_wallet(db, user_sub=user_sub)
        db.commit()

    assert wallet["balance"] == 30
    assert wallet["paid_sp"] == 0
    assert wallet["bonus_sp"] == 30

    with container.session_factory() as db:
        account_count = db.execute(select(func.count(SPAccount.user_sub)).where(SPAccount.user_sub == user_sub)).scalar_one()
        seed_count = db.execute(
            select(func.count(SPLedgerEntry.id)).where(
                SPLedgerEntry.user_sub == user_sub,
                SPLedgerEntry.reason_code == "bonus_grant_signup",
            )
        ).scalar_one()

    assert account_count == 1
    assert seed_count == 1


def test_failed_turn_refunds_sp_and_records_ledger(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()

    _, payload, _ = post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={
            "input_mode": "free_text",
            "input_text": "__force_invalid_all__ 広場で灯をともす",
        },
        terminal_event="turn.failed",
    )

    with container.session_factory() as db:
        ledger_entries = list(db.execute(select(SPLedgerEntry).order_by(SPLedgerEntry.created_at.asc())).scalars())

    assert [entry.reason_code for entry in ledger_entries] == ["bonus_grant_signup", "turn_cost", "turn_refund"]
    assert ledger_entries[1].paid_delta == 0
    assert ledger_entries[1].bonus_delta == -3
    assert ledger_entries[2].paid_delta == 0
    assert ledger_entries[2].bonus_delta == 3


def test_turn_cost_consumes_bonus_before_paid_sp(client, container, auth_headers):
    wallet_response = client.get("/economy/sp/me", headers=auth_headers)
    assert wallet_response.status_code == 200

    with container.session_factory() as db:
        account = db.get(SPAccount, "local-player")
        assert account is not None
        account.bonus_balance = 2
        account.paid_balance = 10
        account.balance = 12
        db.commit()

    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()

    _, payload, _ = post_turn_and_wait(
        client,
        session_id=session_payload["session_id"],
        auth_headers=auth_headers,
        payload={
            "input_mode": "free_text",
            "input_text": "広場で灯をともす",
        },
    )
    assert payload["sp_balance"] == 9
    assert payload["paid_sp"] == 9
    assert payload["bonus_sp"] == 0

    with container.session_factory() as db:
        entry = db.execute(
            select(SPLedgerEntry).where(SPLedgerEntry.reason_code == "turn_cost").order_by(SPLedgerEntry.created_at.desc())
        ).scalars().first()

    assert entry is not None
    assert entry.bonus_delta == -2
    assert entry.paid_delta == -1


def test_insufficient_sp_returns_409_without_turn_artifacts(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()

    zero_balance = client.post(
        "/ops/sp/adjustments",
        json={
            "user_sub": "local-player",
            "delta": -30,
            "reason_code": "admin_adjustment",
            "sp_bucket": "bonus",
            "world_id": session_payload["world_id"],
            "note": "drain wallet for test",
        },
        headers=auth_headers,
    )
    assert zero_balance.status_code == 200

    with container.session_factory() as db:
        before_turns = db.execute(select(func.count(Turn.id))).scalar_one()
        before_events = db.execute(select(func.count(Event.id))).scalar_one()
        before_memories = db.execute(select(func.count(Memory.id))).scalar_one()

    turn_response = client.post(
        "/turns",
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "choice_2"},
        headers=auth_headers,
    )
    assert turn_response.status_code == 409
    error_payload = turn_response.json()
    assert error_payload == {
        "detail": "Insufficient SP balance",
        "balance": 0,
        "paid_sp": 0,
        "bonus_sp": 0,
        "required": 1,
        "turn_cost": 1,
        "choice_turn_cost": 1,
        "free_text_turn_cost": 3,
        "world_context": error_payload["world_context"],
    }
    assert error_payload["world_context"]["pack_id"] == "gestaloka_world_reference"

    with container.session_factory() as db:
        after_turns = db.execute(select(func.count(Turn.id))).scalar_one()
        after_events = db.execute(select(func.count(Event.id))).scalar_one()
        after_memories = db.execute(select(func.count(Memory.id))).scalar_one()
        turn_cost_count = db.execute(
            select(func.count(SPLedgerEntry.id)).where(SPLedgerEntry.reason_code == "turn_cost")
        ).scalar_one()

    assert after_turns == before_turns
    assert after_events == before_events
    assert after_memories == before_memories
    assert turn_cost_count == 0


def test_ops_sp_adjustment_and_filtered_ledger(client, container, auth_headers):
    overview_response = client.get("/ops/sp/overview", headers=auth_headers)
    assert overview_response.status_code == 200
    assert overview_response.json()["turn_cost"] == 1
    assert overview_response.json()["choice_turn_cost"] == 1
    assert overview_response.json()["free_text_turn_cost"] == 3
    assert overview_response.json()["initial_bonus_sp"] == 30
    assert overview_response.json()["budget_scope"] == "execution_only"

    session_response = client.post(
        "/sessions",
        json=engine_session_payload(),
        headers=auth_headers,
    )
    assert session_response.status_code == 200

    adjustment_response = client.post(
        "/ops/sp/adjustments",
        json={
            "user_sub": "local-player",
            "delta": 3,
            "reason_code": "admin_adjustment",
            "sp_bucket": "bonus",
            "world_id": "gestaloka_world_reference",
            "note": "bonus grant",
        },
        headers=auth_headers,
    )
    assert adjustment_response.status_code == 200
    assert adjustment_response.json()["balance"] == 33
    assert adjustment_response.json()["paid_sp"] == 0
    assert adjustment_response.json()["bonus_sp"] == 33

    ledger_response = client.get(
        "/ops/sp/ledger?user_sub=local-player&world_id=gestaloka_world_reference&limit=20",
        headers=auth_headers,
    )
    assert ledger_response.status_code == 200
    items = ledger_response.json()["items"]
    assert items[0]["reason_code"] == "admin_adjustment"
    assert items[0]["created_by_sub"] == "local-player"
    assert items[0]["world_context"]["pack_id"] == "gestaloka_world_reference"
    assert items[0]["world_context"]["world_template_id"] == "layered_world_foundation"

    global_ledger_response = client.get("/ops/sp/ledger?user_sub=local-player&limit=20", headers=auth_headers)
    assert global_ledger_response.status_code == 200
    seed_item = next(item for item in global_ledger_response.json()["items"] if item["reason_code"] == "bonus_grant_signup")
    assert seed_item["world_context"] is None

    updated_overview_response = client.get("/ops/sp/overview", headers=auth_headers)
    assert updated_overview_response.status_code == 200
    assert updated_overview_response.json()["recent_adjustments"][0]["world_context"]["pack_id"] == "gestaloka_world_reference"

    with container.session_factory() as db:
        latest = db.execute(
            select(SPLedgerEntry).order_by(SPLedgerEntry.created_at.desc(), SPLedgerEntry.id.desc()).limit(1)
        ).scalar_one()

    assert latest.created_by_sub == "local-player"
    assert latest.note == "bonus grant"


def test_world_state_reason_codes_are_rejected_for_sp_adjustments(client, auth_headers):
    response = client.post(
        "/ops/sp/adjustments",
        json={
            "user_sub": "local-player",
            "delta": 1,
            "reason_code": "quest_reward",
            "sp_bucket": "bonus",
            "world_id": None,
            "note": "should fail",
        },
        headers=auth_headers,
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Admin adjustments must use reason_code=admin_adjustment"
