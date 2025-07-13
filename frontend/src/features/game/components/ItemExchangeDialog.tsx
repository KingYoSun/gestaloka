import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ArrowLeftRight, Package, AlertCircle, Check } from 'lucide-react'
interface NPCData {
  name: string
}

interface Item {
  id: string
  name: string
  description?: string
  quantity: number
  value?: number
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
}

interface ItemExchangeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  npc: NPCData
  playerItems: Item[]
  npcItems: Item[]
  onExchange: (
    offeredItems: string[],
    requestedItems: string[]
  ) => Promise<void>
}

export function ItemExchangeDialog({
  open,
  onOpenChange,
  npc,
  playerItems,
  npcItems,
  onExchange,
}: ItemExchangeDialogProps) {
  const [selectedPlayerItems, setSelectedPlayerItems] = useState<string[]>([])
  const [selectedNpcItems, setSelectedNpcItems] = useState<string[]>([])
  const [isExchanging, setIsExchanging] = useState(false)

  const handlePlayerItemToggle = (itemId: string) => {
    setSelectedPlayerItems(prev =>
      prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    )
  }

  const handleNpcItemToggle = (itemId: string) => {
    setSelectedNpcItems(prev =>
      prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    )
  }

  const handleExchange = async () => {
    if (selectedPlayerItems.length === 0 && selectedNpcItems.length === 0) {
      return
    }

    setIsExchanging(true)
    try {
      await onExchange(selectedPlayerItems, selectedNpcItems)
      // 成功時はダイアログを閉じる
      onOpenChange(false)
      // 選択をリセット
      setSelectedPlayerItems([])
      setSelectedNpcItems([])
    } catch (error) {
      console.error('Exchange failed:', error)
    } finally {
      setIsExchanging(false)
    }
  }

  const getRarityColor = (rarity?: string) => {
    switch (rarity) {
      case 'legendary':
        return 'text-orange-500 border-orange-500'
      case 'epic':
        return 'text-purple-500 border-purple-500'
      case 'rare':
        return 'text-blue-500 border-blue-500'
      case 'uncommon':
        return 'text-green-500 border-green-500'
      default:
        return 'text-gray-500 border-gray-500'
    }
  }

  const calculateTotalValue = (items: Item[], selectedIds: string[]) => {
    return items
      .filter(item => selectedIds.includes(item.id))
      .reduce((sum, item) => sum + (item.value || 0) * item.quantity, 0)
  }

  const playerTotal = calculateTotalValue(playerItems, selectedPlayerItems)
  const npcTotal = calculateTotalValue(npcItems, selectedNpcItems)
  const isBalanced = Math.abs(playerTotal - npcTotal) < playerTotal * 0.2 // 20%の差まで許容

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            {npc.name}とのアイテム交換
          </DialogTitle>
          <DialogDescription>
            交換したいアイテムを選択してください
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          <Tabs defaultValue="exchange" className="h-full flex flex-col">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="exchange">交換</TabsTrigger>
              <TabsTrigger value="preview">プレビュー</TabsTrigger>
            </TabsList>

            <TabsContent value="exchange" className="flex-1 overflow-hidden">
              <div className="grid grid-cols-2 gap-4 h-full">
                {/* プレイヤーのアイテム */}
                <Card className="h-full flex flex-col">
                  <CardHeader>
                    <CardTitle className="text-lg">あなたのアイテム</CardTitle>
                    <CardDescription>提供するアイテムを選択</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden">
                    <ScrollArea className="h-full">
                      <div className="space-y-2 pr-4">
                        {playerItems.map(item => (
                          <div
                            key={item.id}
                            className="flex items-start space-x-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
                          >
                            <Checkbox
                              id={`player-${item.id}`}
                              checked={selectedPlayerItems.includes(item.id)}
                              onCheckedChange={() =>
                                handlePlayerItemToggle(item.id)
                              }
                            />
                            <Label
                              htmlFor={`player-${item.id}`}
                              className="flex-1 cursor-pointer"
                            >
                              <div className="font-medium flex items-center gap-2">
                                {item.name}
                                {item.quantity > 1 && (
                                  <Badge variant="secondary">
                                    x{item.quantity}
                                  </Badge>
                                )}
                                {item.rarity && (
                                  <Badge
                                    variant="outline"
                                    className={getRarityColor(item.rarity)}
                                  >
                                    {item.rarity}
                                  </Badge>
                                )}
                              </div>
                              {item.description && (
                                <div className="text-sm text-muted-foreground">
                                  {item.description}
                                </div>
                              )}
                              {item.value && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  価値: {item.value}G
                                </div>
                              )}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                {/* NPCのアイテム */}
                <Card className="h-full flex flex-col">
                  <CardHeader>
                    <CardTitle className="text-lg">
                      {npc.name}のアイテム
                    </CardTitle>
                    <CardDescription>欲しいアイテムを選択</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden">
                    <ScrollArea className="h-full">
                      <div className="space-y-2 pr-4">
                        {npcItems.map(item => (
                          <div
                            key={item.id}
                            className="flex items-start space-x-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
                          >
                            <Checkbox
                              id={`npc-${item.id}`}
                              checked={selectedNpcItems.includes(item.id)}
                              onCheckedChange={() =>
                                handleNpcItemToggle(item.id)
                              }
                            />
                            <Label
                              htmlFor={`npc-${item.id}`}
                              className="flex-1 cursor-pointer"
                            >
                              <div className="font-medium flex items-center gap-2">
                                {item.name}
                                {item.quantity > 1 && (
                                  <Badge variant="secondary">
                                    x{item.quantity}
                                  </Badge>
                                )}
                                {item.rarity && (
                                  <Badge
                                    variant="outline"
                                    className={getRarityColor(item.rarity)}
                                  >
                                    {item.rarity}
                                  </Badge>
                                )}
                              </div>
                              {item.description && (
                                <div className="text-sm text-muted-foreground">
                                  {item.description}
                                </div>
                              )}
                              {item.value && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  価値: {item.value}G
                                </div>
                              )}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="preview" className="flex-1">
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>交換内容の確認</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* 提供アイテム */}
                  <div>
                    <h4 className="font-semibold mb-2">提供するアイテム:</h4>
                    {selectedPlayerItems.length > 0 ? (
                      <div className="space-y-1">
                        {playerItems
                          .filter(item => selectedPlayerItems.includes(item.id))
                          .map(item => (
                            <div
                              key={item.id}
                              className="flex items-center gap-2 text-sm"
                            >
                              <Check className="w-4 h-4 text-green-500" />
                              <span>{item.name}</span>
                              {item.quantity > 1 && (
                                <Badge variant="secondary" className="text-xs">
                                  x{item.quantity}
                                </Badge>
                              )}
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">なし</p>
                    )}
                  </div>

                  <div className="flex justify-center">
                    <ArrowLeftRight className="w-6 h-6 text-muted-foreground" />
                  </div>

                  {/* 受け取りアイテム */}
                  <div>
                    <h4 className="font-semibold mb-2">受け取るアイテム:</h4>
                    {selectedNpcItems.length > 0 ? (
                      <div className="space-y-1">
                        {npcItems
                          .filter(item => selectedNpcItems.includes(item.id))
                          .map(item => (
                            <div
                              key={item.id}
                              className="flex items-center gap-2 text-sm"
                            >
                              <Check className="w-4 h-4 text-blue-500" />
                              <span>{item.name}</span>
                              {item.quantity > 1 && (
                                <Badge variant="secondary" className="text-xs">
                                  x{item.quantity}
                                </Badge>
                              )}
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">なし</p>
                    )}
                  </div>

                  {/* 価値バランス */}
                  {(playerTotal > 0 || npcTotal > 0) && (
                    <div className="border-t pt-4">
                      <div className="flex justify-between text-sm">
                        <span>提供価値: {playerTotal}G</span>
                        <span>受取価値: {npcTotal}G</span>
                      </div>
                      {!isBalanced && (
                        <div className="flex items-center gap-2 mt-2 text-sm text-orange-500">
                          <AlertCircle className="w-4 h-4" />
                          <span>価値の差が大きすぎます</span>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button
            onClick={handleExchange}
            disabled={
              isExchanging ||
              (selectedPlayerItems.length === 0 &&
                selectedNpcItems.length === 0) ||
              !isBalanced
            }
          >
            {isExchanging ? '交換中...' : '交換する'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
