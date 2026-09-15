import React, { useState } from 'react';
import { X, Plus, Minus, Check, Sparkles } from 'lucide-react';
import { MenuItem, MenuItemVariant, MenuItemAddon } from '../../types/menu';
import { CustomerCartItem, PublicRestaurantProfile } from '../../types/customer';
import { FoodTypeBadge } from './FoodTypeBadge';

export interface CustomerItemCustomizerModalProps {
  item: MenuItem;
  restaurant: PublicRestaurantProfile;
  isOpen: boolean;
  onClose: () => void;
  onAddToCart: (cartItem: CustomerCartItem) => void;
}

export const CustomerItemCustomizerModal: React.FC<CustomerItemCustomizerModalProps> = ({
  item,
  restaurant,
  isOpen,
  onClose,
  onAddToCart
}) => {
  if (!isOpen) return null;

  const variants = item.variants || [];
  const addons = item.addons || [];

  // Default variant is first available variant, or null if no variants
  const defaultVariant = variants.length > 0 ? variants[0] : null;
  const [selectedVariant, setSelectedVariant] = useState<MenuItemVariant | null>(defaultVariant);
  const [selectedAddons, setSelectedAddons] = useState<MenuItemAddon[]>([]);
  const [quantity, setQuantity] = useState<number>(1);
  const [notes, setNotes] = useState<string>('');

  const toggleAddon = (addon: MenuItemAddon) => {
    if (selectedAddons.some((a) => a.id === addon.id)) {
      setSelectedAddons(selectedAddons.filter((a) => a.id !== addon.id));
    } else {
      setSelectedAddons([...selectedAddons, addon]);
    }
  };

  // Base price in standard units (e.g. ₹250 or ₹25000 paise depending on representation)
  // In RestaurantOS catalog, MenuItem.price is standard currency units (e.g. 250).
  // CustomerCartItem.price is converted to integer minor units (paise) for financial calculations.
  const unitPriceNumber = selectedVariant ? selectedVariant.price : item.price;
  const addonsTotalNumber = selectedAddons.reduce((sum, a) => sum + (a.price || 0), 0);
  const singleItemTotal = unitPriceNumber + addonsTotalNumber;
  const grandTotal = singleItemTotal * quantity;

  const handleAdd = () => {
    // Generate unique cart item id
    const cartItemId = `${item.itemId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    
    // Price in minor units (paise: ₹1 = 100 paise)
    // Note: If item.price is already large (> 1000 and matches paise) or standard, we ensure minor units standard
    const priceInPaise = Math.round(singleItemTotal * 100);

    const cartItem: CustomerCartItem = {
      cartItemId,
      itemId: item.itemId,
      name: item.name,
      price: priceInPaise,
      quantity,
      selectedVariantId: selectedVariant?.id,
      selectedVariantName: selectedVariant?.name,
      selectedAddons: selectedAddons.map((a) => ({
        addonId: a.id,
        name: a.name,
        price: Math.round(a.price * 100)
      })),
      itemNotes: notes.trim() || undefined,
      imageUrl: item.imageUrl,
      isVeg: item.foodType === 'veg'
    };

    onAddToCart(cartItem);
    onClose();
  };

  return (
    <div
      id="item-customizer-modal"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-slate-100 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <FoodTypeBadge foodType={item.foodType} size="md" className="mt-1" />
            <div>
              <h2 id="customizer-item-name" className="text-lg font-extrabold text-slate-900 tracking-tight">
                {item.name}
              </h2>
              {item.description && (
                <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                  {item.description}
                </p>
              )}
            </div>
          </div>
          <button
            id="close-customizer-btn"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center shrink-0 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body (Scrollable) */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1 text-slate-800">
          {/* Variants Section if present */}
          {variants.length > 0 && (
            <div id="customizer-variants-section" className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Choose Portion / Size
                </h3>
                <span className="text-[11px] font-semibold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-md">
                  Required
                </span>
              </div>
              <div className="space-y-2">
                {variants.map((v) => {
                  const isSelected = selectedVariant?.id === v.id;
                  return (
                    <label
                      key={v.id}
                      className={`flex items-center justify-between p-3.5 rounded-2xl border cursor-pointer transition-all ${
                        isSelected
                          ? 'border-orange-500 bg-orange-50/50 text-slate-900 font-semibold shadow-2xs'
                          : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="radio"
                          name="item-variant"
                          checked={isSelected}
                          onChange={() => setSelectedVariant(v)}
                          className="w-4 h-4 text-orange-600 border-slate-300 focus:ring-orange-500"
                        />
                        <span className="text-xs font-bold">{v.name}</span>
                      </div>
                      <span className="text-xs font-bold font-mono">
                        {restaurant.currencySymbol || '₹'}
                        {v.price}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add-ons Section if present */}
          {addons.length > 0 && (
            <div id="customizer-addons-section" className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-orange-500" />
                  Add-ons & Extras
                </h3>
                <span className="text-[11px] text-slate-400">Optional</span>
              </div>
              <div className="space-y-2">
                {addons.map((addon) => {
                  const isChecked = selectedAddons.some((a) => a.id === addon.id);
                  return (
                    <label
                      key={addon.id}
                      className={`flex items-center justify-between p-3.5 rounded-2xl border cursor-pointer transition-all ${
                        isChecked
                          ? 'border-orange-500 bg-orange-50/40 text-slate-900 font-semibold'
                          : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleAddon(addon)}
                          className="w-4 h-4 text-orange-600 rounded border-slate-300 focus:ring-orange-500"
                        />
                        <span className="text-xs font-bold">{addon.name}</span>
                      </div>
                      <span className="text-xs font-bold font-mono text-slate-700">
                        +{restaurant.currencySymbol || '₹'}
                        {addon.price}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Special Cooking Instructions / Notes */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-900 uppercase tracking-wider block">
              Special Instructions
            </label>
            <textarea
              id="customizer-item-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Less spicy, no onion, extra crispy..."
              rows={2}
              className="w-full text-xs p-3 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 resize-none"
            />
          </div>
        </div>

        {/* Modal Footer Bar */}
        <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-4">
          {/* Quantity Controls */}
          <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-2xs">
            <button
              id="customizer-qty-minus"
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              disabled={quantity <= 1}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span id="customizer-qty-val" className="w-8 text-center text-xs font-bold font-mono text-slate-900">
              {quantity}
            </span>
            <button
              id="customizer-qty-plus"
              onClick={() => setQuantity(quantity + 1)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Add to Cart CTA */}
          <button
            id="customizer-add-to-cart-btn"
            onClick={handleAdd}
            className="flex-1 px-5 py-3 bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white text-xs font-bold rounded-2xl shadow-md shadow-orange-600/20 transition-all flex items-center justify-between min-h-[44px]"
          >
            <span>Add Item</span>
            <span className="font-mono font-extrabold text-sm">
              {restaurant.currencySymbol || '₹'}
              {grandTotal}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
