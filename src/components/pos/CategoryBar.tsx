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
    <div className="bg-white border-b border-slate-200 px-3 py-2 space-y-2 shrink-0 select-none shadow-2xs">
      {/* 1. Category Scroll Row (Directly matching Reference Image) */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 -mx-3 px-3">
        {/* All Items Pill */}
        <button
          type="button"
          onClick={() => onSelectCategory(null)}
          className={`px-4 py-1.5 sm:py-2 rounded-xl text-xs font-black whitespace-nowrap transition-all duration-150 shrink-0 active:scale-95 ${
            selectedCategoryId === null
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
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
              className={`flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-150 shrink-0 active:scale-95 ${
                isSelected
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              <span className="text-sm shrink-0">{visual.emoji}</span>
              <span>{cat.name}</span>
            </button>
          );
        })}
      </div>

      {/* 2. Compact Search Row (Matching Reference Image) */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search food (e.g. Biryani, Naan, Coke...)"
            className="w-full pl-9 pr-8 py-2 text-xs bg-slate-100 hover:bg-slate-50 focus:bg-white border border-transparent focus:border-indigo-400 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-400 transition-all text-slate-800 placeholder-slate-400 font-medium h-9"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search query"
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-md active:scale-90"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter / Count Button */}
        <div className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0 cursor-pointer shadow-2xs" title={`${totalItemsCount} items available`}>
          <SlidersHorizontal className="w-4 h-4 text-slate-600" />
        </div>
      </div>
    </div>
  );
});

CategoryBar.displayName = 'CategoryBar';
