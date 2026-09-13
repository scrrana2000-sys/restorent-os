import React from 'react';
import {
  Utensils,
  ShoppingBag,
  Bike,
  PauseCircle,
  Receipt,
  DollarSign,
  Menu,
  ShoppingCart,
  ChevronDown,
  X,
  Users,
  Wifi,
  Sparkles
} from 'lucide-react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { OfflineSyncIndicator } from '../OfflineSyncIndicator';
import { OrderType } from '../../types/order';
import { Table, TableSession } from '../../types/table';
import { VoiceOrderButton } from '../voice/VoiceOrderButton';

interface PosHeaderProps {
  orderType: OrderType;
  onOrderTypeChange: (type: OrderType) => void;
  selectedTable: Table | null;
  activeSession: TableSession | null;
  onOpenTableModal: () => void;
  onClearTable?: () => void;
  heldOrdersCount: number;
  onOpenHeldOrders: () => void;
  onOpenRecentOrders: () => void;
  paymentDueCount?: number;
  totalPaymentDueMinor?: number;
  onOpenPaymentDue?: () => void;
  cartItemsCount?: number;
  onOpenCart?: () => void;
  onOpenMobileMenu?: () => void;
  onOpenVoiceModal?: () => void;
  isVoiceListening?: boolean;
}

export const PosHeader: React.FC<PosHeaderProps> = ({
  orderType,
  onOrderTypeChange,
  selectedTable,
  activeSession,
  onOpenTableModal,
  onClearTable,
  heldOrdersCount,
  onOpenHeldOrders,
  onOpenRecentOrders,
  paymentDueCount = 0,
  totalPaymentDueMinor = 0,
  onOpenPaymentDue,
  cartItemsCount = 0,
  onOpenCart,
  onOpenMobileMenu,
  onOpenVoiceModal,
  isVoiceListening = false
}) => {
  const { restaurant } = useRestaurant();
  const { profile, user } = useAuth();

  const userInitial = (profile?.displayName || user?.displayName || user?.email || 'A')
    .charAt(0)
    .toUpperCase();

  const restaurantName = restaurant?.name || "Harisha's Restaurant";
  const branchSubtitle = restaurant?.address || restaurant?.city || 'Main Branch • Raichur';

  return (
    <div className="sticky top-0 z-20 bg-white border-b border-slate-200 text-slate-800 px-4 py-2.5 sm:py-3 shadow-xs shrink-0 select-none space-y-2.5">
      {/* 1. Top Bar: Restaurant Identity & Staff Profile */}
      <div className="flex items-center justify-between gap-2">
        {/* Left: Hamburger & Restaurant Brand */}
        <div className="flex items-center gap-2.5 min-w-0">
          {onOpenMobileMenu && (
            <button
              type="button"
              id="pos-mobile-menu-btn"
              onClick={onOpenMobileMenu}
              className="lg:hidden p-1.5 -ml-1 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg active:scale-95 transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          {/* Restaurant Logo / Avatar */}
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-800 font-bold text-xs shrink-0 overflow-hidden shadow-2xs">
            {restaurant?.logoUrl ? (
              <img
                src={restaurant.logoUrl}
                alt={restaurantName}
                className="w-full h-full object-cover rounded-xl"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="text-base">👨‍🍳</span>
            )}
          </div>

          {/* Restaurant Name & Branch Subtitle */}
          <div className="min-w-0">
            <h1 className="text-xs sm:text-sm font-bold text-slate-900 tracking-tight leading-tight truncate">
              {restaurantName}
            </h1>
            <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-slate-500 font-medium truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="truncate">{branchSubtitle}</span>
            </div>
          </div>
        </div>

        {/* Right: Connectivity status & User controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <OfflineSyncIndicator />

          {/* Payment Due Quick Center Button */}
          {onOpenPaymentDue && paymentDueCount > 0 && (
            <button
              id="payment-due-header-btn"
              type="button"
              onClick={onOpenPaymentDue}
              className="flex items-center gap-1 h-8 px-2.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-bold active:scale-95 transition-all shadow-2xs"
              title="Payment Due Collection Center"
            >
              <DollarSign className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span className="px-1 py-0.2 text-[10px] font-black rounded-full bg-amber-500 text-slate-950">
                {paymentDueCount}
              </span>
            </button>
          )}

          {/* Held Orders Badge */}
          {heldOrdersCount > 0 && (
            <button
              type="button"
              onClick={onOpenHeldOrders}
              className="flex items-center gap-1 h-8 px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 text-xs font-bold active:scale-95 transition-all"
              title="Held Orders"
            >
              <PauseCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span className="px-1 py-0.2 text-[10px] bg-amber-500 text-slate-950 font-black rounded-full">
                {heldOrdersCount}
              </span>
            </button>
          )}

          {/* Voice Ordering Trigger Button */}
          {onOpenVoiceModal && (
            <VoiceOrderButton
              onClick={onOpenVoiceModal}
              isListening={isVoiceListening}
              variant="header"
            />
          )}

          {/* Recent Orders Receipt button */}
          <button
            type="button"
            onClick={onOpenRecentOrders}
            className="hidden sm:flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-600 text-xs active:scale-95 transition-all"
            title="Recent Orders / Bill"
          >
            <Receipt className="w-4 h-4 text-indigo-600" />
          </button>

          {/* User Profile Avatar Pill */}
          <div className="flex items-center gap-1 pl-0.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white font-black text-xs flex items-center justify-center shadow-xs">
              {userInitial}
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden xs:inline" />
          </div>

          {/* Mobile Cart Direct Button */}
          {onOpenCart && (
            <button
              id="pos-mobile-cart-btn"
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenCart();
              }}
              className={`lg:hidden flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-bold active:scale-95 transition-all ${
                cartItemsCount > 0
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 border border-slate-200'
              }`}
              title="View Cart"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>{cartItemsCount}</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Quick Order Type Segmented Control (Matching Reference Image) */}
      <div className="grid grid-cols-3 gap-2">
        {/* Dine-In */}
        <button
          id="order-type-dinein-btn"
          type="button"
          onClick={() => onOrderTypeChange('dineIn')}
          className={`h-10 px-2 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-95 ${
            orderType === 'dineIn'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-slate-100/80 hover:bg-slate-200/70 border border-slate-200/80 text-slate-700'
          }`}
        >
          <Utensils className={`w-4 h-4 shrink-0 ${orderType === 'dineIn' ? 'text-white' : 'text-indigo-600'}`} />
          <span>Dine-In</span>
        </button>

        {/* Parcel */}
        <button
          id="order-type-takeaway-btn"
          type="button"
          onClick={() => onOrderTypeChange('takeaway')}
          className={`h-10 px-2 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-95 ${
            orderType === 'takeaway'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-slate-100/80 hover:bg-slate-200/70 border border-slate-200/80 text-slate-700'
          }`}
        >
          <ShoppingBag className={`w-4 h-4 shrink-0 ${orderType === 'takeaway' ? 'text-white' : 'text-slate-700'}`} />
          <span>Parcel</span>
        </button>

        {/* Delivery */}
        <button
          id="order-type-delivery-btn"
          type="button"
          onClick={() => onOrderTypeChange('delivery')}
          className={`h-10 px-2 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-95 ${
            orderType === 'delivery'
              ? 'bg-indigo-600 text-white shadow-xs'
              : 'bg-slate-100/80 hover:bg-slate-200/70 border border-slate-200/80 text-slate-700'
          }`}
        >
          <Bike className={`w-4 h-4 shrink-0 ${orderType === 'delivery' ? 'text-white' : 'text-slate-700'}`} />
          <span>Delivery</span>
        </button>
      </div>

      {/* 3. Selected Table Row (Only for Dine-In, exactly matching reference image) */}
      {orderType === 'dineIn' && (
        <div className="flex items-center gap-2 pt-0.5">
          {/* Table Selector Pill */}
          <button
            id="pos-select-table-btn"
            type="button"
            onClick={onOpenTableModal}
            className={`flex-1 h-10 px-3 rounded-xl border text-xs sm:text-sm font-bold flex items-center justify-between transition-all active:scale-[0.99] ${
              selectedTable
                ? 'bg-white border-slate-200 text-slate-900 shadow-2xs hover:border-indigo-400'
                : 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100 animate-pulse'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-base leading-none">🪑</span>
              <span className="font-bold text-slate-900">
                {selectedTable ? `Table ${selectedTable.tableNumber}` : 'Select Table'}
              </span>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
          </button>

          {/* Guests Badge */}
          <div className="h-10 px-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-xs sm:text-sm font-bold flex items-center gap-1.5 shrink-0 shadow-2xs">
            <Users className="w-4 h-4 text-slate-500 shrink-0" />
            <span>{selectedTable?.capacity ? `${selectedTable.capacity} Guests` : '2 Guests'}</span>
          </div>

          {/* Clear Table button (if table selected) */}
          {selectedTable && onClearTable && (
            <button
              type="button"
              onClick={onClearTable}
              className="h-10 px-2.5 rounded-xl bg-white border border-slate-200 hover:border-rose-300 hover:bg-rose-50 text-slate-600 hover:text-rose-600 text-xs font-bold flex items-center gap-1 shrink-0 shadow-2xs transition-colors active:scale-95"
              title="Clear table selection"
            >
              <X className="w-4 h-4 shrink-0" />
              <span className="hidden xs:inline">Clear</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
