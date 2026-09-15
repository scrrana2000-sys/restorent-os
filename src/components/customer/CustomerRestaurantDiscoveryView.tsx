import React from 'react';
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
  ArrowRight
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
  const { location, status, isDenied, requestLocation } = useCustomerLocation();

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

  // Extract available areas for the active city from city dataset
  const activeCityObj = location?.city ? findIndianCityByName(location.city) : undefined;
  const availableAreas = activeCityObj?.popularAreas || [];

  return (
    <div className={`w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 ${className}`}>
      {/* Top Bar: Location Context & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Discover Restaurants
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Order fresh food for delivery and takeaway near you
          </p>
        </div>

        {/* M9-C Location Selector Bar */}
        <div className="flex items-center gap-2">
          <CustomerLocationBar variant="pill" />
        </div>
      </div>

      {/* Search Input Box */}
      <div className="relative">
        <div className="relative flex items-center">
          <div className="absolute left-4 text-slate-400 pointer-events-none">
            <Search className="w-5 h-5" />
          </div>
          <input
            id="customer-restaurant-search-input"
            type="text"
            value={filters.searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              location?.city
                ? `Search restaurants, cuisines, dishes in ${location.city}... (or enter code like R-0YG9I)`
                : 'Select your city to search restaurants...'
            }
            className="w-full pl-12 pr-10 py-3.5 bg-white border border-slate-200 rounded-2xl shadow-xs text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
          />
          {filters.searchQuery && (
            <button
              id="clear-search-query-btn"
              onClick={() => setSearchQuery('')}
              className="absolute right-3.5 p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              title="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filters Bar */}
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

      {/* Exact Match Highlight Box (if user searched exact public code or slug) */}
      {exactMatch && (
        <div
          id="exact-match-banner"
          className="p-4 bg-orange-50/80 border border-orange-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
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
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 shrink-0"
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
            className="p-10 bg-slate-50 border border-slate-200/80 rounded-3xl text-center max-w-lg mx-auto my-8 shadow-xs"
          >
            <div className="w-14 h-14 rounded-2xl bg-orange-100 text-orange-600 flex items-center justify-center mx-auto mb-4">
              <MapPin className="w-7 h-7" />
            </div>
            <h3 className="text-base font-bold text-slate-900 mb-1">
              Choose your city to discover restaurants
            </h3>
            <p className="text-xs text-slate-500 mb-6 leading-relaxed max-w-sm mx-auto">
              Select your city or use device GPS to see available restaurants, delivery options, and food menus in your area.
            </p>
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
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Restaurants near {location?.city} ({totalCount})
              </h2>
            </div>

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
                  className="px-6 py-2.5 bg-white border border-slate-300 hover:border-slate-400 text-slate-800 text-xs font-bold rounded-xl shadow-xs hover:bg-slate-50 transition-all inline-flex items-center gap-2 min-h-[44px] disabled:opacity-50"
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
