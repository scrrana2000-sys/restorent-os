import React from 'react';
import { Category } from '../../types/menu';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { getCategoryVisual } from '../../utils/visualCategory';

interface CategoryBarProps {
  categories: Category[];
  selectedCategoryId: string | null;
  onSelectCategory: (id: string | null) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  totalItemsCount: number;
}

export const CategoryBar: React.FC<CategoryBarProps> = React.memo(({
  categories,
  selectedCategoryId,
  onSelectCategory,
  searchQuery,
  onSearchChange,
  totalItemsCount
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

      {/* 2. Compact Search Row (Matching Reference Image) */}
      <div className="flex items-center gap-2 min-w-0 w-full">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search food (e.g. Biryani, Naan, Coke...)"
            className="w-full h-10 pl-9 pr-8 text-xs bg-slate-100 hover:bg-slate-50 focus:bg-white border border-slate-200 focus:border-indigo-400 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-400 transition-all text-slate-800 placeholder-slate-400 font-medium"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search query"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-md active:scale-90"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter / Count Button */}
        <div
          className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0 shadow-2xs active:scale-95"
          title={`${totalItemsCount} items available`}
        >
          <SlidersHorizontal className="w-4 h-4 text-slate-600" />
        </div>
      </div>
    </div>
  );
});

CategoryBar.displayName = 'CategoryBar';
