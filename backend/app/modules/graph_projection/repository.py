from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.entities import (
    Actor,
    Event,
    Faction,
    FactionStanding,
    Item,
    Location,
    Memory,
    QuestAssignment,
    QuestTemplate,
    Relationship,
)


def nebula_vid(world_id: str, entity_type: str, entity_id: str) -> str:
    return f"{world_id}:{entity_type}:{entity_id}"


@dataclass(frozen=True)
class ProjectedArtifact:
    entity_key: str
    projection_type: str
    payload: dict[str, Any]


@dataclass(frozen=True)
class GraphProjectionBundle:
    world_id: str
    projection_type: str
    event: Event
    memories: list[Memory]
    actors: list[Actor]
    location: Location | None
    relationships: list[Relationship]
    factions: list[Faction]
    faction_standings: list[FactionStanding]
    quest_assignments: list[QuestAssignment]
    quest_templates: list[QuestTemplate]
    items: list[Item]


@dataclass(frozen=True)
class GraphProjectionResult:
    records: list[ProjectedArtifact]
    vertex_count: int
    edge_count: int


@dataclass(frozen=True)
class GraphRelationContext:
    mode: str
    location: dict[str, Any] | None
    nearby_actors: list[dict[str, Any]]
    relationships: list[dict[str, Any]]
    related_events: list[dict[str, Any]]
    related_memories: list[dict[str, Any]]
    active_quests: list[dict[str, Any]]
    faction_standings: list[dict[str, Any]]
    inventory_items: list[dict[str, Any]]

    def prompt_lines(self) -> list[str]:
        lines: list[str] = []
        if self.location:
            lines.append(f"location={self.location['name']}")
        for item in self.relationships[:2]:
            lines.append(
                "relationship="
                f"{item['from_actor_name']} {item['relationship_type']} {item['to_actor_name']} ({item['strength']:.2f})"
            )
        for item in self.related_memories[:2]:
            lines.append(f"memory={item['text']}")
        for item in self.related_events[:1]:
            lines.append(f"event={item['narrative']}")
        for item in self.active_quests[:1]:
            lines.append(
                "active_quest="
                f"{item['title']} [{item['status']} {item['progress']}/{item['progress_target']}]"
            )
        for item in self.faction_standings[:2]:
            lines.append(f"faction={item['name']} standing={item['standing']:.2f} ({item['band']})")
        if self.inventory_items:
            names = ", ".join(item["name"] for item in self.inventory_items[:3])
            lines.append(f"inventory={names}")
        return lines


class WorldGraphRepository(Protocol):
    def bootstrap(self) -> None: ...

    def clear_world(self, *, world_id: str, entity_vids: list[str]) -> None: ...

    def project_bundle(self, bundle: GraphProjectionBundle) -> GraphProjectionResult: ...

    def read_relation_context(
        self,
        db: Session,
        *,
        world_id: str,
        primary_actor_id: str,
        counterpart_actor_id: str | None,
        location_id: str | None,
        limit: int = 5,
    ) -> GraphRelationContext: ...


class RecordingWorldGraphRepository:
    def bootstrap(self) -> None:
        return None

    def clear_world(self, *, world_id: str, entity_vids: list[str]) -> None:
        del world_id, entity_vids
        return None

    def project_bundle(self, bundle: GraphProjectionBundle) -> GraphProjectionResult:
        actor_map = {actor.id: actor for actor in bundle.actors}
        faction_map = {faction.id: faction for faction in bundle.factions}
        quest_template_map = {template.id: template for template in bundle.quest_templates}
        records: list[ProjectedArtifact] = []

        for actor in actor_map.values():
            records.append(
                ProjectedArtifact(
                    entity_key=f"{bundle.world_id}:vertex:Actor:{actor.id}",
                    projection_type=bundle.projection_type,
                    payload={
                        "kind": "vertex",
                        "label": "Actor",
                        "vid": nebula_vid(bundle.world_id, "actor", actor.id),
                        "properties": {
                            "world_id": actor.world_id,
                            "actor_id": actor.id,
                            "display_name": actor.display_name,
                            "actor_type": actor.actor_type,
                            "status": actor.status,
                        },
                    },
                )
            )

        for faction in faction_map.values():
            records.append(
                ProjectedArtifact(
                    entity_key=f"{bundle.world_id}:vertex:Faction:{faction.id}",
                    projection_type=bundle.projection_type,
                    payload={
                        "kind": "vertex",
                        "label": "Faction",
                        "vid": nebula_vid(bundle.world_id, "faction", faction.id),
                        "properties": {
                            "world_id": faction.world_id,
                            "faction_id": faction.id,
                            "name": faction.name,
                            "description": faction.description,
                            "status": faction.status,
                        },
                    },
                )
            )

        if bundle.location is not None:
            records.append(
                ProjectedArtifact(
                    entity_key=f"{bundle.world_id}:vertex:Location:{bundle.location.id}",
                    projection_type=bundle.projection_type,
                    payload={
                        "kind": "vertex",
                        "label": "Location",
                        "vid": nebula_vid(bundle.world_id, "location", bundle.location.id),
                        "properties": {
                            "world_id": bundle.location.world_id,
                            "location_id": bundle.location.id,
                            "name": bundle.location.name,
                            "description": bundle.location.description,
                        },
                    },
                )
            )

        records.append(
            ProjectedArtifact(
                entity_key=f"{bundle.world_id}:vertex:Event:{bundle.event.id}",
                projection_type=bundle.projection_type,
                payload={
                    "kind": "vertex",
                    "label": "Event",
                    "vid": nebula_vid(bundle.world_id, "event", bundle.event.id),
                    "properties": {
                        "world_id": bundle.event.world_id,
                        "event_id": bundle.event.id,
                        "event_type": bundle.event.event_type,
                        "narrative": bundle.event.narrative,
                    },
                },
            )
        )

        for assignment in bundle.quest_assignments:
            template = quest_template_map.get(assignment.quest_template_id)
            if template is None:
                continue
            records.append(
                ProjectedArtifact(
                    entity_key=f"{bundle.world_id}:vertex:Quest:{assignment.id}",
                    projection_type=bundle.projection_type,
                    payload={
                        "kind": "vertex",
                        "label": "Quest",
                        "vid": nebula_vid(bundle.world_id, "quest", assignment.id),
                        "properties": {
                            "world_id": assignment.world_id,
                            "quest_id": assignment.id,
                            "quest_template_id": template.id,
                            "title": template.title,
                            "status": assignment.status,
                            "progress": assignment.progress,
                            "progress_target": assignment.progress_target,
                            "latest_summary": assignment.latest_summary,
                        },
                    },
                )
            )

        for item in bundle.items:
            records.append(
                ProjectedArtifact(
                    entity_key=f"{bundle.world_id}:vertex:Item:{item.id}",
                    projection_type=bundle.projection_type,
                    payload={
                        "kind": "vertex",
                        "label": "Item",
                        "vid": nebula_vid(bundle.world_id, "item", item.id),
                        "properties": {
                            "world_id": item.world_id,
                            "item_id": item.id,
                            "template_key": item.template_key,
                            "name": item.name,
                            "description": item.description,
                            "status": item.status,
                        },
                    },
                )
            )

        for memory in bundle.memories:
            records.append(
                ProjectedArtifact(
                    entity_key=f"{bundle.world_id}:vertex:Memory:{memory.id}",
                    projection_type=bundle.projection_type,
                    payload={
                        "kind": "vertex",
                        "label": "Memory",
                        "vid": nebula_vid(bundle.world_id, "memory", memory.id),
                        "properties": {
                            "world_id": memory.world_id,
                            "memory_id": memory.id,
                            "scope": memory.scope,
                            "text": memory.text,
                            "salience": memory.salience,
                        },
                    },
                )
            )

        if bundle.location is not None:
            for actor in actor_map.values():
                if actor.current_location_id == bundle.location.id:
                    records.append(
                        ProjectedArtifact(
                            entity_key=f"{bundle.world_id}:edge:LOCATED_AT:{actor.id}:{bundle.location.id}",
                            projection_type=bundle.projection_type,
                            payload={
                                "kind": "edge",
                                "label": "LOCATED_AT",
                                "source_vid": nebula_vid(bundle.world_id, "actor", actor.id),
                                "target_vid": nebula_vid(bundle.world_id, "location", bundle.location.id),
                                "properties": {"world_id": bundle.world_id},
                            },
                        )
                    )

        records.append(
            ProjectedArtifact(
                entity_key=f"{bundle.world_id}:edge:CAUSED:{bundle.event.source_actor_id}:{bundle.event.id}",
                projection_type=bundle.projection_type,
                payload={
                    "kind": "edge",
                    "label": "CAUSED",
                    "source_vid": nebula_vid(bundle.world_id, "actor", bundle.event.source_actor_id),
                    "target_vid": nebula_vid(bundle.world_id, "event", bundle.event.id),
                    "properties": {"world_id": bundle.world_id},
                },
            )
        )

        for standing in bundle.faction_standings:
            if standing.faction_id not in faction_map:
                continue
            records.append(
                ProjectedArtifact(
                    entity_key=f"{bundle.world_id}:edge:AFFECTS:{standing.actor_id}:{standing.faction_id}",
                    projection_type=bundle.projection_type,
                    payload={
                        "kind": "edge",
                        "label": "AFFECTS",
                        "source_vid": nebula_vid(bundle.world_id, "actor", standing.actor_id),
                        "target_vid": nebula_vid(bundle.world_id, "faction", standing.faction_id),
                        "properties": {
                            "world_id": bundle.world_id,
                            "standing": standing.standing,
                            "band": standing.band,
                        },
                    },
                )
            )

        for assignment in bundle.quest_assignments:
            template = quest_template_map.get(assignment.quest_template_id)
            if template is None:
                continue
            records.append(
                ProjectedArtifact(
                    entity_key=f"{bundle.world_id}:edge:PURSUES:{assignment.owner_actor_id}:{assignment.id}",
                    projection_type=bundle.projection_type,
                    payload={
                        "kind": "edge",
                        "label": "PURSUES",
                        "source_vid": nebula_vid(bundle.world_id, "actor", assignment.owner_actor_id),
                        "target_vid": nebula_vid(bundle.world_id, "quest", assignment.id),
                        "properties": {
                            "world_id": bundle.world_id,
                            "status": assignment.status,
                            "progress": assignment.progress,
                            "progress_target": assignment.progress_target,
                            "title": template.title,
                        },
                    },
                )
            )

        for item in bundle.items:
            records.append(
                ProjectedArtifact(
                    entity_key=f"{bundle.world_id}:edge:OWNS:{item.owner_actor_id}:{item.id}",
                    projection_type=bundle.projection_type,
                    payload={
                        "kind": "edge",
                        "label": "OWNS",
                        "source_vid": nebula_vid(bundle.world_id, "actor", item.owner_actor_id),
                        "target_vid": nebula_vid(bundle.world_id, "item", item.id),
                        "properties": {"world_id": bundle.world_id},
                    },
                )
            )
            if item.source_quest_assignment_id is not None:
                records.append(
                    ProjectedArtifact(
                        entity_key=f"{bundle.world_id}:edge:REWARDS:{item.source_quest_assignment_id}:{item.id}",
                        projection_type=bundle.projection_type,
                        payload={
                            "kind": "edge",
                            "label": "REWARDS",
                            "source_vid": nebula_vid(bundle.world_id, "quest", item.source_quest_assignment_id),
                            "target_vid": nebula_vid(bundle.world_id, "item", item.id),
                            "properties": {"world_id": bundle.world_id},
                        },
                    )
                )

        for memory in bundle.memories:
            records.append(
                ProjectedArtifact(
                    entity_key=f"{bundle.world_id}:edge:CAUSED:{bundle.event.id}:{memory.id}",
                    projection_type=bundle.projection_type,
                    payload={
                        "kind": "edge",
                        "label": "CAUSED",
                        "source_vid": nebula_vid(bundle.world_id, "event", bundle.event.id),
                        "target_vid": nebula_vid(bundle.world_id, "memory", memory.id),
                        "properties": {"world_id": bundle.world_id},
                    },
                )
            )
            if memory.actor_id is not None:
                records.append(
                    ProjectedArtifact(
                        entity_key=f"{bundle.world_id}:edge:REMEMBERS:{memory.actor_id}:{memory.id}",
                        projection_type=bundle.projection_type,
                        payload={
                            "kind": "edge",
                            "label": "REMEMBERS",
                            "source_vid": nebula_vid(bundle.world_id, "actor", memory.actor_id),
                            "target_vid": nebula_vid(bundle.world_id, "memory", memory.id),
                            "properties": {"world_id": bundle.world_id, "scope": memory.scope},
                        },
                    )
                )
            if memory.location_id is not None:
                records.append(
                    ProjectedArtifact(
                        entity_key=f"{bundle.world_id}:edge:RUMORED_AT:{memory.id}:{memory.location_id}",
                        projection_type=bundle.projection_type,
                        payload={
                            "kind": "edge",
                            "label": "RUMORED_AT",
                            "source_vid": nebula_vid(bundle.world_id, "memory", memory.id),
                            "target_vid": nebula_vid(bundle.world_id, "location", memory.location_id),
                            "properties": {"world_id": bundle.world_id},
                        },
                    )
                )

        if bundle.event.location_id is not None:
            records.append(
                ProjectedArtifact(
                    entity_key=f"{bundle.world_id}:edge:RUMORED_AT:{bundle.event.id}:{bundle.event.location_id}",
                    projection_type=bundle.projection_type,
                    payload={
                        "kind": "edge",
                        "label": "RUMORED_AT",
                        "source_vid": nebula_vid(bundle.world_id, "event", bundle.event.id),
                        "target_vid": nebula_vid(bundle.world_id, "location", bundle.event.location_id),
                        "properties": {"world_id": bundle.world_id},
                    },
                )
            )

        for relationship in sorted(
            bundle.relationships,
            key=lambda item: (item.relationship_type, item.from_actor_id, item.to_entity_id),
        ):
            if relationship.relationship_type == "MEMBER_OF":
                if relationship.to_entity_id not in faction_map:
                    continue
                records.append(
                    ProjectedArtifact(
                        entity_key=(
                            f"{bundle.world_id}:edge:MEMBER_OF:"
                            f"{relationship.from_actor_id}:{relationship.to_entity_id}"
                        ),
                        projection_type=bundle.projection_type,
                        payload={
                            "kind": "edge",
                            "label": "MEMBER_OF",
                            "source_vid": nebula_vid(bundle.world_id, "actor", relationship.from_actor_id),
                            "target_vid": nebula_vid(bundle.world_id, "faction", relationship.to_entity_id),
                            "properties": {
                                "world_id": bundle.world_id,
                                "strength": relationship.strength,
                            },
                        },
                    )
                )
                continue
            if relationship.to_actor_id is None:
                continue
            records.append(
                ProjectedArtifact(
                    entity_key=(
                        f"{bundle.world_id}:edge:{relationship.relationship_type}:"
                        f"{relationship.from_actor_id}:{relationship.to_actor_id}"
                    ),
                    projection_type=bundle.projection_type,
                    payload={
                        "kind": "edge",
                        "label": relationship.relationship_type,
                        "source_vid": nebula_vid(bundle.world_id, "actor", relationship.from_actor_id),
                        "target_vid": nebula_vid(bundle.world_id, "actor", relationship.to_actor_id),
                        "properties": {
                            "world_id": bundle.world_id,
                            "strength": relationship.strength,
                        },
                    },
                )
            )

        vertex_count = sum(1 for record in records if record.payload["kind"] == "vertex")
        edge_count = sum(1 for record in records if record.payload["kind"] == "edge")
        return GraphProjectionResult(records=records, vertex_count=vertex_count, edge_count=edge_count)

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
        actor_name_map = {
            actor.id: actor.display_name
            for actor in db.execute(select(Actor).where(Actor.world_id == world_id)).scalars()
        }

        location = None
        if location_id is not None:
            location_model = db.execute(
                select(Location).where(Location.world_id == world_id, Location.id == location_id)
            ).scalar_one_or_none()
            if location_model is not None:
                location = {
                    "id": location_model.id,
                    "name": location_model.name,
                    "description": location_model.description,
                }

        nearby_actors = []
        if location_id is not None:
            nearby_actors = [
                {
                    "id": actor.id,
                    "display_name": actor.display_name,
                    "actor_type": actor.actor_type,
                }
                for actor in db.execute(
                    select(Actor)
                    .where(Actor.world_id == world_id, Actor.current_location_id == location_id)
                    .order_by(Actor.actor_type.asc(), Actor.display_name.asc(), Actor.id.asc())
                    .limit(limit)
                ).scalars()
            ]

        relationship_actor_ids = [primary_actor_id]
        if counterpart_actor_id is not None:
            relationship_actor_ids.append(counterpart_actor_id)
        relationships = [
            {
                "id": item.id,
                "from_actor_id": item.from_actor_id,
                "from_actor_name": actor_name_map.get(item.from_actor_id, item.from_actor_id),
                "to_actor_id": item.to_actor_id,
                "to_actor_name": actor_name_map.get(item.to_actor_id or "", item.to_entity_id),
                "relationship_type": item.relationship_type,
                "strength": item.strength,
            }
            for item in db.execute(
                select(Relationship)
                .where(
                    Relationship.world_id == world_id,
                    Relationship.relationship_type == "KNOWS",
                    or_(
                        Relationship.from_actor_id.in_(relationship_actor_ids),
                        Relationship.to_actor_id.in_(relationship_actor_ids),
                    ),
                )
                .order_by(Relationship.strength.desc(), Relationship.created_at.desc(), Relationship.id.desc())
                .limit(limit)
            ).scalars()
            if item.to_actor_id is not None
        ]

        state_actor_id = counterpart_actor_id or primary_actor_id
        active_quests = [
            {
                "assignment_id": assignment.id,
                "title": template.title,
                "status": assignment.status,
                "progress": assignment.progress,
                "progress_target": assignment.progress_target,
                "latest_summary": assignment.latest_summary,
            }
            for assignment, template in db.execute(
                select(QuestAssignment, QuestTemplate)
                .join(
                    QuestTemplate,
                    (QuestTemplate.id == QuestAssignment.quest_template_id)
                    & (QuestTemplate.world_id == QuestAssignment.world_id),
                )
                .where(QuestAssignment.world_id == world_id, QuestAssignment.owner_actor_id == state_actor_id)
                .order_by(QuestAssignment.created_at.asc(), QuestAssignment.id.asc())
                .limit(limit)
            ).all()
        ]
        faction_standings = [
            {
                "faction_id": faction.id,
                "name": faction.name,
                "standing": standing.standing,
                "band": standing.band,
            }
            for standing, faction in db.execute(
                select(FactionStanding, Faction)
                .join(Faction, (Faction.id == FactionStanding.faction_id) & (Faction.world_id == FactionStanding.world_id))
                .where(FactionStanding.world_id == world_id, FactionStanding.actor_id == state_actor_id)
                .order_by(FactionStanding.updated_at.desc(), Faction.id.asc())
                .limit(limit)
            ).all()
        ]
        inventory_items = [
            {
                "id": item.id,
                "template_key": item.template_key,
                "name": item.name,
            }
            for item in db.execute(
                select(Item)
                .where(Item.world_id == world_id, Item.owner_actor_id == state_actor_id)
                .order_by(Item.created_at.asc(), Item.id.asc())
                .limit(limit)
            ).scalars()
        ]

        event_filters = [Event.world_id == world_id]
        if location_id is not None:
            event_filters.append(Event.location_id == location_id)
        related_events = [
            {
                "id": item.id,
                "event_type": item.event_type,
                "narrative": item.narrative,
                "location_id": item.location_id,
            }
            for item in db.execute(
                select(Event)
                .where(*event_filters)
                .order_by(Event.occurred_at.desc(), Event.id.desc())
                .limit(limit)
            ).scalars()
        ]

        memory_predicates = [Memory.world_id == world_id]
        actor_scope = [Memory.actor_id == primary_actor_id, Memory.actor_id.is_(None)]
        if counterpart_actor_id is not None:
            actor_scope.append(Memory.actor_id == counterpart_actor_id)
        if location_id is not None:
            memory_predicates.append(or_(Memory.location_id == location_id, *actor_scope))
        else:
            memory_predicates.append(or_(*actor_scope))
        related_memories = [
            {
                "id": item.id,
                "scope": item.scope,
                "text": item.text,
                "salience": item.salience,
                "actor_id": item.actor_id,
                "location_id": item.location_id,
            }
            for item in db.execute(
                select(Memory)
                .where(*memory_predicates)
                .order_by(Memory.salience.desc(), Memory.created_at.desc(), Memory.id.desc())
                .limit(limit)
            ).scalars()
        ]

        return GraphRelationContext(
            mode="recording",
            location=location,
            nearby_actors=nearby_actors,
            relationships=relationships,
            related_events=related_events,
            related_memories=related_memories,
            active_quests=active_quests,
            faction_standings=faction_standings,
            inventory_items=inventory_items,
        )
