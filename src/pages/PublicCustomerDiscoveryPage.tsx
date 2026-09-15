import React, { useState } from 'react';
import { CustomerLocationProvider } from '../context/CustomerLocationContext';
import { CustomerCartProvider } from '../context/CustomerCartContext';
import { CustomerRestaurantDiscoveryView } from '../components/customer/CustomerRestaurantDiscoveryView';
import { CustomerRestaurantPage } from './customer/CustomerRestaurantPage';
import { PublicRestaurantProfile } from '../types/customer';
import { UtensilsCrossed, ArrowLeft } from 'lucide-react';

export interface PublicCustomerDiscoveryPageProps {
  onBackToApp?: () => void;
  onSelectRestaurant?: (restaurant: PublicRestaurantProfile) => void;
}

/**
 * Public Customer Discovery Page (M9-D & M9-E).
 * Hosts the CustomerLocationProvider and CustomerRestaurantDiscoveryView.
 * Provides public, tenant-isolated restaurant search and filtering.
 * Transitions smoothly to CustomerRestaurantPage when a restaurant is selected.
 */
const PublicCustomerDiscoveryPageContent: React.FC<PublicCustomerDiscoveryPageProps> = ({
  onBackToApp,
  onSelectRestaurant
}) => {
  const [selectedRestaurant, setSelectedRestaurant] = useState<PublicRestaurantProfile | null>(null);

  const handleSelect = (restaurant: PublicRestaurantProfile) => {
    setSelectedRestaurant(restaurant);
    if (onSelectRestaurant) {
      onSelectRestaurant(restaurant);
    }
  };

  const handleBackToDiscovery = () => {
    setSelectedRestaurant(null);
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
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-600 text-white flex items-center justify-center shadow-sm shadow-orange-600/30">
                <UtensilsCrossed className="w-5 h-5" />
              </div>
              <div>
                <span className="text-base font-extrabold text-slate-900 tracking-tight block">
                  RestaurantOS
                </span>
                <span className="text-[10px] font-semibold text-orange-600 uppercase tracking-wider block">
                  Online Food Discovery
                </span>
              </div>
            </div>

            {onBackToApp && (
              <button
                id="back-to-app-btn"
                onClick={onBackToApp}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Staff Portal
              </button>
            )}
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1">
          <CustomerRestaurantDiscoveryView onSelectRestaurant={handleSelect} />
        </main>

        {/* Footer */}
        <footer className="border-t border-slate-200/80 bg-white py-6 text-center text-xs text-slate-500">
          <p>© {new Date().getFullYear()} RestaurantOS. Secure, tenant-isolated cloud food ordering.</p>
        </footer>
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

