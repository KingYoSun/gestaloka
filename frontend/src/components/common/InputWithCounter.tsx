import React, { forwardRef } from 'react';
import { CharacterCounter } from './CharacterCounter';

interface InputWithCounterProps extends React.InputHTMLAttributes<HTMLInputElement> {
  maxLength: number;
  error?: string;
}

export const InputWithCounter = forwardRef<HTMLInputElement, InputWithCounterProps>(
  ({ maxLength, error, className = '', ...props }, ref) => {
    const currentLength = (props.value || '').toString().length;

    return (
      <div className="space-y-1">
        <div className="relative">
          <input
            ref={ref}
            maxLength={maxLength}
            className={`w-full px-3 py-2 pr-16 border rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${className}`}
            {...props}
          />
          <div className="absolute bottom-1 right-2">
            <CharacterCounter current={currentLength} max={maxLength} />
          </div>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    );
  }
);

InputWithCounter.displayName = 'InputWithCounter';