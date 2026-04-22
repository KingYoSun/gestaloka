from __future__ import annotations

import json
import time
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.modules.graph_projection.repository import (
    GraphProjectionBundle,
    GraphProjectionResult,
    GraphRelationContext,
    RecordingWorldGraphRepository,
    WorldGraphRepository,
    nebula_vid,
)


class NebulaWorldGraphRepository(WorldGraphRepository):
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._pool = None
        self._bootstrapped = False
        self._recording = RecordingWorldGraphRepository()

    def bootstrap(self) -> None:
        if self._bootstrapped:
            return
        self._execute(
            "CREATE SPACE IF NOT EXISTS "
            f"{self.settings.nebula_space}(partition_num=1, replica_factor=1, vid_type=FIXED_STRING(256))"
        )
        for _ in range(20):
            try:
                self._execute_in_space(
                    """
                    CREATE TAG IF NOT EXISTS Actor(
                      world_id string,
                      actor_id string,
                      display_name string,
                      actor_type string,
                      status string
                    );
                    CREATE TAG IF NOT EXISTS Location(
                      world_id string,
                      location_id string,
                      name string,
                      description string
                    );
                    CREATE TAG IF NOT EXISTS Event(
                      world_id string,
                      event_id string,
                      event_type string,
                      narrative string
                    );
                    CREATE TAG IF NOT EXISTS Memory(
                      world_id string,
                      memory_id string,
                      scope string,
                      text string,
                      salience double
                    );
                    CREATE TAG IF NOT EXISTS Faction(
                      world_id string,
                      faction_id string,
                      name string,
                      description string,
                      status string
                    );
                    CREATE TAG IF NOT EXISTS Quest(
                      world_id string,
                      quest_id string,
                      quest_template_id string,
                      title string,
                      status string,
                      progress int,
                      progress_target int,
                      latest_summary string
                    );
                    CREATE TAG IF NOT EXISTS Item(
                      world_id string,
                      item_id string,
                      template_key string,
                      name string,
                      description string,
                      status string
                    );
                    CREATE EDGE IF NOT EXISTS LOCATED_AT(world_id string);
                    CREATE EDGE IF NOT EXISTS CAUSED(world_id string);
                    CREATE EDGE IF NOT EXISTS REMEMBERS(world_id string, scope string);
                    CREATE EDGE IF NOT EXISTS RUMORED_AT(world_id string);
                    CREATE EDGE IF NOT EXISTS KNOWS(world_id string, strength double);
                    CREATE EDGE IF NOT EXISTS MEMBER_OF(world_id string, strength double);
                    CREATE EDGE IF NOT EXISTS PURSUES(
                      world_id string,
                      status string,
                      progress int,
                      progress_target int,
                      title string
                    );
                    CREATE EDGE IF NOT EXISTS OWNS(world_id string);
                    CREATE EDGE IF NOT EXISTS REWARDS(world_id string);
                    CREATE EDGE IF NOT EXISTS AFFECTS(world_id string, standing double, band string);
                    """.strip()
                )
                self._wait_for_schema_ready()
                self._bootstrapped = True
                return
            except RuntimeError:
                time.sleep(1)
        self._wait_for_schema_ready()
        self._bootstrapped = True

    def _wait_for_schema_ready(self) -> None:
        required_tags = ("Actor", "Location", "Event", "Memory", "Faction", "Quest", "Item")
        required_edges = ("LOCATED_AT", "CAUSED", "REMEMBERS", "RUMORED_AT", "KNOWS", "MEMBER_OF", "PURSUES", "OWNS", "REWARDS", "AFFECTS")
        last_error: RuntimeError | None = None
        for _ in range(20):
            try:
                for tag in required_tags:
                    self._execute_in_space(f"DESCRIBE TAG {tag}")
                for edge in required_edges:
                    self._execute_in_space(f"DESCRIBE EDGE {edge}")
                return
            except RuntimeError as exc:
                last_error = exc
                time.sleep(1)
        if last_error is not None:
            raise last_error

    def clear_world(self, *, world_id: str, entity_vids: list[str]) -> None:
        del world_id
        if not entity_vids:
            return
        self.bootstrap()
        for start in range(0, len(entity_vids), 50):
            chunk = entity_vids[start : start + 50]
            vids = ", ".join(self._quote(item) for item in chunk)
            self._execute_in_space(f"DELETE VERTEX {vids} WITH EDGE")

    def project_bundle(self, bundle: GraphProjectionBundle) -> GraphProjectionResult:
        self.bootstrap()
        result = self._recording.project_bundle(bundle)
        for artifact in result.records:
            payload = artifact.payload
            if payload["kind"] == "vertex":
                label = payload["label"]
                vid = self._quote(payload["vid"])
                assignments = self._format_assignments(payload["properties"])
                self._execute_in_space(f"UPSERT VERTEX ON {label} {vid} SET {assignments}")
            else:
                label = payload["label"]
                source_vid = self._quote(payload["source_vid"])
                target_vid = self._quote(payload["target_vid"])
                assignments = self._format_assignments(payload["properties"])
                self._execute_in_space(f"UPSERT EDGE ON {label} {source_vid} -> {target_vid} SET {assignments}")
        return result

    def read_relation_context(
        self,
        db: Session,
        *,
        world_id: str,
        primary_actor_id: str,
        counterpart_actor_id: str | None,
        location_id: str | None,
        limit: int = 5,
    ) -> GraphRelationContext:
        del db
        self.bootstrap()
        location = None
        if location_id is not None:
            location_vid = nebula_vid(world_id, "location", location_id)
            location_rows = self._query_rows(
                "FETCH PROP ON Location "
                f'{self._quote(location_vid)} '
                "YIELD properties(vertex).location_id AS location_id, "
                "properties(vertex).name AS name, "
                "properties(vertex).description AS description"
            )
            if location_rows:
                location = dict(location_rows[0])

        nearby_actors: list[dict[str, Any]] = []
        if location_id is not None:
            location_vid = nebula_vid(world_id, "location", location_id)
            actor_rows = self._query_rows(
                f'GO FROM {self._quote(location_vid)} REVERSELY OVER LOCATED_AT YIELD src(edge) AS actor_vid'
            )
            nearby_actors = self._fetch_actor_rows(
                [row["actor_vid"] for row in actor_rows if row.get("actor_vid")],
                limit=limit,
            )

        primary_vid = nebula_vid(world_id, "actor", primary_actor_id)
        primary_actor_rows = self._fetch_actor_rows([primary_vid], limit=1)
        primary_actor_name = primary_actor_rows[0]["display_name"] if primary_actor_rows else primary_actor_id
        relationship_rows = self._query_rows(
            "GO FROM "
            f"{self._quote(primary_vid)} OVER KNOWS "
            "YIELD dst(edge) AS actor_vid, properties(edge).strength AS strength"
        )
        related_actor_rows = self._fetch_actor_rows(
            [row["actor_vid"] for row in relationship_rows if row.get("actor_vid")],
            limit=limit,
        )
        actor_row_map = {row["vid"]: row for row in related_actor_rows}
        relationships = []
        for row in relationship_rows[:limit]:
            actor_vid = row.get("actor_vid")
            actor = actor_row_map.get(actor_vid)
            if actor is None:
                continue
            relationships.append(
                {
                    "from_actor_id": primary_actor_id,
                    "from_actor_name": primary_actor_name,
                    "to_actor_id": actor["actor_id"],
                    "to_actor_name": actor["display_name"],
                    "relationship_type": "KNOWS",
                    "strength": float(row.get("strength") or 0.0),
                }
            )

        if counterpart_actor_id is not None and not relationships:
            counterpart_rows = self._fetch_actor_rows([nebula_vid(world_id, "actor", counterpart_actor_id)], limit=1)
            if counterpart_rows:
                relationships.append(
                    {
                        "from_actor_id": primary_actor_id,
                        "from_actor_name": primary_actor_name,
                        "to_actor_id": counterpart_rows[0]["actor_id"],
                        "to_actor_name": counterpart_rows[0]["display_name"],
                        "relationship_type": "KNOWS",
                        "strength": 0.0,
                    }
                )

        state_actor_id = counterpart_actor_id or primary_actor_id
        state_actor_vid = nebula_vid(world_id, "actor", state_actor_id)
        active_quests: list[dict[str, Any]] = []
        quest_rows = self._query_rows(
            "GO FROM "
            f"{self._quote(state_actor_vid)} OVER PURSUES "
            "YIELD dst(edge) AS quest_vid, "
            "properties(edge).status AS status, "
            "properties(edge).progress AS progress, "
            "properties(edge).progress_target AS progress_target"
        )
        quest_vertex_rows = self._fetch_quest_rows(
            [row["quest_vid"] for row in quest_rows if row.get("quest_vid")],
            limit=limit,
        )
        quest_row_map = {row["vid"]: row for row in quest_vertex_rows}
        for row in quest_rows[:limit]:
            quest_vid = row.get("quest_vid")
            quest = quest_row_map.get(quest_vid)
            if quest is None:
                continue
            active_quests.append(
                {
                    "assignment_id": quest["quest_id"],
                    "title": quest["title"],
                    "status": row.get("status") or quest.get("status"),
                    "progress": int(row.get("progress") or quest.get("progress") or 0),
                    "progress_target": int(row.get("progress_target") or quest.get("progress_target") or 0),
                    "latest_summary": quest.get("latest_summary"),
                }
            )

        faction_standings: list[dict[str, Any]] = []
        faction_rows = self._query_rows(
            "GO FROM "
            f"{self._quote(state_actor_vid)} OVER AFFECTS "
            "YIELD dst(edge) AS faction_vid, "
            "properties(edge).standing AS standing, "
            "properties(edge).band AS band"
        )
        faction_vertex_rows = self._fetch_faction_rows(
            [row["faction_vid"] for row in faction_rows if row.get("faction_vid")],
            limit=limit,
        )
        faction_row_map = {row["vid"]: row for row in faction_vertex_rows}
        for row in faction_rows[:limit]:
            faction_vid = row.get("faction_vid")
            faction = faction_row_map.get(faction_vid)
            if faction is None:
                continue
            faction_standings.append(
                {
                    "faction_id": faction["faction_id"],
                    "name": faction["name"],
                    "standing": float(row.get("standing") or 0.0),
                    "band": row.get("band") or "neutral",
                }
            )

        inventory_edges = self._query_rows(
            f"GO FROM {self._quote(state_actor_vid)} OVER OWNS YIELD dst(edge) AS item_vid"
        )
        inventory_items = self._fetch_item_rows(
            [row["item_vid"] for row in inventory_edges if row.get("item_vid")],
            limit=limit,
        )

        related_events: list[dict[str, Any]] = []
        related_memories: list[dict[str, Any]] = []
        if location_id is not None:
            location_vid = nebula_vid(world_id, "location", location_id)
            rumor_rows = self._query_rows(
                f'GO FROM {self._quote(location_vid)} REVERSELY OVER RUMORED_AT YIELD src(edge) AS entity_vid'
            )
            event_vids = [row["entity_vid"] for row in rumor_rows if ":event:" in str(row.get("entity_vid", ""))]
            memory_vids = [row["entity_vid"] for row in rumor_rows if ":memory:" in str(row.get("entity_vid", ""))]
            related_events = self._fetch_event_rows(event_vids[:limit], limit=limit)
            related_memories = self._fetch_memory_rows(memory_vids[:limit], limit=limit)

        return GraphRelationContext(
            mode="nebula",
            location=location,
            nearby_actors=nearby_actors,
            relationships=relationships,
            related_events=related_events,
            related_memories=related_memories,
            active_quests=active_quests,
            faction_standings=faction_standings,
            inventory_items=inventory_items,
        )

    def _fetch_actor_rows(self, vids: list[str], *, limit: int) -> list[dict[str, Any]]:
        if not vids:
            return []
        unique_vids = list(dict.fromkeys(vids))[:limit]
        rows = self._query_rows(
            "FETCH PROP ON Actor "
            + ", ".join(self._quote(item) for item in unique_vids)
            + " YIELD id(vertex) AS vid, "
            "properties(vertex).actor_id AS actor_id, "
            "properties(vertex).display_name AS display_name, "
            "properties(vertex).actor_type AS actor_type"
        )
        rows.sort(key=lambda item: (str(item.get("actor_type")), str(item.get("display_name")), str(item.get("actor_id"))))
        return rows[:limit]

    def _fetch_event_rows(self, vids: list[str], *, limit: int) -> list[dict[str, Any]]:
        if not vids:
            return []
        rows = self._query_rows(
            "FETCH PROP ON Event "
            + ", ".join(self._quote(item) for item in list(dict.fromkeys(vids))[:limit])
            + " YIELD properties(vertex).event_id AS id, "
            "properties(vertex).event_type AS event_type, "
            "properties(vertex).narrative AS narrative"
        )
        return rows[:limit]

    def _fetch_faction_rows(self, vids: list[str], *, limit: int) -> list[dict[str, Any]]:
        if not vids:
            return []
        rows = self._query_rows(
            "FETCH PROP ON Faction "
            + ", ".join(self._quote(item) for item in list(dict.fromkeys(vids))[:limit])
            + " YIELD id(vertex) AS vid, "
            "properties(vertex).faction_id AS faction_id, "
            "properties(vertex).name AS name, "
            "properties(vertex).description AS description"
        )
        rows.sort(key=lambda item: (str(item.get("name")), str(item.get("faction_id"))))
        return rows[:limit]

    def _fetch_quest_rows(self, vids: list[str], *, limit: int) -> list[dict[str, Any]]:
        if not vids:
            return []
        rows = self._query_rows(
            "FETCH PROP ON Quest "
            + ", ".join(self._quote(item) for item in list(dict.fromkeys(vids))[:limit])
            + " YIELD id(vertex) AS vid, "
            "properties(vertex).quest_id AS quest_id, "
            "properties(vertex).title AS title, "
            "properties(vertex).status AS status, "
            "properties(vertex).progress AS progress, "
            "properties(vertex).progress_target AS progress_target, "
            "properties(vertex).latest_summary AS latest_summary"
        )
        rows.sort(key=lambda item: (str(item.get("title")), str(item.get("quest_id"))))
        return rows[:limit]

    def _fetch_item_rows(self, vids: list[str], *, limit: int) -> list[dict[str, Any]]:
        if not vids:
            return []
        rows = self._query_rows(
            "FETCH PROP ON Item "
            + ", ".join(self._quote(item) for item in list(dict.fromkeys(vids))[:limit])
            + " YIELD properties(vertex).item_id AS id, "
            "properties(vertex).template_key AS template_key, "
            "properties(vertex).name AS name"
        )
        rows.sort(key=lambda item: (str(item.get("name")), str(item.get("id"))))
        return rows[:limit]

    def _fetch_memory_rows(self, vids: list[str], *, limit: int) -> list[dict[str, Any]]:
        if not vids:
            return []
        rows = self._query_rows(
            "FETCH PROP ON Memory "
            + ", ".join(self._quote(item) for item in list(dict.fromkeys(vids))[:limit])
            + " YIELD properties(vertex).memory_id AS id, "
            "properties(vertex).scope AS scope, "
            "properties(vertex).text AS text, "
            "properties(vertex).salience AS salience"
        )
        rows.sort(key=lambda item: (-float(item.get("salience") or 0.0), str(item.get("id"))))
        return rows[:limit]

    def _query_rows(self, statement: str) -> list[dict[str, Any]]:
        result = self._execute_in_space(statement)
        rows = result.as_primitive()
        return [dict(row) for row in rows]

    def _execute_in_space(self, statement: str):
        with self._session() as session:
            use_result = session.execute(f"USE {self.settings.nebula_space}")
            if not use_result.is_succeeded():
                raise RuntimeError(use_result.error_msg())
            result = session.execute(statement)
            if not result.is_succeeded():
                raise RuntimeError(result.error_msg())
            return result

    def _execute(self, statement: str):
        with self._session() as session:
            result = session.execute(statement)
            if not result.is_succeeded():
                raise RuntimeError(result.error_msg())
            return result

    def _session(self):
        pool = self._connection_pool()
        return pool.session_context(self.settings.nebula_user, self.settings.nebula_password)

    def _connection_pool(self):
        if self._pool is not None:
            return self._pool

        try:
            from nebula3.Config import Config
            from nebula3.gclient.net import ConnectionPool
        except ImportError as exc:  # pragma: no cover - requires optional runtime dependency
            raise RuntimeError("nebula3-python is required for GRAPH_PROJECTION_BACKEND=nebula") from exc

        config = Config()
        config.max_connection_pool_size = 10
        pool = ConnectionPool()
        ok = pool.init([(self.settings.nebula_host, self.settings.nebula_port)], config)
        if not ok:
            raise RuntimeError(
                f"Failed to connect to NebulaGraph at {self.settings.nebula_host}:{self.settings.nebula_port}"
            )
        self._pool = pool
        return pool

    @staticmethod
    def _format_assignments(properties: dict[str, Any]) -> str:
        return ", ".join(f"{key}={NebulaWorldGraphRepository._format_value(value)}" for key, value in properties.items())

    @staticmethod
    def _format_value(value: Any) -> str:
        if value is None:
            return "NULL"
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (int, float)):
            return str(value)
        return json.dumps(str(value), ensure_ascii=False)

    @staticmethod
    def _quote(value: str) -> str:
        return json.dumps(value, ensure_ascii=False)
