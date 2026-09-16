import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Utensils,
  Search,
  ArrowLeft,
  ShoppingBag,
  Info,
  Clock,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  ChevronRight,
  X,
  Building,
  AlertCircle,
  Plus,
  User,
  Compass,
  Menu
} from 'lucide-react';
import { PublicRestaurantProfile, CustomerCartItem } from '../../types/customer';
import { Category, MenuItem } from '../../types/menu';
import {
  resolveRestaurantBySlug,
  resolveRestaurantByPublicCode,
  resolveRestaurantById
} from '../../services/customerDiscoveryService';
import {
  fetchPublicMenu,
  subscribeToPublicMenu,
  PublicMenuData
} from '../../services/customerMenuService';
import {
  extractRestaurantIdentifierFromUrl,
  PRODUCTION_BASE_PATH,
  buildPublicRestaurantUrl
} from '../../utils/urlUtils';
import { FoodTypeBadge } from '../../components/customer/FoodTypeBadge';
import { CustomerItemCustomizerModal } from '../../components/customer/CustomerItemCustomizerModal';
import { CustomerCartProvider, useCustomerCart } from '../../context/CustomerCartContext';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { CustomerCartDrawer } from '../../components/customer/CustomerCartDrawer';
import { CustomerSidebarDrawer } from '../../components/customer/CustomerSidebarDrawer';
import { CustomerLocationBar } from '../../components/customer/CustomerLocationBar';
import { CartConflictModal } from '../../components/customer/CartConflictModal';
import { CustomerCheckoutModal } from '../../components/customer/CustomerCheckoutModal';
import { CustomerProfileModal } from '../../components/customer/CustomerProfileModal';
import { CustomerOrderTrackingModal } from '../../components/customer/CustomerOrderTrackingModal';
import { CustomerMyOrdersModal } from '../../components/customer/CustomerMyOrdersModal';
import { getActiveOrdersCount } from '../../services/customerOrderTrackingService';

export interface CustomerRestaurantMenuPageProps {
  initialProfile?: PublicRestaurantProfile;
  slug?: string;
  code?: string;
  restaurantId?: string;
  onBack?: () => void;
  onBackToDiscovery?: () => void;
  onViewProfile?: (restaurant: PublicRestaurantProfile) => void;
  onAddToCart?: (item: CustomerCartItem) => void;
  onViewCart?: () => void;
  cartItemCount?: number;
  cartSubtotal?: number; // in paise
}

const CustomerRestaurantMenuPageContent: React.FC<CustomerRestaurantMenuPageProps> = ({
  initialProfile,
  slug: propSlug,
  code: propCode,
  restaurantId: propRestaurantId,
  onBack,
  onBackToDiscovery,
  onViewProfile,
  onAddToCart,
  onViewCart,
  cartItemCount = 0,
  cartSubtotal = 0
}) => {
  const [restaurant, setRestaurant] = useState<PublicRestaurantProfile | null>(initialProfile || null);
  const [menuData, setMenuData] = useState<PublicMenuData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<boolean>(false);

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDiet, setSelectedDiet] = useState<'all' | 'veg' | 'nonveg'>('all');
  const [activeCategoryId, setActiveCategoryId] = useState<string>('');

  // Item customization modal
  const [customizingItem, setCustomizingItem] = useState<MenuItem | null>(null);

  // Checkout & Tracking Modal states
  const [isCheckoutModalOpen, setIsCheckoutModalOpen] = useState<boolean>(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);
  const [isMyOrdersOpen, setIsMyOrdersOpen] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isTrackingModalOpen, setIsTrackingModalOpen] = useState<boolean>(false);
  const [trackingOrderParams, setTrackingOrderParams] = useState<{ restaurantId: string; orderId: string } | null>(null);
  const [activeOrdersCount, setActiveOrdersCount] = useState<number>(0);
  const orderJustSubmittedRef = useRef(false);

  // Customer Auth
  const { customer, firebaseUser } = useCustomerAuth();
  const currentUid = customer?.customerId || firebaseUser?.uid || null;

  // Refresh active orders count
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

  // Deep-linking: check URL params for ?track=orderId or #track?orderId=...
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const trackOrderId = urlParams.get('track') || urlParams.get('trackOrderId');
    const trackRestId = urlParams.get('rest') || urlParams.get('restaurantId') || propRestaurantId || propSlug;

    if (trackOrderId && trackRestId) {
      setTrackingOrderParams({ restaurantId: trackRestId, orderId: trackOrderId });
      setIsTrackingModalOpen(true);
    }
  }, [propRestaurantId, propSlug]);

  // Local fallback cart counters if context is bypassed
  const [localCartCount, setLocalCartCount] = useState<number>(cartItemCount);
  const [localCartSubtotal, setLocalCartSubtotal] = useState<number>(cartSubtotal);

  // Cart Context
  const {
    cart,
    addItem,
    openCartDrawer,
    closeCartDrawer
  } = useCustomerCart();

  // Determine if cart belongs to current restaurant
  const isCartFromThisRestaurant = Boolean(
    cart && restaurant && cart.restaurantId === restaurant.restaurantId && cart.items.length > 0
  );

  const displayCartCount = isCartFromThisRestaurant ? cart!.itemCount : (localCartCount || cartItemCount);
  const displayCartSubtotal = isCartFromThisRestaurant ? cart!.subtotal : (localCartSubtotal || cartSubtotal);

  // Resolution workflow
  const loadRestaurantAndMenu = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setNotFound(false);

    try {
      let targetSlug = propSlug;
      let targetCode = propCode;
      let targetId = propRestaurantId;

      if (!targetSlug && !targetCode && !targetId && !initialProfile) {
        const urlParams = extractRestaurantIdentifierFromUrl();
        if (urlParams) {
          targetSlug = urlParams.slug;
          targetCode = urlParams.code;
        }
      }

      let profile: PublicRestaurantProfile | null = initialProfile || null;

      if (!profile) {
        if (targetSlug) {
          profile = await resolveRestaurantBySlug(targetSlug);
        } else if (targetCode) {
          profile = await resolveRestaurantByPublicCode(targetCode);
        } else if (targetId) {
          profile = await resolveRestaurantById(targetId);
        }
      }

      if (!profile) {
        setNotFound(true);
        setIsLoading(false);
        return;
      }

      setRestaurant(profile);

      // Fetch authoritative public menu for resolved restaurantId
      const menu = await fetchPublicMenu(profile.restaurantId);
      setMenuData(menu);
      if (menu.categories.length > 0) {
        setActiveCategoryId(menu.categories[0].categoryId);
      }
    } catch (err: any) {
      console.warn('[RestaurantOS] Error loading restaurant menu:', err);
      setError('Unable to load restaurant menu. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [propSlug, propCode, propRestaurantId, initialProfile]);

  useEffect(() => {
    loadRestaurantAndMenu();
  }, [loadRestaurantAndMenu]);

  // Live real-time menu subscription when restaurant is resolved
  useEffect(() => {
    if (!restaurant?.restaurantId) return;

    const unsub = subscribeToPublicMenu(
      restaurant.restaurantId,
      (updatedMenu) => {
        setMenuData(updatedMenu);
        if (updatedMenu.categories.length > 0 && !activeCategoryId) {
          setActiveCategoryId(updatedMenu.categories[0].categoryId);
        }
      },
      (err) => {
        console.warn('[RestaurantOS] Live menu update error:', err);
      }
    );

    return () => unsub();
  }, [restaurant?.restaurantId]);

  // Navigation handlers
  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (restaurant && onViewProfile) {
      onViewProfile(restaurant);
    } else if (typeof window !== 'undefined') {
      if (restaurant) {
        window.location.hash = `r/${restaurant.publicSlug}`;
      } else if (onBackToDiscovery) {
        onBackToDiscovery();
      } else {
        const base = import.meta.env.BASE_URL || PRODUCTION_BASE_PATH;
        window.location.href = `${base}?view=discover`;
      }
    }
  };

  const handleProfileClick = () => {
    if (restaurant) {
      if (onViewProfile) {
        onViewProfile(restaurant);
      } else if (typeof window !== 'undefined') {
        window.location.hash = `r/${restaurant.publicSlug}`;
      }
    }
  };

  const handleScrollToCategory = (categoryId: string) => {
    setActiveCategoryId(categoryId);
    const element = document.getElementById(`category-section-${categoryId}`);
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Add to cart handler
  const handleAddItem = (item: MenuItem) => {
    // If item has variants or add-ons, open customizer modal
    if ((item.variants && item.variants.length > 0) || (item.addons && item.addons.length > 0)) {
      setCustomizingItem(item);
      return;
    }

    // Direct addition for standard items
    const priceInPaise = Math.round(item.price * 100);
    const cartItem: CustomerCartItem = {
      cartItemId: `${item.itemId}-${Date.now()}`,
      itemId: item.itemId,
      name: item.name,
      price: priceInPaise,
      quantity: 1,
      imageUrl: item.imageUrl,
      isVeg: item.foodType === 'veg',
      foodType: item.foodType
    };

    if (restaurant) {
      addItem(cartItem, {
        restaurantId: restaurant.restaurantId,
        restaurantName: restaurant.name,
        publicSlug: restaurant.publicSlug,
        publicRestaurantCode: restaurant.publicRestaurantCode,
        currency: restaurant.currency,
        currencySymbol: restaurant.currencySymbol
      });
    }

    if (onAddToCart) {
      onAddToCart(cartItem);
    }

    // Update local cart preview counters
    setLocalCartCount((prev) => prev + 1);
    setLocalCartSubtotal((prev) => prev + priceInPaise);
  };

  const handleCustomizerAddToCart = (cartItem: CustomerCartItem) => {
    if (restaurant) {
      addItem(cartItem, {
        restaurantId: restaurant.restaurantId,
        restaurantName: restaurant.name,
        publicSlug: restaurant.publicSlug,
        publicRestaurantCode: restaurant.publicRestaurantCode,
        currency: restaurant.currency,
        currencySymbol: restaurant.currencySymbol
      });
    }

    if (onAddToCart) {
      onAddToCart(cartItem);
    }
    setLocalCartCount((prev) => prev + cartItem.quantity);
    setLocalCartSubtotal((prev) => prev + cartItem.price * cartItem.quantity);
    setCustomizingItem(null);
  };

  const handleCartClick = () => {
    if (onViewCart) {
      onViewCart();
      return;
    }
    openCartDrawer();
  };

  // Filter items based on search and dietary filter
  const filteredCategoriesWithItems = useMemo(() => {
    if (!menuData) return [];

    const query = searchQuery.trim().toLowerCase();

    return menuData.categories
      .map((cat) => {
        const categoryItems = menuData.itemsByCategory[cat.categoryId] || [];
        const filtered = categoryItems.filter((item) => {
          // Dietary filter
          if (selectedDiet === 'veg' && item.foodType !== 'veg') return false;
          if (selectedDiet === 'nonveg' && item.foodType !== 'nonVeg') return false;

          // Search query filter
          if (query) {
            const matchesName = item.name.toLowerCase().includes(query);
            const matchesDesc = (item.description || '').toLowerCase().includes(query);
            const matchesCategory = cat.name.toLowerCase().includes(query);
            return matchesName || matchesDesc || matchesCategory;
          }

          return true;
        });

        return {
          ...cat,
          filteredItems: filtered
        };
      })
      .filter((cat) => cat.filteredItems.length > 0);
  }, [menuData, searchQuery, selectedDiet]);

  const totalVisibleItems = useMemo(() => {
    return filteredCategoriesWithItems.reduce((sum, cat) => sum + cat.filteredItems.length, 0);
  }, [filteredCategoriesWithItems]);

  const isOpenForOrders =
    restaurant?.publicStatus === 'active' &&
    restaurant?.onlineOrderingEnabled === true &&
    restaurant?.isOpenNow !== false;

  return (
    <div className="min-h-screen glass-neu-canvas text-slate-900 flex flex-col pb-28">
      {/* Sticky Top Bar */}
      <header className="sticky top-0 z-40 glass-neu-header">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            {/* Sidebar Drawer Toggle Button (Left Side) */}
            <button
              id="menu-header-sidebar-trigger-btn"
              onClick={() => setIsSidebarOpen(true)}
              className="relative glass-neu-btn-primary p-2 sm:p-2.5 text-xs font-bold rounded-xl flex items-center justify-center cursor-pointer shrink-0 min-h-[38px] min-w-[38px] sm:min-h-[42px] sm:min-w-[42px]"
              title="Open Sidebar Menu"
              aria-label="Open Sidebar Menu"
            >
              <Menu className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <button
              id="menu-back-btn"
              onClick={handleBack}
              className="glass-neu-btn px-3 py-2 text-xs font-bold text-slate-800 rounded-xl shrink-0 min-h-[38px] sm:min-h-[42px] flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </button>

            {restaurant && (
              <div className="min-w-0">
                <h1
                  id="menu-header-restaurant-name"
                  onClick={handleProfileClick}
                  className="text-sm sm:text-base font-extrabold text-slate-900 truncate cursor-pointer hover:text-orange-600 transition-colors"
                >
                  {restaurant.name}
                </h1>
                <p className="text-[11px] text-slate-500 truncate">
                  {restaurant.area ? `${restaurant.area}, ` : ''}{restaurant.city}
                </p>
              </div>
            )}
          </div>

          {/* Header Action Buttons - Cart Button */}
          <div className="flex items-center gap-2">
            <button
              id="menu-header-cart-trigger-btn"
              onClick={openCartDrawer}
              className="relative p-2.5 sm:p-3 bg-white border border-slate-200 text-slate-800 hover:bg-slate-50 rounded-xl sm:rounded-2xl shadow-xs flex items-center justify-center cursor-pointer shrink-0 min-h-[38px] min-w-[38px] sm:min-h-[42px] sm:min-w-[42px] transition-all"
              title="View Cart"
              aria-label="View Cart"
            >
              <ShoppingBag className="w-4 h-4 sm:w-5 sm:h-5 text-slate-800" />
              <span
                id="menu-header-cart-count"
                className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 bg-orange-600 text-white text-[10px] font-black rounded-full shadow-[0_2px_5px_rgba(234,88,12,0.4)] min-w-[18px] text-center"
              >
                {displayCartCount}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Menu Layout */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Loading Skeleton */}
        {isLoading && (
          <div id="menu-loading-skeleton" className="space-y-6 animate-pulse">
            {/* Header skeleton */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 space-y-4 shadow-xs">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-slate-200 shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-6 bg-slate-200 rounded-md w-1/3" />
                  <div className="h-4 bg-slate-200 rounded-md w-1/4" />
                </div>
              </div>
            </div>

            {/* Filter pills skeleton */}
            <div className="flex gap-2">
              <div className="h-10 bg-slate-200 rounded-xl w-28" />
              <div className="h-10 bg-slate-200 rounded-xl w-24" />
              <div className="h-10 bg-slate-200 rounded-xl w-24" />
            </div>

            {/* Item cards skeleton */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="h-32 bg-white rounded-2xl border border-slate-200/80 p-4" />
              <div className="h-32 bg-white rounded-2xl border border-slate-200/80 p-4" />
              <div className="h-32 bg-white rounded-2xl border border-slate-200/80 p-4" />
              <div className="h-32 bg-white rounded-2xl border border-slate-200/80 p-4" />
            </div>
          </div>
        )}

        {/* Error State */}
        {!isLoading && error && (
          <div
            id="menu-error-box"
            className="p-8 bg-red-50 border border-red-200 rounded-3xl text-center max-w-md mx-auto my-12 shadow-xs"
          >
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h2 className="text-base font-bold text-red-900 mb-1">Unable to Load Menu</h2>
            <p className="text-xs text-red-700 mb-6 leading-relaxed">{error}</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                id="menu-retry-btn"
                onClick={loadRestaurantAndMenu}
                className="w-full sm:w-auto px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors inline-flex items-center justify-center gap-2 min-h-[44px]"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Retry</span>
              </button>
              <button
                onClick={handleBack}
                className="w-full sm:w-auto px-5 py-2.5 bg-white border border-red-200 text-red-700 hover:bg-red-50 text-xs font-bold rounded-xl transition-colors min-h-[44px]"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* Not Found State */}
        {!isLoading && !error && notFound && (
          <div
            id="menu-not-found-box"
            className="p-10 bg-white border border-slate-200 rounded-3xl text-center max-w-md mx-auto my-12 shadow-xs"
          >
            <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-200/60">
              <Building className="w-7 h-7" />
            </div>
            <h2 className="text-base font-bold text-slate-900 mb-1">Restaurant Menu Not Found</h2>
            <p className="text-xs text-slate-500 mb-6 leading-relaxed">
              We could not locate this restaurant or its public menu catalog.
            </p>
            <button
              onClick={handleBack}
              className="px-6 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-xs transition-colors inline-flex items-center gap-2 min-h-[44px]"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Discovery</span>
            </button>
          </div>
        )}

        {/* Menu Content View */}
        {!isLoading && !error && !notFound && restaurant && menuData && (
          <div id={`restaurant-public-menu-${restaurant.restaurantId}`} className="space-y-6">
            {/* Restaurant Summary Card */}
            <div className="glass-neu-card rounded-3xl overflow-hidden p-0">
              {(restaurant.bannerImageUrl || restaurant.coverImageUrl) && (
                <div className="relative h-32 sm:h-44 w-full bg-slate-800 overflow-hidden">
                  <img
                    id="menu-banner-image"
                    src={restaurant.bannerImageUrl || restaurant.coverImageUrl!}
                    alt={`${restaurant.name} banner`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/60 via-transparent to-transparent" />
                </div>
              )}
              <div className="p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-orange-100/80 border border-white flex items-center justify-center overflow-hidden shrink-0 shadow-[3px_3px_8px_rgba(234,88,12,0.2)]">
                  {restaurant.logoUrl ? (
                    <img
                      src={restaurant.logoUrl}
                      alt={restaurant.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Utensils className="w-6 h-6 text-orange-600" />
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2
                      id="public-menu-title"
                      className="text-lg font-extrabold text-slate-900 tracking-tight"
                    >
                      {restaurant.name}
                    </h2>
                    <span className="font-mono text-[10px] font-bold px-2 py-0.5 bg-slate-200/80 text-slate-700 rounded-md border border-white">
                      {restaurant.publicRestaurantCode}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5 flex-wrap">
                    {restaurant.cuisine.length > 0 && (
                      <span>{restaurant.cuisine.join(' • ')}</span>
                    )}
                    <span>•</span>
                    <span>{restaurant.area || restaurant.city}</span>
                  </div>
                </div>
              </div>

              {/* Status and Profile Info Link */}
              <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-200/60">
                <div>
                  {isOpenForOrders ? (
                    <span
                      id="menu-status-open"
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/90 text-white shadow-[2px_2px_6px_rgba(16,185,129,0.3)] border border-white/50"
                    >
                      <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                      Open for Orders
                    </span>
                  ) : restaurant.publicStatus === 'paused' ? (
                    <span
                      id="menu-status-paused"
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/90 text-white shadow-[2px_2px_6px_rgba(245,158,11,0.3)] border border-white/50"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Paused
                    </span>
                  ) : restaurant.publicStatus === 'closed' ? (
                    <span
                      id="menu-status-closed"
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-700/90 text-slate-100 shadow-xs border border-white/20"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      Closed
                    </span>
                  ) : (
                    <span
                      id="menu-status-ordering-off"
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-600/90 text-white shadow-xs border border-white/30"
                    >
                      <Info className="w-3.5 h-3.5" />
                      Dine-in Only
                    </span>
                  )}
                </div>

                <button
                  id="view-restaurant-about-btn"
                  onClick={handleProfileClick}
                  className="text-xs font-bold text-orange-600 hover:text-orange-700 inline-flex items-center gap-1 transition-colors"
                >
                  <span>Restaurant Info</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

            {/* Operating Notice Banners */}
            {restaurant.publicStatus === 'paused' && (
              <div
                id="menu-paused-banner"
                className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 text-amber-900 shadow-2xs"
              >
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs space-y-0.5">
                  <div className="font-bold">Ordering Currently Paused</div>
                  <p className="text-amber-700 leading-relaxed">
                    This restaurant is temporarily paused and not accepting new incoming orders right now. You may still browse the full menu.
                  </p>
                </div>
              </div>
            )}

            {restaurant.publicStatus === 'closed' && (
              <div
                id="menu-closed-banner"
                className="p-4 bg-slate-100 border border-slate-200 rounded-2xl flex items-start gap-3 text-slate-800 shadow-2xs"
              >
                <Clock className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
                <div className="text-xs space-y-0.5">
                  <div className="font-bold">Restaurant Closed</div>
                  <p className="text-slate-600 leading-relaxed">
                    This restaurant is currently closed. You can view menu offerings and prices below.
                  </p>
                </div>
              </div>
            )}

            {!restaurant.onlineOrderingEnabled && (
              <div
                id="menu-online-disabled-banner"
                className="p-4 bg-blue-50 border border-blue-200 rounded-2xl flex items-start gap-3 text-blue-900 shadow-2xs"
              >
                <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="text-xs space-y-0.5">
                  <div className="font-bold">Dine-in & Walk-in Catalog Only</div>
                  <p className="text-blue-700 leading-relaxed">
                    Online ordering is disabled by this restaurant. Browse our menu to plan your visit or takeaway.
                  </p>
                </div>
              </div>
            )}

            {/* Search & Dietary Filters Bar */}
            <div className="glass-neu-card rounded-3xl p-4 space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="menu-search-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search for dishes, items, categories..."
                  className="w-full pl-10 pr-10 py-2.5 glass-neu-inset text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none transition-all"
                />
                {searchQuery && (
                  <button
                    id="clear-menu-search-btn"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-full"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Dietary Filter Chips */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                <button
                  id="diet-filter-all"
                  onClick={() => setSelectedDiet('all')}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 min-h-[36px] ${
                    selectedDiet === 'all'
                      ? 'glass-neu-pill-active'
                      : 'glass-neu-pill'
                  }`}
                >
                  All Items
                </button>
                <button
                  id="diet-filter-veg"
                  onClick={() => setSelectedDiet('veg')}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 min-h-[36px] ${
                    selectedDiet === 'veg'
                      ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-[3px_3px_10px_rgba(16,185,129,0.35)] border border-white/50'
                      : 'glass-neu-pill'
                  }`}
                >
                  <FoodTypeBadge foodType="veg" size="sm" />
                  <span>Veg Only</span>
                </button>
                <button
                  id="diet-filter-nonveg"
                  onClick={() => setSelectedDiet('nonveg')}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 min-h-[36px] ${
                    selectedDiet === 'nonveg'
                      ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-[3px_3px_10px_rgba(239,68,68,0.35)] border border-white/50'
                      : 'glass-neu-pill'
                  }`}
                >
                  <FoodTypeBadge foodType="nonVeg" size="sm" />
                  <span>Non-Veg</span>
                </button>
              </div>
            </div>

            {/* Empty Menu State when no categories or active items exist */}
            {menuData.totalActiveItems === 0 && (
              <div
                id="menu-empty-state"
                className="p-12 bg-white border border-slate-200 rounded-3xl text-center max-w-md mx-auto my-8 shadow-xs"
              >
                <div className="w-14 h-14 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center mx-auto mb-4 border border-orange-100">
                  <Utensils className="w-7 h-7" />
                </div>
                <h3 className="text-base font-bold text-slate-900 mb-1">No Menu Items Available</h3>
                <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                  This restaurant has not published any active menu items yet. Please check back soon.
                </p>
                <button
                  onClick={handleBack}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-xs transition-colors min-h-[44px]"
                >
                  Back to Restaurant
                </button>
              </div>
            )}

            {/* No Search Matches State */}
            {menuData.totalActiveItems > 0 && totalVisibleItems === 0 && (
              <div
                id="menu-no-results-state"
                className="p-10 bg-white border border-slate-200 rounded-3xl text-center max-w-md mx-auto my-6 shadow-xs"
              >
                <Search className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-slate-900 mb-1">No Matching Dishes Found</h3>
                <p className="text-xs text-slate-500 mb-4">
                  No items matched "{searchQuery}" with the selected dietary filters.
                </p>
                <button
                  id="reset-menu-filters-btn"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedDiet('all');
                  }}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
                >
                  Clear Filters
                </button>
              </div>
            )}

            {/* Sticky Category Navigation Bar */}
            {filteredCategoriesWithItems.length > 1 && (
              <div className="sticky top-16 z-30 glass-neu-header py-3 -mx-4 sm:-mx-6 px-4 sm:px-6">
                <div className="max-w-5xl mx-auto flex items-center gap-2 overflow-x-auto scrollbar-none">
                  {filteredCategoriesWithItems.map((category) => {
                    const isSelected = activeCategoryId === category.categoryId;
                    return (
                      <button
                        key={category.categoryId}
                        id={`cat-nav-${category.categoryId}`}
                        onClick={() => handleScrollToCategory(category.categoryId)}
                        className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all shrink-0 flex items-center gap-1.5 min-h-[38px] ${
                          isSelected
                            ? 'glass-neu-pill-active bg-orange-600'
                            : 'glass-neu-pill'
                        }`}
                      >
                        <span>{category.name}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                            isSelected ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {category.filteredItems.length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Menu Sections by Category */}
            {filteredCategoriesWithItems.map((category) => (
              <section
                key={category.categoryId}
                id={`category-section-${category.categoryId}`}
                className="space-y-4 scroll-mt-32"
              >
                {/* Category Header */}
                <div className="border-b border-slate-200 pb-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                      <span>{category.name}</span>
                      <span className="text-xs font-normal text-slate-400 font-mono">
                        ({category.filteredItems.length})
                      </span>
                    </h3>
                  </div>
                  {category.description && (
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                      {category.description}
                    </p>
                  )}
                </div>

                {/* Items Grid / List */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {category.filteredItems.map((item) => {
                    const hasCustomization =
                      (item.variants && item.variants.length > 0) ||
                      (item.addons && item.addons.length > 0);
                    const isOutOfStock = !item.isAvailable;

                    return (
                      <div
                        key={item.itemId}
                        id={`menu-item-${item.itemId}`}
                        className={`glass-neu-card rounded-3xl p-4 sm:p-5 flex flex-col justify-between gap-4 ${
                          isOutOfStock
                            ? 'opacity-65'
                            : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          {/* Item Details */}
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <FoodTypeBadge foodType={item.foodType} size="md" />
                              {item.foodType === 'veg' && (
                                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-sm">
                                  Pure Veg
                                </span>
                              )}
                            </div>

                            <h4 className="text-sm font-bold text-slate-900 tracking-tight">
                              {item.name}
                            </h4>

                            <div className="text-sm font-extrabold text-slate-900 font-mono">
                              {restaurant.currencySymbol || '₹'}
                              {item.price}
                            </div>

                            {item.description && (
                              <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed pt-0.5">
                                {item.description}
                              </p>
                            )}

                            {hasCustomization && (
                              <div className="text-[11px] font-semibold text-orange-600 flex items-center gap-1 pt-1">
                                <Sparkles className="w-3 h-3" />
                                <span>Customizable options available</span>
                              </div>
                            )}
                          </div>

                          {/* Item Image with Fallback */}
                          <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-slate-100 overflow-hidden shrink-0 border border-slate-100">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt={item.name}
                                referrerPolicy="no-referrer"
                                className={`w-full h-full object-cover ${
                                  isOutOfStock ? 'grayscale' : ''
                                }`}
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-orange-50/50 text-orange-300">
                                <Utensils className="w-8 h-8" />
                              </div>
                            )}

                            {isOutOfStock && (
                              <div className="absolute inset-0 bg-black/50 backdrop-blur-2xs flex items-center justify-center p-1">
                                <span className="text-[10px] font-extrabold text-white text-center uppercase tracking-wider">
                                  Sold Out
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Action Row */}
                        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                          <div>
                            {isOutOfStock ? (
                              <span className="text-xs font-bold text-slate-400">
                                Currently Unavailable
                              </span>
                            ) : hasCustomization ? (
                              <span className="text-[11px] text-slate-400">
                                Size / Extras
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400">
                                Standard item
                              </span>
                            )}
                          </div>

                          <div>
                            {isOutOfStock ? (
                              <button
                                disabled
                                className="px-4 py-2 bg-slate-200 text-slate-400 text-xs font-bold rounded-xl cursor-not-allowed min-h-[38px]"
                              >
                                Sold Out
                              </button>
                            ) : !isOpenForOrders ? (
                              <button
                                onClick={() => {
                                  if (restaurant.publicStatus === 'paused') {
                                    alert('Ordering is currently paused by this restaurant.');
                                  } else if (restaurant.publicStatus === 'closed') {
                                    alert('This restaurant is currently closed.');
                                  } else {
                                    alert('Online ordering is not enabled for this restaurant.');
                                  }
                                }}
                                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs font-bold rounded-xl transition-colors min-h-[38px]"
                              >
                                View Only
                              </button>
                            ) : hasCustomization ? (
                              <button
                                id={`customize-item-btn-${item.itemId}`}
                                onClick={() => handleAddItem(item)}
                                className="glass-neu-btn px-4 py-2 text-orange-700 font-bold text-xs rounded-xl inline-flex items-center gap-1.5 min-h-[38px]"
                              >
                                <Plus className="w-3.5 h-3.5 text-orange-600" />
                                <span>Customize</span>
                              </button>
                            ) : (
                              <button
                                id={`add-item-btn-${item.itemId}`}
                                onClick={() => handleAddItem(item)}
                                className="glass-neu-btn-primary px-5 py-2 text-xs font-bold rounded-xl inline-flex items-center gap-1.5 min-h-[38px]"
                              >
                                <Plus className="w-3.5 h-3.5 text-white" />
                                <span>Add</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            {/* Customization Modal */}
            {customizingItem && (
              <CustomerItemCustomizerModal
                item={customizingItem}
                restaurant={restaurant}
                isOpen={!!customizingItem}
                onClose={() => setCustomizingItem(null)}
                onAddToCart={handleCustomizerAddToCart}
              />
            )}

            {/* Customer Cart Drawer */}
            <CustomerCartDrawer
              restaurantProfile={restaurant}
              menuItems={menuData ? menuData.allItems : undefined}
              onCheckout={() => {
                closeCartDrawer();
                setIsCheckoutModalOpen(true);
              }}
            />

            {/* Customer Checkout Modal */}
            <CustomerCheckoutModal
              isOpen={isCheckoutModalOpen}
              onClose={() => {
                setIsCheckoutModalOpen(false);
                if (!orderJustSubmittedRef.current) {
                  openCartDrawer();
                } else {
                  orderJustSubmittedRef.current = false;
                }
              }}
              onOrderSubmitted={() => {
                orderJustSubmittedRef.current = true;
                refreshActiveOrders();
              }}
              onTrackOrder={(restId, ordId) => {
                setTrackingOrderParams({ restaurantId: restId, orderId: ordId });
                setIsTrackingModalOpen(true);
              }}
              restaurantProfile={restaurant}
              menuItems={menuData ? menuData.allItems : undefined}
              onEditCart={() => {
                setIsCheckoutModalOpen(false);
                openCartDrawer();
              }}
            />

            {/* Cart Conflict Modal (Cross-Restaurant Guard) */}
            <CartConflictModal />

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
              restaurantProfile={restaurant || undefined}
              menuItems={menuData ? menuData.allItems : undefined}
              onCheckout={() => {
                setIsSidebarOpen(false);
                setIsCheckoutModalOpen(true);
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
              restaurantId={trackingOrderParams?.restaurantId || restaurant?.restaurantId}
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
        )}
      </main>

      {/* Floating Bottom Cart Bar */}
      {displayCartCount > 0 && (
        <div className="fixed bottom-5 left-4 right-4 z-40 max-w-lg mx-auto animate-in slide-in-from-bottom duration-300">
          <div
            id="floating-cart-bar"
            onClick={handleCartClick}
            className="bg-slate-900/90 backdrop-blur-xl text-white rounded-2xl p-4 shadow-[0_12px_32px_rgba(0,0,0,0.35)] border border-white/20 flex items-center justify-between gap-4 cursor-pointer hover:bg-slate-900 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-orange-500 to-amber-500 flex items-center justify-center text-white font-mono font-bold text-sm shadow-[2px_2px_8px_rgba(234,88,12,0.4)] border border-white/30">
                {displayCartCount}
              </div>
              <div>
                <div className="text-xs font-extrabold tracking-tight">
                  {displayCartCount} {displayCartCount === 1 ? 'item' : 'items'} added
                </div>
                <div className="text-[11px] text-slate-300 font-mono">
                  Subtotal: {restaurant?.currencySymbol || '₹'}
                  {(displayCartSubtotal / 100).toFixed(2)}
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
    </div>
  );
};

export const CustomerRestaurantMenuPage: React.FC<CustomerRestaurantMenuPageProps> = (props) => {
  return (
    <CustomerCartProvider>
      <CustomerRestaurantMenuPageContent {...props} />
    </CustomerCartProvider>
  );
};
