import React from 'react';

interface CharacterCounterProps {
  current: number;
  max: number;
  className?: string;
}

export const CharacterCounter: React.FC<CharacterCounterProps> = ({ current, max, className = '' }) => {
  const percentage = (current / max) * 100;
  const isNearLimit = percentage >= 80;
  const isAtLimit = current >= max;

  const getColorClass = () => {
    if (isAtLimit) return 'text-red-600';
    if (isNearLimit) return 'text-yellow-600';
    return 'text-muted-foreground';
  };

  return (
    <span className={`text-sm ${getColorClass()} ${className}`}>
      {current}/{max}
    </span>
  );
};