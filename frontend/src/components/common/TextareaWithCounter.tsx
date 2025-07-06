import React, { forwardRef } from 'react';
import { CharacterCounter } from './CharacterCounter';

interface TextareaWithCounterProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  maxLength: number;
  label?: string;
  error?: string;
}

export const TextareaWithCounter = forwardRef<HTMLTextAreaElement, TextareaWithCounterProps>(
  ({ maxLength, label, error, value = '', className = '', ...props }, ref) => {
    const currentLength = value.toString().length;

    return (
      <div className="space-y-1">
        {label && (
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-gray-300">{label}</label>
            <CharacterCounter current={currentLength} max={maxLength} />
          </div>
        )}
        <textarea
          ref={ref}
          value={value}
          maxLength={maxLength}
          className={`w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${className}`}
          {...props}
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    );
  }
);

TextareaWithCounter.displayName = 'TextareaWithCounter';