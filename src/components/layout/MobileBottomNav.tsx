import React from 'react';
import {
  Store,
  Layers,
  CookingPot,
  Receipt,
  CreditCard,
  MoreHorizontal
} from 'lucide-react';
import { AdminView } from './Sidebar';
import { useAuth } from '../../context/AuthContext';
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
  const userRole = profile?.role || 'owner';

  const operationalNav: { id: AdminView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'pos', label: 'POS', icon: Store },
    { id: 'captain', label: 'Tables', icon: Layers },
    { id: 'kitchen', label: 'Kitchen', icon: CookingPot },
    { id: 'orders', label: 'Orders', icon: Receipt },
    { id: 'payments', label: 'Payments', icon: CreditCard }
  ];

  // Filter based on RBAC permissions
  const allowedNav = operationalNav.filter((item) => isViewAllowed(userRole, item.id));

  return (
    <nav
      id="mobile-bottom-navigation"
      aria-label="Mobile Navigation"
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 text-slate-600 pb-safe shadow-lg transition-transform duration-200 select-none"
    >
      <div className="flex items-center justify-around h-16 px-1 max-w-lg mx-auto">
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
              className={`flex-1 flex flex-col items-center justify-center h-full min-h-[44px] relative py-1 rounded-xl transition-all duration-150 active:scale-95 ${
                isActive
                  ? 'text-indigo-600 font-bold'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <div className="relative">
                <Icon
                  className={`w-5 h-5 transition-transform ${
                    isActive ? 'scale-110 text-indigo-600' : 'text-slate-500'
                  }`}
                />
                {isPaymentTab && dueOrdersCount > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 px-1 py-0.2 bg-rose-500 text-white font-extrabold text-[9px] rounded-full min-w-[14px] text-center shadow-xs animate-pulse">
                    {dueOrdersCount > 99 ? '99+' : dueOrdersCount}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] mt-1 tracking-tight leading-none ${
                  isActive ? 'text-indigo-600 font-bold' : 'text-slate-500'
                }`}
              >
                {item.label}
              </span>
              {isActive && (
                <span className="absolute bottom-1 w-6 h-0.5 bg-indigo-600 rounded-full" />
              )}
            </button>
          );
        })}

        {/* 'More' Drawer Action */}
        <button
          id="mobile-nav-more-btn"
          type="button"
          onClick={onOpenMoreMenu}
          className="flex-1 flex flex-col items-center justify-center h-full min-h-[44px] py-1 text-slate-500 hover:text-slate-800 rounded-xl transition-all duration-150 active:scale-95"
        >
          <MoreHorizontal className="w-5 h-5 text-slate-500" />
          <span className="text-[10px] mt-1 tracking-tight leading-none text-slate-500 font-medium">
            More
          </span>
        </button>
      </div>
    </nav>
  );
};
