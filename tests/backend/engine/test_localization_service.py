from __future__ import annotations

from app.modules.localization.service import PlayLocalizationPayload, _apply_glossary_replacements


def test_play_localization_payload_accepts_canonical_items_object() -> None:
    payload = PlayLocalizationPayload.model_validate(
        {"items": [{"key": "location:nexus_city:name:abc123", "localized_text": "ネクサス・ゲート"}]}
    )

    assert payload.items[0].key == "location:nexus_city:name:abc123"
    assert payload.items[0].localized_text == "ネクサス・ゲート"


def test_play_localization_payload_accepts_top_level_array() -> None:
    payload = PlayLocalizationPayload.model_validate(
        [{"key": "route:lift_tower:destination_name:abc123", "localized_text": "リフト・タワー・コンコース"}]
    )

    assert payload.items[0].key == "route:lift_tower:destination_name:abc123"
    assert payload.items[0].localized_text == "リフト・タワー・コンコース"


def test_play_localization_payload_accepts_text_alias_and_ignores_extra_fields() -> None:
    payload = PlayLocalizationPayload.model_validate(
        [
            {
                "key": "local_figure:rikka:display_name:abc123",
                "kind": "local_figure.display_name",
                "text": "ゲート守リッカ",
            }
        ]
    )

    assert payload.items[0].key == "local_figure:rikka:display_name:abc123"
    assert payload.items[0].localized_text == "ゲート守リッカ"


def test_play_localization_payload_keeps_first_duplicate_key() -> None:
    payload = PlayLocalizationPayload.model_validate(
        {
            "items": [
                {"key": "choice:explore:label:abc123", "text": "最初の訳"},
                {"key": "choice:explore:label:abc123", "text": "後の訳"},
            ]
        }
    )

    assert len(payload.items) == 1
    assert payload.items[0].localized_text == "最初の訳"


def test_glossary_replacements_remove_residual_source_names() -> None:
    localized = _apply_glossary_replacements(
        "Nexus Cityの気配を読み、Universal Libraryへ向かう。[aid_local]",
        [
            {
                "source_text": "Nexus City",
                "localized_text": "ネクサス・ゲート",
            },
            {
                "source_text": "Universal Library",
                "localized_text": "リフト・タワー・コンコース",
            },
        ],
    )

    assert localized == "ネクサス・ゲートの気配を読み、リフト・タワー・コンコースへ向かう。"


def test_glossary_replacements_collapse_repeated_localized_name_prefixes() -> None:
    localized = _apply_glossary_replacements(
        "ゲート守ゲート守リッカに礼を言い、記録官記録官イオネへ報告する。",
        [
            {
                "source_text": "Nexus Entry Liaison",
                "localized_text": "ゲート守リッカ",
            },
            {
                "source_text": "Historian AI of the Universal Library",
                "localized_text": "記録官イオネ",
            },
        ],
    )

    assert localized == "ゲート守リッカに礼を言い、記録官イオネへ報告する。"
