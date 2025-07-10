/**
 * ノベルゲーム風の物語インターフェース
 * 没入感のある物語体験を提供するUIコンポーネント
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Coins, SkipForward } from 'lucide-react'
import { motion } from 'framer-motion'

interface NovelMessage {
  id: string
  content: string
  type: 'narration' | 'dialogue' | 'system'
  speaker?: string
  timestamp: Date
}

interface Choice {
  id?: string
  text: string
  difficulty?: string
}

interface NovelGameInterfaceProps {
  messages: NovelMessage[]
  choices?: Choice[]
  currentScene?: string
  onChoiceSelect?: (index: number, text: string) => void
  isTyping?: boolean
  showChoices?: boolean
}

export const NovelGameInterface: React.FC<NovelGameInterfaceProps> = ({
  messages,
  choices = [],
  currentScene,
  onChoiceSelect,
  showChoices = true,
}) => {
  const [displayedMessages, setDisplayedMessages] = useState<Array<{message: NovelMessage, displayedText: string}>>([])  
  const [currentTypingIndex, setCurrentTypingIndex] = useState(0)
  const [isAutoPlay, setIsAutoPlay] = useState(false)
  const typewriterSpeed = 30
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // 新しいメッセージが追加されたときの処理
  useEffect(() => {
    if (messages.length > displayedMessages.length) {
      const newMessages = messages.slice(displayedMessages.length)
      newMessages.forEach((msg) => {
        setDisplayedMessages(prev => [...prev, { message: msg, displayedText: '' }])
      })
      setCurrentTypingIndex(displayedMessages.length)
    }
  }, [messages, displayedMessages.length])

  // タイプライター効果
  useEffect(() => {
    if (currentTypingIndex >= displayedMessages.length) return
    
    const currentItem = displayedMessages[currentTypingIndex]
    if (!currentItem) return
    
    let charIndex = currentItem.displayedText.length
    const fullText = currentItem.message.content
    
    if (charIndex >= fullText.length) {
      // 現在のメッセージが完了したら次へ
      if (currentTypingIndex < displayedMessages.length - 1) {
        setCurrentTypingIndex(prev => prev + 1)
      }
      return
    }

    intervalRef.current = setInterval(() => {
      if (charIndex < fullText.length) {
        setDisplayedMessages(prev => {
          const newMessages = [...prev]
          newMessages[currentTypingIndex] = {
            ...newMessages[currentTypingIndex],
            displayedText: fullText.slice(0, charIndex + 1)
          }
          return newMessages
        })
        charIndex++
      } else {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
        }
        // 自動再生モードの場合、次のメッセージへ
        if (isAutoPlay && currentTypingIndex < displayedMessages.length - 1) {
          setTimeout(() => {
            setCurrentTypingIndex(prev => prev + 1)
          }, 1000)
        }
      }
    }, typewriterSpeed)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [currentTypingIndex, displayedMessages, typewriterSpeed, isAutoPlay])

  // テキストスキップ
  const handleSkip = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }
    // すべてのメッセージを完全に表示
    setDisplayedMessages(prev => prev.map((item) => ({
      ...item,
      displayedText: item.message.content
    })))
    setCurrentTypingIndex(displayedMessages.length)
  }, [displayedMessages.length])

  // メッセージ領域のスクロール調整
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [displayedMessages])

  return (
    <div className="relative w-full h-full bg-background rounded-lg overflow-hidden">
      {/* 背景オーバーレイ */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/50 to-background/90" />

      {/* シーン情報 */}
      {currentScene && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-4 left-4 z-10"
        >
          <Card className="bg-card/90 backdrop-blur-sm border-border px-4 py-2">
            <p className="text-sm text-muted-foreground">{currentScene}</p>
          </Card>
        </motion.div>
      )}

      {/* コントロールボタン */}
      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <Button
          size="sm"
          variant={isAutoPlay ? 'default' : 'outline'}
          onClick={() => setIsAutoPlay(!isAutoPlay)}
          className="bg-card/90 backdrop-blur-sm border-border"
        >
          {isAutoPlay ? 'Auto ON' : 'Auto OFF'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSkip}
          className="bg-card/90 backdrop-blur-sm border-border"
        >
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>

      {/* メインコンテンツエリア */}
      <div className="relative h-full flex flex-col">
        {/* 物語表示エリア */}
        <div className="flex-1 overflow-hidden relative">
          <div 
            ref={scrollAreaRef}
            className="absolute inset-0 overflow-y-auto gestaloka-scrollbar p-8"
          >
            <div className="max-w-4xl mx-auto space-y-4">
              {displayedMessages.map((item, index) => (
                <motion.div
                  key={item.message.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <Card className="bg-card/95 backdrop-blur-md border-border p-6">
                    {/* スピーカー名 */}
                    {item.message.speaker && (
                      <div className="mb-2">
                        <span className="text-primary font-semibold">
                          {item.message.speaker}
                        </span>
                      </div>
                    )}

                    {/* テキスト内容 */}
                    <div className="text-lg leading-relaxed text-foreground">
                      <p className="whitespace-pre-wrap">{item.displayedText}</p>
                      {index === currentTypingIndex && item.displayedText.length < item.message.content.length && (
                        <span className="inline-block w-2 h-5 bg-gray-400 ml-1 animate-pulse" />
                      )}
                    </div>
                  </Card>
                </motion.div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>

        {/* 選択肢エリア */}
        {showChoices && choices.length > 0 && displayedMessages.length === messages.length && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="p-8 pt-4"
          >
            <div className="max-w-4xl mx-auto grid gap-3">
              {choices.map((choice, index) => (
                <motion.div
                  key={choice.id || index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 * index }}
                >
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-between h-auto p-4',
                      'bg-card/90 backdrop-blur-sm border-border',
                      'hover:bg-white/10 hover:border-primary',
                      'transition-all duration-200'
                    )}
                    onClick={() => onChoiceSelect?.(index, choice.text)}
                  >
                    <div className="flex-1 text-left">
                      <span className="text-base">{choice.text}</span>
                      {choice.difficulty && (
                        <span className="block text-xs text-gray-400 mt-1">
                          難易度: {choice.difficulty}
                        </span>
                      )}
                    </div>
                    <Badge variant="secondary" className="ml-4">
                      <Coins className="h-3 w-3 mr-1" />
                      2 SP
                    </Badge>
                  </Button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}