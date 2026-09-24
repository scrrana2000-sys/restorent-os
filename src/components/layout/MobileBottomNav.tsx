import React from 'react';
import {
  Store,
  Layers,
  CookingPot,
  Receipt,
  CreditCard,
  Boxes,
  MoreHorizontal
} from 'lucide-react';
import { AdminView } from './Sidebar';
import { useAuth } from '../../context/AuthContext';
import { useRestaurant } from '../../context/RestaurantContext';
import { getRestaurantOperatingProfile } from '../../config/restaurantOperatingModes';
import { isViewAllowed } from '../../utils/permissions';

interface MobileBottomNavProps {
  currentView: AdminView;
  onNavigate: (view: AdminView) => void;
  onOpenMoreMenu: () => void;
  dueOrdersCount?: number;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentView,
  onNavigate,
  onOpenMoreMenu,
  dueOrdersCount = 0
}) => {
  const { profile } = useAuth();
  const { operatingProfile, restaurant } = useRestaurant();
  const resolvedProfile = operatingProfile || getRestaurantOperatingProfile(restaurant);
  const userRole = profile?.role || 'owner';

  const operationalNavCandidates: { id: AdminView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'pos', label: 'POS', icon: Store },
    { id: 'captain', label: 'Tables', icon: Layers },
    { id: 'kitchen', label: 'Kitchen', icon: CookingPot },
    { id: 'orders', label: 'Orders', icon: Receipt },
    { id: 'payments', label: 'Payments', icon: CreditCard },
    { id: 'inventory', label: 'Stock', icon: Boxes }
  ];

  const isViewOperationallyAllowed = (viewId: AdminView): boolean => {
    const nav = resolvedProfile?.navigation;
    if (!nav) return true;
    switch (viewId) {
      case 'pos':
        return nav.isPosVisible;
      case 'captain':
        return nav.isCaptainVisible;
      case 'kitchen':
        return nav.isKitchenVisible;
      case 'orders':
        return nav.isOrdersVisible;
      case 'payments':
        return nav.isPaymentsVisible;
      case 'inventory':
        return nav.isInventoryVisible;
      default:
        return true;
    }
  };

  // Filter based on operating capabilities AND RBAC permissions (max 4 primary tabs + More)
  const allowedNav = operationalNavCandidates
    .filter((item) => isViewOperationallyAllowed(item.id) && isViewAllowed(userRole, item.id))
    .slice(0, 4);

  const isDark = currentView === 'subscription';

  return (
    <nav
      id="mobile-bottom-navigation"
      aria-label="Mobile Navigation"
      className={`lg:hidden fixed bottom-0 left-0 right-0 z-30 backdrop-blur-md border-t pb-safe shadow-lg select-none transition-all duration-200 ${
        isDark
          ? 'bg-slate-900/95 border-slate-800 text-slate-400'
          : 'bg-white/95 border-slate-200 text-slate-600'
      }`}
    >
      <div className="flex items-center justify-around w-full max-w-none min-w-0 h-13 sm:h-14 pt-1 px-1 mx-0">
        {allowedNav.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          const isPaymentTab = item.id === 'payments';

          return (
            <button
              key={item.id}
              id={`mobile-nav-${item.id}-btn`}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`flex-1 min-w-0 flex flex-col items-center justify-center min-h-[44px] relative py-1 px-0.5 rounded-lg transition-all duration-150 active:scale-95 ${
                isActive
                  ? isDark
                    ? 'text-indigo-400 font-bold bg-indigo-500/10'
                    : 'text-indigo-600 font-bold bg-indigo-50/40'
                  : isDark
                  ? 'text-slate-400 hover:text-slate-200'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <div className="relative flex items-center justify-center w-5 h-5 shrink-0">
                <Icon
                  className={`w-5 h-5 transition-transform duration-150 ${
                    isActive
                      ? isDark
                        ? 'scale-105 text-indigo-400'
                        : 'scale-105 text-indigo-600'
                      : isDark
                      ? 'text-slate-400'
                      : 'text-slate-500'
                  }`}
                />
                {isPaymentTab && dueOrdersCount > 0 && (
                  <span className="absolute -top-1 -right-2 px-1 py-0 bg-rose-500 text-white font-extrabold text-[8.5px] rounded-full min-w-[14px] h-3.5 flex items-center justify-center text-center shadow-xs animate-pulse leading-none">
                    {dueOrdersCount > 99 ? '99+' : dueOrdersCount}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] sm:text-[10.5px] mt-0.5 tracking-tight leading-none text-center truncate max-w-full ${
                  isActive
                    ? isDark
                      ? 'text-indigo-400 font-bold'
                      : 'text-indigo-600 font-bold'
                    : isDark
                    ? 'text-slate-400 font-medium'
                    : 'text-slate-500 font-medium'
                }`}
              >
                {item.label}
              </span>
              {isActive && (
                <span className={`absolute bottom-0.5 w-5 h-0.5 rounded-full ${isDark ? 'bg-indigo-400' : 'bg-indigo-600'}`} />
              )}
            </button>
          );
        })}

        {/* 'More' Drawer Action */}
        <button
          id="mobile-nav-more-btn"
          type="button"
          onClick={onOpenMoreMenu}
          className={`flex-1 flex flex-col items-center justify-center h-full min-h-[44px] py-1 px-0.5 rounded-lg transition-all duration-150 active:scale-95 relative ${
            isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <div className="relative flex items-center justify-center w-5 h-5 shrink-0">
            <MoreHorizontal className={`w-5 h-5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
          </div>
          <span className={`text-[10px] sm:text-[10.5px] mt-0.5 tracking-tight leading-none font-medium text-center truncate max-w-full ${
            isDark ? 'text-slate-400' : 'text-slate-500'
          }`}>
            More
          </span>
        </button>
      </div>
    </nav>
  );
};
