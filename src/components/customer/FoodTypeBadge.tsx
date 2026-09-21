import React from 'react';
import { FoodType } from '../../types/menu';

export interface FoodTypeBadgeProps {
  foodType: FoodType | string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

/**
 * Standard food dietary symbol badge (Veg green dot in square, Non-Veg red triangle in square, Egg yellow circle in square).
 */
export const FoodTypeBadge: React.FC<FoodTypeBadgeProps> = ({
  foodType,
  size = 'md',
  showLabel = false,
  className = ''
}) => {
  const normalized = typeof foodType === 'string' ? foodType.toLowerCase() : 'veg';
  // Defensive normalization: malformed/legacy menu data must never crash the
  // customer menu when a sidebar or cart interaction causes a re-render.
  const safeSize: 'sm' | 'md' | 'lg' =
    size === 'sm' || size === 'lg' || size === 'md' ? size : 'md';

  const sizeClasses = {
    sm: {
      box: 'w-3.5 h-3.5 border',
      dot: 'w-1.5 h-1.5',
      triangle: 'border-l-[3px] border-r-[3px] border-b-[5px]',
      text: 'text-[10px]'
    },
    md: {
      box: 'w-4 h-4 border',
      dot: 'w-2 h-2',
      triangle: 'border-l-[4px] border-r-[4px] border-b-[7px]',
      text: 'text-xs'
    },
    lg: {
      box: 'w-5 h-5 border-[1.5px]',
      dot: 'w-2.5 h-2.5',
      triangle: 'border-l-[5px] border-r-[5px] border-b-[8px]',
      text: 'text-xs'
    }
  }[safeSize];

  if (normalized === 'veg') {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        <div
          data-testid="food-badge-veg"
          title="Vegetarian"
          className={`${sizeClasses.box} border-emerald-600 rounded-sm flex items-center justify-center p-[1px] bg-white shrink-0`}
        >
          <div className={`${sizeClasses.dot} rounded-full bg-emerald-600`} />
        </div>
        {showLabel && <span className={`${sizeClasses.text} font-semibold text-emerald-700`}>Veg</span>}
      </div>
    );
  }

  if (normalized === 'nonveg' || normalized === 'non-veg') {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        <div
          data-testid="food-badge-nonveg"
          title="Non-Vegetarian"
          className={`${sizeClasses.box} border-red-600 rounded-sm flex items-center justify-center p-[1px] bg-white shrink-0`}
        >
          <div
            className={`w-0 h-0 ${sizeClasses.triangle} border-l-transparent border-r-transparent border-b-red-600`}
          />
        </div>
        {showLabel && <span className={`${sizeClasses.text} font-semibold text-red-700`}>Non-Veg</span>}
      </div>
    );
  }

  if (normalized === 'egg') {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        <div
          data-testid="food-badge-egg"
          title="Contains Egg"
          className={`${sizeClasses.box} border-amber-600 rounded-sm flex items-center justify-center p-[1px] bg-white shrink-0`}
        >
          <div className={`${sizeClasses.dot} rounded-full bg-amber-500`} />
        </div>
        {showLabel && <span className={`${sizeClasses.text} font-semibold text-amber-700`}>Egg</span>}
      </div>
    );
  }

  // Other / Neutral
  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <div
        data-testid="food-badge-other"
        className={`${sizeClasses.box} border-slate-400 rounded-sm flex items-center justify-center p-[1px] bg-white shrink-0`}
      >
        <div className={`${sizeClasses.dot} rounded-full bg-slate-400`} />
      </div>
      {showLabel && <span className={`${sizeClasses.text} font-semibold text-slate-600`}>Item</span>}
    </div>
  );
};
