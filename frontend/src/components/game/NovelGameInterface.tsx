/**
 * ノベルゲーム風の物語インターフェース
 * 没入感のある物語体験を提供するUIコンポーネント
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Coins, ChevronRight, SkipForward } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

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
  isTyping = false,
  showChoices = true,
}) => {
  const [displayedText, setDisplayedText] = useState('')
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0)
  const [isAutoPlay, setIsAutoPlay] = useState(false)
  const typewriterSpeed = 30
  const textContainerRef = useRef<HTMLDivElement>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const currentMessage = messages[currentMessageIndex]

  // タイプライター効果
  useEffect(() => {
    if (!currentMessage) return

    setDisplayedText('')
    let charIndex = 0
    const text = currentMessage.content

    intervalRef.current = setInterval(() => {
      if (charIndex < text.length) {
        setDisplayedText(text.slice(0, charIndex + 1))
        charIndex++
      } else {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
        }
        // 自動再生モードの場合、次のメッセージへ
        if (isAutoPlay && currentMessageIndex < messages.length - 1) {
          setTimeout(() => {
            setCurrentMessageIndex(prev => prev + 1)
          }, 2000)
        }
      }
    }, typewriterSpeed)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [currentMessage, typewriterSpeed, isAutoPlay, currentMessageIndex, messages.length])

  // テキストスキップ
  const handleSkip = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
    }
    setDisplayedText(currentMessage?.content || '')
  }, [currentMessage])

  // 次のメッセージへ
  const handleNext = useCallback(() => {
    if (currentMessageIndex < messages.length - 1) {
      setCurrentMessageIndex(prev => prev + 1)
    }
  }, [currentMessageIndex, messages.length])

  // メッセージ領域のスクロール調整
  useEffect(() => {
    if (textContainerRef.current) {
      textContainerRef.current.scrollTop = textContainerRef.current.scrollHeight
    }
  }, [displayedText])

  return (
    <div className="relative w-full h-full bg-gradient-to-b from-gray-900 to-black rounded-lg overflow-hidden">
      {/* 背景オーバーレイ */}
      <div className="absolute inset-0 bg-black/30" />

      {/* シーン情報 */}
      {currentScene && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute top-4 left-4 z-10"
        >
          <Card className="bg-black/60 backdrop-blur-sm border-gray-800 px-4 py-2">
            <p className="text-sm text-gray-300">{currentScene}</p>
          </Card>
        </motion.div>
      )}

      {/* コントロールボタン */}
      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <Button
          size="sm"
          variant={isAutoPlay ? 'default' : 'outline'}
          onClick={() => setIsAutoPlay(!isAutoPlay)}
          className="bg-black/60 backdrop-blur-sm border-gray-700"
        >
          {isAutoPlay ? 'Auto ON' : 'Auto OFF'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSkip}
          className="bg-black/60 backdrop-blur-sm border-gray-700"
        >
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>

      {/* メインコンテンツエリア */}
      <div className="relative h-full flex flex-col">
        {/* 物語表示エリア */}
        <div className="flex-1 flex items-end p-8 pb-4">
          <div className="w-full max-w-4xl mx-auto">
            <AnimatePresence mode="wait">
              {currentMessage && (
                <motion.div
                  key={currentMessage.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  {/* テキストボックス */}
                  <Card className="bg-black/80 backdrop-blur-md border-gray-700 p-6">
                    {/* スピーカー名 */}
                    {currentMessage.speaker && (
                      <div className="mb-2">
                        <span className="text-primary font-semibold">
                          {currentMessage.speaker}
                        </span>
                      </div>
                    )}

                    {/* テキスト内容 */}
                    <div
                      ref={textContainerRef}
                      className="text-lg leading-relaxed text-gray-100 min-h-[100px] max-h-[200px] overflow-y-auto"
                    >
                      <p className="whitespace-pre-wrap">{displayedText}</p>
                      {isTyping && displayedText.length < (currentMessage?.content.length || 0) && (
                        <span className="inline-block w-2 h-5 bg-gray-400 ml-1 animate-pulse" />
                      )}
                    </div>

                    {/* 次へボタン */}
                    {displayedText === currentMessage.content && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="absolute bottom-4 right-4"
                      >
                        {currentMessageIndex < messages.length - 1 ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleNext}
                            className="text-gray-400 hover:text-gray-100"
                          >
                            <ChevronRight className="h-5 w-5" />
                          </Button>
                        ) : (
                          showChoices && choices.length === 0 && (
                            <span className="text-sm text-gray-500">続く...</span>
                          )
                        )}
                      </motion.div>
                    )}
                  </Card>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* 選択肢エリア */}
        {showChoices && choices.length > 0 && currentMessageIndex === messages.length - 1 && (
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
                      'bg-black/60 backdrop-blur-sm border-gray-700',
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