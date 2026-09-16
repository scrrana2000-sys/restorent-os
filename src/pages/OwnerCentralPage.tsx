import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { RestaurantProvider, useRestaurant } from '../context/RestaurantContext';
import { AdminLayout } from '../components/layout/AdminLayout';
import { AdminView } from '../components/layout/Sidebar';
import { LoginPage } from './LoginPage';
import { PosPage } from './PosPage';
import { lazy, Suspense } from 'react';
import {
  UtensilsCrossed,
  Store,
  ShieldAlert,
  Loader2,
  ArrowLeft,
  Building2,
  CheckCircle2,
  LogOut,
  MapPin,
  ChevronRight,
  RefreshCw,
  UserCheck
} from 'lucide-react';
import { isViewAllowed } from '../utils/permissions';
import { Restaurant } from '../types/restaurant';

// Code-split non-POS views
const DashboardPage = lazy(() => import('./DashboardPage').then(m => ({ default: m.DashboardPage })));
const RestaurantSetupPage = lazy(() => import('./RestaurantSetupPage').then(m => ({ default: m.RestaurantSetupPage })));
const CategoriesPage = lazy(() => import('./CategoriesPage').then(m => ({ default: m.CategoriesPage })));
const ItemsPage = lazy(() => import('./ItemsPage').then(m => ({ default: m.ItemsPage })));
const KitchenPage = lazy(() => import('./KitchenPage').then(m => ({ default: m.KitchenPage })));
const CaptainPage = lazy(() => import('./CaptainPage').then(m => ({ default: m.CaptainPage })));
const ReportsPage = lazy(() => import('./ReportsPage').then(m => ({ default: m.ReportsPage })));
const AuditPage = lazy(() => import('./AuditPage').then(m => ({ default: m.AuditPage })));
const OrdersPage = lazy(() => import('./OrdersPage').then(m => ({ default: m.OrdersPage })));
const StaffPage = lazy(() => import('./StaffPage').then(m => ({ default: m.StaffPage })));
const InventoryPage = lazy(() => import('./InventoryPage').then(m => ({ default: m.InventoryPage })));
const PaymentsPage = lazy(() => import('./PaymentsPage').then(m => ({ default: m.PaymentsPage })));
const CustomersPage = lazy(() => import('./CustomersPage').then(m => ({ default: m.CustomersPage })));

const ViewFallback = () => (
  <div className="flex flex-col items-center justify-center p-12 min-h-[400px]">
    <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-2" />
    <span className="text-xs font-semibold text-slate-500">Loading view...</span>
  </div>
);

interface OwnerCentralPageProps {
  onBackToCustomerHome?: () => void;
}

const OwnerCentralManagementConsole: React.FC<{ onBackToCustomerHome?: () => void }> = ({ onBackToCustomerHome }) => {
  const { user, profile, logout } = useAuth();
  const {
    restaurant,
    loading,
    error,
    hasNoRestaurant,
    isCreatingRestaurant,
    createOwnerRestaurant,
    availableRestaurants,
    switchRestaurant,
    isSwitching,
    retry
  } = useRestaurant();
  const [currentView, setCurrentView] = useState<AdminView>('pos');
  const [showMultiSelector, setShowMultiSelector] = useState<boolean>(false);

  // Onboarding form state
  const cleanOwnerFirstName = user?.displayName ? user.displayName.split(' ')[0] : user?.email ? user.email.split('@')[0] : 'Owner';
  const [newRestName, setNewRestName] = useState<string>(`${cleanOwnerFirstName}'s Restaurant`);
  const [newRestCity, setNewRestCity] = useState<string>('Bengaluru');
  const [creationError, setCreationError] = useState<string | null>(null);

  const handleBackToCustomer = () => {
    if (onBackToCustomerHome) {
      onBackToCustomerHome();
    } else {
      window.location.hash = 'discover';
    }
  };

  const handleConfirmCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRestName.trim()) {
      setCreationError('Please enter a valid restaurant name.');
      return;
    }
    setCreationError(null);
    try {
      await createOwnerRestaurant(newRestName.trim(), newRestCity.trim());
    } catch (err: any) {
      setCreationError(err?.message || 'Failed to create restaurant. Please try again.');
    }
  };

  const userRole = profile?.role || 'owner';

  if (loading || isSwitching) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-white">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center shadow-xl shadow-indigo-600/30 animate-pulse mb-4">
          <UtensilsCrossed className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">Owner Central</h2>
        <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading restaurant management console...
        </p>
      </div>
    );
  }

  // Handle case where user is an authorized staff/user with an explicit access error
  if (!restaurant && availableRestaurants.length === 0 && error) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-white">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto mb-4 border border-amber-500/20">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-extrabold text-white mb-2">Access Denied</h2>
          <p className="text-xs text-slate-400 mb-4 leading-relaxed">
            Your account <span className="text-indigo-300 font-semibold">{user?.email}</span> is authenticated, but could not access the restaurant console.
          </p>
          <div className="mb-6 p-3 bg-red-950/40 border border-red-800/40 rounded-xl text-xs text-red-300 text-left">
            {error}
          </div>
          <div className="space-y-2.5">
            <button
              onClick={retry}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry Verification
            </button>
            <button
              onClick={handleBackToCustomer}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Customer Front Door
            </button>
            <button
              onClick={() => logout()}
              className="w-full py-2 bg-transparent hover:bg-slate-800/50 text-slate-400 hover:text-white text-xs font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Handle Explicit Owner Onboarding flow when user has no existing restaurant
  if (!restaurant && availableRestaurants.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-white">
        <div className="max-w-lg w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30 shadow-inner">
              <Store className="w-6 h-6" />
            </div>
            <div>
              <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 mb-1">
                Owner Onboarding
              </span>
              <h2 className="text-xl font-extrabold text-white tracking-tight">Create Your Restaurant</h2>
            </div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4 mb-6">
            <div className="flex items-center gap-2 text-xs text-slate-300 font-medium mb-1.5">
              <UserCheck className="w-4 h-4 text-indigo-400" />
              <span>Signed in as: <strong className="text-white">{user?.displayName || user?.email}</strong></span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Customer accounts are completely separate from Restaurant Owner accounts on RestaurantOS. No restaurant is currently registered under this account.
            </p>
          </div>

          {(creationError || error) && (
            <div className="mb-5 p-3.5 bg-red-950/40 border border-red-800/40 rounded-xl text-xs text-red-300">
              {creationError || error}
            </div>
          )}

          <form onSubmit={handleConfirmCreate} className="space-y-4">
            <div>
              <label htmlFor="onboarding-restaurant-name" className="block text-xs font-semibold text-slate-300 mb-1.5">
                Restaurant Name
              </label>
              <input
                id="onboarding-restaurant-name"
                type="text"
                required
                disabled={isCreatingRestaurant}
                value={newRestName}
                onChange={(e) => setNewRestName(e.target.value)}
                placeholder="e.g. Royal Spice Bistro"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-xs text-white placeholder-slate-500 outline-none transition-all disabled:opacity-60"
              />
            </div>

            <div>
              <label htmlFor="onboarding-city" className="block text-xs font-semibold text-slate-300 mb-1.5">
                City / Location
              </label>
              <div className="relative">
                <MapPin className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-3" />
                <input
                  id="onboarding-city"
                  type="text"
                  required
                  disabled={isCreatingRestaurant}
                  value={newRestCity}
                  onChange={(e) => setNewRestCity(e.target.value)}
                  placeholder="e.g. Bengaluru, Raichur, Mumbai"
                  className="w-full pl-9 pr-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-xs text-white placeholder-slate-500 outline-none transition-all disabled:opacity-60"
                />
              </div>
            </div>

            <div className="pt-2 space-y-2.5">
              <button
                type="submit"
                id="confirm-create-restaurant-btn"
                disabled={isCreatingRestaurant || !newRestName.trim()}
                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 disabled:from-indigo-900/50 disabled:to-indigo-800/50 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-600/20 transition-all flex items-center justify-center gap-2"
              >
                {isCreatingRestaurant ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Provisioning Restaurant...</span>
                  </>
                ) : (
                  <>
                    <Store className="w-4 h-4" />
                    <span>Yes, Create My Restaurant</span>
                  </>
                )}
              </button>

              <button
                type="button"
                id="cancel-create-restaurant-btn"
                disabled={isCreatingRestaurant}
                onClick={handleBackToCustomer}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Cancel & Back to Customer Front Door
              </button>

              <button
                type="button"
                id="owner-onboarding-signout-btn"
                disabled={isCreatingRestaurant}
                onClick={() => logout()}
                className="w-full py-2 bg-transparent hover:bg-slate-800/50 text-slate-400 hover:text-white text-xs font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out & Switch Account
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Handle Multi-Restaurant Selector view if owner explicitly requests or hasn't selected active restaurant
  if (showMultiSelector && availableRestaurants.length > 1) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col">
        <header className="border-b border-slate-800 bg-slate-900/90 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-md">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-extrabold text-white tracking-tight">Owner Central</h1>
              <p className="text-xs text-slate-400">Select an authorized restaurant to manage</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowMultiSelector(false)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleBackToCustomer}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl transition-colors flex items-center gap-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Customer Front Door
            </button>
          </div>
        </header>

        <main className="max-w-4xl w-full mx-auto p-6 flex-1">
          <h2 className="text-xl font-bold mb-1">Your Authorized Restaurants</h2>
          <p className="text-xs text-slate-400 mb-6">Choose a restaurant location to open its POS and management portal.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {availableRestaurants.map((r) => {
              const isActive = restaurant?.restaurantId === r.restaurantId;
              return (
                <div
                  key={r.restaurantId}
                  className={`bg-slate-900 border rounded-2xl p-5 transition-all flex flex-col justify-between ${
                    isActive ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="font-bold text-base text-white">{r.name}</h3>
                      {isActive && (
                        <span className="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 text-[10px] font-bold rounded-full border border-indigo-500/30 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-indigo-400" /> Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 flex items-center gap-1 mb-3">
                      <MapPin className="w-3.5 h-3.5 text-slate-500" />
                      {r.city}, {r.state} {r.area ? `(${r.area})` : ''}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {r.cuisine?.map((c, i) => (
                        <span key={i} className="px-2 py-0.5 bg-slate-800 text-slate-300 text-[10px] rounded-md">
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={async () => {
                      await switchRestaurant(r.restaurantId);
                      setShowMultiSelector(false);
                    }}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-md shadow-indigo-600/20"
                  >
                    Open Restaurant
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </main>
      </div>
    );
  }

  const allowedToView = isViewAllowed(userRole, currentView);

  return (
    <AdminLayout
      currentView={currentView}
      onNavigate={setCurrentView}
      onSwitchRestaurant={
        availableRestaurants.length > 1 ? () => setShowMultiSelector(true) : undefined
      }
      onBackToCustomerHome={handleBackToCustomer}
    >
      {allowedToView ? (
        <Suspense fallback={<ViewFallback />}>
          {currentView === 'pos' && <PosPage onNavigate={setCurrentView} />}
          {currentView === 'captain' && <CaptainPage onNavigate={setCurrentView} />}
          {currentView === 'kitchen' && <KitchenPage />}
          {currentView === 'orders' && <OrdersPage />}
          {currentView === 'customers' && (
            <CustomersPage onNavigateToOrders={() => setCurrentView('orders')} />
          )}
          {currentView === 'payments' && <PaymentsPage />}
          {currentView === 'inventory' && <InventoryPage />}
          {currentView === 'dashboard' && <DashboardPage onNavigate={setCurrentView} />}
          {currentView === 'staff' && <StaffPage />}
          {currentView === 'restaurant' && <RestaurantSetupPage />}
          {currentView === 'categories' && <CategoriesPage />}
          {currentView === 'items' && <ItemsPage />}
          {currentView === 'reports' && <ReportsPage />}
          {currentView === 'audit' && <AuditPage />}
          {currentView === 'settings' && <RestaurantSetupPage />}
        </Suspense>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center max-w-md mx-auto my-12 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto mb-4 border border-red-200/60">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-base font-bold text-slate-900 mb-1.5">Unauthorized View</h2>
          <p className="text-xs text-slate-600 mb-6 leading-relaxed">
            Your staff role ({userRole}) does not have permission to access the "{currentView}" panel.
          </p>
        </div>
      )}
    </AdminLayout>
  );
};

export const OwnerCentralPage: React.FC<OwnerCentralPageProps> = ({ onBackToCustomerHome }) => {
  const { user, loading } = useAuth();

  const handleBackToCustomer = () => {
    if (onBackToCustomerHome) {
      onBackToCustomerHome();
    } else {
      window.location.hash = 'discover';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-white">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center shadow-xl shadow-indigo-600/30 animate-pulse mb-4">
          <UtensilsCrossed className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold tracking-tight">RestaurantOS OWNER CENTRAL</h2>
        <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Connecting to security portal...
        </p>
      </div>
    );
  }

  // Unauthenticated: Show Owner Central Landing & Login
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-between text-white">
        {/* Header Navigation */}
        <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md px-3 sm:px-6 py-2.5 sm:py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/30 shrink-0">
              <Store className="w-4 h-4 sm:w-5 sm:h-5 text-orange-400" />
            </div>
            <div className="min-w-0">
              <span className="text-xs sm:text-base font-extrabold text-white tracking-tight block truncate leading-tight">
                RestaurantOS <span className="text-indigo-400 font-semibold">OWNER CENTRAL</span>
              </span>
              <span className="text-[8px] sm:text-[10px] font-semibold text-slate-400 tracking-wider block uppercase truncate">
                Management Console
              </span>
            </div>
          </div>

          <button
            id="back-to-customer-btn"
            onClick={handleBackToCustomer}
            className="px-2 sm:px-3.5 py-1 sm:py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] sm:text-xs font-semibold rounded-lg sm:rounded-xl transition-all border border-slate-700/60 flex items-center gap-1 sm:gap-1.5 shrink-0 cursor-pointer max-w-[140px] xs:max-w-[170px] sm:max-w-none overflow-hidden"
          >
            <ArrowLeft className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
            <span className="truncate">Are you a customer? Back to RestaurantOS</span>
          </button>
        </header>

        {/* Main Login Area */}
        <div className="flex-1 flex flex-col justify-center">
          <LoginPage />
        </div>

        {/* Footer */}
        <footer className="border-t border-slate-900 py-4 text-center text-xs text-slate-500">
          <p>© {new Date().getFullYear()} RestaurantOS Owner Central. Authorized management access only.</p>
        </footer>
      </div>
    );
  }

  // Authenticated: Wrap in RestaurantProvider to manage restaurant context
  return (
    <RestaurantProvider>
      <OwnerCentralManagementConsole onBackToCustomerHome={handleBackToCustomer} />
    </RestaurantProvider>
  );
};
