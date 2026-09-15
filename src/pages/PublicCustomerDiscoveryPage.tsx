import React, { useState } from 'react';
import { CustomerLocationProvider } from '../context/CustomerLocationContext';
import { CustomerCartProvider, useCustomerCart } from '../context/CustomerCartContext';
import { CustomerRestaurantDiscoveryView } from '../components/customer/CustomerRestaurantDiscoveryView';
import { CustomerRestaurantPage } from './customer/CustomerRestaurantPage';
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
 * Transitions smoothly to CustomerRestaurantPage when a restaurant is selected.
 */
const PublicCustomerDiscoveryPageContent: React.FC<PublicCustomerDiscoveryPageProps> = ({
  onBackToApp,
  onOpenOwnerCentral,
  onSelectRestaurant
}) => {
  const [selectedRestaurant, setSelectedRestaurant] = useState<PublicRestaurantProfile | null>(null);
  const { cart, openCartDrawer } = useCustomerCart();
  const itemCount = cart?.itemCount || 0;

  const handleSelect = (restaurant: PublicRestaurantProfile) => {
    setSelectedRestaurant(restaurant);
    if (onSelectRestaurant) {
      onSelectRestaurant(restaurant);
    }
  };

  const handleBackToDiscovery = () => {
    setSelectedRestaurant(null);
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

  // If a restaurant is selected within the customer discovery flow, show its public profile
  if (selectedRestaurant) {
    return (
      <CustomerRestaurantPage
        initialProfile={selectedRestaurant}
        onBackToDiscovery={handleBackToDiscovery}
      />
    );
  }

  return (
    <CustomerLocationProvider autoDetectOnMount={true}>
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
        {/* Navigation Bar */}
        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-2xs">
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-13 sm:h-16 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-orange-600 text-white flex items-center justify-center shadow-xs sm:shadow-sm shadow-orange-600/30 shrink-0">
                <UtensilsCrossed className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div className="min-w-0">
                <span className="text-sm sm:text-base font-extrabold text-slate-900 tracking-tight block leading-tight">
                  RestaurantOS
                </span>
                <span className="text-[9px] sm:text-[10px] font-semibold text-orange-600 uppercase tracking-wider block truncate">
                  Online Food Discovery
                </span>
              </div>
            </div>

            <button
              id="customer-cart-btn"
              onClick={openCartDrawer}
              className="px-2.5 py-1.5 sm:px-3.5 sm:py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-lg sm:rounded-xl transition-all shadow-xs sm:shadow-sm flex items-center gap-1.5 sm:gap-2 cursor-pointer shrink-0"
            >
              <ShoppingBag className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Cart</span>
              {itemCount > 0 && (
                <span className="px-1.5 py-0.5 bg-white text-orange-600 text-[10px] sm:text-[11px] font-extrabold rounded-full min-w-[18px] sm:min-w-[20px] text-center">
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
        <footer className="border-t border-slate-200/80 bg-white py-6 text-center text-xs text-slate-500">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p>© {new Date().getFullYear()} RestaurantOS. Secure, tenant-isolated cloud food ordering.</p>
            <button
              onClick={handleGoToOwnerCentral}
              className="text-slate-600 hover:text-orange-600 font-medium inline-flex items-center gap-1 transition-colors cursor-pointer"
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

