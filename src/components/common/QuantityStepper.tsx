import React from 'react';
import { Minus, Plus } from 'lucide-react';

export interface QuantityStepperProps {
  value: number;
  min?: number;
  max?: number;
  onChange?: (newValue: number) => void;
  onIncrement?: () => void;
  onDecrement?: () => void;
  size?: 'sm' | 'md' | 'lg';
  theme?: 'light' | 'dark' | 'indigo' | 'slate';
  disabled?: boolean;
  className?: string;
  itemLabel?: string;
  stopPropagation?: boolean;
}

export const QuantityStepper: React.FC<QuantityStepperProps> = ({
  value,
  min = 0,
  max = 99,
  onChange,
  onIncrement,
  onDecrement,
  size = 'md',
  theme = 'light',
  disabled = false,
  className = '',
  itemLabel,
  stopPropagation = true
}) => {
  const handleDecrement = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    if (disabled || value <= min) return;
    if (onDecrement) {
      onDecrement();
    } else if (onChange) {
      onChange(Math.max(min, value - 1));
    }
  };

  const handleIncrement = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    if (disabled || value >= max) return;
    if (onIncrement) {
      onIncrement();
    } else if (onChange) {
      onChange(Math.min(max, value + 1));
    }
  };

  // Dimensions & typography based on size
  const sizeStyles = {
    sm: {
      container: 'min-h-[44px] h-auto px-1 gap-1',
      btn: 'w-11 h-11 rounded-md text-xs',
      icon: 'w-3 h-3',
      text: 'w-6 text-xs font-bold'
    },
    md: {
      container: 'min-h-[44px] h-auto px-1 gap-1.5',
      btn: 'w-11 h-11 rounded-lg text-xs',
      icon: 'w-3.5 h-3.5',
      text: 'w-7 sm:w-8 text-xs sm:text-sm font-black'
    },
    lg: {
      container: 'min-h-[44px] h-auto px-1.5 gap-2',
      btn: 'w-11 h-11 rounded-xl text-sm',
      icon: 'w-4 h-4',
      text: 'w-8 sm:w-10 text-sm sm:text-base font-black'
    }
  }[size];

  // Colors & backgrounds based on theme
  const themeStyles = {
    light: {
      container: 'bg-slate-100/90 border border-slate-200/90 text-slate-900',
      minusBtn: 'bg-white hover:bg-slate-200 text-slate-700 shadow-2xs active:bg-slate-300',
      plusBtn: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs active:bg-indigo-800'
    },
    dark: {
      container: 'bg-slate-800/90 border border-slate-700 text-white',
      minusBtn: 'bg-slate-700 hover:bg-slate-600 text-slate-200 active:bg-slate-500',
      plusBtn: 'bg-indigo-500 hover:bg-indigo-400 text-white active:bg-indigo-600'
    },
    indigo: {
      container: 'bg-indigo-50 border border-indigo-200 text-indigo-950',
      minusBtn: 'bg-white hover:bg-indigo-100 text-indigo-700 shadow-2xs active:bg-indigo-200',
      plusBtn: 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs active:bg-indigo-800'
    },
    slate: {
      container: 'bg-slate-200/80 border border-slate-300/80 text-slate-900',
      minusBtn: 'bg-white hover:bg-slate-100 text-slate-800 shadow-2xs',
      plusBtn: 'bg-slate-900 hover:bg-slate-800 text-white shadow-2xs'
    }
  }[theme];

  return (
    <div
      className={`inline-flex items-center justify-between rounded-xl select-none shrink-0 ${sizeStyles.container} ${themeStyles.container} ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${className}`}
      onClick={(e) => stopPropagation && e.stopPropagation()}
    >
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={handleDecrement}
        aria-label={itemLabel ? `Decrease quantity for ${itemLabel}` : 'Decrease quantity'}
        className={`flex items-center justify-center font-bold transition-transform active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed ${sizeStyles.btn} ${themeStyles.minusBtn}`}
      >
        <Minus className={sizeStyles.icon} />
      </button>

      <span
        className={`text-center font-mono tracking-tight flex items-center justify-center leading-none ${sizeStyles.text}`}
      >
        {value}
      </span>

      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={handleIncrement}
        aria-label={itemLabel ? `Increase quantity for ${itemLabel}` : 'Increase quantity'}
        className={`flex items-center justify-center font-bold transition-transform active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed ${sizeStyles.btn} ${themeStyles.plusBtn}`}
      >
        <Plus className={sizeStyles.icon} />
      </button>
    </div>
  );
};
