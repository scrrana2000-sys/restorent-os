import React, { useState, useRef, useEffect } from 'react';
import {
  Utensils, ShoppingBag, Bike, PauseCircle, Receipt, DollarSign, Globe2,
  Menu, ShoppingCart, ChevronDown, X, Users, Sparkles, LogOut, ShieldCheck, Wifi, Search, Mic } from 'lucide-react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { OfflineSyncIndicator } from '../OfflineSyncIndicator';
import { OrderType } from '../../types/order';
import { Table, TableSession } from '../../types/table';

interface PosHeaderProps {
  orderType: OrderType;
  onOrderTypeChange: (type: OrderType) => void;
  selectedTable: Table | null;
  activeSession: TableSession | null;
  onOpenTableModal: () => void;
  onClearTable?: () => void;
  showTableSelector?: boolean;
  allowedOrderTypes?: OrderType[];
  heldOrdersCount: number;
  onOpenHeldOrders: () => void;
  onOpenRecentOrders: () => void;
  paymentDueCount?: number;
  totalPaymentDueMinor?: number;
  onOpenPaymentDue?: () => void;
  onlineOrderCount?: number;
  onOpenOnlineOrders?: () => void;
  onlineOrderingLive?: boolean;
  onOpenLiveOperations?: () => void;
  onOpenPosItemAvailability?: () => void;
  cartItemsCount?: number;
  onOpenCart?: () => void;
  onOpenMobileMenu?: () => void;
  onOpenVoiceModal?: () => void;
  isVoiceListening?: boolean;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

export const PosHeader: React.FC<PosHeaderProps> = ({
  orderType, onOrderTypeChange, selectedTable, activeSession, onOpenTableModal,
  onClearTable, showTableSelector = true, allowedOrderTypes = ['dineIn', 'takeaway', 'delivery'],
  heldOrdersCount, onOpenHeldOrders, onOpenRecentOrders, paymentDueCount = 0,
  totalPaymentDueMinor = 0, onOpenPaymentDue, onlineOrderCount = 0, onOpenOnlineOrders,
  onlineOrderingLive = false, onOpenLiveOperations, onOpenPosItemAvailability, cartItemsCount = 0, onOpenCart,
  onOpenMobileMenu, onOpenVoiceModal, isVoiceListening = false, searchQuery = '', onSearchChange
}) => {
  const { restaurant } = useRestaurant();
  const { profile, user, logout } = useAuth();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsProfileOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const userInitial = (profile?.displayName || user?.displayName || user?.email || 'A').charAt(0).toUpperCase();
  const restaurantName = restaurant?.name || "Harisha's Restaurant";
  const branchSubtitle = restaurant?.address || restaurant?.city || 'Main Branch • Raichur';

  return (
    <div className="sticky top-0 z-20 w-full max-w-full min-w-0 overflow-x-hidden bg-white border-b border-slate-200 text-slate-800 px-3 sm:px-4 py-2.5 sm:py-3 shadow-xs shrink-0 select-none space-y-2.5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {(onOpenMobileMenu || (window as any).openAdminMobileMenu) && (
            <button type="button" id="pos-mobile-menu-btn" onClick={onOpenMobileMenu || (window as any).openAdminMobileMenu}
              className="lg:hidden p-1.5 -ml-1 text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg active:scale-95 transition-colors" aria-label="Open menu">
              <Menu className="w-5 h-5" />
            </button>
          )}
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-800 font-bold text-xs shrink-0 overflow-hidden shadow-2xs">
            {restaurant?.logoUrl ? <img src={restaurant.logoUrl} alt={restaurantName} className="w-full h-full object-cover rounded-xl" referrerPolicy="no-referrer" /> : <span className="text-base">👨‍🍳</span>}
          </div>
          <div className="min-w-0">
            <h1 className="text-xs sm:text-sm font-bold text-slate-900 tracking-tight leading-tight truncate">{restaurantName}</h1>
            <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-slate-500 font-medium truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" /><span className="truncate">{branchSubtitle}</span>
            </div>
          </div>
          {onSearchChange && (
            <div className="relative shrink-0">
              <button
                id="pos-header-search-btn"
                type="button"
                onClick={() => setIsSearchOpen((open) => !open)}
                className={`w-9 h-9 rounded-lg border flex items-center justify-center active:scale-95 transition-all ${isSearchOpen || searchQuery ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-slate-100 border-slate-200 text-slate-600'}`}
                title="Search menu"
                aria-label="Search menu"
              >
                <Search className="w-4 h-4" />
              </button>
              {isSearchOpen && (
                <div className="absolute left-0 top-10 z-40 flex items-center gap-1.5 w-[min(250px,calc(100vw-32px))] p-1.5 bg-white border border-slate-200 rounded-lg shadow-lg">
                  <Search className="w-4 h-4 text-slate-400 shrink-0 ml-1" />
                  <input autoFocus type="text" value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search food..." className="flex-1 min-w-0 h-8 px-1.5 text-xs bg-transparent focus:outline-none text-slate-800 placeholder-slate-400" />
                  {searchQuery && <button type="button" onClick={() => onSearchChange('')} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:bg-slate-100" aria-label="Clear search"><X className="w-3.5 h-3.5" /></button>}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="w-full sm:w-auto min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
          <OfflineSyncIndicator />
          {onOpenLiveOperations && (
            <button id="live-operations-header-btn" type="button"
              onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpenLiveOperations(); }}
              className={`flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-black active:scale-95 transition-all ${onlineOrderingLive ? 'bg-emerald-50 border border-emerald-300 text-emerald-900 hover:bg-emerald-100' : 'bg-rose-50 border border-rose-200 text-rose-800 hover:bg-rose-100'}`}
              title="Live Restaurant Operations">
              <span className={`w-2 h-2 rounded-full ${onlineOrderingLive ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
              <span className="hidden sm:inline">Live Ops</span>
            </button>
          )}
          {onOpenPosItemAvailability && (
            <button id="pos-item-availability-header-btn" type="button"
              onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpenPosItemAvailability(); }}
              className="flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-black bg-indigo-50 border border-indigo-200 text-indigo-800 hover:bg-indigo-100 active:scale-95 transition-all"
              title="POS Item Availability — turn menu items ON/OFF">
              <span className="w-2 h-2 rounded-full bg-indigo-500" />
              <span className="hidden sm:inline">Items</span>
            </button>
          )}
          {onOpenOnlineOrders && (
            <button id="online-orders-header-btn" type="button" onClick={onOpenOnlineOrders}
              className={`flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-bold active:scale-95 transition-all ${onlineOrderCount > 0 ? 'bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-900 shadow-2xs' : 'bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700'}`} title="Online Orders">
              <Globe2 className={`w-3.5 h-3.5 shrink-0 ${onlineOrderCount > 0 ? 'text-emerald-700' : 'text-slate-500'}`} />
              <span className="hidden sm:inline">Online</span>
              {onlineOrderCount > 0 && <span className="px-1 py-0.2 min-w-[18px] text-[10px] font-black rounded-full bg-emerald-600 text-white text-center">{onlineOrderCount}</span>}
            </button>
          )}
          {onOpenPaymentDue && paymentDueCount > 0 && (
            <button id="payment-due-header-btn" type="button" onClick={onOpenPaymentDue}
              className="flex items-center gap-1 h-8 px-2.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 text-xs font-bold active:scale-95 transition-all shadow-2xs" title="Payment Due Collection Center">
              <DollarSign className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span className="px-1 py-0.2 min-w-[18px] text-[10px] font-black rounded-full bg-amber-500 text-slate-950 text-center">{paymentDueCount}</span>
              <span className="hidden sm:inline text-[10px] font-black font-mono">{totalPaymentDueMinor > 0 ? `₹${(totalPaymentDueMinor / 100).toFixed(0)} due` : 'Due'}</span>
            </button>
          )}
          {heldOrdersCount > 0 && (
            <button type="button" onClick={onOpenHeldOrders} className="flex items-center gap-1 h-8 px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 text-xs font-bold active:scale-95 transition-all" title="Held Orders">
              <PauseCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" /><span className="px-1 py-0.2 text-[10px] bg-amber-500 text-slate-950 font-black rounded-full">{heldOrdersCount}</span>
            </button>
          )}
          {onOpenVoiceModal && (
            <button id="pos-header-voice-btn" type="button" onClick={onOpenVoiceModal}
              className={`w-9 h-9 rounded-lg border flex items-center justify-center active:scale-95 transition-all ${isVoiceListening ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-indigo-50 border-indigo-200 text-indigo-700'}`}
              title="Voice order" aria-label="Voice order"><Mic className="w-4 h-4" /></button>
          )}
          <button type="button" onClick={onOpenRecentOrders} className="hidden sm:flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-600 text-xs active:scale-95 transition-all" title="Recent Orders / Bill">
            <Receipt className="w-4 h-4 text-indigo-600" />
          </button>
          <div className="relative" ref={dropdownRef}>
            <button id="pos-header-user-profile-btn" type="button" onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="flex items-center gap-1 pl-0.5 p-1 rounded-lg hover:bg-slate-100 transition-colors focus:outline-none min-h-[36px]" title="User Account & Settings">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white font-black text-xs flex items-center justify-center shadow-xs">{userInitial}</div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden sm:inline" />
            </button>
            {isProfileOpen && (
              <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white shadow-xl border border-slate-200 py-2 z-50 animate-in fade-in slide-in-from-top-1 duration-150 text-left">
                <div className="px-4 py-3 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-900">{profile?.displayName || user?.displayName || 'Administrator'}</p>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{user?.email}</p>
                  <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md"><ShieldCheck className="w-3 h-3" />Primary Owner Access</div>
                </div>
                <div className="pt-1 border-t border-slate-100">
                  <button id="pos-header-logout-btn" type="button" onClick={async () => { setIsProfileOpen(false); try { await logout(); } catch (err) { console.error('POS Header Logout error:', err); } }}
                    className="w-full px-4 py-2.5 text-left text-xs font-bold text-rose-600 hover:bg-rose-50 flex items-center gap-2.5 transition-colors min-h-[44px]">
                    <LogOut className="w-4 h-4 text-rose-500 shrink-0" /><span>Sign Out / Logout</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          {onOpenCart && (
            <button id="pos-mobile-cart-btn" type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenCart(); }}
              className={`lg:hidden flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-bold active:scale-95 transition-all ${cartItemsCount > 0 ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600 border border-slate-200'}`} title="View Cart">
              <ShoppingCart className="w-3.5 h-3.5" /><span>{cartItemsCount}</span>
            </button>
          )}
        </div>
      </div>

      <div className={`grid gap-2 min-w-0 w-full ${allowedOrderTypes.length === 1 ? 'grid-cols-1' : allowedOrderTypes.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {allowedOrderTypes.includes('dineIn') && (
          <button id="order-type-dinein-btn" type="button" onClick={() => onOrderTypeChange('dineIn')}
            className={`h-10 px-2 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-95 ${orderType === 'dineIn' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-100/80 hover:bg-slate-200/70 border border-slate-200/80 text-slate-700'}`}>
            <Utensils className={`w-4 h-4 shrink-0 ${orderType === 'dineIn' ? 'text-white' : 'text-indigo-600'}`} /><span>Dine-In</span>
          </button>
        )}
        {allowedOrderTypes.includes('takeaway') && (
          <button id="order-type-takeaway-btn" type="button" onClick={() => onOrderTypeChange('takeaway')}
            className={`h-10 px-2 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-95 ${orderType === 'takeaway' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-100/80 hover:bg-slate-200/70 border border-slate-200/80 text-slate-700'}`}>
            <ShoppingBag className={`w-4 h-4 shrink-0 ${orderType === 'takeaway' ? 'text-white' : 'text-slate-700'}`} /><span>Parcel</span>
          </button>
        )}
        {allowedOrderTypes.includes('delivery') && (
          <button id="order-type-delivery-btn" type="button" onClick={() => onOrderTypeChange('delivery')}
            className={`h-10 px-2 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all duration-150 active:scale-95 ${orderType === 'delivery' ? 'bg-indigo-600 text-white shadow-xs' : 'bg-slate-100/80 hover:bg-slate-200/70 border border-slate-200/80 text-slate-700'}`}>
            <Bike className={`w-4 h-4 shrink-0 ${orderType === 'delivery' ? 'text-white' : 'text-slate-700'}`} /><span>Delivery</span>
          </button>
        )}
      </div>

      {showTableSelector && orderType === 'dineIn' && (
        <div className="flex items-center gap-2 pt-0.5 min-w-0 w-full">
          <button id="pos-select-table-btn" type="button" onClick={onOpenTableModal}
            className={`flex-1 h-10 px-3 rounded-xl border text-xs sm:text-sm font-bold flex items-center justify-between transition-all active:scale-[0.99] ${selectedTable ? 'bg-white border-slate-200 text-slate-900 shadow-2xs hover:border-indigo-400' : 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100 animate-pulse'}`}>
            <div className="flex items-center gap-2"><span className="text-base leading-none">🪑</span><span className="font-bold text-slate-900">{selectedTable ? `Table ${selectedTable.tableNumber}` : 'Select Table'}</span></div>
            <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
          </button>
          <div className="h-10 px-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-xs sm:text-sm font-bold flex items-center gap-1.5 shrink-0 shadow-2xs">
            <Users className="w-4 h-4 text-slate-500 shrink-0" /><span>{selectedTable?.capacity ? `${selectedTable.capacity} Guests` : '2 Guests'}</span>
          </div>
          {selectedTable && onClearTable && (
            <button type="button" onClick={onClearTable} className="h-10 px-2.5 rounded-xl bg-white border border-slate-200 hover:border-rose-300 hover:bg-rose-50 text-slate-600 hover:text-rose-600 text-xs font-bold flex items-center gap-1 shrink-0 shadow-2xs transition-colors active:scale-95" title="Clear table selection">
              <X className="w-4 h-4 shrink-0" /><span className="hidden xs:inline">Clear</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
