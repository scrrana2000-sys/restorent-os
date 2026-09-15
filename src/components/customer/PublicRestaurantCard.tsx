import React from 'react';
import {
  Utensils,
  MapPin,
  Bike,
  ShoppingBag,
  Clock,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Building
} from 'lucide-react';
import { PublicRestaurantProfile } from '../../types/customer';

export interface PublicRestaurantCardProps {
  restaurant: PublicRestaurantProfile;
  onSelect?: (restaurant: PublicRestaurantProfile) => void;
  className?: string;
  featured?: boolean;
}

/**
 * Public Restaurant Card Component.
 * Displays only non-sensitive, public discovery fields:
 * Name, Logo, Cover, Cuisine tags, City/Area, Delivery/Takeaway flags, Status, Approx Distance.
 * Strictly avoids rendering private tenant IDs, staff details, GST numbers, or financial metrics.
 */
export const PublicRestaurantCard: React.FC<PublicRestaurantCardProps> = ({
  restaurant,
  onSelect,
  className = '',
  featured = false
}) => {
  const isAvailableForOrders =
    restaurant.publicStatus === 'active' &&
    restaurant.onlineOrderingEnabled &&
    restaurant.isOpenNow !== false;

  const handleCardClick = () => {
    if (onSelect) {
      onSelect(restaurant);
    }
  };

  return (
    <div
      id={`public-restaurant-card-${restaurant.restaurantId}`}
      onClick={handleCardClick}
      className={`group glass-neu-card rounded-2xl overflow-hidden flex flex-col justify-between cursor-pointer ${
        featured ? 'ring-2 ring-orange-400/80 shadow-[0_0_20px_rgba(249,115,22,0.3)]' : ''
      } ${className}`}
    >
      {/* Cover / Header Section */}
      <div className="relative h-36 sm:h-40 bg-gradient-to-br from-slate-100 to-slate-200 overflow-hidden shrink-0">
        {restaurant.coverImageUrl ? (
          <img
            src={restaurant.coverImageUrl}
            alt={restaurant.name}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-orange-50 via-slate-50 to-amber-50">
            <Utensils className="w-10 h-10 text-orange-200 group-hover:scale-110 transition-transform" />
          </div>
        )}

        {/* Status Badge */}
        <div className="absolute top-3 left-3">
          {isAvailableForOrders ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/95 text-white shadow-xs backdrop-blur-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              Open for Orders
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-800/85 text-slate-200 shadow-xs backdrop-blur-xs">
              <Clock className="w-3 h-3" />
              {restaurant.publicStatus === 'closed' ? 'Closed' : 'Busy / Paused'}
            </span>
          )}
        </div>

        {/* Public Restaurant Code Badge */}
        <div className="absolute top-3 right-3">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-white/90 text-slate-700 shadow-xs backdrop-blur-xs border border-slate-200/60">
            {restaurant.publicRestaurantCode}
          </span>
        </div>

        {/* Logo overlay */}
        <div className="absolute -bottom-4 left-4">
          <div className="w-12 h-12 rounded-xl bg-white border-2 border-white shadow-md overflow-hidden flex items-center justify-center shrink-0">
            {restaurant.logoUrl ? (
              <img
                src={restaurant.logoUrl}
                alt={`${restaurant.name} logo`}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            ) : (
              <Building className="w-6 h-6 text-orange-500" />
            )}
          </div>
        </div>
      </div>

      {/* Body Content */}
      <div className="p-4 pt-6 flex-1 flex flex-col justify-between">
        <div>
          {/* Restaurant Name */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-bold text-slate-900 line-clamp-1 group-hover:text-orange-600 transition-colors">
              {restaurant.name}
            </h3>
          </div>

          {/* Location Area & City */}
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">
              {restaurant.area ? `${restaurant.area}, ` : ''}{restaurant.city}
            </span>
            {restaurant.approxDistanceKm !== undefined && (
              <span className="text-slate-400 text-[11px] font-medium shrink-0">
                • {restaurant.approxDistanceKm < 1 ? '< 1 km' : `${restaurant.approxDistanceKm.toFixed(1)} km`}
              </span>
            )}
          </div>

          {/* Cuisine Pills */}
          {restaurant.cuisine && restaurant.cuisine.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              {restaurant.cuisine.slice(0, 3).map((item, idx) => (
                <span
                  key={`${item}-${idx}`}
                  className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[11px] font-medium rounded-md whitespace-nowrap"
                >
                  {item}
                </span>
              ))}
              {restaurant.cuisine.length > 3 && (
                <span className="text-[10px] font-semibold text-slate-400 whitespace-nowrap">
                  +{restaurant.cuisine.length - 3} more
                </span>
              )}
            </div>
          )}
        </div>

        {/* Footer: Capabilities and Action */}
        <div className="pt-4 mt-3 border-t border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {restaurant.deliveryEnabled && (
              <span
                className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md"
                title="Delivery Available"
              >
                <Bike className="w-3 h-3" />
                Delivery
              </span>
            )}
            {restaurant.takeawayEnabled && (
              <span
                className="flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md"
                title="Takeaway Available"
              >
                <ShoppingBag className="w-3 h-3" />
                Takeaway
              </span>
            )}
          </div>

          <button
            id={`view-restaurant-btn-${restaurant.restaurantId}`}
            className="flex items-center gap-1 text-xs font-bold text-orange-600 group-hover:text-orange-700 group-hover:translate-x-0.5 transition-all"
          >
            <span>View</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
