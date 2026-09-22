import React, { useState, useEffect, lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CustomerAuthProvider } from './context/CustomerAuthContext';
import { RestaurantProvider } from './context/RestaurantContext';
import { AdminLayout } from './components/layout/AdminLayout';
import { AdminView } from './components/layout/Sidebar';
import { LoginPage } from './pages/LoginPage';
import { PosPage } from './pages/PosPage';
import { UtensilsCrossed, ShieldAlert, Loader2 } from 'lucide-react';
import { isViewAllowed } from './utils/permissions';
import {
  isInvitationRoute,
  extractInvitationTokenFromUrl,
  isPublicBillRoute,
  isCustomTabAuthRoute,
  isCustomerDiscoveryRoute,
  isCustomerRestaurantRoute,
  isOwnerCentralRoute,
  extractRestaurantIdentifierFromUrl,
  buildPublicRestaurantUrl,
  PRODUCTION_BASE_PATH
} from './utils/urlUtils';
import { CustomTabAuthPage } from './pages/CustomTabAuthPage';
import { PublicCustomerDiscoveryPage } from './pages/PublicCustomerDiscoveryPage';
import { CustomerRestaurantPage } from './pages/customer/CustomerRestaurantPage';
import { CustomerRestaurantMenuPage } from './pages/customer/CustomerRestaurantMenuPage';
import { OwnerCentralPage } from './pages/OwnerCentralPage';
import { OrdersPage } from './pages/OrdersPage';

// Code-split non-POS views for optimal bundle size and initial app load performance
const DashboardPage = lazy(() => import('./pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const RestaurantSetupPage = lazy(() => import('./pages/RestaurantSetupPage').then(m => ({ default: m.RestaurantSetupPage })));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage').then(m => ({ default: m.CategoriesPage })));
const ItemsPage = lazy(() => import('./pages/ItemsPage').then(m => ({ default: m.ItemsPage })));
const KitchenPage = lazy(() => import('./pages/KitchenPage').then(m => ({ default: m.KitchenPage })));
const CaptainPage = lazy(() => import('./pages/CaptainPage').then(m => ({ default: m.CaptainPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const AuditPage = lazy(() => import('./pages/AuditPage').then(m => ({ default: m.AuditPage })));
// OrdersPage is eagerly imported because it is a primary navigation target.
// This avoids stale GitHub Pages sessions requesting a removed hashed chunk.
const StaffPage = lazy(() => import('./pages/StaffPage').then(m => ({ default: m.StaffPage })));
const InventoryPage = lazy(() => import('./pages/InventoryPage').then(m => ({ default: m.InventoryPage })));
const PaymentsPage = lazy(() => import('./pages/PaymentsPage').then(m => ({ default: m.PaymentsPage })));
const AcceptInvitationPage = lazy(() => import('./pages/AcceptInvitationPage').then(m => ({ default: m.AcceptInvitationPage })));
const PublicBillPage = lazy(() => import('./pages/PublicBillPage').then(m => ({ default: m.PublicBillPage })));

const ViewFallback = () => (
  <div className="flex flex-col items-center justify-center p-12 min-h-[400px]">
    <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-2" />
    <span className="text-xs font-semibold text-slate-500">Loading view...</span>
  </div>
);

const AdminApp: React.FC = () => {
  const [routeState, setRouteState] = useState<number>(0);

  // Listen for browser hash and history navigation
  useEffect(() => {
    const handleLocationChange = () => {
      setRouteState((prev) => prev + 1);
    };

    window.addEventListener('hashchange', handleLocationChange);
    window.addEventListener('popstate', handleLocationChange);

    return () => {
      window.removeEventListener('hashchange', handleLocationChange);
      window.removeEventListener('popstate', handleLocationChange);
    };
  }, []);

  // Check route conditions
  const isAcceptInvitation = isInvitationRoute();
  const invitationToken = extractInvitationTokenFromUrl();
  const isPublicBill = isPublicBillRoute();
  const isCustomTabAuth = isCustomTabAuthRoute();
  const isCustomerRestaurant = isCustomerRestaurantRoute();
  const restaurantIdentifier = extractRestaurantIdentifierFromUrl();
  const isOwnerCentral = isOwnerCentralRoute();

  if (isCustomTabAuth) {
    return <CustomTabAuthPage />;
  }

  if (isPublicBill) {
    return (
      <Suspense fallback={<ViewFallback />}>
        <PublicBillPage />
      </Suspense>
    );
  }

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

  // M9-F Customer Restaurant Public Menu Route (/r/:slug/menu, #r/:slug/menu, ?r=:slug&view=menu, etc.)
  if (isCustomerRestaurant && restaurantIdentifier?.isMenu) {
    return (
      <CustomerRestaurantMenuPage
        slug={restaurantIdentifier?.slug}
        code={restaurantIdentifier?.code}
        onBack={() => {
          const target = restaurantIdentifier?.slug || restaurantIdentifier?.code || '';
          if (target) {
            window.location.hash = `r/${target}`;
          } else {
            window.location.hash = 'discover';
          }
        }}
        onViewProfile={(profile) => {
          window.location.hash = `r/${profile.publicSlug}`;
        }}
        onBackToDiscovery={() => {
          window.location.hash = 'discover';
        }}
      />
    );
  }

  // M9-E Customer Restaurant Public Profile Route (/r/:slug, #r/:slug, ?r=:slug, etc.)
  if (isCustomerRestaurant) {
    return (
      <CustomerRestaurantPage
        slug={restaurantIdentifier?.slug}
        code={restaurantIdentifier?.code}
        onViewMenu={(profile) => {
          window.location.hash = `r/${profile.publicSlug}/menu`;
        }}
        onBackToDiscovery={() => {
          window.location.hash = 'discover';
        }}
      />
    );
  }

  // M9-K Owner Central Route (/owner, #owner, ?view=owner, ?owner=true)
  if (isOwnerCentral) {
    return (
      <OwnerCentralPage
        onBackToCustomerHome={() => {
          window.location.hash = 'discover';
        }}
      />
    );
  }

  // M9-K Customer Front Door at Root / (and #discover, ?view=discover)
  return (
    <PublicCustomerDiscoveryPage
      onOpenOwnerCentral={() => {
        window.location.hash = 'owner';
      }}
      onSelectRestaurant={(restaurant) => {
        window.location.hash = `r/${restaurant.publicSlug}`;
      }}
    />
  );
};

export default function App() {
  return (
    <AuthProvider>
      <CustomerAuthProvider>
        <AdminApp />
      </CustomerAuthProvider>
    </AuthProvider>
  );
}
