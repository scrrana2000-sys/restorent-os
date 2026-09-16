import React, { useState, useEffect, useCallback } from 'react';
import { CustomerLocationProvider } from '../context/CustomerLocationContext';
import { CustomerCartProvider, useCustomerCart } from '../context/CustomerCartContext';
import { useCustomerAuth } from '../context/CustomerAuthContext';
import { CustomerRestaurantDiscoveryView } from '../components/customer/CustomerRestaurantDiscoveryView';
import { CustomerRestaurantPage } from './customer/CustomerRestaurantPage';
import { CustomerRestaurantMenuPage } from './customer/CustomerRestaurantMenuPage';
import { CustomerCartDrawer } from '../components/customer/CustomerCartDrawer';
import { CustomerProfileModal } from '../components/customer/CustomerProfileModal';
import { CustomerOrderTrackingModal } from '../components/customer/CustomerOrderTrackingModal';
import { CustomerMyOrdersModal } from '../components/customer/CustomerMyOrdersModal';
import { getActiveOrdersCount } from '../services/customerOrderTrackingService';
import { PublicRestaurantProfile } from '../types/customer';
import { UtensilsCrossed, ShoppingBag, ArrowRight, User, Compass, Menu } from 'lucide-react';
import { buildOwnerCentralUrl } from '../utils/urlUtils';
import { CustomerSidebarDrawer } from '../components/customer/CustomerSidebarDrawer';
import { CustomerLocationBar } from '../components/customer/CustomerLocationBar';

export interface PublicCustomerDiscoveryPageProps {
  onBackToApp?: () => void;
  onOpenOwnerCentral?: () => void;
  onSelectRestaurant?: (restaurant: PublicRestaurantProfile) => void;
}

/**
 * Public Customer Discovery Page (M9-D, M9-E & M9-K Customer Front Door).
 * Hosts the CustomerLocationProvider and CustomerRestaurantDiscoveryView.
 * Provides public, tenant-isolated restaurant search and filtering.
 * Transitions smoothly to CustomerRestaurantPage and CustomerRestaurantMenuPage when a restaurant is selected.
 */
const PublicCustomerDiscoveryPageContent: React.FC<PublicCustomerDiscoveryPageProps> = ({
  onBackToApp,
  onOpenOwnerCentral,
  onSelectRestaurant
}) => {
  const [selectedRestaurant, setSelectedRestaurant] = useState<PublicRestaurantProfile | null>(null);
  const [viewingMenu, setViewingMenu] = useState<boolean>(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);
  const [isMyOrdersOpen, setIsMyOrdersOpen] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isTrackingModalOpen, setIsTrackingModalOpen] = useState<boolean>(false);
  const [trackingOrderParams, setTrackingOrderParams] = useState<{ restaurantId: string; orderId: string } | null>(null);
  const [activeOrdersCount, setActiveOrdersCount] = useState<number>(0);

  const { customer, firebaseUser } = useCustomerAuth();
  const currentUid = customer?.customerId || firebaseUser?.uid || null;
  const { cart, openCartDrawer } = useCustomerCart();
  const itemCount = cart?.itemCount || 0;

  const refreshActiveOrders = useCallback(() => {
    const count = getActiveOrdersCount(currentUid);
    setActiveOrdersCount(count);
  }, [currentUid]);

  useEffect(() => {
    refreshActiveOrders();
    const handleOrderTracked = () => refreshActiveOrders();
    window.addEventListener('restaurantos_order_tracked', handleOrderTracked);
    return () => window.removeEventListener('restaurantos_order_tracked', handleOrderTracked);
  }, [refreshActiveOrders]);

  const handleSelect = (restaurant: PublicRestaurantProfile) => {
    setSelectedRestaurant(restaurant);
    setViewingMenu(false);
    if (onSelectRestaurant) {
      onSelectRestaurant(restaurant);
    }
  };

  const handleBackToDiscovery = () => {
    setSelectedRestaurant(null);
    setViewingMenu(false);
  };

  const handleGoToOwnerCentral = () => {
    if (onOpenOwnerCentral) {
      onOpenOwnerCentral();
    } else if (onBackToApp) {
      onBackToApp();
    } else {
      window.location.hash = 'owner';
    }
  };

  // If a restaurant is selected within the customer discovery flow, show its menu or public profile
  if (selectedRestaurant) {
    if (viewingMenu) {
      return (
        <CustomerRestaurantMenuPage
          initialProfile={selectedRestaurant}
          onBack={() => setViewingMenu(false)}
          onViewProfile={() => setViewingMenu(false)}
          onBackToDiscovery={handleBackToDiscovery}
        />
      );
    }

    return (
      <CustomerRestaurantPage
        initialProfile={selectedRestaurant}
        onBackToDiscovery={handleBackToDiscovery}
        onViewMenu={(restaurant) => {
          setSelectedRestaurant(restaurant);
          setViewingMenu(true);
        }}
      />
    );
  }

  return (
    <CustomerLocationProvider autoDetectOnMount={true}>
      <div className="min-h-screen glass-neu-canvas text-slate-900 flex flex-col">
        {/* Glass-Neumorphic Navigation Bar */}
        <header className="sticky top-0 z-40 glass-neu-header">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-13 sm:h-16 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Sidebar Drawer Toggle Button (Left Side) */}
              <button
                id="customer-sidebar-trigger-btn"
                onClick={() => setIsSidebarOpen(true)}
                className="relative glass-neu-btn-primary p-2 sm:p-2.5 text-xs font-bold rounded-xl flex items-center justify-center cursor-pointer shrink-0 min-h-[38px] min-w-[38px] sm:min-h-[42px] sm:min-w-[42px]"
                title="Open Sidebar Menu"
                aria-label="Open Sidebar Menu"
              >
                <Menu className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white flex items-center justify-center shadow-[4px_4px_10px_rgba(234,88,12,0.35),-2px_-2px_8px_rgba(255,255,255,0.8)] border border-white/40 shrink-0">
                <UtensilsCrossed className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-sm sm:text-base font-extrabold text-slate-900 tracking-tight block leading-tight">
                  RestaurantOS
                </span>
                <span className="text-[9px] sm:text-[10px] font-bold text-orange-600 uppercase tracking-wider block truncate">
                  Online Food Discovery
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Header Cart Button (Location removed from header, moved to Title row) */}
              <button
                id="header-cart-trigger-btn"
                onClick={openCartDrawer}
                className="relative p-2.5 sm:p-3 bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 rounded-xl sm:rounded-2xl shadow-xs flex items-center justify-center cursor-pointer shrink-0 min-h-[38px] min-w-[38px] sm:min-h-[42px] sm:min-w-[42px] transition-all"
                title="View Cart"
                aria-label="View Cart"
              >
                <ShoppingBag className="w-4 h-4 sm:w-5 sm:h-5 text-slate-800" />
                <span
                  id="header-cart-count-badge"
                  className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 bg-orange-600 text-white text-[10px] font-black rounded-full shadow-[0_2px_5px_rgba(234,88,12,0.4)] min-w-[18px] text-center"
                >
                  {itemCount}
                </span>
              </button>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1">
          <CustomerRestaurantDiscoveryView onSelectRestaurant={handleSelect} />
        </main>

        {/* Footer */}
        <footer className="border-t border-white/80 bg-white/60 backdrop-blur-md py-6 text-center text-xs text-slate-500">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p>© {new Date().getFullYear()} RestaurantOS. Glassmorphism + Neumorphism Customer Flow.</p>
            <button
              onClick={handleGoToOwnerCentral}
              className="glass-neu-pill px-3 py-1.5 text-slate-700 hover:text-orange-600 font-medium inline-flex items-center gap-1 transition-colors cursor-pointer text-xs"
            >
              For Restaurant Owners: Owner Central <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </footer>

        {/* Cart Drawer */}
        <CustomerCartDrawer />

        {/* Customer Sidebar Drawer */}
        <CustomerSidebarDrawer
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          onOpenProfile={() => {
            setIsSidebarOpen(false);
            setIsProfileModalOpen(true);
          }}
          onOpenMyOrders={() => {
            setIsSidebarOpen(false);
            setIsMyOrdersOpen(true);
          }}
        />

        {/* Customer Profile & Sign In Modal */}
        <CustomerProfileModal
          isOpen={isProfileModalOpen}
          onClose={() => setIsProfileModalOpen(false)}
          onTrackOrder={(restId, ordId) => {
            setTrackingOrderParams({ restaurantId: restId, orderId: ordId });
            setIsTrackingModalOpen(true);
          }}
        />

        {/* Customer Order Tracking Modal */}
        <CustomerOrderTrackingModal
          isOpen={isTrackingModalOpen}
          onClose={() => {
            setIsTrackingModalOpen(false);
            refreshActiveOrders();
          }}
          restaurantId={trackingOrderParams?.restaurantId}
          orderId={trackingOrderParams?.orderId}
          onBackToMenu={() => {
            setIsTrackingModalOpen(false);
            refreshActiveOrders();
          }}
        />

        {/* Customer My Orders Modal */}
        <CustomerMyOrdersModal
          isOpen={isMyOrdersOpen}
          onClose={() => {
            setIsMyOrdersOpen(false);
            refreshActiveOrders();
          }}
          onSelectOrderToTrack={(restId, ordId) => {
            setTrackingOrderParams({ restaurantId: restId, orderId: ordId });
            setIsTrackingModalOpen(true);
          }}
        />
      </div>
    </CustomerLocationProvider>
  );
};

export const PublicCustomerDiscoveryPage: React.FC<PublicCustomerDiscoveryPageProps> = (props) => {
  return (
    <CustomerCartProvider>
      <PublicCustomerDiscoveryPageContent {...props} />
    </CustomerCartProvider>
  );
};

