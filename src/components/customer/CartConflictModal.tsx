import React from 'react';
import { AlertCircle, UtensilsCrossed, X, RefreshCw } from 'lucide-react';
import { useCustomerCart } from '../../context/CustomerCartContext';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';

export interface CartConflictModalProps {
  isOpen?: boolean;
  currentRestaurantName?: string;
  pendingRestaurantName?: string;
  pendingItemName?: string;
  onCancel?: () => void;
  onConfirm?: () => void;
}

/**
 * M9-G Cart Conflict Modal.
 * Enforces the Single Restaurant Rule: One customer cart belongs to exactly ONE restaurant.
 * Warns customer when attempting to add items from a second restaurant and requires explicit confirmation.
 */
export const CartConflictModal: React.FC<CartConflictModalProps> = ({
  isOpen: propIsOpen,
  currentRestaurantName: propCurrentRestName,
  pendingRestaurantName: propPendingRestName,
  pendingItemName: propPendingItemName,
  onCancel: propOnCancel,
  onConfirm: propOnConfirm
}) => {
  const { cart, conflictState, cancelConflict, confirmReplaceCart } = useCustomerCart();

  const isContextOpen = Boolean(conflictState);
  const isOpen = propIsOpen !== undefined ? propIsOpen : isContextOpen;

  const currentRestName = propCurrentRestName || cart?.restaurantName || 'another restaurant';
  const pendingRestName = propPendingRestName || conflictState?.pendingRestaurant.restaurantName || 'the new restaurant';
  const pendingItemName = propPendingItemName || conflictState?.pendingItem.name;

  const handleCancel = () => {
    if (propOnCancel) {
      propOnCancel();
    } else {
      cancelConflict();
    }
  };

  const handleConfirm = () => {
    if (propOnConfirm) {
      propOnConfirm();
    } else {
      confirmReplaceCart();
    }
  };

  // Coordinated modal back handler for Android Back button integration
  useModalBackHandler(isOpen, handleCancel, 'cart-conflict-modal');

  if (!isOpen) return null;

  return (
    <div
      id="cart-conflict-modal-overlay"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={handleCancel}
    >
      <div
        id="cart-conflict-modal"
        className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-100 space-y-5 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 shadow-2xs">
            <UtensilsCrossed className="w-6 h-6" />
          </div>
          <button
            id="conflict-close-x-btn"
            onClick={handleCancel}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2">
          <h3 id="conflict-modal-title" className="text-lg font-extrabold text-slate-900 tracking-tight">
            Replace items in cart?
          </h3>
          <p id="conflict-modal-description" className="text-xs text-slate-600 leading-relaxed">
            Your cart contains items from <strong className="text-slate-900 font-bold">{currentRestName}</strong>.
            A customer cart can only contain dishes from one restaurant at a time.
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">
            Do you want to clear your current cart and start a new order from <strong className="text-orange-600 font-bold">{pendingRestName}</strong>?
          </p>

          {pendingItemName && (
            <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">Adding:</span>
              <span className="font-bold text-slate-900">{pendingItemName}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-2">
          <button
            id="conflict-cancel-btn"
            onClick={handleCancel}
            className="w-full sm:w-1/2 py-3 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 text-xs font-bold rounded-2xl transition-colors min-h-[44px]"
          >
            Keep Current Cart
          </button>
          <button
            id="conflict-confirm-replace-btn"
            onClick={handleConfirm}
            className="w-full sm:w-1/2 py-3 bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white text-xs font-bold rounded-2xl shadow-md shadow-orange-600/20 transition-all flex items-center justify-center gap-1.5 min-h-[44px]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Clear & Add</span>
          </button>
        </div>
      </div>
    </div>
  );
};
