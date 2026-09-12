import React, { useState, useEffect, useMemo } from 'react';
import { Table, TableSession } from '../../types/table';
import { Order } from '../../types/order';
import { KOT } from '../../types/kot';
import { MenuItem, Category } from '../../types/menu';
import { CartItem } from '../../types/cart';
import { menuService } from '../../services/menuService';
import { orderService } from '../../services/orderService';
import { kotService } from '../../services/kotService';
import { offlineSyncService } from '../../services/offlineSyncService';
import { useAuth } from '../../context/AuthContext';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatMoney } from '../../utils/money';
import {
  X,
  Search,
  Plus,
  Minus,
  Trash2,
  CookingPot,
  Send,
  Utensils,
  AlertCircle,
  CheckCircle2,
  Receipt,
  FileText
} from 'lucide-react';

interface StaffOrderModalProps {
  isOpen: boolean;
  table: Table | null;
  session: TableSession | null;
  existingOrder?: Order | null;
  onClose: () => void;
  onOrderPlaced?: (order: Order, kot: KOT) => void;
}

export const StaffOrderModal: React.FC<StaffOrderModalProps> = ({
  isOpen,
  table,
  session,
  existingOrder,
  onClose,
  onOrderPlaced
}) => {
  const { restaurant } = useRestaurant();
  const { user } = useAuth();
  const restaurantId = restaurant?.restaurantId || '';

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderNotes, setOrderNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Subscribe to menu items and categories
  useEffect(() => {
    if (!restaurantId || !isOpen) return;

    const unsubItems = menuService.subscribeToMenuItems(
      restaurantId,
      (items) => setMenuItems(items.filter((item) => item.isAvailable !== false)),
      (err) => console.warn('Menu items sub error:', err)
    );

    const unsubCats = menuService.subscribeToCategories(
      restaurantId,
      (cats) => setCategories(cats),
      (err) => console.warn('Categories sub error:', err)
    );

    return () => {
      unsubItems();
      unsubCats();
    };
  }, [restaurantId, isOpen]);

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setCart([]);
      setOrderNotes('');
      setErrorMessage(null);
      setSuccessMessage(null);
      setSearchQuery('');
      setSelectedCategory('all');
    }
  }, [isOpen]);

  // Filtered menu items
  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      const matchesCat = selectedCategory === 'all' || item.categoryId === selectedCategory;
      const matchesSearch =
        !searchQuery.trim() ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.shortName && item.shortName.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesCat && matchesSearch;
    });
  }, [menuItems, selectedCategory, searchQuery]);

  // Cart operations
  const handleAddItem = (item: MenuItem) => {
    const itemPriceMinor = Math.round(item.price * 100);
    setCart((prev) => {
      const existingIndex = prev.findIndex((ci) => ci.itemId === item.itemId);
      if (existingIndex > -1) {
        const next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: next[existingIndex].quantity + 1
        };
        return next;
      }

      const newCartItem: CartItem = {
        cartItemId: `ci_${item.itemId}_${Date.now()}`,
        itemId: item.itemId,
        nameSnapshot: item.name,
        shortNameSnapshot: item.shortName,
        unitPriceMinor: itemPriceMinor,
        quantity: 1,
        taxRate: item.taxRate || 5,
        taxInclusive: item.taxInclusive ?? false
      };
      return [...prev, newCartItem];
    });
  };

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    setCart((prev) => {
      return prev
        .map((ci) => {
          if (ci.itemId === itemId) {
            const nextQty = ci.quantity + delta;
            return nextQty > 0 ? { ...ci, quantity: nextQty } : null;
          }
          return ci;
        })
        .filter((ci): ci is CartItem => ci !== null);
    });
  };

  const handleItemNoteChange = (itemId: string, notes: string) => {
    setCart((prev) =>
      prev.map((ci) => (ci.itemId === itemId ? { ...ci, notes } : ci))
    );
  };

  const handleRemoveItem = (itemId: string) => {
    setCart((prev) => prev.filter((ci) => ci.itemId !== itemId));
  };

  // Cart totals preview
  const subtotalMinor = useMemo(() => {
    return cart.reduce((sum, ci) => sum + ci.unitPriceMinor * ci.quantity, 0);
  }, [cart]);

  const totalItemsCount = useMemo(() => {
    return cart.reduce((sum, ci) => sum + ci.quantity, 0);
  }, [cart]);

  // Submit Order and KOT
  const handleConfirmAndSendToKitchen = async () => {
    if (cart.length === 0) {
      setErrorMessage('Please add at least one item to the order.');
      return;
    }

    if (!table || !session) {
      setErrorMessage('Active table session is required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const clientRequestId = `staff_ord_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        // Enqueue offline operation
        offlineSyncService.enqueue(
          restaurantId,
          'create_order_with_kot',
          {
            cartState: { items: cart, notes: orderNotes },
            orderType: 'dineIn',
            source: 'captain',
            tableId: table.id,
            tableSessionId: session.id,
            notes: orderNotes,
            createdBy: user?.uid || 'floor_captain'
          },
          clientRequestId
        );
        setSuccessMessage('Offline mode: Order & KOT queued locally for synchronization.');
        setTimeout(() => {
          onClose();
        }, 1500);
        return;
      }

      const result = await orderService.createOrderAndKOTFromCart({
        restaurantId,
        cartState: { items: cart, notes: orderNotes },
        orderType: 'dineIn',
        source: 'captain',
        tableId: table.id,
        tableSessionId: session.id,
        notes: orderNotes,
        createdBy: user?.uid || 'floor_captain',
        clientRequestId
      });

      setSuccessMessage(`Order #${result.order.orderNumber} sent to kitchen! (KOT: ${result.kot.kotNumber})`);
      if (onOrderPlaced) {
        onOrderPlaced(result.order, result.kot);
      }

      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      console.error('Failed to submit staff order:', err);
      setErrorMessage(err.message || 'Failed to submit order to kitchen.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !table || !session) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-xs">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl p-4 sm:p-6 text-white shadow-2xl animate-in fade-in zoom-in-95 duration-150 flex flex-col h-[92vh] max-h-[850px]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Utensils className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  Take Order — Table {table.tableNumber}
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-bold border border-indigo-500/30">
                  {session.guestCount} Guests
                </span>
              </div>
              <p className="text-xs text-slate-400">Floor Staff Order & Kitchen Ticket Dispatch</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            data-testid="btn-close-staff-order"
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback banners */}
        {errorMessage && (
          <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="mt-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2 shrink-0 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Main 2-column layout */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 gap-4 mt-3">
          {/* Left: Menu selection (7 cols) */}
          <div className="md:col-span-7 flex flex-col min-h-0 space-y-3">
            {/* Search & Category Filter */}
            <div className="space-y-2 shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search menu items..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-indigo-500"
                />
              </div>

              {/* Categories Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('all')}
                  className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-colors ${
                    selectedCategory === 'all'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  All Items
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.categoryId}
                    type="button"
                    onClick={() => setSelectedCategory(cat.categoryId)}
                    className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap transition-colors ${
                      selectedCategory === cat.categoryId
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Menu Items Grid */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              {filteredItems.length === 0 ? (
                <div className="h-full flex items-center justify-center p-8 text-center text-slate-500 text-xs">
                  No menu items found.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                  {filteredItems.map((item) => {
                    const cartItem = cart.find((ci) => ci.itemId === item.itemId);
                    return (
                      <div
                        key={item.itemId}
                        onClick={() => handleAddItem(item)}
                        data-testid={`menu-item-${item.itemId}`}
                        className={`p-3 rounded-xl border cursor-pointer transition-all flex flex-col justify-between select-none ${
                          cartItem
                            ? 'bg-indigo-950/40 border-indigo-500/50 shadow-xs'
                            : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'
                        }`}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="text-xs font-bold text-white leading-tight">
                              {item.name}
                            </h4>
                            {cartItem && (
                              <span className="px-1.5 py-0.5 rounded bg-indigo-600 text-[10px] font-bold text-white shrink-0">
                                {cartItem.quantity}x
                              </span>
                            )}
                          </div>
                          {item.shortName && (
                            <span className="text-[10px] text-slate-400 block mt-0.5">
                              {item.shortName}
                            </span>
                          )}
                        </div>

                        <div className="mt-2 flex items-center justify-between text-xs pt-1.5 border-t border-slate-800/60">
                          <span className="font-bold text-slate-300">
                            {formatMoney(item.priceMinor)}
                          </span>
                          <span className="text-[10px] text-indigo-400 font-semibold inline-flex items-center gap-1">
                            <Plus className="w-3 h-3" /> Add
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: Order Cart & Kitchen Dispatch (5 cols) */}
          <div className="md:col-span-5 bg-slate-950/80 border border-slate-800 rounded-xl p-3 sm:p-4 flex flex-col min-h-0">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs sm:text-sm font-bold text-white">Current Order Items</h3>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {totalItemsCount} items
              </span>
            </div>

            {/* Cart Items List */}
            <div className="flex-1 min-h-0 overflow-y-auto py-2 space-y-2">
              {cart.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-500 text-xs">
                  <Utensils className="w-8 h-8 mb-2 opacity-40" />
                  <p>Tap menu items on the left to add to table order.</p>
                </div>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.itemId}
                    className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-bold text-white block truncate">{item.nameSnapshot}</span>
                        <span className="text-[10px] text-slate-400">
                          {formatMoney(item.unitPriceMinor)} each
                        </span>
                      </div>

                      {/* Quantity Controls */}
                      <div className="flex items-center gap-1 shrink-0 bg-slate-950 border border-slate-800 rounded-lg p-0.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUpdateQuantity(item.itemId, -1);
                          }}
                          className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-800"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-5 text-center font-bold text-slate-200">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUpdateQuantity(item.itemId, 1);
                          }}
                          className="w-5 h-5 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-800"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Kitchen Note per item */}
                    <div className="flex items-center gap-2 pt-1 border-t border-slate-800/60">
                      <input
                        type="text"
                        placeholder="Kitchen note (e.g. less spicy)..."
                        value={item.notes || ''}
                        onChange={(e) => handleItemNoteChange(item.itemId, e.target.value)}
                        className="flex-1 bg-slate-950 border border-slate-800/80 rounded px-2 py-0.5 text-[10px] text-slate-300 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.itemId)}
                        className="text-slate-500 hover:text-rose-400 p-0.5"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* General Order Notes & Totals */}
            <div className="pt-2 border-t border-slate-800 space-y-2 shrink-0">
              <input
                type="text"
                placeholder="Overall ticket instructions / allergen info..."
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-indigo-500"
              />

              <div className="flex items-center justify-between text-xs px-1">
                <span className="text-slate-400">Estimated Subtotal:</span>
                <span className="font-bold text-white font-mono">
                  {formatMoney(subtotalMinor)}
                </span>
              </div>

              {/* Action Button: Confirm & Send to Kitchen */}
              <button
                type="button"
                data-testid="btn-confirm-send-kitchen"
                onClick={handleConfirmAndSendToKitchen}
                disabled={isSubmitting || cart.length === 0}
                className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs inline-flex items-center justify-center gap-2 transition-all shadow-md active:scale-98"
              >
                <CookingPot className="w-4 h-4 text-indigo-200" />
                <span>
                  {isSubmitting ? 'Sending to Kitchen...' : 'Confirm & Send to Kitchen'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
