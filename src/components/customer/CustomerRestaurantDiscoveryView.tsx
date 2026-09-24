import React, { useState } from 'react';
import {
  Search,
  X,
  MapPin,
  Sparkles,
  AlertCircle,
  RotateCcw,
  Loader2,
  Utensils,
  Store,
  ArrowRight,
  SlidersHorizontal
} from 'lucide-react';
import { useCustomerLocation } from '../../context/CustomerLocationContext';
import { useCustomerRestaurantSearch } from '../../hooks/useCustomerRestaurantSearch';
import { CustomerLocationBar } from './CustomerLocationBar';
import { CustomerRestaurantFilters } from './CustomerRestaurantFilters';
import { PublicRestaurantCard } from './PublicRestaurantCard';
import { PublicRestaurantProfile } from '../../types/customer';
import { findIndianCityByName } from '../../data/indianLocations';

export interface CustomerRestaurantDiscoveryViewProps {
  onSelectRestaurant?: (restaurant: PublicRestaurantProfile) => void;
  className?: string;
}

/**
 * M9-D Customer Restaurant Discovery View.
 * Combines Location Context, Search Input with Debounce, Capability & Cuisine Filters,
 * Exact Slug / Public Code Resolution, Public Restaurant Cards, and Cursor Pagination.
 */
export const CustomerRestaurantDiscoveryView: React.FC<CustomerRestaurantDiscoveryViewProps> = ({
  onSelectRestaurant,
  className = ''
}) => {
  const { location, status, isDenied, requestLocation, selectCity } = useCustomerLocation();

  const {
    restaurants,
    exactMatch,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    filters,
    setSearchQuery,
    setCuisine,
    setArea,
    setDeliveryOnly,
    setTakeawayOnly,
    setOnlineOrderingOnly,
    resetFilters,
    loadMore,
    refetch,
    totalCount
  } = useCustomerRestaurantSearch({
    debounceMs: 300,
    pageSize: 12
  });

  const [showFilters, setShowFilters] = useState<boolean>(false);

  // Extract available areas for the active city from city dataset
  const activeCityObj = location?.city ? findIndianCityByName(location.city) : undefined;
  const availableAreas = activeCityObj?.popularAreas || [];

  const activeFiltersCount = [
    filters.searchQuery ? 1 : 0,
    filters.selectedCuisine ? 1 : 0,
    filters.deliveryOnly ? 1 : 0,
    filters.takeawayOnly ? 1 : 0,
    filters.onlineOrderingOnly ? 1 : 0,
    filters.selectedArea ? 1 : 0
  ].reduce((a, b) => a + b, 0);

  return (
    <div className={`w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-6 space-y-4 sm:space-y-6 ${className}`}>
      {/* Restaurants near city header & Icon-only Location & Filter controls */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <h1 className="text-xs sm:text-sm md:text-base font-extrabold text-slate-900 uppercase tracking-wider flex items-center gap-1.5 sm:gap-2 min-w-0 truncate">
            <span className="truncate">
              Restaurants near {location?.city || 'Bengaluru'}
            </span>
            {totalCount > 0 && (
              <span className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-black rounded-full shrink-0">
                {totalCount}
              </span>
            )}
          </h1>

          {/* Controls: Location button (icon only) + Filter button (icon only) */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Location Icon-Only Button */}
            <CustomerLocationBar variant="icon" />

            {/* Filter Icon-Only Button */}
            <button
              id="toggle-filters-btn"
              onClick={() => setShowFilters(!showFilters)}
              className={`p-2.5 sm:p-3 text-xs font-bold rounded-xl sm:rounded-2xl flex items-center justify-center transition-all cursor-pointer select-none border shrink-0 min-w-[38px] min-h-[38px] sm:min-w-[44px] sm:min-h-[44px] relative ${
                showFilters
                  ? 'bg-orange-600 text-white border-orange-600 shadow-xs'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 shadow-xs'
              }`}
              title={showFilters ? "Hide Filters" : "Show Filters"}
              aria-label="Filters"
            >
              <SlidersHorizontal className="w-4 h-4 sm:w-5 sm:h-5 text-slate-800" />
              {activeFiltersCount > 0 && (
                <span className="absolute -top-1 -right-1 px-1.5 py-0.5 bg-emerald-500 text-white text-[9px] font-black rounded-full min-w-[16px] text-center shadow-xs">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          </div>
        </div>

          {/* Collapsible Search and Filters Panel */}
          {showFilters && (
            <div className="p-4 bg-white border border-slate-100 rounded-2xl shadow-md space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
              {/* Search input bar */}
              <div className="relative">
                <div className="relative flex items-center bg-slate-50/70 border border-slate-200/80 rounded-xl transition-all focus-within:border-orange-500/50">
                  <div className="absolute left-3.5 text-slate-400 pointer-events-none">
                    <Search className="w-4 h-4" />
                  </div>
                  <input
                    id="customer-restaurant-search-input"
                    type="text"
                    value={filters.searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={`Search restaurants, cuisines, dishes in ${location.city}...`}
                    className="w-full pl-10 pr-9 py-2.5 bg-transparent text-xs font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none"
                  />
                  {filters.searchQuery && (
                    <button
                      id="clear-search-query-btn"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
                      title="Clear search"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Filters & Cuisines & All options (Capability pills) */}
              <CustomerRestaurantFilters
                filters={filters}
                availableAreas={availableAreas}
                onCuisineChange={setCuisine}
                onAreaChange={setArea}
                onDeliveryToggle={setDeliveryOnly}
                onTakeawayToggle={setTakeawayOnly}
                onOnlineOrderingToggle={setOnlineOrderingOnly}
                onResetFilters={resetFilters}
              />
            </div>
          )}
        </div>

      {/* Exact Match Highlight Box */}
      {exactMatch && (
        <div
          id="exact-match-banner"
          className="p-4 glass-neu-card rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-orange-300/60"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-orange-100/90 text-orange-600 flex items-center justify-center shrink-0 shadow-[2px_2px_6px_rgba(234,88,12,0.25)] border border-white">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-orange-800 uppercase tracking-wider">
                Direct Restaurant Match
              </div>
              <div className="text-sm font-bold text-slate-900 truncate">
                {exactMatch.name} ({exactMatch.publicRestaurantCode})
              </div>
              <div className="text-xs text-slate-600">
                {exactMatch.area ? `${exactMatch.area}, ` : ''}{exactMatch.city}
              </div>
            </div>
          </div>
          <button
            id="view-exact-match-btn"
            onClick={() => onSelectRestaurant?.(exactMatch)}
            className="glass-neu-btn-primary px-4 py-2 text-xs font-bold rounded-xl flex items-center gap-1.5 shrink-0"
          >
            <span>Open Menu</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Content Body: Loading, Error, Empty, or Restaurant Grid */}
      <div className="space-y-6">
        {/* Error State */}
        {error && (
          <div
            id="discovery-error-box"
            className="p-6 bg-red-50 border border-red-200 rounded-2xl text-center max-w-md mx-auto my-8 shadow-xs"
          >
            <div className="w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-3">
              <AlertCircle className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-red-900 mb-1">Search Encountered an Error</h3>
            <p className="text-xs text-red-700 mb-4">{error}</p>
            <button
              id="retry-discovery-btn"
              onClick={refetch}
              className="px-4 py-2 bg-white border border-red-300 text-red-700 hover:bg-red-50 text-xs font-bold rounded-xl shadow-xs transition-all inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry Search
            </button>
          </div>
        )}

        {/* Location Missing State */}
        {!location?.city && !isLoading && (
          <div
            id="location-missing-empty-state"
            className="p-6 sm:p-10 glass-neu-card rounded-3xl text-center max-w-lg mx-auto my-6"
          >
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-orange-100/90 text-orange-600 flex items-center justify-center mx-auto mb-3 border border-white shadow-[3px_3px_8px_rgba(234,88,12,0.2)]">
              <MapPin className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 mb-1">
              Choose your city to discover restaurants
            </h3>
            <p className="text-xs text-slate-500 mb-5 leading-relaxed max-w-sm mx-auto">
              Select your city or tap a popular city below to see available restaurants, menus, and online ordering options.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 mb-5">
              {[
                { name: 'Bengaluru', state: 'Karnataka' },
                { name: 'Mumbai', state: 'Maharashtra' },
                { name: 'Delhi', state: 'Delhi' },
                { name: 'Hyderabad', state: 'Telangana' },
                { name: 'Chennai', state: 'Tamil Nadu' },
                { name: 'Pune', state: 'Maharashtra' },
                { name: 'Kolkata', state: 'West Bengal' },
                { name: 'Raichur', state: 'Karnataka' }
              ].map((c) => (
                <button
                  key={c.name}
                  id={`quick-city-${c.name.toLowerCase()}`}
                  onClick={() => {
                    const matched = findIndianCityByName(c.name);
                    if (matched) {
                      selectCity(matched);
                    }
                  }}
                  className="glass-neu-pill px-3 py-1.5 text-xs font-semibold rounded-xl min-h-[36px]"
                >
                  {c.name}
                </button>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <CustomerLocationBar variant="pill" />
            </div>
          </div>
        )}

        {/* Initial Loading Skeletons */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="bg-white rounded-2xl border border-slate-200/60 p-4 space-y-4 animate-pulse"
              >
                <div className="h-36 bg-slate-100 rounded-xl w-full" />
                <div className="space-y-2">
                  <div className="h-4 bg-slate-100 rounded-md w-3/4" />
                  <div className="h-3 bg-slate-100 rounded-md w-1/2" />
                </div>
                <div className="flex gap-2 pt-2 border-t border-slate-50">
                  <div className="h-5 bg-slate-100 rounded-md w-16" />
                  <div className="h-5 bg-slate-100 rounded-md w-16" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty Search Results State */}
        {!isLoading && !error && location?.city && restaurants.length === 0 && (
          <div
            id="no-restaurants-empty-state"
            className="p-10 bg-slate-50 border border-slate-200/80 rounded-3xl text-center max-w-md mx-auto my-8 shadow-xs"
          >
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
              <Utensils className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 mb-1">
              {filters.searchQuery
                ? `No restaurants found for "${filters.searchQuery}"`
                : filters.selectedCuisine
                ? `No restaurants found for "${filters.selectedCuisine}" in ${location.city}`
                : `No restaurants found in ${location.city}`}
            </h3>
            <p className="text-xs text-slate-500 mb-5 leading-relaxed">
              Try adjusting your search terms, changing filters, or selecting a nearby city.
            </p>
            <button
              id="reset-empty-filters-btn"
              onClick={resetFilters}
              className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-xl shadow-xs hover:bg-slate-800 transition-all inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Clear Filters
            </button>
          </div>
        )}

        {/* Results Grid */}
        {!isLoading && !error && restaurants.length > 0 && (
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {restaurants.map((restaurant) => (
                <PublicRestaurantCard
                  key={restaurant.restaurantId}
                  restaurant={restaurant}
                  onSelect={onSelectRestaurant}
                />
              ))}
            </div>

            {/* Pagination / Load More Button */}
            {hasMore && (
              <div className="text-center pt-8 pb-4">
                <button
                  id="load-more-restaurants-btn"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                  className="glass-neu-btn px-6 py-2.5 text-slate-800 text-xs font-bold rounded-xl inline-flex items-center gap-2 min-h-[44px] disabled:opacity-50"
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-orange-600" />
                      Loading more restaurants...
                    </>
                  ) : (
                    'Load More Restaurants'
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
