import React, { useState, useRef, useEffect } from 'react';
import {
  Menu as MenuIcon,
  LogOut,
  User,
  Store,
  ChevronDown,
  ShieldCheck,
  Percent,
  Sparkles,
  Mic
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useRestaurant } from '../../context/RestaurantContext';
import { OfflineSyncIndicator } from '../OfflineSyncIndicator';
import {
  getVoiceAssistantSettings,
  toggleVoiceAssistant,
  VOICE_ASSISTANT_TOGGLE_EVENT
} from '../../services/voice/voiceSettings';

interface HeaderProps {
  onOpenMobileMenu: () => void;
  onNavigateToSetup: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenMobileMenu,
  onNavigateToSetup
}) => {
  const { user, profile, logout } = useAuth();
  const { restaurant, availableRestaurants, switchRestaurant, isSwitching } = useRestaurant();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isOutletOpen, setIsOutletOpen] = useState(false);
  const [isAssistantEnabled, setIsAssistantEnabled] = useState(() => {
    const s = getVoiceAssistantSettings();
    return s.enabled && !s.completelyHidden;
  });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const outletRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleToggle = (e: Event) => {
      const custom = e as CustomEvent<{ enabled?: boolean; completelyHidden?: boolean }>;
      if (custom.detail?.enabled !== undefined && custom.detail?.completelyHidden !== undefined) {
        setIsAssistantEnabled(custom.detail.enabled && !custom.detail.completelyHidden);
      } else {
        const s = getVoiceAssistantSettings();
        setIsAssistantEnabled(s.enabled && !s.completelyHidden);
      }
    };
    window.addEventListener(VOICE_ASSISTANT_TOGGLE_EVENT, handleToggle);
    return () => window.removeEventListener(VOICE_ASSISTANT_TOGGLE_EVENT, handleToggle);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsProfileOpen(false);
      }
      if (outletRef.current && !outletRef.current.contains(e.target as Node)) {
        setIsOutletOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  return (
    <header className="sticky top-0 z-30 h-14 sm:h-16 lg:h-18 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-3 sm:px-6 lg:px-8 flex items-center justify-between">
      {/* Left section */}
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          onClick={onOpenMobileMenu}
          aria-label="Open Navigation Menu"
          className="lg:hidden p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus:outline-none active:scale-95"
        >
          <MenuIcon className="w-5 h-5" />
        </button>

        <div className="relative" ref={outletRef}>
          <button
            onClick={() => {
              if (availableRestaurants.length > 1) {
                setIsOutletOpen(!isOutletOpen);
              }
            }}
            disabled={isSwitching}
            className={`flex items-center gap-2 p-1 px-2 -ml-1 rounded-xl transition-all duration-150 text-left focus:outline-none min-h-[44px] ${
              availableRestaurants.length > 1 ? 'hover:bg-slate-100 cursor-pointer' : 'cursor-default'
            }`}
          >
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 font-bold overflow-hidden shadow-xs shrink-0">
              {restaurant?.logoUrl ? (
                <img
                  src={restaurant.logoUrl}
                  alt={restaurant.name}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <Store className="w-4 h-4 text-slate-500" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-1">
                <h1 className="text-xs sm:text-base font-bold text-slate-900 leading-none truncate max-w-[130px] sm:max-w-xs">
                  {restaurant?.name || 'RestaurantOS'}
                </h1>
                {availableRestaurants.length > 1 && (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
              </div>
              <p className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 truncate hidden sm:block">
                {restaurant?.city ? `${restaurant.city}, ${restaurant.country}` : 'Web Admin Dashboard'}
              </p>
            </div>
          </button>

          {/* Outlets Dropdown */}
          {isOutletOpen && availableRestaurants.length > 1 && (
            <div className="absolute left-0 mt-2 w-72 rounded-2xl bg-white shadow-xl border border-slate-250 py-2 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="px-4 py-2 border-b border-slate-100 pb-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Select Restaurant Outlet
                </p>
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {availableRestaurants.map((res) => {
                  const isActive = res.restaurantId === restaurant?.restaurantId;
                  const isOwner = res.ownerId === user?.uid;
                  return (
                    <button
                      key={res.restaurantId}
                      onClick={async () => {
                        if (isActive) return;
                        setIsOutletOpen(false);
                        try {
                          await switchRestaurant(res.restaurantId);
                        } catch (err: any) {
                          alert(`Error switching restaurant: ${err.message || err}`);
                        }
                      }}
                      className={`w-full px-4 py-2 text-left transition-colors flex items-center justify-between group ${
                        isActive
                          ? 'bg-indigo-50 text-indigo-900 font-semibold'
                          : 'hover:bg-slate-50 text-slate-700 hover:text-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                          isActive ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'
                        }`}>
                          {res.logoUrl ? (
                            <img src={res.logoUrl} alt={res.name} className="w-full h-full object-cover rounded-lg" referrerPolicy="no-referrer" />
                          ) : (
                            <Store className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate">{res.name}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5 truncate">
                            {isOwner ? 'Owner' : 'Staff'} • {res.city || 'Outlet'}
                          </p>
                        </div>
                      </div>
                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right section: System Status & User Profile */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Offline / Sync Queue Status Indicator */}
        <OfflineSyncIndicator />

        {/* Voice Assistant Header Status / Toggle Button */}
        <button
          type="button"
          onClick={() => {
            const next = toggleVoiceAssistant();
            setIsAssistantEnabled(next);
          }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 border ${
            isAssistantEnabled
              ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200/80 shadow-2xs'
              : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'
          }`}
          title={isAssistantEnabled ? 'Voice Assistant is Visible (Click to Fully Close/Hide)' : 'Voice Assistant is Closed (Click to Open)'}
          aria-label={isAssistantEnabled ? 'Hide Voice Assistant' : 'Show Voice Assistant'}
        >
          <Sparkles className={`w-3.5 h-3.5 ${isAssistantEnabled ? 'text-amber-500 animate-pulse' : 'text-slate-400'}`} />
          <span className="hidden sm:inline">
            {isAssistantEnabled ? 'Assistant ON' : 'Assistant OFF'}
          </span>
        </button>

        {/* Tax Mode Chip */}
        <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100/90 text-xs font-semibold text-slate-700 border border-slate-200">
          <Percent className="w-3.5 h-3.5 text-indigo-600" />
          <span>GST: {restaurant?.defaultTaxRate ?? 5}%</span>
          <span className="text-[10px] text-slate-400 font-normal capitalize">
            ({restaurant?.taxMode || 'exclusive'})
          </span>
        </div>

        {/* User Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsProfileOpen(!isProfileOpen)}
            className="flex items-center gap-2.5 p-1.5 pl-2 rounded-xl hover:bg-slate-100 transition-colors duration-150 focus:outline-none"
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-indigo-700 text-white font-bold flex items-center justify-center text-xs shadow-xs">
              {profile?.displayName ? profile.displayName.charAt(0).toUpperCase() : 'A'}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-xs font-bold text-slate-800 leading-tight truncate max-w-[120px]">
                {profile?.displayName || 'Admin'}
              </p>
              <p className="text-[10px] text-slate-500 leading-none truncate max-w-[120px]">
                Owner
              </p>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400" />
          </button>

          {/* Profile Dropdown Menu */}
          {isProfileOpen && (
            <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white shadow-xl border border-slate-100 py-2 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="text-xs font-bold text-slate-900">{profile?.displayName || 'Administrator'}</p>
                <p className="text-xs text-slate-500 truncate mt-0.5">{user?.email}</p>
                <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                  <ShieldCheck className="w-3 h-3" />
                  Primary Owner Access
                </div>
              </div>

              <div className="py-1">
                <button
                  onClick={() => {
                    setIsProfileOpen(false);
                    onNavigateToSetup();
                  }}
                  className="w-full px-4 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5"
                >
                  <Store className="w-4 h-4 text-slate-400" />
                  Restaurant Profile & GST
                </button>
              </div>

              <div className="pt-1 border-t border-slate-100">
                <button
                  onClick={() => {
                    setIsProfileOpen(false);
                    handleLogout();
                  }}
                  className="w-full px-4 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 flex items-center gap-2.5"
                >
                  <LogOut className="w-4 h-4 text-rose-500" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
