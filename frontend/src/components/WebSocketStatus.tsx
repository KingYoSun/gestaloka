/**
 * WebSocket接続状態表示コンポーネント
 */
import { Wifi, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWebSocketContext } from '@/providers/webSocketContext'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function WebSocketStatus() {
  const { isConnected, status } = useWebSocketContext()

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md text-sm',
              isConnected
                ? 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950'
                : 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950'
            )}
          >
            {isConnected ? (
              <Wifi className="h-4 w-4" />
            ) : (
              <WifiOff className="h-4 w-4" />
            )}
            <span className="font-medium">
              {isConnected ? '接続中' : '切断'}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1">
            <p className="font-medium">
              WebSocket {isConnected ? '接続中' : '切断中'}
            </p>
            {status.socketId && (
              <p className="text-xs text-muted-foreground">
                ID: {status.socketId}
              </p>
            )}
            {status.error && (
              <p className="text-xs text-red-500">エラー: {status.error}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
