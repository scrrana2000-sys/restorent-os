import React, { useState, useEffect, useCallback } from 'react';
import {
  Utensils,
  MapPin,
  Phone,
  Bike,
  ShoppingBag,
  Clock,
  ArrowLeft,
  AlertCircle,
  RotateCcw,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  Building,
  Info,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle
} from 'lucide-react';
import { PublicRestaurantProfile } from '../../types/customer';
import {
  resolveRestaurantBySlug,
  resolveRestaurantByPublicCode,
  resolveRestaurantById,
  subscribeToPublicRestaurantProfile
} from '../../services/customerDiscoveryService';
import {
  extractRestaurantIdentifierFromUrl,
  PRODUCTION_BASE_PATH
} from '../../utils/urlUtils';
import { CustomerLocationProvider } from '../../context/CustomerLocationContext';
import { CustomerLocationBar } from '../../components/customer/CustomerLocationBar';
import { CustomerCartProvider, useCustomerCart } from '../../context/CustomerCartContext';
import { CustomerCartDrawer } from '../../components/customer/CustomerCartDrawer';
import { CartConflictModal } from '../../components/customer/CartConflictModal';
import { CustomerRestaurantMenuPage } from './CustomerRestaurantMenuPage';

export interface CustomerRestaurantPageProps {
  initialProfile?: PublicRestaurantProfile;
  slug?: string;
  code?: string;
  restaurantId?: string;
  onBackToDiscovery?: () => void;
  onViewMenu?: (restaurant: PublicRestaurantProfile) => void;
}

/**
 * M9-E Customer Restaurant Public Profile Page.
 * Displays tenant-isolated, public-safe restaurant profile information.
 * Resolves restaurant via exact slug or public code from URL or props.
 * Strictly guarantees that private tenant data, GST/FSSAI, staff, and financial data are never exposed.
 */
const CustomerRestaurantPageContent: React.FC<CustomerRestaurantPageProps> = ({
  initialProfile,
  slug: propSlug,
  code: propCode,
  restaurantId: propRestaurantId,
  onBackToDiscovery,
  onViewMenu
}) => {
  const [restaurant, setRestaurant] = useState<PublicRestaurantProfile | null>(initialProfile || null);
  const [isLoading, setIsLoading] = useState<boolean>(!initialProfile);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<boolean>(false);
  const [showMenuInline, setShowMenuInline] = useState<boolean>(false);

  const { cart, openCartDrawer } = useCustomerCart();

  // Resolution workflow
  const loadRestaurantProfile = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setNotFound(false);

    try {
      // 1. Determine target identifier from props or URL
      let targetSlug = propSlug;
      let targetCode = propCode;
      let targetId = propRestaurantId;

      if (!targetSlug && !targetCode && !targetId) {
        const urlParams = extractRestaurantIdentifierFromUrl();
        if (urlParams) {
          targetSlug = urlParams.slug;
          targetCode = urlParams.code;
        }
      }

      if (!targetSlug && !targetCode && !targetId) {
        setNotFound(true);
        setIsLoading(false);
        return;
      }

      let profile: PublicRestaurantProfile | null = null;

      if (targetSlug) {
        profile = await resolveRestaurantBySlug(targetSlug);
      } else if (targetCode) {
        profile = await resolveRestaurantByPublicCode(targetCode);
      } else if (targetId) {
        profile = await resolveRestaurantById(targetId);
      }

      if (!profile) {
        setNotFound(true);
      } else {
        setRestaurant(profile);
      }
    } catch (err: any) {
      console.warn('[RestaurantOS] Customer restaurant profile resolution error:', err);
      setError('Unable to load restaurant details. Please check your internet connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [propSlug, propCode, propRestaurantId]);

  useEffect(() => {
    if (initialProfile) {
      setRestaurant(initialProfile);
      setIsLoading(false);
      setError(null);
      setNotFound(false);
    } else {
      loadRestaurantProfile();
    }
  }, [initialProfile, loadRestaurantProfile]);

  useEffect(() => {
    const restaurantId = restaurant?.restaurantId;
    if (!restaurantId) return;

    const unsubscribe = subscribeToPublicRestaurantProfile(
      restaurantId,
      (profile) => {
        if (profile) setRestaurant(profile);
      },
      (err) => console.warn('[RestaurantOS Customer] Restaurant status live-sync notice:', err)
    );

    return () => unsubscribe();
  }, [restaurant?.restaurantId]);

  const handleBack = () => {
    if (onBackToDiscovery) {
      onBackToDiscovery();
    } else if (typeof window !== 'undefined') {
      // Navigate back to discovery via hash or query
      const base = import.meta.env.BASE_URL || PRODUCTION_BASE_PATH;
      window.location.href = `${base}?view=discover`;
    }
  };

  const handleMenuClick = () => {
    if (restaurant) {
      if (onViewMenu) {
        onViewMenu(restaurant);
      } else {
        const target = restaurant.publicSlug || restaurant.publicRestaurantCode;
        if (typeof window !== 'undefined' && target) {
          window.location.hash = `r/${target}/menu`;
        }
        setShowMenuInline(true);
      }
    }
  };

  if (showMenuInline && restaurant) {
    return (
      <CustomerRestaurantMenuPage
        initialProfile={restaurant}
        onBack={() => setShowMenuInline(false)}
        onBackToDiscovery={onBackToDiscovery}
        onViewProfile={() => setShowMenuInline(false)}
      />
    );
  }

  const isOpenForOrders =
    restaurant?.publicStatus === 'active' &&
    restaurant?.onlineOrderingEnabled === true &&
    restaurant?.isOpenNow !== false;

  return (
    <CustomerLocationProvider autoDetectOnMount={false}>
      <div className="min-h-screen glass-neu-canvas text-slate-900 flex flex-col">
        {/* Navigation Bar */}
        <header className="sticky top-0 z-40 glass-neu-header">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <button
              id="back-to-discovery-btn"
              onClick={handleBack}
              className="glass-neu-btn px-3.5 py-2 text-xs font-bold text-slate-800 rounded-xl min-h-[44px] flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Discovery</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                id="profile-header-cart-trigger-btn"
                onClick={openCartDrawer}
                className="relative p-2.5 sm:p-3 bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 rounded-xl sm:rounded-2xl shadow-xs flex items-center justify-center cursor-pointer shrink-0 min-h-[38px] min-w-[38px] sm:min-h-[42px] sm:min-w-[42px] transition-all"
                title="View Cart"
                aria-label="View Cart"
              >
                <ShoppingBag className="w-4 h-4 sm:w-5 sm:h-5 text-slate-800" />
                <span
                  id="profile-header-cart-count"
                  className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 bg-orange-600 text-white text-[10px] font-black rounded-full shadow-[0_2px_5px_rgba(234,88,12,0.4)] min-w-[18px] text-center"
                >
                  {cart?.itemCount || 0}
                </span>
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
          {/* Loading Skeleton */}
          {isLoading && (
            <div id="profile-loading-skeleton" className="space-y-6 animate-pulse">
              {/* Cover skeleton */}
              <div className="h-48 sm:h-64 bg-slate-200 rounded-3xl w-full" />

              {/* Header skeleton */}
              <div className="bg-white rounded-3xl p-6 border border-slate-200/80 space-y-4 shadow-xs">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-slate-200 shrink-0" />
                  <div className="space-y-2 flex-1">
                    <div className="h-6 bg-slate-200 rounded-md w-1/2" />
                    <div className="h-4 bg-slate-200 rounded-md w-1/3" />
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <div className="h-6 bg-slate-200 rounded-lg w-20" />
                  <div className="h-6 bg-slate-200 rounded-lg w-20" />
                  <div className="h-6 bg-slate-200 rounded-lg w-24" />
                </div>
              </div>

              {/* Details skeleton */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="h-40 bg-white rounded-3xl border border-slate-200/80 p-6" />
                <div className="h-40 bg-white rounded-3xl border border-slate-200/80 p-6" />
              </div>
            </div>
          )}

          {/* Error State */}
          {!isLoading && error && (
            <div
              id="profile-error-box"
              className="p-8 bg-red-50 border border-red-200 rounded-3xl text-center max-w-md mx-auto my-12 shadow-xs"
            >
              <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h2 className="text-base font-bold text-red-900 mb-1">Could Not Load Profile</h2>
              <p className="text-xs text-red-700 mb-6 leading-relaxed">{error}</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  id="retry-profile-load-btn"
                  onClick={loadRestaurantProfile}
                  className="w-full sm:w-auto px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors inline-flex items-center justify-center gap-2 min-h-[44px]"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Retry</span>
                </button>
                <button
                  onClick={handleBack}
                  className="w-full sm:w-auto px-5 py-2.5 bg-white border border-red-200 text-red-700 hover:bg-red-50 text-xs font-bold rounded-xl transition-colors min-h-[44px]"
                >
                  Back to Discovery
                </button>
              </div>
            </div>
          )}

          {/* Not Found State */}
          {!isLoading && !error && notFound && (
            <div
              id="profile-not-found-box"
              className="p-10 bg-white border border-slate-200 rounded-3xl text-center max-w-md mx-auto my-12 shadow-xs"
            >
              <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-200/60">
                <Building className="w-7 h-7" />
              </div>
              <h2 className="text-base font-bold text-slate-900 mb-1">Restaurant Not Found</h2>
              <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                The restaurant you requested is not listed, has been moved, or the link is invalid.
              </p>
              <button
                id="not-found-back-discovery-btn"
                onClick={handleBack}
                className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-xs transition-colors inline-flex items-center gap-2 min-h-[44px]"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Explore Restaurants</span>
              </button>
            </div>
          )}

          {/* Restaurant Profile Content */}
          {!isLoading && !error && !notFound && restaurant && (
            <div id={`restaurant-profile-${restaurant.restaurantId}`} className="space-y-6">
              {/* Cover Banner & Quick Badges */}
              <div className="relative rounded-3xl overflow-hidden glass-neu-card p-0 bg-slate-900">
                <div className="relative h-48 sm:h-64 bg-gradient-to-br from-slate-800 to-slate-950 overflow-hidden">
                  {(restaurant.bannerImageUrl || restaurant.coverImageUrl) ? (
                    <img
                      id="profile-cover-image"
                      src={restaurant.bannerImageUrl || restaurant.coverImageUrl!}
                      alt={restaurant.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover opacity-85"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-orange-950 via-slate-900 to-amber-950">
                      <Utensils className="w-16 h-16 text-orange-400/30" />
                    </div>
                  )}

                  {/* Gradient overlay for readability */}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-black/30" />

                  {/* Status Overlay Badge */}
                  <div className="absolute top-4 left-4">
                    {isOpenForOrders ? (
                      <span
                        id="profile-status-open"
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/90 text-white shadow-[2px_2px_8px_rgba(16,185,129,0.35)] backdrop-blur-md border border-white/50"
                      >
                        <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                        Open for Orders
                      </span>
                    ) : restaurant.publicStatus === 'paused' ? (
                      <span
                        id="profile-status-paused"
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/90 text-white shadow-md backdrop-blur-md border border-white/50"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Currently Paused
                      </span>
                    ) : restaurant.publicStatus === 'closed' ? (
                      <span
                        id="profile-status-closed"
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-700/90 text-slate-200 shadow-md backdrop-blur-md border border-white/20"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        Currently Closed
                      </span>
                    ) : (
                      <span
                        id="profile-status-ordering-off"
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-600/90 text-white shadow-md backdrop-blur-md border border-white/30"
                      >
                        <Info className="w-3.5 h-3.5" />
                        Dine-in / Walk-in Only
                      </span>
                    )}
                  </div>

                  {/* Public Code Badge */}
                  <div className="absolute top-4 right-4">
                    <span
                      id="profile-public-code-badge"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-white/90 text-slate-900 shadow-md backdrop-blur-md border border-white/40"
                    >
                      {restaurant.publicRestaurantCode}
                    </span>
                  </div>
                </div>

                {/* Profile Header Bar */}
                <div className="bg-white/70 backdrop-blur-md p-6 pt-0 relative">
                  {/* Floating Logo */}
                  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 -mt-10 sm:-mt-12 mb-4">
                    <div className="flex items-end gap-4">
                      <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-white border-4 border-white shadow-[4px_4px_12px_rgba(0,0,0,0.15)] overflow-hidden flex items-center justify-center shrink-0">
                        {restaurant.logoUrl ? (
                          <img
                            id="profile-logo-image"
                            src={restaurant.logoUrl}
                            alt={`${restaurant.name} logo`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Building className="w-10 h-10 text-orange-500" />
                        )}
                      </div>
                      <div className="pt-2">
                        <h1
                          id="profile-restaurant-name"
                          className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight"
                        >
                          {restaurant.name}
                        </h1>
                        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mt-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span id="profile-location-text">
                            {restaurant.area ? `${restaurant.area}, ` : ''}{restaurant.city}, {restaurant.state}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* View Menu Action */}
                    <div className="pt-2 sm:pt-0 shrink-0">
                      <button
                        id="profile-view-menu-btn"
                        onClick={handleMenuClick}
                        className="w-full sm:w-auto px-6 py-3 glass-neu-btn-primary font-bold text-sm rounded-2xl flex items-center justify-center gap-2 min-h-[44px]"
                      >
                        <span>View Menu</span>
                        <ChevronRight className="w-4 h-4 text-white" />
                      </button>
                    </div>
                  </div>

                  {/* Cuisine Tags */}
                  {restaurant.cuisine && restaurant.cuisine.length > 0 && (
                    <div id="profile-cuisine-tags" className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/60">
                      {restaurant.cuisine.map((item, idx) => (
                        <span
                          key={`${item}-${idx}`}
                          className="glass-neu-pill px-3 py-1 text-xs font-semibold rounded-lg"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Status Notice Banners if Paused or Online Ordering Disabled */}
              {restaurant.publicStatus === 'paused' && (
                <div
                  id="profile-paused-notice"
                  className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 text-amber-900 shadow-2xs"
                >
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs space-y-0.5">
                    <div className="font-bold">Restaurant Temporarily Paused</div>
                    <p className="text-amber-700 leading-relaxed">
                      This kitchen is currently taking a short pause and not accepting new incoming orders right now. You can still view the menu.
                    </p>
                  </div>
                </div>
              )}

              {restaurant.publicStatus === 'closed' && (
                <div
                  id="profile-closed-notice"
                  className="p-4 bg-slate-100 border border-slate-200 rounded-2xl flex items-start gap-3 text-slate-800 shadow-2xs"
                >
                  <Clock className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
                  <div className="text-xs space-y-0.5">
                    <div className="font-bold">Restaurant Currently Closed</div>
                    <p className="text-slate-600 leading-relaxed">
                      This restaurant is closed at the moment. Please check back during operating hours.
                    </p>
                  </div>
                </div>
              )}

              {!restaurant.onlineOrderingEnabled && (
                <div
                  id="profile-online-disabled-notice"
                  className="p-4 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-3 text-blue-900 shadow-2xs"
                >
                  <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <div className="text-xs space-y-0.5">
                    <div className="font-bold">Online Ordering Unavailable</div>
                    <p className="text-blue-700 leading-relaxed">
                      This restaurant accepts walk-in and dine-in guests only. Online ordering is not enabled.
                    </p>
                  </div>
                </div>
              )}

              {/* Capabilities & Information Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Order Capabilities Card */}
                <div className="glass-neu-card rounded-3xl p-6 space-y-4">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-orange-500" />
                    Available Services
                  </h3>

                  <div className="space-y-3">
                    {/* Delivery Capability */}
                    <div
                      id="profile-capability-delivery"
                      className={`p-3.5 rounded-2xl border flex items-center justify-between ${
                        restaurant.deliveryEnabled
                          ? 'bg-emerald-50/70 border-emerald-200/80 text-emerald-900 shadow-[2px_2px_8px_rgba(16,185,129,0.15)]'
                          : 'bg-slate-50/50 border-slate-200 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                            restaurant.deliveryEnabled
                              ? 'bg-emerald-100 text-emerald-700 border border-white'
                              : 'bg-slate-200 text-slate-400'
                          }`}
                        >
                          <Bike className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold">Home Delivery</div>
                          <div className="text-[11px] opacity-80">
                            {restaurant.deliveryEnabled
                              ? 'Direct doorstep food delivery'
                              : 'Not currently offering delivery'}
                          </div>
                        </div>
                      </div>
                      <span className="text-xs font-bold">
                        {restaurant.deliveryEnabled ? 'Available' : 'Unavailable'}
                      </span>
                    </div>

                    {/* Takeaway Capability */}
                    <div
                      id="profile-capability-takeaway"
                      className={`p-3.5 rounded-2xl border flex items-center justify-between ${
                        restaurant.takeawayEnabled
                          ? 'bg-blue-50/70 border-blue-200/80 text-blue-900 shadow-[2px_2px_8px_rgba(59,130,246,0.15)]'
                          : 'bg-slate-50/50 border-slate-200 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                            restaurant.takeawayEnabled
                              ? 'bg-blue-100 text-blue-700 border border-white'
                              : 'bg-slate-200 text-slate-400'
                          }`}
                        >
                          <ShoppingBag className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold">Self Takeaway</div>
                          <div className="text-[11px] opacity-80">
                            {restaurant.takeawayEnabled
                              ? 'Pick up order directly at restaurant'
                              : 'Takeaway pickup not available'}
                          </div>
                        </div>
                      </div>
                      <span className="text-xs font-bold">
                        {restaurant.takeawayEnabled ? 'Available' : 'Unavailable'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Location & Contact Information Card */}
                <div className="glass-neu-card rounded-3xl p-6 space-y-4">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Building className="w-4 h-4 text-orange-500" />
                    Restaurant Address & Contact
                  </h3>

                  <div className="space-y-3.5 text-xs text-slate-600">
                    {/* Address */}
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-xl bg-orange-100/80 text-orange-600 flex items-center justify-center shrink-0 mt-0.5 border border-white shadow-[2px_2px_5px_rgba(234,88,12,0.15)]">
                        <MapPin className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-slate-900">Address</div>
                        <p id="profile-full-address" className="text-slate-600 mt-0.5 leading-relaxed">
                          {restaurant.address || `${restaurant.area || ''}, ${restaurant.city}`}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {restaurant.city}, {restaurant.state} {restaurant.postalCode ? `- ${restaurant.postalCode}` : ''}
                        </p>
                      </div>
                    </div>

                    {/* Phone */}
                    {restaurant.phone && (
                      <div className="flex items-start gap-3 pt-2 border-t border-slate-200/60">
                        <div className="w-8 h-8 rounded-xl bg-orange-100/80 text-orange-600 flex items-center justify-center shrink-0 mt-0.5 border border-white shadow-[2px_2px_5px_rgba(234,88,12,0.15)]">
                          <Phone className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="font-bold text-slate-900">Phone Contact</div>
                          <a
                            id="profile-phone-link"
                            href={`tel:${restaurant.phone}`}
                            className="text-orange-600 font-semibold hover:underline mt-0.5 block"
                          >
                            {restaurant.phone}
                          </a>
                        </div>
                      </div>
                    )}

                    {/* Canonical Identifier */}
                    <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-400">
                      <span>Public Reference Code</span>
                      <span className="font-mono font-bold text-slate-700">{restaurant.publicRestaurantCode}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Customer Cart Drawer */}
              <CustomerCartDrawer
                restaurantProfile={restaurant}
                onNavigateToMenu={handleMenuClick}
              />

              {/* Cross-Restaurant Conflict Modal */}
              <CartConflictModal />
            </div>
          )}
        </main>

        {/* Floating Cart Button if Cart has items */}
        {cart && cart.items.length > 0 && (
          <div className="fixed bottom-5 left-4 right-4 z-40 max-w-lg mx-auto animate-in slide-in-from-bottom duration-300">
            <div
              id="profile-floating-cart-bar"
              onClick={openCartDrawer}
              className="bg-slate-900/90 backdrop-blur-xl text-white rounded-2xl p-4 shadow-[0_12px_32px_rgba(0,0,0,0.35)] border border-white/20 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-900 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-orange-500 to-amber-500 flex items-center justify-center text-white font-mono font-bold text-sm shadow-[2px_2px_8px_rgba(234,88,12,0.4)] border border-white/30">
                  {cart.itemCount}
                </div>
                <div>
                  <div className="text-xs font-extrabold tracking-tight">
                    {cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'} in cart
                  </div>
                  <div className="text-[11px] text-slate-300 font-mono">
                    Subtotal: {cart.currencySymbol || '₹'}
                    {(cart.subtotal / 100).toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs font-bold text-orange-400">
                <span>View Cart</span>
                <ChevronRight className="w-4 h-4" />
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="border-t border-slate-200/80 bg-white py-6 text-center text-xs text-slate-500 mt-auto">
          <p>© {new Date().getFullYear()} RestaurantOS. Verified public restaurant profile.</p>
        </footer>
      </div>
    </CustomerLocationProvider>
  );
};

export const CustomerRestaurantPage: React.FC<CustomerRestaurantPageProps> = (props) => {
  return (
    <CustomerCartProvider>
      <CustomerRestaurantPageContent {...props} />
    </CustomerCartProvider>
  );
};
