import React, { useState } from 'react';
import { MenuItem } from '../../types/menu';
import { formatMoney, toMoneyMinor } from '../../utils/money';
import { useRestaurant } from '../../context/RestaurantContext';
import { getItemFallbackVisual } from '../../utils/visualCategory';
import { Plus, Minus, Star, Ban } from 'lucide-react';

interface MenuGridProps {
  items: MenuItem[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onAddToCart: (item: MenuItem) => void;
  cartItemQuantityMap?: Record<string, number>;
  onUpdateQuantityByItemId?: (itemId: string, delta: number) => void;
}

interface MenuItemCardProps {
  item: MenuItem;
  symbol: string;
  quantityInCart: number;
  onAddToCart: (item: MenuItem) => void;
  onUpdateQuantity?: (itemId: string, delta: number) => void;
}

const MenuItemCard: React.FC<MenuItemCardProps> = React.memo(({
  item,
  symbol,
  quantityInCart,
  onAddToCart,
  onUpdateQuantity
}) => {
  const [imgError, setImgError] = useState(false);
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
      className={`group relative bg-white rounded-2xl border transition-all duration-150 flex flex-col justify-between overflow-hidden select-none active:scale-[0.98] ${
        item.isAvailable
          ? quantityInCart > 0
            ? 'border-indigo-400 ring-2 ring-indigo-500/20 shadow-xs cursor-pointer'
            : 'border-slate-200 hover:border-indigo-300 hover:shadow-xs cursor-pointer'
          : 'border-slate-200/60 bg-slate-50/70 opacity-60 cursor-not-allowed'
      }`}
    >
      {/* 1. Food Image Header with Veg/Non-Veg Badge and Popular Star */}
      <div className="relative w-full aspect-4/3 sm:aspect-square max-h-24 sm:max-h-28 bg-slate-100 overflow-hidden shrink-0">
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
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-2xs flex items-center justify-center text-white font-bold text-[11px] gap-1">
            <Ban className="w-3 h-3 text-rose-400" />
            <span>Sold Out</span>
          </div>
        )}
      </div>

      {/* 2. Card Content: Title, Price, and Stepper/Add Button */}
      <div className="p-2 flex-1 flex flex-col justify-between gap-1.5">
        <div className="min-w-0">
          <h4 className="text-xs sm:text-[13px] font-bold text-slate-900 leading-snug truncate" title={item.name}>
            {item.name}
          </h4>
          <span className="text-xs font-black text-slate-900 block mt-0.5">
            {formattedPrice}
          </span>
        </div>

        {/* Bottom Action: Prominent '+ Add' or Stepper '[ - ] 1 [ + ]' */}
        <div className="pt-0.5">
          {quantityInCart > 0 && onUpdateQuantity ? (
            <div
              className="flex items-center justify-between bg-slate-50 border border-indigo-200 rounded-xl p-0.5 shadow-2xs"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                aria-label={`Decrease ${item.name} quantity`}
                onClick={handleDecrement}
                className="w-7 h-7 rounded-lg flex items-center justify-center bg-slate-200 hover:bg-slate-300 text-slate-800 font-black active:scale-90 transition-transform"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="w-5 text-center font-black text-xs text-slate-900">
                {quantityInCart}
              </span>
              <button
                type="button"
                aria-label={`Increase ${item.name} quantity`}
                onClick={handleIncrement}
                className="w-7 h-7 rounded-lg flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white font-black active:scale-90 transition-transform shadow-xs"
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
              className={`w-full py-1.5 px-2 rounded-xl text-xs font-black flex items-center justify-center gap-1 transition-all active:scale-95 min-h-[30px] ${
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
  onUpdateQuantityByItemId
}) => {
  const { restaurant } = useRestaurant();
  const symbol = restaurant?.currencySymbol || '₹';

  if (loading) {
    return (
      <div className="p-2.5 sm:p-3 grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5 gap-2 sm:gap-2.5">
        {Array.from({ length: 9 }).map((_, idx) => (
          <div
            key={idx}
            className="bg-white rounded-2xl p-2 border border-slate-200 animate-pulse space-y-2"
          >
            <div className="w-full h-20 sm:h-24 bg-slate-100 rounded-xl" />
            <div className="h-3.5 bg-slate-100 rounded w-3/4" />
            <div className="h-3.5 bg-slate-100 rounded w-1/3" />
            <div className="h-7 bg-slate-100 rounded-xl w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center flex flex-col items-center justify-center space-y-3">
        <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-200">
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
        <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">
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
    <div className="p-2 sm:p-3 grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5 gap-2 sm:gap-2.5">
      {items.map((item) => (
        <MenuItemCard
          key={item.itemId}
          item={item}
          symbol={symbol}
          quantityInCart={cartItemQuantityMap[item.itemId] || 0}
          onAddToCart={onAddToCart}
          onUpdateQuantity={onUpdateQuantityByItemId}
        />
      ))}
    </div>
  );
});

MenuGrid.displayName = 'MenuGrid';
