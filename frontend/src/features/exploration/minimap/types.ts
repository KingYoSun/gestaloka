/**
 * ミニマップ機能の型定義
 */

export interface Coordinates {
  x: number
  y: number
}

export interface MapLocation {
  id: number
  name: string
  coordinates: Coordinates
  type: 'city' | 'town' | 'dungeon' | 'wild' | 'special'
  danger_level: 'safe' | 'low' | 'medium' | 'high' | 'extreme'
  is_discovered: boolean
  exploration_percentage: number
  last_visited?: string
}

export interface MapConnection {
  id: number
  from_location_id: number
  to_location_id: number
  path_type: 'direct' | 'curved' | 'teleport' | 'stairs' | 'elevator'
  is_one_way: boolean
  is_discovered: boolean
  sp_cost: number
  path_metadata?: Record<string, any>
}

export interface ExplorationProgress {
  id: string
  character_id: string
  location_id: number
  exploration_percentage: number
  areas_explored: string[]
  fog_revealed_at?: string
  fully_explored_at?: string
  created_at: string
  updated_at: string
}

export interface LayerData {
  layer: number
  name: string
  locations: MapLocation[]
  connections: MapConnection[]
  exploration_progress: ExplorationProgress[]
}

export interface LocationHistory {
  location_id: number
  timestamp: string
  layer: number
  coordinates: Coordinates
}

export interface CurrentLocation {
  id: number
  layer: number
  coordinates: Coordinates
}

export interface MapDataResponse {
  layers: LayerData[]
  character_trail: LocationHistory[]
  current_location?: CurrentLocation
}

export interface UpdateProgressRequest {
  location_id: number
  exploration_percentage: number
  areas_explored: string[]
}

export interface Viewport {
  x: number
  y: number
  zoom: number
  width: number
  height: number
}

export interface DirtyRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface MinimapTheme {
  background: string
  grid: string
  location: {
    city: string
    town: string
    dungeon: string
    wild: string
    special: string
  }
  danger: {
    safe: string
    low: string
    medium: string
    high: string
    extreme: string
  }
  fog: string
  trail: string
  currentLocation: string
  connection: {
    direct: string
    curved: string
    teleport: string
    stairs: string
    elevator: string
  }
}
