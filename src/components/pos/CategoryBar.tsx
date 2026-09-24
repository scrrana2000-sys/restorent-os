import React from 'react';
import { Category } from '../../types/menu';
import { getCategoryVisual } from '../../utils/visualCategory';

interface CategoryBarProps {
  categories: Category[];
  selectedCategoryId: string | null;
  onSelectCategory: (id: string | null) => void;
}

export const CategoryBar: React.FC<CategoryBarProps> = React.memo(({
  categories,
  selectedCategoryId,
  onSelectCategory,
}) => {
  return (
    <div className="w-full min-w-0 bg-white border-b border-slate-200 px-3 sm:px-4 py-2.5 space-y-2.5 shrink-0 select-none shadow-2xs">
      {/* 1. Category Scroll Row (Directly matching Reference Image) */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5 -mx-4 px-4">
        {/* All Items Pill */}
        <button
          type="button"
          onClick={() => onSelectCategory(null)}
          className={`min-h-[44px] h-10 px-3.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all duration-150 shrink-0 flex items-center justify-center active:scale-95 ${
            selectedCategoryId === null
              ? 'bg-indigo-600 text-white shadow-2xs'
              : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700 border border-slate-200/60'
          }`}
        >
          All
        </button>

        {/* Dynamic Category Pills with recognizable Food Emojis */}
        {categories.map((cat) => {
          const isSelected = selectedCategoryId === cat.categoryId;
          const visual = getCategoryVisual(cat.name);

          return (
            <button
              key={cat.categoryId}
              type="button"
              onClick={() => onSelectCategory(cat.categoryId)}
              className={`min-h-[44px] h-10 px-3.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all duration-150 shrink-0 flex items-center gap-1.5 active:scale-95 ${
                isSelected
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-slate-100 hover:bg-slate-200/80 text-slate-700 border border-slate-200/60'
              }`}
            >
              <span className="text-sm shrink-0">{visual.emoji}</span>
              <span>{cat.name}</span>
            </button>
          );
        })}
      </div>

    </div>
  );
});

CategoryBar.displayName = 'CategoryBar';
