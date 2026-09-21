import React, { useState, useEffect } from 'react';
import { Sidebar, AdminView } from './Sidebar';
import { Header } from './Header';
import { MobileBottomNav } from './MobileBottomNav';
import { useRestaurant } from '../../context/RestaurantContext';
import { getRestaurantOperatingProfile } from '../../config/restaurantOperatingModes';
import { ShieldAlert, RefreshCw, ExternalLink } from 'lucide-react';
import { SecurityRulesNotice } from '../common/SecurityRulesNotice';
import { firebaseConfig } from '../../config/firebase';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import { VoiceAssistantWidget } from '../voice/VoiceAssistantWidget';
import { Order } from '../../types/order';
import { subscribeToNewOnlineOrders } from '../../services/onlineOrderNotificationService';
import { playNewOrderSoundAlert, isSoundAlertEnabled, setSoundAlertEnabled } from '../../utils/soundAlert';
import { NewOnlineOrderNotification } from '../notifications/NewOnlineOrderNotification';

interface AdminLayoutProps {
  currentView: AdminView;
  onNavigate: (view: AdminView) => void;
  children: React.ReactNode;
  onSwitchRestaurant?: () => void;
  onBackToCustomerHome?: () => void;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  currentView,
  onNavigate,
  children,
  onBackToCustomerHome
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { restaurant, operatingProfile, error, retry, loading: restaurantLoading, isSwitching } = useRestaurant();
  const resolvedProfile = operatingProfile || getRestaurantOperatingProfile(restaurant);

  // Milestone 9 — Phase 3: Incoming Online Order Notifications
  const [pendingOnlineOrders, setPendingOnlineOrders] = useState<Order[]>([]);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(isSoundAlertEnabled());

  useEffect(() => {
    const restaurantId = restaurant?.restaurantId;
    // Online-order notifications are page-scoped. Do not keep an orders
    // listener alive while the user is on POS, dashboard, inventory, etc.
    if (!restaurantId || !['orders', 'kitchen'].includes(currentView)) {
      setPendingOnlineOrders([]);
      return;
    }

    const unsubscribe = subscribeToNewOnlineOrders(restaurantId, {
      onNewOrder: (newOrder) => {
        // Attempt sound alert (catches autoplay errors gracefully internally)
        playNewOrderSoundAlert().catch(() => {});

        // Add new order to stack if not already present
        setPendingOnlineOrders((prev) => {
          if (prev.some((o) => o.id === newOrder.id)) return prev;
          return [newOrder, ...prev];
        });
      },
      onError: (err) => {
        console.warn('[AdminLayout] Online order notification subscription notice:', err);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [restaurant?.restaurantId, currentView]);

  const handleDismissOnlineOrder = (orderId: string) => {
    setPendingOnlineOrders((prev) => prev.filter((o) => o.id !== orderId));
  };

  const handleDismissAllOnlineOrders = () => {
    setPendingOnlineOrders([]);
  };

  const handleViewOnlineOrder = (order: Order) => {
    // Dismiss the visual card without mutating the order
    handleDismissOnlineOrder(order.id);

    // Navigate to Kitchen or Orders view based on operating capabilities
    if (resolvedProfile.capabilities.kitchenEnabled) {
      onNavigate('kitchen');
    } else {
      onNavigate('orders');
    }
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    setSoundAlertEnabled(next);
  };

  // Deterministic Back button handling for mobile sidebar menu
  useModalBackHandler(isMobileMenuOpen, () => setIsMobileMenuOpen(false), 'admin-mobile-sidebar');

  React.useEffect(() => {
    (window as any).openAdminMobileMenu = () => setIsMobileMenuOpen(true);
    return () => {
      delete (window as any).openAdminMobileMenu;
    };
  }, []);

  const isViewOperationallyDisabled =
    (currentView === 'kitchen' && !resolvedProfile.capabilities.kitchenEnabled) ||
    (currentView === 'captain' && !resolvedProfile.capabilities.captainEnabled) ||
    (currentView === 'inventory' && !resolvedProfile.capabilities.inventoryEnabled);

  const isPermissionError =
    error &&
    (error.toLowerCase().includes('permission') ||
      error.toLowerCase().includes('insufficient'));

  const isOfflineError =
    error &&
    (error.toLowerCase().includes('offline') ||
      error.toLowerCase().includes('network') ||
      error.toLowerCase().includes('backend didn\'t respond') ||
      error.toLowerCase().includes('could not reach'));

  const isDarkView = currentView === 'subscription';

  return (
    <div className={`min-h-screen ${isDarkView ? 'bg-[#0B0F19] text-slate-100' : 'bg-slate-50'} flex relative`}>
      {/* Switching Context Overlay */}
      {isSwitching && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex flex-col items-center justify-center transition-all duration-200">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-2xl flex flex-col items-center max-w-sm text-center mx-4 animate-in zoom-in-95 duration-150">
            <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
            <h3 className="text-sm font-bold text-slate-900">Switching Outlet Context</h3>
            <p className="text-[11px] text-slate-500 mt-1 max-w-xs leading-relaxed">
              Verifying credentials, updating database session channels, and loading real-time settings...
            </p>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <Sidebar
        currentView={currentView}
        onNavigate={onNavigate}
        isOpenMobile={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        onBackToCustomerHome={onBackToCustomerHome}
      />

      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col lg:pl-64 min-w-0 ${isDarkView ? 'bg-[#0B0F19]' : ''}`}>
        <div className={currentView === 'pos' ? 'hidden lg:block' : 'block'}>
          <Header
            onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
            onNavigateToSetup={() => onNavigate('restaurant')}
            isDark={isDarkView}
          />
        </div>

        {error && (
          <div className="mx-4 sm:mx-6 lg:mx-8 mt-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm text-amber-900">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-amber-100 text-amber-700 rounded-lg shrink-0 mt-0.5">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-amber-950">
                    {isPermissionError
                      ? 'Firestore Security Rules Configuration Required'
                      : isOfflineError
                      ? 'Network / Offline Notice'
                      : 'Database Synchronization Notice'}
                  </h3>
                  <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                    {isPermissionError ? (
                      <>
                        The active Firestore database on project{' '}
                        <code className="font-mono bg-amber-100 px-1 py-0.5 rounded text-amber-900 font-bold">
                          {firebaseConfig.projectId}
                        </code>{' '}
                        rejected read/write access. Ensure you have published the updated{' '}
                        <span className="font-semibold">firestore.rules</span> in your Firebase Console.
                      </>
                    ) : isOfflineError ? (
                      <>
                        Cloud Firestore was temporarily unable to reach the backend service. If your internet connection is active, click <span className="font-semibold">Retry Connection</span> below.
                      </>
                    ) : (
                      error
                    )}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {isPermissionError && (
                      <a
                        href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/rules`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-700 hover:bg-amber-800 text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
                      >
                        Open Firebase Rules Console
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <button
                      onClick={retry}
                      disabled={restaurantLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-amber-300 hover:bg-amber-100/50 text-amber-900 text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${restaurantLoading ? 'animate-spin' : ''}`} />
                      {restaurantLoading ? 'Retrying...' : 'Retry Connection'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <SecurityRulesNotice />

        <main className={`flex-1 ${
          ['pos', 'kitchen', 'captain'].includes(currentView)
            ? 'max-w-none w-full !p-0 sm:!p-2 lg:!p-4 pb-16 sm:pb-18 lg:pb-4'
            : isDarkView
            ? 'max-w-7xl w-full mx-auto p-3 sm:p-5 lg:p-6 pb-24 sm:pb-28 lg:pb-12 bg-[#0B0F19]'
            : 'max-w-7xl w-full mx-auto p-2 sm:p-4 lg:p-6 pb-16 sm:pb-18 lg:pb-6'
        }`}>
          {restaurantLoading && !restaurant ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
              <h3 className="text-base font-semibold text-slate-800">Connecting to Firestore</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Resolving restaurant profile and synchronizing real-time menu data...
              </p>
            </div>
          ) : !restaurant && error ? (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-8 text-center max-w-md mx-auto my-12 shadow-sm">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-200/60">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <h2 className="text-base font-bold text-slate-900 mb-1.5">Restaurant Data Unavailable</h2>
              <p className="text-xs text-slate-600 mb-6 leading-relaxed">
                {error}
              </p>
              <button
                onClick={retry}
                disabled={restaurantLoading}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-sm transition-colors w-full disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${restaurantLoading ? 'animate-spin' : ''}`} />
                {restaurantLoading ? 'Connecting...' : 'Retry Connection'}
              </button>
            </div>
          ) : isViewOperationallyDisabled ? (
            <div className="bg-white border border-slate-200/80 rounded-2xl p-8 text-center max-w-md mx-auto my-12 shadow-sm">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-4 border border-indigo-200/60">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <h2 className="text-base font-bold text-slate-900 mb-1.5">Module Disabled</h2>
              <p className="text-xs text-slate-600 mb-6 leading-relaxed">
                The {currentView} workflow is not enabled in your current operating mode ({resolvedProfile.mode.replace('_', ' ')}). You can customize enabled capabilities anytime in Restaurant Setup.
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('pos')}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl shadow-sm transition-colors"
                >
                  Go to POS
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('restaurant')}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors"
                >
                  Configure Capabilities
                </button>
              </div>
            </div>
          ) : React.isValidElement(children) ? (
            React.cloneElement(children as React.ReactElement<{ onOpenMobileMenu?: () => void }>, {
              onOpenMobileMenu: () => setIsMobileMenuOpen(true)
            })
          ) : (
            children
          )}
        </main>

        {/* Mobile-First Bottom Navigation Bar */}
        <MobileBottomNav
          currentView={currentView}
          onNavigate={onNavigate}
          onOpenMoreMenu={() => setIsMobileMenuOpen(true)}
        />

        {/* Global Canonical RestaurantOS Assistant */}
        <VoiceAssistantWidget
          currentView={currentView}
          onNavigate={onNavigate}
        />

        {/* Milestone 9 — Phase 3: Realtime New Online Order Notifications */}
        <NewOnlineOrderNotification
          orders={pendingOnlineOrders}
          onDismiss={handleDismissOnlineOrder}
          onDismissAll={handleDismissAllOnlineOrders}
          onViewOrder={handleViewOnlineOrder}
          currencySymbol={restaurant?.currencySymbol || '₹'}
          isSoundEnabled={soundEnabled}
          onToggleSound={handleToggleSound}
        />
      </div>
    </div>
  );
};
