import React, { useState, useEffect, lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { RestaurantProvider } from './context/RestaurantContext';
import { AdminLayout } from './components/layout/AdminLayout';
import { AdminView } from './components/layout/Sidebar';
import { LoginPage } from './pages/LoginPage';
import { PosPage } from './pages/PosPage';
import { UtensilsCrossed, ShieldAlert, Loader2 } from 'lucide-react';
import { isViewAllowed } from './utils/permissions';
import { isInvitationRoute, extractInvitationTokenFromUrl, PRODUCTION_BASE_PATH } from './utils/urlUtils';

// Code-split non-POS views for optimal bundle size and initial app load performance
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const RestaurantSetupPage = lazy(() => import('./pages/RestaurantSetupPage').then(m => ({ default: m.RestaurantSetupPage })));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage').then(m => ({ default: m.CategoriesPage })));
const ItemsPage = lazy(() => import('./pages/ItemsPage').then(m => ({ default: m.ItemsPage })));
const KitchenPage = lazy(() => import('./pages/KitchenPage').then(m => ({ default: m.KitchenPage })));
const CaptainPage = lazy(() => import('./pages/CaptainPage').then(m => ({ default: m.CaptainPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const AuditPage = lazy(() => import('./pages/AuditPage').then(m => ({ default: m.AuditPage })));
const OrdersPage = lazy(() => import('./pages/OrdersPage').then(m => ({ default: m.OrdersPage })));
const StaffPage = lazy(() => import('./pages/StaffPage').then(m => ({ default: m.StaffPage })));
const InventoryPage = lazy(() => import('./pages/InventoryPage').then(m => ({ default: m.InventoryPage })));
const PaymentsPage = lazy(() => import('./pages/PaymentsPage').then(m => ({ default: m.PaymentsPage })));
const AcceptInvitationPage = lazy(() => import('./pages/AcceptInvitationPage').then(m => ({ default: m.AcceptInvitationPage })));

const ViewFallback = () => (
  <div className="flex flex-col items-center justify-center p-12 min-h-[400px]">
    <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-2" />
    <span className="text-xs font-semibold text-slate-500">Loading view...</span>
  </div>
);

const AdminApp: React.FC = () => {
  const { user, profile, loading } = useAuth();
  const [currentView, setCurrentView] = useState<AdminView>('pos');

  // Check if current URL is an invitation acceptance route
  const isAcceptInvitation = isInvitationRoute();
  const invitationToken = extractInvitationTokenFromUrl();

  // Automatically correct/redirect currentView if it is unauthorized for the user's role
  useEffect(() => {
    if (user && profile && !isAcceptInvitation) {
      const role = profile.role || 'owner';
      if (!isViewAllowed(role, currentView)) {
        const views: AdminView[] = ['pos', 'captain', 'kitchen', 'orders', 'payments', 'inventory', 'dashboard', 'staff', 'restaurant', 'categories', 'items', 'reports', 'audit'];
        const firstAllowed = views.find((v) => isViewAllowed(role, v));
        if (firstAllowed) {
          setCurrentView(firstAllowed);
        }
      }
    }
  }, [user, profile, currentView, isAcceptInvitation]);

  if (isAcceptInvitation) {
    return (
      <AcceptInvitationPage
        token={invitationToken}
        onComplete={() => {
          const base = import.meta.env.BASE_URL || PRODUCTION_BASE_PATH;
          window.location.href = base;
        }}
      />
    );
  }

  const userRole = profile?.role || 'owner';

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center text-white shadow-2xl shadow-indigo-600/40 animate-pulse mb-4">
          <UtensilsCrossed className="w-8 h-8" />
        </div>
        <h1 className="text-xl font-bold text-white tracking-tight">RestaurantOS</h1>
        <p className="text-xs text-slate-400 mt-1">Connecting to Firestore cloud database...</p>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const allowedToView = isViewAllowed(userRole, currentView);

  return (
    <RestaurantProvider>
      <AdminLayout currentView={currentView} onNavigate={setCurrentView}>
        {allowedToView ? (
          <Suspense fallback={<ViewFallback />}>
            {currentView === 'pos' && <PosPage onNavigate={setCurrentView} />}
            {currentView === 'captain' && <CaptainPage onNavigate={setCurrentView} />}
            {currentView === 'kitchen' && <KitchenPage />}
            {currentView === 'orders' && <OrdersPage />}
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
    </RestaurantProvider>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AdminApp />
    </AuthProvider>
  );
}
