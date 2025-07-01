/**
 * ミニマップのツールチップコンポーネント
 */

import React from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { LocationIcon } from './LocationIcons'
import type { MapLocation, MapConnection } from '../types'
import { formatDistanceToNow } from 'date-fns'
import { ja } from 'date-fns/locale'

interface MinimapTooltipProps {
  location: MapLocation
  connections: MapConnection[]
  x: number
  y: number
  visible: boolean
}

export const MinimapTooltip: React.FC<MinimapTooltipProps> = ({
  location,
  connections,
  x,
  y,
  visible,
}) => {
  if (!visible) return null

  const getDangerLevelColor = (level: string) => {
    switch (level) {
      case 'safe':
        return 'bg-green-500'
      case 'low':
        return 'bg-lime-500'
      case 'medium':
        return 'bg-yellow-500'
      case 'high':
        return 'bg-orange-500'
      case 'extreme':
        return 'bg-red-500'
      default:
        return 'bg-gray-500'
    }
  }

  const getLocationTypeLabel = (type: string) => {
    switch (type) {
      case 'city':
        return '都市'
      case 'town':
        return '町'
      case 'dungeon':
        return 'ダンジョン'
      case 'wild':
        return '荒野'
      case 'special':
        return '特殊'
      default:
        return '不明'
    }
  }

  // 接続されている場所の数を計算
  const connectionCount = connections.filter(
    conn =>
      conn.from_location_id === location.id ||
      conn.to_location_id === location.id
  ).length

  return (
    <div
      className="absolute z-50 pointer-events-none"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform: 'translate(-50%, -120%)',
      }}
    >
      <Card className="p-3 shadow-lg border-gray-700 bg-gray-900/95 backdrop-blur-sm animate-in fade-in-0 zoom-in-95 duration-200">
        {/* ヘッダー */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <LocationIcon
              type={location.type}
              size={20}
              color="#fff"
              className="flex-shrink-0"
            />
            <h3 className="font-bold text-sm text-white">{location.name}</h3>
          </div>
          <Badge
            variant="secondary"
            className={`${getDangerLevelColor(
              location.danger_level
            )} text-white text-xs`}
          >
            危険度
          </Badge>
        </div>

        <Separator className="my-2" />

        {/* 詳細情報 */}
        <div className="space-y-2 text-xs">
          {/* 場所タイプ */}
          <div className="flex justify-between items-center">
            <span className="text-gray-400">タイプ:</span>
            <span className="text-white">
              {getLocationTypeLabel(location.type)}
            </span>
          </div>

          {/* 探索進捗 */}
          {location.exploration_percentage > 0 && (
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-gray-400">探索進捗:</span>
                <span className="text-white">
                  {location.exploration_percentage}%
                </span>
              </div>
              <Progress
                value={location.exploration_percentage}
                className="h-1.5"
              />
            </div>
          )}

          {/* 接続数 */}
          <div className="flex justify-between items-center">
            <span className="text-gray-400">接続:</span>
            <span className="text-white">{connectionCount} 箇所</span>
          </div>

          {/* 最終訪問 */}
          {location.last_visited && (
            <div className="flex justify-between items-center">
              <span className="text-gray-400">最終訪問:</span>
              <span className="text-white text-xs">
                {formatDistanceToNow(new Date(location.last_visited), {
                  addSuffix: true,
                  locale: ja,
                })}
              </span>
            </div>
          )}

          {/* 座標（デバッグ用、本番では非表示） */}
          {process.env.NODE_ENV === 'development' && (
            <div className="flex justify-between items-center text-xs opacity-50">
              <span className="text-gray-500">座標:</span>
              <span className="text-gray-400 font-mono">
                ({location.coordinates.x}, {location.coordinates.y})
              </span>
            </div>
          )}
        </div>

        {/* 未探索の場合のメッセージ */}
        {!location.is_discovered && (
          <>
            <Separator className="my-2" />
            <p className="text-xs text-gray-400 italic text-center">
              この場所はまだ発見されていません
            </p>
          </>
        )}

        {/* 特殊な状態の表示 */}
        {location.is_discovered && location.exploration_percentage === 100 && (
          <>
            <Separator className="my-2" />
            <p className="text-xs text-green-400 text-center flex items-center justify-center gap-1">
              <span className="inline-block w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              完全探索済み
            </p>
          </>
        )}
      </Card>
    </div>
  )
}

/**
 * 接続線のツールチップ
 */
interface ConnectionTooltipProps {
  connection: MapConnection
  fromLocation: MapLocation
  toLocation: MapLocation
  x: number
  y: number
  visible: boolean
}

export const ConnectionTooltip: React.FC<ConnectionTooltipProps> = ({
  connection,
  fromLocation,
  toLocation,
  x,
  y,
  visible,
}) => {
  if (!visible) return null

  const getPathTypeLabel = (type: string) => {
    switch (type) {
      case 'direct':
        return '通常の道'
      case 'curved':
        return '曲がりくねった道'
      case 'teleport':
        return 'テレポート'
      case 'stairs':
        return '階段'
      case 'elevator':
        return 'エレベーター'
      default:
        return '接続'
    }
  }

  return (
    <div
      className="absolute z-50 pointer-events-none"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform: 'translate(-50%, -120%)',
      }}
    >
      <Card className="p-2 shadow-lg border-gray-700 bg-gray-900/95 backdrop-blur-sm animate-in fade-in-0 zoom-in-95 duration-200">
        <div className="text-xs space-y-1">
          <div className="font-semibold text-white text-center">
            {fromLocation.name} → {toLocation.name}
          </div>
          <Separator className="my-1" />
          <div className="flex justify-between items-center gap-3">
            <span className="text-gray-400">タイプ:</span>
            <span className="text-white">
              {getPathTypeLabel(connection.path_type)}
            </span>
          </div>
          <div className="flex justify-between items-center gap-3">
            <span className="text-gray-400">SP消費:</span>
            <span className="text-cyan-400">{connection.sp_cost} SP</span>
          </div>
          {connection.is_one_way && (
            <div className="text-yellow-400 text-center mt-1">⚠️ 一方通行</div>
          )}
        </div>
      </Card>
    </div>
  )
}
