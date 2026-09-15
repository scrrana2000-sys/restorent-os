import React from 'react';
import {
  Bike,
  ShoppingBag,
  RotateCcw,
  Sparkles,
  MapPin,
  X
} from 'lucide-react';
import { CustomerRestaurantFilterState } from '../../types/customer';

export interface CustomerRestaurantFiltersProps {
  filters: CustomerRestaurantFilterState;
  availableCuisines?: string[];
  availableAreas?: string[];
  onCuisineChange: (cuisine: string | null) => void;
  onAreaChange: (area: string | null) => void;
  onDeliveryToggle: (enabled: boolean) => void;
  onTakeawayToggle: (enabled: boolean) => void;
  onOnlineOrderingToggle: (enabled: boolean) => void;
  onResetFilters: () => void;
  className?: string;
}

const DEFAULT_POPULAR_CUISINES = [
  'North Indian',
  'South Indian',
  'Biryani',
  'Chinese',
  'Pizza',
  'Fast Food',
  'Thali',
  'Bakery',
  'Desserts',
  'Mughlai',
  'Street Food'
];

/**
 * Filter bar for customer restaurant discovery.
 * Supports Cuisines, Delivery, Takeaway, Online Ordering, and Area filtering.
 * Never invents fake review/rating filters.
 */
export const CustomerRestaurantFilters: React.FC<CustomerRestaurantFiltersProps> = ({
  filters,
  availableCuisines = DEFAULT_POPULAR_CUISINES,
  availableAreas = [],
  onCuisineChange,
  onAreaChange,
  onDeliveryToggle,
  onTakeawayToggle,
  onOnlineOrderingToggle,
  onResetFilters,
  className = ''
}) => {
  const isAnyFilterActive =
    filters.selectedCuisine !== null ||
    filters.deliveryOnly ||
    filters.takeawayOnly ||
    filters.onlineOrderingOnly ||
    filters.selectedArea !== null;

  return (
    <div className={`space-y-2.5 ${className}`}>
      {/* Primary Capability Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {/* Reset / All Button */}
        <button
          id="filter-all-btn"
          onClick={() => {
            if (isAnyFilterActive) onResetFilters();
          }}
          className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 whitespace-nowrap min-h-[36px] flex items-center gap-1.5 ${
            !isAnyFilterActive
              ? 'glass-neu-pill-active'
              : 'glass-neu-pill'
          }`}
        >
          All
          {isAnyFilterActive && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onResetFilters();
              }}
              className="p-0.5 rounded-full hover:bg-white/40"
              title="Reset all filters"
            >
              <RotateCcw className="w-3 h-3 text-white" />
            </span>
          )}
        </button>

        {/* Delivery Toggle Pill */}
        <button
          id="filter-delivery-btn"
          onClick={() => onDeliveryToggle(!filters.deliveryOnly)}
          className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 whitespace-nowrap min-h-[36px] flex items-center gap-1.5 ${
            filters.deliveryOnly
              ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-[4px_4px_12px_rgba(16,185,129,0.35),-3px_-3px_10px_rgba(255,255,255,0.8)] border border-white/50'
              : 'glass-neu-pill'
          }`}
        >
          <Bike className="w-3.5 h-3.5" />
          Delivery
          {filters.deliveryOnly && <X className="w-3 h-3 ml-0.5" />}
        </button>

        {/* Takeaway Toggle Pill */}
        <button
          id="filter-takeaway-btn"
          onClick={() => onTakeawayToggle(!filters.takeawayOnly)}
          className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 whitespace-nowrap min-h-[36px] flex items-center gap-1.5 ${
            filters.takeawayOnly
              ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-[4px_4px_12px_rgba(59,130,246,0.35),-3px_-3px_10px_rgba(255,255,255,0.8)] border border-white/50'
              : 'glass-neu-pill'
          }`}
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          Takeaway
          {filters.takeawayOnly && <X className="w-3 h-3 ml-0.5" />}
        </button>

        {/* Online Ordering Toggle Pill */}
        <button
          id="filter-online-ordering-btn"
          onClick={() => onOnlineOrderingToggle(!filters.onlineOrderingOnly)}
          className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 whitespace-nowrap min-h-[36px] flex items-center gap-1.5 ${
            filters.onlineOrderingOnly
              ? 'glass-neu-pill-active'
              : 'glass-neu-pill'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Order Online
          {filters.onlineOrderingOnly && <X className="w-3 h-3 ml-0.5" />}
        </button>

        {/* Optional Area Filter dropdown if areas available */}
        {availableAreas.length > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            {availableAreas.slice(0, 4).map((area) => (
              <button
                key={area}
                onClick={() => onAreaChange(filters.selectedArea === area ? null : area)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 whitespace-nowrap min-h-[36px] flex items-center gap-1 ${
                  filters.selectedArea === area
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                <MapPin className="w-3 h-3" />
                {area}
                {filters.selectedArea === area && <X className="w-3 h-3 ml-0.5" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cuisine Quick-Select Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-1">
          Cuisines:
        </span>
        {availableCuisines.map((cuisine) => {
          const isSelected = filters.selectedCuisine?.toLowerCase() === cuisine.toLowerCase();
          return (
            <button
              key={cuisine}
              onClick={() => onCuisineChange(cuisine)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 whitespace-nowrap min-h-[32px] ${
                isSelected
                  ? 'glass-neu-pill-active font-bold'
                  : 'glass-neu-pill hover:text-slate-900'
              }`}
            >
              {cuisine}
              {isSelected && <span className="ml-1 text-white">✓</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
};
