import React, { useState } from 'react';
import {
  ShoppingBag,
  X,
  Trash2,
  Plus,
  Minus,
  ChevronRight,
  Utensils,
  AlertTriangle,
  Info,
  ArrowRight,
  FileText
} from 'lucide-react';
import { useCustomerCart } from '../../context/CustomerCartContext';
import { FoodTypeBadge } from './FoodTypeBadge';
import { PublicRestaurantProfile } from '../../types/customer';
import { MenuItem } from '../../types/menu';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';

export interface CustomerCartDrawerProps {
  isOpen?: boolean;
  onClose?: () => void;
  restaurantProfile?: PublicRestaurantProfile | null;
  menuItems?: MenuItem[];
  onCheckout?: () => void;
  onNavigateToMenu?: () => void;
}

/**
 * M9-G Customer Cart Drawer / Panel.
 * Slide-over drawer on desktop and responsive bottom sheet on mobile.
 * Displays restaurant-scoped cart line items, variants, add-ons, notes, quantities, subtotal, and checkout entry.
 */
export const CustomerCartDrawer: React.FC<CustomerCartDrawerProps> = ({
  isOpen: propIsOpen,
  onClose: propOnClose,
  restaurantProfile,
  menuItems,
  onCheckout,
  onNavigateToMenu
}) => {
  const {
    cart,
    isCartDrawerOpen,
    closeCartDrawer,
    removeItem,
    updateQuantity,
    clearCart,
    validateCart
  } = useCustomerCart();

  const [confirmClearOpen, setConfirmClearOpen] = useState<boolean>(false);
  const [checkoutNoticeOpen, setCheckoutNoticeOpen] = useState<boolean>(false);

  const isOpen = propIsOpen !== undefined ? propIsOpen : isCartDrawerOpen;

  const handleClose = () => {
    setConfirmClearOpen(false);
    setCheckoutNoticeOpen(false);
    if (propOnClose) {
      propOnClose();
    } else {
      closeCartDrawer();
    }
  };

  // Coordinated modal back handler for Android Back button integration
  useModalBackHandler(isOpen, handleClose, 'customer-cart-drawer');

  if (!isOpen) return null;

  // Stale cart validation
  const validationResult = validateCart(restaurantProfile, menuItems);
  const currencySymbol = cart?.currencySymbol || restaurantProfile?.currencySymbol || '₹';

  const handleProceedToCheckout = () => {
    if (onCheckout) {
      onCheckout();
    } else {
      setCheckoutNoticeOpen(true);
    }
  };

  return (
    <div
      id="customer-cart-drawer-overlay"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end animate-in fade-in duration-200"
      onClick={handleClose}
    >
      <div
        id="customer-cart-drawer"
        className="w-full max-w-md bg-white h-full flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="p-5 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-orange-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-orange-600/20">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 id="cart-drawer-title" className="text-base font-extrabold text-slate-900 tracking-tight truncate">
                Your Order
              </h2>
              {cart ? (
                <p id="cart-restaurant-name" className="text-xs text-slate-500 truncate font-medium">
                  from <span className="text-slate-900 font-bold">{cart.restaurantName}</span>
                </p>
              ) : (
                <p className="text-xs text-slate-400">Cart is empty</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {cart && cart.items.length > 0 && (
              <button
                id="clear-cart-btn"
                onClick={() => setConfirmClearOpen(true)}
                title="Clear Cart"
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              id="close-cart-drawer-btn"
              onClick={handleClose}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-colors"
              aria-label="Close cart"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Clear Confirmation Inline Notice */}
        {confirmClearOpen && (
          <div id="clear-cart-confirmation-bar" className="p-4 bg-red-50 border-b border-red-100 flex items-center justify-between gap-3 text-xs text-red-900">
            <span className="font-semibold">Clear all items from your cart?</span>
            <div className="flex items-center gap-2">
              <button
                id="cancel-clear-cart-btn"
                onClick={() => setConfirmClearOpen(false)}
                className="px-2.5 py-1 bg-white text-slate-700 font-bold rounded-lg border border-slate-200 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                id="confirm-clear-cart-btn"
                onClick={() => {
                  clearCart();
                  setConfirmClearOpen(false);
                }}
                className="px-2.5 py-1 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Stale / Unavailable Warnings */}
        {!validationResult.isValid && validationResult.issues.length > 0 && (
          <div id="cart-validation-warning-bar" className="p-3.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-900 space-y-1">
            <div className="flex items-center gap-2 font-bold text-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Please review items in your cart</span>
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-700 pl-1">
              {validationResult.issues.map((issue, idx) => (
                <li key={idx}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {!cart || cart.items.length === 0 ? (
            <div id="cart-empty-state" className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
              <div className="w-16 h-16 rounded-3xl bg-slate-100 text-slate-400 flex items-center justify-center">
                <Utensils className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">Your cart is empty</h3>
                <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                  Browse delicious meals from the restaurant menu and add your favorites.
                </p>
              </div>
              {onNavigateToMenu && (
                <button
                  id="browse-menu-from-empty-cart-btn"
                  onClick={() => {
                    handleClose();
                    onNavigateToMenu();
                  }}
                  className="mt-2 px-5 py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors"
                >
                  Browse Menu
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {cart.items.map((item) => {
                const itemLineTotal = (item.price * item.quantity) / 100;
                const isStale = validationResult.staleItemIds.includes(item.itemId);

                return (
                  <div
                    key={item.cartItemId}
                    id={`cart-item-card-${item.cartItemId}`}
                    className={`p-4 rounded-2xl border transition-all ${
                      isStale
                        ? 'bg-amber-50/50 border-amber-200'
                        : 'bg-white border-slate-200/80 shadow-2xs hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0">
                        {item.foodType ? (
                          <FoodTypeBadge foodType={item.foodType} size="sm" className="mt-0.5 shrink-0" />
                        ) : typeof item.isVeg === 'boolean' ? (
                          <FoodTypeBadge foodType={item.isVeg ? 'veg' : 'nonVeg'} size="sm" className="mt-0.5 shrink-0" />
                        ) : null}

                        <div className="min-w-0">
                          <h4 className="text-xs font-bold text-slate-900 tracking-tight line-clamp-2">
                            {item.name}
                          </h4>

                          {/* Variant Badge */}
                          {item.selectedVariantName && (
                            <div className="mt-1">
                              <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-bold rounded-md">
                                Option: {item.selectedVariantName}
                              </span>
                            </div>
                          )}

                          {/* Selected Add-ons List */}
                          {item.selectedAddons && item.selectedAddons.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {item.selectedAddons.map((addon) => (
                                <div
                                  key={addon.addonId}
                                  className="text-[11px] text-slate-500 flex items-center gap-1"
                                >
                                  <span>+ {addon.name}</span>
                                  {addon.price > 0 && (
                                    <span className="font-mono text-slate-400">
                                      (+{currencySymbol}{(addon.price / 100).toFixed(2)})
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Special Instructions Note */}
                          {item.itemNotes && (
                            <div className="mt-1.5 flex items-start gap-1 text-[11px] text-orange-700 bg-orange-50/80 px-2 py-1 rounded-lg border border-orange-100">
                              <FileText className="w-3 h-3 text-orange-500 shrink-0 mt-0.5" />
                              <span className="italic line-clamp-2">"{item.itemNotes}"</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Remove Button */}
                      <button
                        id={`remove-cart-item-btn-${item.cartItemId}`}
                        onClick={() => removeItem(item.cartItemId)}
                        className="text-slate-300 hover:text-red-500 p-1 rounded-lg transition-colors shrink-0"
                        title="Remove item"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Quantity & Price Row */}
                    <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                      {/* Quantity Stepper */}
                      <div className="flex items-center bg-slate-100 rounded-xl p-0.5 border border-slate-200/60 shadow-2xs">
                        <button
                          id={`decrease-qty-btn-${item.cartItemId}`}
                          onClick={() => updateQuantity(item.cartItemId, item.quantity - 1)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 hover:bg-white active:bg-slate-200 transition-colors"
                          aria-label="Decrease quantity"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span
                          id={`cart-item-qty-${item.cartItemId}`}
                          className="w-8 text-center text-xs font-bold font-mono text-slate-900"
                        >
                          {item.quantity}
                        </span>
                        <button
                          id={`increase-qty-btn-${item.cartItemId}`}
                          onClick={() => updateQuantity(item.cartItemId, item.quantity + 1)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 hover:bg-white active:bg-slate-200 transition-colors"
                          aria-label="Increase quantity"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Price */}
                      <div className="text-right">
                        <div id={`cart-item-total-${item.cartItemId}`} className="text-xs font-extrabold font-mono text-slate-900">
                          {currencySymbol}
                          {itemLineTotal.toFixed(2)}
                        </div>
                        {item.quantity > 1 && (
                          <div className="text-[10px] text-slate-400 font-mono">
                            {currencySymbol}{(item.price / 100).toFixed(2)} each
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Drawer Footer & Checkout */}
        {cart && cart.items.length > 0 && (
          <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50 space-y-3">
            {/* Subtotal Summary */}
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between text-slate-600">
                <span>Items Subtotal ({cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'})</span>
                <span id="cart-drawer-subtotal" className="font-mono font-bold text-slate-900">
                  {currencySymbol}
                  {(cart.subtotal / 100).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Info className="w-3 h-3 shrink-0" />
                <span>Taxes, packaging, and delivery calculated at checkout</span>
              </div>
            </div>

            {/* Proceed to Checkout CTA */}
            <button
              id="proceed-to-checkout-btn"
              onClick={handleProceedToCheckout}
              disabled={validationResult.isRestaurantUnavailable || validationResult.isOrderingDisabled}
              className="w-full py-3.5 bg-orange-600 hover:bg-orange-700 active:bg-orange-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-xs font-extrabold rounded-2xl shadow-md shadow-orange-600/20 transition-all flex items-center justify-between px-5 min-h-[44px]"
            >
              <div className="flex items-center gap-2">
                <span>Proceed to Checkout</span>
                <ArrowRight className="w-4 h-4" />
              </div>
              <span className="font-mono text-sm">
                {currencySymbol}
                {(cart.subtotal / 100).toFixed(2)}
              </span>
            </button>

            {/* M9-H Notice Modal / Boundary */}
            {checkoutNoticeOpen && (
              <div
                id="checkout-milestone-boundary-notice"
                className="p-3 bg-indigo-50 border border-indigo-100 rounded-2xl text-indigo-900 text-xs flex items-start gap-2.5 animate-in fade-in duration-150"
              >
                <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div className="space-y-1 flex-1">
                  <span className="font-bold block">Checkout Flow Ready (Milestone M9-H)</span>
                  <p className="text-[11px] text-indigo-700 leading-relaxed">
                    Customer Cart is active and verified! Complete delivery address, payment collection, and order submission will connect in Milestone M9-H.
                  </p>
                </div>
                <button
                  onClick={() => setCheckoutNoticeOpen(false)}
                  className="p-1 text-indigo-400 hover:text-indigo-700"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
