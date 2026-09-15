import React, { useState } from 'react';
import { CustomerLocationProvider } from '../context/CustomerLocationContext';
import { CustomerCartProvider, useCustomerCart } from '../context/CustomerCartContext';
import { CustomerRestaurantDiscoveryView } from '../components/customer/CustomerRestaurantDiscoveryView';
import { CustomerRestaurantPage } from './customer/CustomerRestaurantPage';
import { CustomerRestaurantMenuPage } from './customer/CustomerRestaurantMenuPage';
import { CustomerCartDrawer } from '../components/customer/CustomerCartDrawer';
import { PublicRestaurantProfile } from '../types/customer';
import { UtensilsCrossed, ShoppingBag, ArrowRight } from 'lucide-react';
import { buildOwnerCentralUrl } from '../utils/urlUtils';

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
  const { cart, openCartDrawer } = useCustomerCart();
  const itemCount = cart?.itemCount || 0;

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

            <button
              id="customer-cart-btn"
              onClick={openCartDrawer}
              className="glass-neu-btn-primary px-3 py-1.5 sm:px-4 sm:py-2 text-xs font-bold rounded-xl flex items-center gap-1.5 sm:gap-2 cursor-pointer shrink-0"
            >
              <ShoppingBag className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Cart</span>
              {itemCount > 0 && (
                <span className="px-1.5 py-0.5 bg-white text-orange-600 text-[10px] sm:text-[11px] font-extrabold rounded-full min-w-[18px] sm:min-w-[20px] text-center shadow-xs">
                  {itemCount}
                </span>
              )}
            </button>
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

