"""
場所の初期データを設定するスクリプト
"""
from sqlmodel import Session, select
from app.models import (
    Location, LocationConnection, ExplorationArea,
    LocationType, DangerLevel
)
from app.core.database import engine


def seed_locations():
    """場所の初期データを作成"""
    with Session(engine) as session:
        # 既存データがある場合はスキップ
        existing = session.exec(select(Location)).first()
        if existing:
            print("Locations already seeded, skipping...")
            return
        
        # 基点都市ネクサス（開始地点）
        nexus = Location(
            name="Nexus",
            description="The central hub city where all journeys begin. A safe haven for travelers.",
            location_type=LocationType.CITY,
            hierarchy_level=1,
            danger_level=DangerLevel.SAFE,
            x_coordinate=0,
            y_coordinate=0,
            has_inn=True,
            has_shop=True,
            has_guild=True,
            fragment_discovery_rate=5,
            is_starting_location=True,
            is_discovered=True
        )
        session.add(nexus)
        
        # 商業地区
        market_district = Location(
            name="Market District",
            description="A bustling commercial area filled with merchants and traders.",
            location_type=LocationType.TOWN,
            hierarchy_level=1,
            danger_level=DangerLevel.SAFE,
            x_coordinate=1,
            y_coordinate=0,
            has_inn=False,
            has_shop=True,
            has_guild=False,
            fragment_discovery_rate=10,
            is_discovered=True
        )
        session.add(market_district)
        
        # 外周区
        outer_ward = Location(
            name="Outer Ward",
            description="The outskirts of Nexus, where danger begins to creep in.",
            location_type=LocationType.TOWN,
            hierarchy_level=1,
            danger_level=DangerLevel.LOW,
            x_coordinate=0,
            y_coordinate=1,
            has_inn=True,
            has_shop=False,
            has_guild=False,
            fragment_discovery_rate=15,
            is_discovered=True
        )
        session.add(outer_ward)
        
        # 忘却の森
        forgotten_woods = Location(
            name="Forgotten Woods",
            description="A mysterious forest where memories drift like fog.",
            location_type=LocationType.WILD,
            hierarchy_level=1,
            danger_level=DangerLevel.MEDIUM,
            x_coordinate=-1,
            y_coordinate=1,
            has_inn=False,
            has_shop=False,
            has_guild=False,
            fragment_discovery_rate=25,
            is_discovered=False
        )
        session.add(forgotten_woods)
        
        # 古い遺跡
        ancient_ruins = Location(
            name="Ancient Ruins",
            description="Remnants of a civilization lost to time, filled with secrets.",
            location_type=LocationType.DUNGEON,
            hierarchy_level=1,
            danger_level=DangerLevel.HIGH,
            x_coordinate=2,
            y_coordinate=1,
            has_inn=False,
            has_shop=False,
            has_guild=False,
            fragment_discovery_rate=40,
            is_discovered=False
        )
        session.add(ancient_ruins)
        
        # 昇降塔の入口
        elevator_entrance = Location(
            name="Elevator Tower Entrance",
            description="The gateway to higher hierarchies, heavily guarded and regulated.",
            location_type=LocationType.SPECIAL,
            hierarchy_level=1,
            danger_level=DangerLevel.LOW,
            x_coordinate=0,
            y_coordinate=-1,
            has_inn=False,
            has_shop=False,
            has_guild=True,
            fragment_discovery_rate=20,
            is_discovered=False
        )
        session.add(elevator_entrance)
        
        session.commit()
        
        # 場所間の接続を作成
        locations = {
            loc.name: loc for loc in session.exec(select(Location)).all()
        }
        
        connections = [
            # Nexusから各地へ
            ("Nexus", "Market District", 0, 1),
            ("Nexus", "Outer Ward", 0, 1),
            ("Nexus", "Elevator Tower Entrance", 5, 1),
            
            # Market Districtから
            ("Market District", "Nexus", 0, 1),
            ("Market District", "Outer Ward", 0, 1),
            
            # Outer Wardから
            ("Outer Ward", "Nexus", 0, 1),
            ("Outer Ward", "Market District", 0, 1),
            ("Outer Ward", "Forgotten Woods", 5, 2),
            ("Outer Ward", "Ancient Ruins", 10, 3),
            
            # Forgotten Woodsから
            ("Forgotten Woods", "Outer Ward", 3, 2),
            ("Forgotten Woods", "Ancient Ruins", 8, 2),
            
            # Ancient Ruinsから
            ("Ancient Ruins", "Outer Ward", 8, 3),
            ("Ancient Ruins", "Forgotten Woods", 10, 2),
            
            # Elevator Tower Entranceから
            ("Elevator Tower Entrance", "Nexus", 3, 1),
        ]
        
        for from_name, to_name, sp_cost, distance in connections:
            from_loc = locations[from_name]
            to_loc = locations[to_name]
            
            connection = LocationConnection(
                from_location_id=from_loc.id,
                to_location_id=to_loc.id,
                base_sp_cost=sp_cost,
                distance=distance,
                min_level_required=1,
                is_one_way=False,
                is_blocked=False,
                travel_description=f"Travel from {from_name} to {to_name}"
            )
            session.add(connection)
        
        session.commit()
        
        # 探索エリアを作成
        exploration_areas = [
            # Nexus
            (locations["Nexus"].id, "Central Plaza", "The heart of Nexus, always crowded with people.", 1, 0, 1, 5, 0),
            (locations["Nexus"].id, "Guild Archives", "Ancient records and forgotten tales.", 2, 5, 2, 10, 5),
            
            # Market District
            (locations["Market District"].id, "Merchant Stalls", "Countless shops with hidden treasures.", 1, 3, 1, 8, 10),
            (locations["Market District"].id, "Black Market", "Where forbidden memories are traded.", 3, 10, 2, 15, 20),
            
            # Outer Ward
            (locations["Outer Ward"].id, "Abandoned Houses", "Empty homes with lingering memories.", 2, 5, 2, 12, 15),
            (locations["Outer Ward"].id, "Old Cemetery", "Where the forgotten rest.", 3, 8, 3, 20, 25),
            
            # Forgotten Woods
            (locations["Forgotten Woods"].id, "Memory Grove", "Trees that whisper of the past.", 4, 10, 3, 25, 30),
            (locations["Forgotten Woods"].id, "Lost Path", "A trail that leads to forgotten places.", 5, 15, 2, 30, 40),
            
            # Ancient Ruins
            (locations["Ancient Ruins"].id, "Hall of Echoes", "Where past and present blur.", 6, 20, 3, 35, 50),
            (locations["Ancient Ruins"].id, "Sealed Chamber", "A vault of ancient memories.", 8, 30, 4, 50, 60),
            
            # Elevator Tower Entrance
            (locations["Elevator Tower Entrance"].id, "Waiting Hall", "Where travelers prepare for ascension.", 2, 5, 1, 10, 10),
        ]
        
        for loc_id, name, desc, diff, sp_cost, max_frag, rare_chance, enc_rate in exploration_areas:
            area = ExplorationArea(
                location_id=loc_id,
                name=name,
                description=desc,
                difficulty=diff,
                exploration_sp_cost=sp_cost,
                max_fragments_per_exploration=max_frag,
                rare_fragment_chance=rare_chance,
                encounter_rate=enc_rate
            )
            session.add(area)
        
        session.commit()
        
        print("Location seeding completed!")
        print(f"Created {len(locations)} locations")
        print(f"Created {len(connections)} connections")
        print(f"Created {len(exploration_areas)} exploration areas")


if __name__ == "__main__":
    seed_locations()