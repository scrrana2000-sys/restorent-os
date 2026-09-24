import React, { useState } from 'react';
import { MenuItem } from '../../types/menu';
import { formatMoney, toMoneyMinor } from '../../utils/money';
import { useRestaurant } from '../../context/RestaurantContext';
import { getItemFallbackVisual } from '../../utils/visualCategory';
import { Plus, Minus, Star, Ban, Power } from 'lucide-react';

interface MenuGridProps {
  items: MenuItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onAddToCart: (item: MenuItem) => void;
  cartItemQuantityMap?: Record<string, number>;
  onUpdateQuantityByItemId?: (itemId: string, delta: number) => void;
  onToggleAvailability?: (itemId: string, isAvailable: boolean) => Promise<void>;
}

interface MenuItemCardProps {
  item: MenuItem;
  symbol: string;
  quantityInCart: number;
  onAddToCart: (item: MenuItem) => void;
  onUpdateQuantity?: (itemId: string, delta: number) => void;
  onToggleAvailability?: (itemId: string, isAvailable: boolean) => Promise<void>;
}

const MenuItemCard: React.FC<MenuItemCardProps> = React.memo(({
  item,
  symbol,
  quantityInCart,
  onAddToCart,
  onUpdateQuantity,
  onToggleAvailability
}) => {
  const [imgError, setImgError] = useState(false);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const minorPrice = toMoneyMinor(item.price);
  const formattedPrice = formatMoney(minorPrice, symbol);
  const isVeg = item.foodType === 'veg';
  const isEgg = item.foodType === 'egg';

  const fallback = getItemFallbackVisual(item.name, item.foodType);

  const handleCardClick = () => {
    if (!item.isAvailable) return;
    if (onUpdateQuantity && quantityInCart > 0) {
      onUpdateQuantity(item.itemId, 1);
    } else {
      onAddToCart(item);
    }
  };

  const handleDecrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.isAvailable || !onUpdateQuantity) return;
    onUpdateQuantity(item.itemId, -1);
  };

  const handleIncrement = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.isAvailable) return;
    if (onUpdateQuantity) {
      onUpdateQuantity(item.itemId, 1);
    } else {
      onAddToCart(item);
    }
  };

  return (
    <div
      onClick={handleCardClick}
      data-testid={`menu-item-${item.itemId}`}
      className={`group relative bg-white rounded-xl border transition-all duration-150 flex flex-col justify-between overflow-hidden select-none active:scale-[0.98] ${
        item.isAvailable
          ? quantityInCart > 0
            ? 'border-indigo-400 ring-2 ring-indigo-500/20 shadow-2xs cursor-pointer'
            : 'border-slate-200/90 hover:border-indigo-300 hover:shadow-xs cursor-pointer'
          : 'border-slate-200/60 bg-slate-50/70 opacity-60 cursor-not-allowed'
      }`}
    >
      {/* 1. Food Image Header with Veg/Non-Veg Badge and Popular Star */}
      <div className="relative w-full h-20 sm:h-24 lg:h-28 bg-slate-100 overflow-hidden shrink-0">
        {item.imageUrl && !imgError ? (
          <img
            src={item.imageUrl}
            alt={item.name}
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className={`w-full h-full bg-gradient-to-br ${fallback.bgGradient} flex items-center justify-center p-1 text-center`}
          >
            <span className="text-2xl sm:text-3xl filter drop-shadow-xs transform group-hover:scale-110 transition-transform">
              {fallback.emoji}
            </span>
          </div>
        )}

        {/* Veg / Non-Veg / Egg Visual Dot Indicator (Top-Left) */}
        <div className="absolute top-1.5 left-1.5 z-10">
          <div
            className={`w-3.5 h-3.5 rounded-xs border bg-white/95 backdrop-blur-xs flex items-center justify-center shadow-2xs ${
              isVeg
                ? 'border-emerald-600'
                : isEgg
                ? 'border-amber-600'
                : 'border-rose-600'
            }`}
            title={item.foodType}
          >
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                isVeg ? 'bg-emerald-600' : isEgg ? 'bg-amber-600' : 'bg-rose-600'
              }`}
            />
          </div>
        </div>

        {/* Popular / Special Star (Top-Right) */}
        {(item.isPopular || item.isSpecial) && (
          <div className="absolute top-1.5 right-1.5 z-10">
            <div className="w-4 h-4 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center shadow-xs">
              <Star className="w-2.5 h-2.5 fill-slate-950 text-slate-950" />
            </div>
          </div>
        )}

        {/* Unavailable Banner */}
        {!item.isAvailable && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-2xs flex items-center justify-center text-white font-bold text-xs gap-1">
            <Ban className="w-3.5 h-3.5 text-rose-400" />
            <span>Sold Out</span>
          </div>
        )}
      </div>

      {/* 2. Card Content: Title, Price, and Stepper/Add Button */}
      <div className="p-1.5 sm:p-2 flex-1 flex flex-col justify-between gap-1">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-1.5">
            <div className="min-w-0">
              <h4 className="h-5 text-[10px] sm:text-xs lg:text-[13px] font-bold text-slate-900 leading-5 truncate" title={item.name}>
                {item.name}
              </h4>
              <span className="text-[10px] sm:text-xs lg:text-sm font-black text-slate-900 block mt-0.5">
                {formattedPrice}
              </span>
            </div>
            {onToggleAvailability && (
              <button
                type="button"
                disabled={availabilityBusy}
                onClick={async (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setAvailabilityBusy(true);
                  try {
                    await onToggleAvailability(item.itemId, !item.isAvailable);
                  } finally {
                    setAvailabilityBusy(false);
                  }
                }}
                className={'shrink-0 min-h-[30px] min-w-[30px] sm:min-h-[36px] sm:min-w-[36px] lg:min-h-[44px] lg:min-w-[44px] px-1 rounded-md border text-[8px] sm:text-[9px] font-black flex items-center justify-center gap-0.5 transition-colors ' +
                  (item.isAvailable
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                    : 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100')}
                aria-label={(item.isAvailable ? 'Turn OFF ' : 'Turn ON ') + item.name}
                title={item.isAvailable ? 'Turn this item OFF for POS' : 'Turn this item ON for POS'}
              >
                <Power className="w-3 h-3" />
                <span>{item.isAvailable ? 'ON' : 'OFF'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Bottom Action: Prominent '+ Add' or Stepper '[ - ] 1 [ + ]' */}
        <div className="pt-0.5">
          {quantityInCart > 0 && onUpdateQuantity ? (
            <div
              className="flex items-center justify-between bg-slate-50 border border-indigo-200 rounded-lg p-0.5 h-9 sm:h-10 lg:h-11 shadow-2xs"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                aria-label={`Decrease ${item.name} quantity`}
                onClick={handleDecrement}
                className="min-w-[32px] min-h-[32px] w-8 h-8 sm:min-w-[36px] sm:min-h-[36px] sm:w-9 sm:h-9 lg:min-w-[44px] lg:min-h-[44px] lg:w-11 lg:h-11 rounded-md flex items-center justify-center bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold active:scale-95 transition-transform"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="w-5 sm:w-6 text-center font-bold text-[10px] sm:text-xs text-slate-900">
                {quantityInCart}
              </span>
              <button
                type="button"
                aria-label={`Increase ${item.name} quantity`}
                onClick={handleIncrement}
                className="min-w-[32px] min-h-[32px] w-8 h-8 sm:min-w-[36px] sm:min-h-[36px] sm:w-9 sm:h-9 lg:min-w-[44px] lg:min-h-[44px] lg:w-11 lg:h-11 rounded-md flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white font-bold active:scale-95 transition-transform shadow-2xs"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={!item.isAvailable}
              aria-label={`Add ${item.name} to cart`}
              onClick={handleIncrement}
              className={`w-full min-h-[36px] sm:min-h-[40px] lg:min-h-[44px] px-1 py-1.5 sm:px-2 sm:py-2 rounded-lg text-[10px] sm:text-xs font-bold flex items-center justify-center gap-1 transition-all active:scale-95 ${
                item.isAvailable
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

MenuItemCard.displayName = 'MenuItemCard';

export const MenuGrid: React.FC<MenuGridProps> = React.memo(({
  items,
  loading,
  error,
  onRetry,
  onAddToCart,
  cartItemQuantityMap = {},
  onUpdateQuantityByItemId,
  onToggleAvailability
}) => {
  const { restaurant } = useRestaurant();
  const symbol = restaurant?.currencySymbol || '₹';

  if (loading) {
    return (
      <div className="w-full min-w-0 px-2 py-2 sm:px-3 sm:py-3 lg:p-4 grid grid-cols-3 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2 sm:gap-2.5 lg:gap-3">
        {Array.from({ length: 10 }).map((_, idx) => (
          <div
            key={idx}
            className="bg-white rounded-xl border border-slate-200/80 animate-pulse overflow-hidden space-y-2 p-2.5"
          >
            <div className="w-full h-28 bg-slate-100 rounded-lg" />
            <div className="h-4 bg-slate-100 rounded w-3/4" />
            <div className="h-4 bg-slate-100 rounded w-1/3" />
            <div className="h-8 bg-slate-100 rounded-lg w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center flex flex-col items-center justify-center space-y-3">
        <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-200">
          <Ban className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900">Failed to Load Menu</h3>
          <p className="text-xs text-slate-500 mt-0.5">{error}</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-xs active:scale-95"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-10 text-center flex flex-col items-center justify-center space-y-2">
        <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center">
          <span className="text-2xl">🍽️</span>
        </div>
        <h3 className="text-sm font-bold text-slate-800">No Food Items Found</h3>
        <p className="text-xs text-slate-400 max-w-xs">
          Try a different search keyword or category filter.
        </p>
      </div>
    );
  }

  return (
    <div className="px-2 py-2 sm:px-3 sm:py-3 lg:p-4 grid grid-cols-3 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2 sm:gap-2.5 lg:gap-3">
      {items.map((item) => (
        <MenuItemCard
          key={item.itemId}
          item={item}
          symbol={symbol}
          quantityInCart={cartItemQuantityMap[item.itemId] || 0}
          onAddToCart={onAddToCart}
          onUpdateQuantity={onUpdateQuantityByItemId}
          onToggleAvailability={onToggleAvailability}
        />
      ))}
    </div>
  );
});

MenuGrid.displayName = 'MenuGrid';
