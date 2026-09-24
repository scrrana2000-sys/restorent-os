import React, { useState } from 'react';
import { Search, X } from 'lucide-react';
import { Category } from '../../types/menu';
import { getCategoryVisual } from '../../utils/visualCategory';

interface CategoryBarProps {
  categories: Category[];
  selectedCategoryId: string | null;
  onSelectCategory: (id: string | null) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const CategoryBar: React.FC<CategoryBarProps> = React.memo(({
  categories,
  selectedCategoryId,
  onSelectCategory,
  searchQuery,
  onSearchChange,
}) => {
  return (
    <div className="w-full min-w-0 bg-white border-b border-slate-200 px-3 sm:px-4 py-2.5 space-y-2.5 shrink-0 select-none shadow-2xs">
      <div className="flex items-center justify-end min-h-9">
        <div className={`flex items-center gap-1.5 ${isSearchOpen ? 'w-full' : 'w-auto'}`}>
          {isSearchOpen && (
            <>
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search food..."
                className="flex-1 h-9 min-w-0 px-2.5 text-xs bg-slate-50 border border-indigo-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-400 text-slate-800 placeholder-slate-400"
              />
              {searchQuery && (
                <button type="button" onClick={() => onSearchChange('')} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100" aria-label="Clear search">
                  <X className="w-4 h-4" />
                </button>
              )}
            </>
          )}
          <button
            id="pos-category-search-btn"
            type="button"
            onClick={() => setIsSearchOpen((open) => !open)}
            className={`w-9 h-9 shrink-0 rounded-lg border flex items-center justify-center active:scale-95 transition-all ${isSearchOpen || searchQuery ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-slate-100 border-slate-200 text-slate-600'}`}
            title="Search menu"
            aria-label="Search menu"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>
      </div>

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
