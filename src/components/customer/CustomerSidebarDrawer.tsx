import React, { useState } from 'react';
import {
  User,
  Compass,
  ShoppingBag,
  X,
  LogOut,
  Trash2,
  Plus,
  Minus,
  AlertTriangle,
  Info,
  ArrowRight,
  FileText,
  MapPin,
  UtensilsCrossed,
  Home
} from 'lucide-react';
import { useCustomerCart } from '../../context/CustomerCartContext';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { useCustomerLocation } from '../../context/CustomerLocationContext';
import { CustomerLocationSelectorModal } from './CustomerLocationSelectorModal';
import { FoodTypeBadge } from './FoodTypeBadge';
import { PublicRestaurantProfile } from '../../types/customer';
import { MenuItem } from '../../types/menu';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import { getActiveOrdersCount } from '../../services/customerOrderTrackingService';

export interface CustomerSidebarDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenProfile: () => void;
  onOpenMyOrders: () => void;
  restaurantProfile?: PublicRestaurantProfile | null;
  menuItems?: MenuItem[];
  onCheckout?: () => void;
  onNavigateToMenu?: () => void;
}

/**
 * Responsive Unified Customer Sidebar Drawer.
 * Merges User Profile/Login, My Orders tracking, and dynamic Cart actions into a single pane.
 */
export const CustomerSidebarDrawer: React.FC<CustomerSidebarDrawerProps> = ({
  isOpen,
  onClose,
  onOpenProfile,
  onOpenMyOrders,
  restaurantProfile,
  menuItems,
  onCheckout,
  onNavigateToMenu
}) => {
  const { customer, signOut } = useCustomerAuth();
  const { location } = useCustomerLocation();
  const {
    cart,
    removeItem,
    updateQuantity,
    clearCart,
    validateCart
  } = useCustomerCart();

  const [confirmClearOpen, setConfirmClearOpen] = useState<boolean>(false);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState<boolean>(false);

  // Coordinated modal back handler for Android Back button integration
  useModalBackHandler(isOpen, onClose, 'customer-sidebar-drawer');

  if (!isOpen) return null;

  const currentUid = customer?.customerId || null;
  const activeOrdersCount = getActiveOrdersCount(currentUid);
  const itemCount = cart?.itemCount || 0;
  const validationResult = validateCart(restaurantProfile, menuItems);
  const currencySymbol = cart?.currencySymbol || restaurantProfile?.currencySymbol || '₹';

  const handleProceedToCheckout = () => {
    // Checkout is owned by the parent menu page. Never trap the customer
    // inside the sidebar with the old M9-H informational notice.
    if (onCheckout) {
      onCheckout();
      return;
    }

    // Defensive fallback for any legacy caller that has not yet supplied the
    // callback. The menu page listens for this event and opens the real
    // checkout modal.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('restaurantos_open_checkout'));
    }
  };

  const handleSignOutClick = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('[Sidebar] Sign out error:', err);
    }
  };

  return (
    <div
      id="customer-sidebar-drawer-overlay"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex justify-start animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        id="customer-sidebar-drawer"
        className="w-80 max-w-[85vw] sm:max-w-xs bg-slate-50 h-full flex flex-col overflow-hidden shadow-2xl border-r border-slate-200 animate-in slide-in-from-left duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white flex items-center justify-center font-black shadow-xs">
              <UtensilsCrossed className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 tracking-tight">
                RestaurantOS
              </h2>
              <p className="text-[10px] font-extrabold text-orange-600 uppercase tracking-wider">
                Online Food Discovery
              </p>
            </div>
          </div>
          <button
            id="close-sidebar-drawer-btn"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close sidebar panel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Quick Navigation Menu Links */}
          <div className="bg-white rounded-2xl p-2 border border-slate-200/80 shadow-xs space-y-1">
            <button
              id="sidebar-nav-home"
              onClick={() => {
                onClose();
                if (typeof window !== 'undefined') {
                  window.location.hash = 'discover';
                }
              }}
              className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-orange-50 text-slate-800 hover:text-orange-950 font-bold text-xs transition-colors cursor-pointer text-left"
            >
              <div className="w-7 h-7 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                <Home className="w-4 h-4" />
              </div>
              <span>Home / Discover</span>
            </button>

            <button
              id="sidebar-nav-orders"
              onClick={() => {
                onClose();
                onOpenMyOrders();
              }}
              className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-orange-50 text-slate-800 hover:text-orange-950 font-bold text-xs transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                  <Compass className="w-4 h-4" />
                </div>
                <span>My Orders</span>
              </div>
              {activeOrdersCount > 0 && (
                <span className="px-2 py-0.5 bg-emerald-500 text-white text-[10px] font-black rounded-full">
                  {activeOrdersCount}
                </span>
              )}
            </button>

            <button
              id="sidebar-nav-profile"
              onClick={() => {
                onClose();
                onOpenProfile();
              }}
              className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-orange-50 text-slate-800 hover:text-orange-950 font-bold text-xs transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4" />
                </div>
                <span>Profile & Account</span>
              </div>
              <span className="text-[10px] text-slate-400 font-normal">
                {customer ? customer.name.split(' ')[0] : 'Sign In'}
              </span>
            </button>

            <button
              id="sidebar-nav-location"
              onClick={() => {
                onClose();
                setIsLocationModalOpen(true);
              }}
              className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-orange-50 text-slate-800 hover:text-orange-950 font-bold text-xs transition-colors cursor-pointer text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                  <MapPin className="w-4 h-4" />
                </div>
                <span>Location</span>
              </div>
              <span className="text-[10px] text-slate-500 font-bold truncate max-w-[100px]">
                {location?.city || 'Set Location'}
              </span>
            </button>
          </div>
          
          {/* Section 1: Profile & Login Status */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100/85 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
                Profile Details
              </span>
              {customer && (
                <button
                  id="sidebar-sign-out-btn"
                  onClick={handleSignOutClick}
                  className="text-[11px] font-bold text-red-500 hover:text-red-700 flex items-center gap-1 transition-colors cursor-pointer"
                  title="Sign Out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              )}
            </div>

            {customer ? (
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-orange-500 to-amber-500 text-white flex items-center justify-center text-sm font-black overflow-hidden border border-orange-100">
                  {customer.photoURL ? (
                    <img
                      src={customer.photoURL}
                      alt={customer.name}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    customer.name[0].toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="text-xs font-bold text-slate-800 truncate">
                    {customer.name}
                  </h4>
                  <p className="text-[11px] text-slate-400 truncate">
                    {customer.email}
                  </p>
                </div>
                <button
                  id="sidebar-edit-profile-btn"
                  onClick={onOpenProfile}
                  className="px-2.5 py-1 text-[10px] font-extrabold text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-lg border border-orange-100 transition-all cursor-pointer"
                >
                  Edit
                </button>
              </div>
            ) : (
              <div className="space-y-2 text-center py-2">
                <p className="text-xs text-slate-500">
                  Sign in to save addresses, track active orders, and customize your meals.
                </p>
                <button
                  id="sidebar-sign-in-btn"
                  onClick={onOpenProfile}
                  className="w-full py-2 bg-gradient-to-r from-orange-500 to-amber-500 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer hover:opacity-95 transition-opacity"
                >
                  Sign In / Create Account
                </button>
              </div>
            )}
          </div>

          {/* Section 2: Orders Tracking */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100/85 shadow-xs space-y-3">
            <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block">
              Active Orders
            </span>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
                  <Compass className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-slate-800">
                    My Orders
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    {activeOrdersCount > 0 ? `${activeOrdersCount} order(s) active` : 'No active orders'}
                  </p>
                </div>
              </div>
              <button
                id="sidebar-view-orders-btn"
                onClick={onOpenMyOrders}
                className="px-3 py-1.5 text-[10px] font-extrabold bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl border border-slate-200 transition-all cursor-pointer flex items-center gap-1 shrink-0"
              >
                <span>View</span>
                {activeOrdersCount > 0 && (
                  <span className="w-4 h-4 bg-emerald-500 text-white text-[9px] font-black rounded-full flex items-center justify-center font-mono">
                    {activeOrdersCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Section 3: Your Cart Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
                Your Order ({itemCount})
              </span>
              {cart && cart.items.length > 0 && (
                <button
                  id="sidebar-clear-cart-btn"
                  onClick={() => setConfirmClearOpen(true)}
                  className="text-[11px] font-extrabold text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors cursor-pointer"
                  title="Clear Cart"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              )}
            </div>

            {/* Clear confirmation inside sidebar */}
            {confirmClearOpen && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-center justify-between gap-2.5 text-[11px] text-red-900">
                <span className="font-semibold">Clear your entire cart?</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setConfirmClearOpen(false)}
                    className="px-2 py-0.5 bg-white text-slate-600 font-bold rounded-md border border-slate-200"
                  >
                    No
                  </button>
                  <button
                    onClick={() => {
                      clearCart();
                      setConfirmClearOpen(false);
                    }}
                    className="px-2 py-0.5 bg-red-600 text-white font-bold rounded-md"
                  >
                    Yes
                  </button>
                </div>
              </div>
            )}

            {/* Validation warnings */}
            {!validationResult.isValid && validationResult.issues.length > 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-900 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Review Cart Items</span>
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-[10px] text-amber-700 pl-1">
                  {validationResult.issues.map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            {!cart || cart.items.length === 0 ? (
              <div className="bg-white rounded-2xl p-6 border border-slate-100/85 text-center space-y-2">
                <div className="w-10 h-10 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center mx-auto">
                  <ShoppingBag className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800">Your cart is empty</h4>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                    Choose yummy foods from the restaurant menu to add them here.
                  </p>
                </div>
                {onNavigateToMenu && (
                  <button
                    onClick={() => {
                      onClose();
                      onNavigateToMenu();
                    }}
                    className="px-4 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-bold rounded-xl"
                  >
                    Browse Menu
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                {cart.items.map((item) => {
                  const itemLineTotal = (item.price * item.quantity) / 100;
                  const isStale = validationResult.staleItemIds.includes(item.itemId);

                  return (
                    <div
                      key={item.cartItemId}
                      className={`p-3 bg-white border border-slate-100/85 rounded-xl transition-all ${
                        isStale ? 'border-amber-300 bg-amber-50/40' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          {item.foodType ? (
                            <FoodTypeBadge foodType={item.foodType} size="sm" className="mt-0.5 shrink-0" />
                          ) : typeof item.isVeg === 'boolean' ? (
                            <FoodTypeBadge foodType={item.isVeg ? 'veg' : 'nonVeg'} size="sm" className="mt-0.5 shrink-0" />
                          ) : null}

                          <div className="min-w-0">
                            <h4 className="text-[11px] font-bold text-slate-800 truncate">
                              {item.name}
                            </h4>
                            {item.selectedVariantName && (
                              <p className="text-[9px] text-slate-500">
                                Option: {item.selectedVariantName}
                              </p>
                            )}
                            {item.selectedAddons && item.selectedAddons.length > 0 && (
                              <p className="text-[9px] text-slate-400 truncate">
                                + {item.selectedAddons.map((a) => a.name).join(', ')}
                              </p>
                            )}
                          </div>
                        </div>

                        <button
                          onClick={() => removeItem(item.cartItemId)}
                          className="text-slate-300 hover:text-red-500 p-0.5 rounded transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Stepper + Total */}
                      <div className="mt-2.5 pt-2 border-t border-slate-50 flex items-center justify-between">
                        <div className="flex items-center bg-slate-50 rounded-lg p-0.5 border border-slate-150">
                          <button
                            onClick={() => updateQuantity(item.cartItemId, item.quantity - 1)}
                            className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:bg-white"
                          >
                            <Minus className="w-2.5 h-2.5" />
                          </button>
                          <span className="w-6 text-center text-[10px] font-bold font-mono text-slate-800">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(item.cartItemId, item.quantity + 1)}
                            className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:bg-white"
                          >
                            <Plus className="w-2.5 h-2.5" />
                          </button>
                        </div>

                        <span className="text-[11px] font-black font-mono text-slate-800">
                          {currencySymbol}
                          {itemLineTotal.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Drawer Footer / Checkout Row */}
        {cart && cart.items.length > 0 && (
          <div className="p-4 bg-white border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-500 px-1">
              <span>Items Subtotal</span>
              <span className="font-mono font-bold text-slate-800 text-sm">
                {currencySymbol}
                {(cart.subtotal / 100).toFixed(2)}
              </span>
            </div>

            <button
              id="sidebar-checkout-btn"
              onClick={handleProceedToCheckout}
              disabled={validationResult.isRestaurantUnavailable || validationResult.isOrderingDisabled}
              className="w-full py-3 bg-gradient-to-r from-orange-500 to-amber-500 disabled:opacity-50 text-white text-xs font-black rounded-xl flex items-center justify-between px-4 shadow-sm"
            >
              <div className="flex items-center gap-1.5">
                <span>Proceed to Checkout</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </div>
              <span className="font-mono text-xs">
                {currencySymbol}
                {(cart.subtotal / 100).toFixed(2)}
              </span>
            </button>

          </div>
        )}
      </div>

      <CustomerLocationSelectorModal
        isOpen={isLocationModalOpen}
        onClose={() => setIsLocationModalOpen(false)}
      />
    </div>
  );
};
