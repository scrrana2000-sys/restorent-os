import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Store,
  FolderTree,
  UtensilsCrossed,
  Layers,
  MonitorCheck,
  CookingPot,
  Boxes,
  BarChart3,
  Settings,
  Sparkles,
  ShieldCheck,
  Receipt,
  CreditCard,
  Users,
  UserCheck,
  X,
  ChevronDown,
  Check,
  Lock,
  Sliders
} from 'lucide-react';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { useSubscription } from '../../context/SubscriptionContext';
import { getRestaurantOperatingProfile } from '../../config/restaurantOperatingModes';
import { isViewAllowed } from '../../utils/permissions';
import { getEffectiveFeatureAccess } from '../../utils/effectiveAccessResolver';

export type AdminView = 'pos' | 'kitchen' | 'captain' | 'dashboard' | 'restaurant' | 'categories' | 'items' | 'settings' | 'reports' | 'audit' | 'orders' | 'payments' | 'staff' | 'inventory' | 'customers' | 'subscription';

interface SidebarProps {
  currentView: AdminView;
  onNavigate: (view: AdminView) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  onBackToCustomerHome?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  isOpenMobile,
  onCloseMobile,
  onBackToCustomerHome
}) => {
  const { restaurant, operatingProfile, availableRestaurants, switchRestaurant, isSwitching } = useRestaurant();
  const resolvedProfile = operatingProfile || getRestaurantOperatingProfile(restaurant);
  const { user, profile, logout } = useAuth();
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);

  let entitlements: any = null;
  try {
    const subContext = useSubscription();
    entitlements = subContext?.entitlements;
  } catch {
    // Graceful fallback if rendered outside SubscriptionProvider
  }

  // Lock body scroll when mobile drawer is open to prevent accidental background scrolling
  useEffect(() => {
    if (isOpenMobile) {
      const originalOverflow = document.body.style.overflow;
      const originalTouchAction = document.body.style.touchAction;
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
      return () => {
        document.body.style.overflow = originalOverflow;
        document.body.style.touchAction = originalTouchAction;
      };
    }
  }, [isOpenMobile]);

  const mainNavigation: { id: AdminView; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'pos', label: 'POS Terminal', icon: MonitorCheck },
    { id: 'captain', label: 'Captain / Staff', icon: Layers },
    { id: 'kitchen', label: 'Kitchen / KOT', icon: CookingPot },
    { id: 'orders', label: 'Orders & Online Queue', icon: Receipt },
    { id: 'customers', label: 'Customers & CRM', icon: UserCheck },
    { id: 'payments', label: 'Payment History', icon: CreditCard },
    { id: 'inventory', label: 'Inventory & Stock', icon: Boxes },
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'reports', label: 'Reports & Analytics', icon: BarChart3 },
    { id: 'audit', label: 'Audit Logs', icon: ShieldCheck },
    { id: 'staff', label: 'Staff & Roles', icon: Users },
    { id: 'subscription', label: 'Subscription & Plans', icon: Sparkles },
    { id: 'restaurant', label: 'Restaurant Setup', icon: Store },
    { id: 'categories', label: 'Categories', icon: FolderTree },
    { id: 'items', label: 'Menu Items', icon: UtensilsCrossed }
  ];

  const userRole = profile?.role || 'owner';

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
      case 'customers':
        return nav.isCustomersVisible !== false;
      case 'payments':
        return nav.isPaymentsVisible;
      case 'inventory':
        return nav.isInventoryVisible;
      case 'dashboard':
        return nav.isDashboardVisible;
      case 'reports':
        return nav.isReportsVisible;
      case 'audit':
        return nav.isAuditVisible;
      case 'staff':
        return nav.isStaffVisible;
      case 'restaurant':
      case 'settings':
        return nav.isRestaurantVisible;
      case 'categories':
        return nav.isCategoriesVisible;
      case 'items':
        return nav.isItemsVisible;
      default:
        return true;
    }
  };

  const allowedNavigation = mainNavigation.filter((item) => isViewAllowed(userRole, item.id));

  const futureModules: { label: string; icon: React.ComponentType<{ className?: string }>; milestone: string }[] = [];

  return (
    <>
      {/* Mobile backdrop (Layer 3: z-40, sits strictly above bottom nav z-30) */}
      {isOpenMobile && (
        <div
          id="mobile-sidebar-backdrop"
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-xs lg:hidden transition-opacity duration-200 animate-in fade-in"
          onClick={onCloseMobile}
        />
      )}

      {/* Mobile Drawer / Desktop Sidebar (Layer 4: z-50 on mobile, lg:z-30 on desktop, covers 100dvh, above backdrop & bottom nav) */}
      <aside
        id="app-sidebar-drawer"
        aria-label="Sidebar Navigation"
        className={`fixed top-0 bottom-0 left-0 z-50 lg:z-30 w-72 sm:w-80 max-w-[86vw] lg:w-64 bg-slate-900 text-white flex flex-col h-full h-[100dvh] max-h-[100dvh] shadow-2xl transition-transform duration-200 ease-out lg:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="h-16 sm:h-18 px-4 sm:px-5 border-b border-slate-800 flex items-center justify-between shrink-0 pt-safe">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-indigo-900/50">
              <UtensilsCrossed className="w-5 h-5" />
            </div>
            <div>
              <span className="text-base font-black tracking-tight font-display text-white">
                Restaurant<span className="text-indigo-400">OS</span>
              </span>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Web Admin • M1
              </p>
            </div>
          </div>
          <button
            id="close-mobile-sidebar-btn"
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation drawer"
            className="lg:hidden p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 active:scale-95 transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Restaurant Badge with Interactive Switcher */}
        <div className="px-4 pt-4 pb-2 shrink-0">
          <div className="rounded-xl bg-slate-800/80 border border-slate-700/60 p-3 transition-all duration-150">
            <div 
              onClick={() => {
                if (availableRestaurants.length > 1) {
                  setIsSwitcherOpen(!isSwitcherOpen);
                }
              }}
              className={`flex items-center justify-between ${
                availableRestaurants.length > 1 ? 'cursor-pointer group' : 'cursor-default'
              }`}
            >
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 group-hover:text-indigo-400 transition-colors">
                  {availableRestaurants.length > 1 ? 'Switch Outlet' : 'Active Outlet'}
                </p>
                <p className="text-sm font-bold text-white truncate mt-0.5 max-w-[160px]" title={restaurant?.name || 'RestaurantOS'}>
                  {restaurant?.name || 'Loading restaurant...'}
                </p>
              </div>
              {availableRestaurants.length > 1 && (
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-150 ${
                  isSwitcherOpen ? 'rotate-180 text-white' : 'group-hover:text-white'
                }`} />
              )}
            </div>

            {/* Expanded list of other outlets inside the sidebar */}
            {isSwitcherOpen && availableRestaurants.length > 1 && (
              <div className="mt-3 pt-2.5 border-t border-slate-700/50 space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {availableRestaurants.map((res) => {
                  const isActive = res.restaurantId === restaurant?.restaurantId;
                  const isOwner = res.ownerId === user?.uid;
                  return (
                    <button
                      key={res.restaurantId}
                      disabled={isSwitching}
                      onClick={async () => {
                        if (isActive) return;
                        try {
                          await switchRestaurant(res.restaurantId);
                        } catch (err: any) {
                          alert(`Error switching restaurant: ${err.message || err}`);
                        }
                      }}
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left text-xs font-semibold transition-colors ${
                        isActive
                          ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/20'
                          : 'text-slate-300 hover:bg-slate-700/60 hover:text-white'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-bold">{res.name}</p>
                        <p className="text-[9px] text-slate-400 font-medium truncate mt-0.5">
                          {isOwner ? 'Owner' : 'Staff'} • {res.city || 'Outlet'}
                        </p>
                      </div>
                      {isActive && (
                        <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-2 mt-2 pt-1">
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Live Admin
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {restaurant?.currencySymbol || '₹'} • GST: {restaurant?.defaultTaxRate || 5}%
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Sections (Scrollable independently, smooth scrolling) */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 space-y-5 no-scrollbar sm:scroll-auto">
          {/* Active Navigation */}
          <div>
            <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Core Management
            </div>
            <nav className="space-y-1">
              {allowedNavigation.map((item) => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                const access = getEffectiveFeatureAccess({
                  featureOrView: item.id,
                  entitlements,
                  operatingProfile: resolvedProfile,
                  userRole
                });

                return (
                  <button
                    key={item.id}
                    id={`sidebar-nav-${item.id}-btn`}
                    onClick={() => {
                      onNavigate(item.id);
                      onCloseMobile();
                    }}
                    className={`w-full min-h-[44px] flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/30'
                        : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                      <span className="truncate">{item.label}</span>
                    </div>

                    {access.reason === 'SUBSCRIPTION_REQUIRED' && (
                      <span
                        className="ml-2 flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0"
                        title={`Requires ${access.requiredPlan} plan`}
                      >
                        <Lock className="w-2.5 h-2.5" />
                        {access.requiredPlan}
                      </span>
                    )}

                    {access.reason === 'OPERATING_MODEL_DISABLED' && (
                      <span
                        className="ml-2 flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 border border-slate-600 shrink-0"
                        title="Turned off in Operating Model / Restaurant Setup"
                      >
                        <Sliders className="w-2.5 h-2.5 text-slate-400" />
                        Off
                      </span>
                    )}

                    {access.reason === 'EXPIRED_SUBSCRIPTION' && (
                      <span
                        className="ml-2 flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 shrink-0"
                        title="Subscription Expired"
                      >
                        <Lock className="w-2.5 h-2.5" />
                        Expired
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Planned / Future Modules */}
          {futureModules.length > 0 && (
            <div>
              <div className="px-3 pb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <span>Next Milestones</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                  Roadmap
                </span>
              </div>
              <div className="space-y-1">
                {futureModules.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.label}
                      className="flex items-center justify-between px-3 py-2 rounded-xl text-slate-500 text-sm cursor-not-allowed group hover:bg-slate-800/30 min-h-[44px]"
                      title={`Scheduled for future ${item.milestone} release`}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="w-4 h-4 text-slate-600 group-hover:text-slate-500 shrink-0" />
                        <span className="text-slate-400 text-xs font-medium">{item.label}</span>
                      </div>
                      <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 border border-slate-700/50">
                        {item.milestone}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer info (Bottom safe area aware) */}
        <div className="px-3 py-2 pb-safe border-t border-slate-800/80 text-center bg-slate-900 shrink-0">
          <div className="px-3 py-1.5 rounded-xl bg-slate-800/50 text-[10px] text-slate-400 flex items-center justify-between">
            <span className="font-mono">v0.1.0</span>
            <span className="inline-flex items-center gap-1 text-indigo-400 font-semibold">
              <Sparkles className="w-3 h-3" />
              Production Ready
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};
