from __future__ import annotations

from sqlalchemy import func, select

from app.models.entities import Event, Memory, SPLedgerEntry, Turn


def founders_session_payload() -> dict[str, str]:
    return {
        "world_id": "world-alpha",
        "pack_id": "founders_reach",
        "world_template_id": "founders_reach",
        "world_name": "Founders Reach",
    }


def test_sp_wallet_lazy_seed_only_once(client, container, auth_headers):
    first = client.get("/economy/sp/me", headers=auth_headers)
    second = client.get("/economy/sp/me", headers=auth_headers)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["balance"] == 10
    assert second.json()["balance"] == 10
    assert first.json()["budget_scope"] == "execution_only"
    assert first.json()["choice_turn_cost"] == 1
    assert first.json()["free_text_turn_cost"] == 3

    with container.session_factory() as db:
        seed_count = db.execute(
            select(func.count(SPLedgerEntry.id)).where(SPLedgerEntry.reason_code == "wallet_seed")
        ).scalar_one()

    assert seed_count == 1


def test_failed_turn_refunds_sp_and_records_ledger(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json=founders_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()

    turn_response = client.post(
        "/turns",
        json={
            "session_id": session_payload["session_id"],
            "input_mode": "free_text",
            "input_text": "__force_invalid_all__ 広場で灯をともす",
        },
        headers=auth_headers,
    )
    assert turn_response.status_code == 422
    payload = turn_response.json()
    assert payload["sp_delta"] == 0
    assert payload["sp_balance"] == 10

    with container.session_factory() as db:
        ledger_entries = list(db.execute(select(SPLedgerEntry).order_by(SPLedgerEntry.created_at.asc())).scalars())

    assert [entry.reason_code for entry in ledger_entries] == ["wallet_seed", "turn_cost", "turn_refund"]


def test_insufficient_sp_returns_409_without_turn_artifacts(client, container, auth_headers):
    session_response = client.post(
        "/sessions",
        json=founders_session_payload(),
        headers=auth_headers,
    )
    session_payload = session_response.json()

    zero_balance = client.post(
        "/ops/sp/adjustments",
        json={
            "user_sub": "local-player",
            "delta": -10,
            "reason_code": "admin_adjustment",
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
        json={"session_id": session_payload["session_id"], "input_mode": "choice", "choice_id": "progress"},
        headers=auth_headers,
    )
    assert turn_response.status_code == 409
    assert turn_response.json() == {
        "detail": "Insufficient SP balance",
        "balance": 0,
        "required": 1,
        "turn_cost": 1,
        "choice_turn_cost": 1,
        "free_text_turn_cost": 3,
    }

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
    assert overview_response.json()["budget_scope"] == "execution_only"

    session_response = client.post(
        "/sessions",
        json=founders_session_payload(),
        headers=auth_headers,
    )
    assert session_response.status_code == 200

    adjustment_response = client.post(
        "/ops/sp/adjustments",
        json={
            "user_sub": "local-player",
            "delta": 3,
            "reason_code": "admin_adjustment",
            "world_id": "world-alpha",
            "note": "bonus grant",
        },
        headers=auth_headers,
    )
    assert adjustment_response.status_code == 200
    assert adjustment_response.json()["balance"] == 13

    ledger_response = client.get(
        "/ops/sp/ledger?user_sub=local-player&world_id=world-alpha&limit=20",
        headers=auth_headers,
    )
    assert ledger_response.status_code == 200
    items = ledger_response.json()["items"]
    assert items[0]["reason_code"] == "admin_adjustment"
    assert items[0]["created_by_sub"] == "local-player"

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
            "world_id": None,
            "note": "should fail",
        },
        headers=auth_headers,
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Admin adjustments must use reason_code=admin_adjustment"
