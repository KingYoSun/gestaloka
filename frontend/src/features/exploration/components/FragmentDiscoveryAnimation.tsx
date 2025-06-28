/**
 * ログフラグメント発見アニメーションコンポーネント
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Star, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';

interface FragmentDiscoveryAnimationProps {
  isDiscovering: boolean;
  fragmentCount?: number;
  rarity?: 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
}

export function FragmentDiscoveryAnimation({ 
  isDiscovering, 
  fragmentCount = 1,
  rarity = 'COMMON' 
}: FragmentDiscoveryAnimationProps) {
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number }>>([]);

  useEffect(() => {
    if (isDiscovering) {
      // パーティクル生成
      const newParticles = Array.from({ length: 20 }, (_, i) => ({
        id: i,
        x: Math.random() * 100 - 50,
        y: Math.random() * 100 - 50,
      }));
      setParticles(newParticles);
    }
  }, [isDiscovering]);

  const getRarityColor = () => {
    switch (rarity) {
      case 'LEGENDARY': return 'from-amber-400 to-amber-600';
      case 'EPIC': return 'from-purple-400 to-purple-600';
      case 'RARE': return 'from-blue-400 to-blue-600';
      case 'UNCOMMON': return 'from-green-400 to-green-600';
      default: return 'from-gray-400 to-gray-600';
    }
  };

  const getRarityGlow = () => {
    switch (rarity) {
      case 'LEGENDARY': return 'shadow-amber-500/50';
      case 'EPIC': return 'shadow-purple-500/50';
      case 'RARE': return 'shadow-blue-500/50';
      case 'UNCOMMON': return 'shadow-green-500/50';
      default: return 'shadow-gray-500/50';
    }
  };

  return (
    <AnimatePresence>
      {isDiscovering && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* 背景のオーバーレイ */}
          <motion.div
            className="absolute inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* メインアニメーション */}
          <motion.div
            className="relative"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
          >
            {/* 中心の光 */}
            <motion.div
              className={`w-32 h-32 rounded-full bg-gradient-to-r ${getRarityColor()} ${getRarityGlow()} shadow-2xl`}
              animate={{
                scale: [1, 1.2, 1],
                rotate: [0, 180, 360],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            >
              <div className="w-full h-full flex items-center justify-center">
                <motion.div
                  animate={{
                    scale: [1, 1.5, 1],
                  }}
                  transition={{
                    duration: 1,
                    repeat: Infinity,
                  }}
                >
                  <Sparkles className="w-16 h-16 text-white" />
                </motion.div>
              </div>
            </motion.div>

            {/* パーティクル */}
            {particles.map((particle) => (
              <motion.div
                key={particle.id}
                className="absolute top-1/2 left-1/2"
                initial={{ x: 0, y: 0, opacity: 1 }}
                animate={{
                  x: particle.x * 3,
                  y: particle.y * 3,
                  opacity: 0,
                }}
                transition={{
                  duration: 1.5,
                  ease: "easeOut",
                  delay: Math.random() * 0.3,
                }}
              >
                {particle.id % 3 === 0 ? (
                  <Star className="w-4 h-4 text-yellow-400" />
                ) : particle.id % 3 === 1 ? (
                  <Sparkles className="w-3 h-3 text-purple-400" />
                ) : (
                  <Zap className="w-3 h-3 text-blue-400" />
                )}
              </motion.div>
            ))}

            {/* 発見数テキスト */}
            {fragmentCount > 0 && (
              <motion.div
                className="absolute -bottom-8 left-1/2 transform -translate-x-1/2"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <span className="text-2xl font-bold text-white drop-shadow-lg">
                  {fragmentCount}個発見！
                </span>
              </motion.div>
            )}
          </motion.div>

          {/* リング効果 */}
          {[1, 2, 3].map((ring) => (
            <motion.div
              key={ring}
              className={`absolute w-64 h-64 rounded-full border-2 ${
                rarity === 'LEGENDARY' ? 'border-amber-400' :
                rarity === 'EPIC' ? 'border-purple-400' :
                rarity === 'RARE' ? 'border-blue-400' :
                rarity === 'UNCOMMON' ? 'border-green-400' :
                'border-gray-400'
              }`}
              style={{
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
              }}
              initial={{ scale: 0, opacity: 1 }}
              animate={{
                scale: ring * 1.5,
                opacity: 0,
              }}
              transition={{
                duration: 1.5,
                delay: ring * 0.2,
                ease: "easeOut",
              }}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}