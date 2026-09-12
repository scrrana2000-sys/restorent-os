import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Table, TableSession } from '../../types/table';
import { Order } from '../../types/order';
import { KOT } from '../../types/kot';
import { MenuItem, Category } from '../../types/menu';
import { CartItem } from '../../types/cart';
import { menuService } from '../../services/menuService';
import { orderService } from '../../services/orderService';
import { tableSessionService } from '../../services/tableSessionService';
import { offlineSyncService } from '../../services/offlineSyncService';
import { useAuth } from '../../context/AuthContext';
import { useRestaurant } from '../../context/RestaurantContext';
import { formatMoney } from '../../utils/money';
import { getCategoryVisual, getItemFallbackVisual } from '../../utils/visualCategory';
import { QuantityStepper } from '../common/QuantityStepper';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import {
  X,
  Search,
  Plus,
  Trash2,
  CookingPot,
  ArrowLeft,
  Utensils,
  AlertCircle,
  CheckCircle2,
  Users,
  ShoppingCart,
  MessageSquare
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
  const currencySymbol = restaurant?.currencySymbol || '₹';

  const [step, setStep] = useState<1 | 2>(1);
  const [activeSession, setActiveSession] = useState<TableSession | null>(session);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderNotes, setOrderNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Sync activeSession from props or fetch if missing
  useEffect(() => {
    if (session) {
      setActiveSession(session);
    } else if (table && isOpen && restaurantId) {
      tableSessionService
        .getActiveSession(restaurantId, table.id)
        .then((s) => {
          if (s) setActiveSession(s);
        })
        .catch((e) => console.warn('Could not load active session:', e));
    }
  }, [session, table, isOpen, restaurantId]);

  // Unified deterministic Back button handling for Staff Order flow
  const handleModalBack = useCallback(() => {
    if (step === 2) {
      setStep(1);
    } else {
      onClose();
    }
  }, [step, onClose]);

  useModalBackHandler(isOpen, handleModalBack, 'staff-order-modal');

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

  // Reset state on modal open, start at Step 1
  useEffect(() => {
    if (isOpen) {
      setStep(1);
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

    if (!table) {
      setErrorMessage('Table selection is required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    // Resolve or initialize session
    let currentSession = activeSession;
    if (!currentSession) {
      try {
        currentSession = await tableSessionService.openSession(
          restaurantId,
          table.id,
          Math.min(2, table.capacity || 1),
          user?.uid || 'floor_captain'
        );
        setActiveSession(currentSession);
      } catch (err: any) {
        console.warn('Auto open session fallback:', err);
        // Try fetching in case already open
        const found = await tableSessionService.getActiveSession(restaurantId, table.id);
        if (found) {
          currentSession = found;
          setActiveSession(found);
        } else {
          setErrorMessage(err.message || 'Active table session is required.');
          setIsSubmitting(false);
          return;
        }
      }
    }

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
            tableSessionId: currentSession.id,
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
        tableSessionId: currentSession.id,
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

  if (!isOpen || !table) return null;

  const currentGuestCount = activeSession?.guestCount || session?.guestCount || Math.min(2, table.capacity || 2);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-xs">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl text-white shadow-2xl animate-in fade-in zoom-in-95 duration-150 flex flex-col h-[92vh] max-h-[850px] overflow-hidden">
        
        {/* Top Header - Always visible with Table & Session Info */}
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
              <Utensils className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-white tracking-tight truncate">
                  Take Order — Table {table.tableNumber}
                </h2>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[11px] font-bold border border-indigo-500/30 shrink-0">
                  <Users className="w-3 h-3" />
                  <span>{currentGuestCount}</span>
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="font-semibold text-slate-300">
                  {step === 1 ? 'Step 1: Select Food' : 'Step 2: Review & Send KOT'}
                </span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-400">
                  {step === 1 ? 'Tap "+ Add" to pick food' : 'Verify items & dispatch'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Step 2 Back Icon in Header */}
            {step === 2 && (
              <button
                type="button"
                data-testid="btn-header-back-to-menu"
                onClick={() => setStep(1)}
                className="p-2 rounded-xl text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors flex items-center gap-1 text-xs font-bold"
                title="Back to Food Menu"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Menu</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              data-testid="btn-close-staff-order"
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Feedback Banners */}
        {errorMessage && (
          <div className="mx-4 mt-3 p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="mx-4 mt-3 p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-center gap-2 shrink-0 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Flow Container with Smooth Transitions */}
        <div className="flex-1 min-h-0 relative overflow-hidden flex flex-col">
          {/* ================= STEP 1: SELECT FOOD ONLY ================= */}
          {step === 1 && (
            <div className="flex-1 min-h-0 flex flex-col animate-in fade-in slide-in-from-left-4 duration-150">
              {/* Search Bar & Category Scroll */}
              <div className="p-3 sm:p-4 pb-2 space-y-2.5 shrink-0 bg-slate-900 border-b border-slate-800/80">
                {/* Search Bar */}
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search food (e.g. Biryani, Naan, Coke...)"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full h-11 pl-10 pr-9 bg-slate-950 border border-slate-800 rounded-2xl text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-hidden focus:border-indigo-500 transition-all font-medium"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Horizontal Category Chips (Biryani, Rice, Drinks, etc.) */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs no-scrollbar">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('all')}
                    className={`h-9 px-4 rounded-xl font-bold whitespace-nowrap transition-all duration-150 shrink-0 flex items-center justify-center active:scale-95 ${
                      selectedCategory === 'all'
                        ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-500'
                        : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700/60'
                    }`}
                  >
                    <span>All Items</span>
                  </button>
                  {categories.map((cat) => {
                    const visual = getCategoryVisual(cat.name);
                    const isSelected = selectedCategory === cat.categoryId;
                    return (
                      <button
                        key={cat.categoryId}
                        type="button"
                        onClick={() => setSelectedCategory(cat.categoryId)}
                        className={`h-9 px-3.5 rounded-xl font-bold whitespace-nowrap transition-all duration-150 shrink-0 flex items-center gap-1.5 active:scale-95 ${
                          isSelected
                            ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-500'
                            : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700/60'
                        }`}
                      >
                        <span className="text-sm shrink-0">{visual.emoji}</span>
                        <span>{cat.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 1 Menu Items 2-Column Image Grid */}
              <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 pb-24">
                {filteredItems.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center p-8 text-center text-slate-400 text-xs space-y-2">
                    <span className="text-3xl">🍽️</span>
                    <p className="font-bold text-slate-300">No food items found</p>
                    <p className="text-slate-500">Try changing search query or category filter</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-2.5 sm:gap-3">
                    {filteredItems.map((item) => {
                      const cartItem = cart.find((ci) => ci.itemId === item.itemId);
                      const isVeg = item.foodType === 'veg';
                      const isEgg = item.foodType === 'egg';
                      const fallback = getItemFallbackVisual(item.name, item.foodType);

                      return (
                        <div
                          key={item.itemId}
                          data-testid={`menu-item-${item.itemId}`}
                          className={`bg-slate-950 rounded-2xl border transition-all duration-150 flex flex-col justify-between overflow-hidden select-none active:scale-[0.98] ${
                            cartItem
                              ? 'border-indigo-500 ring-2 ring-indigo-500/30 shadow-md'
                              : 'border-slate-800 hover:border-slate-700 shadow-xs'
                          }`}
                        >
                          {/* Large Food Image with Veg/Non-Veg Indicator */}
                          <div className="relative w-full aspect-4/3 sm:aspect-square max-h-32 bg-slate-900 overflow-hidden shrink-0">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt={item.name}
                                loading="lazy"
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div
                                className={`w-full h-full bg-gradient-to-br ${fallback.bgGradient} flex items-center justify-center p-2 text-center`}
                              >
                                <span className="text-3xl filter drop-shadow-xs">
                                  {fallback.emoji}
                                </span>
                              </div>
                            )}

                            {/* Veg / Non-Veg / Egg Visual Dot Indicator */}
                            <div className="absolute top-2 left-2 z-10">
                              <div
                                className={`w-4 h-4 rounded-xs border bg-slate-950/90 backdrop-blur-xs flex items-center justify-center shadow-xs ${
                                  isVeg
                                    ? 'border-emerald-500'
                                    : isEgg
                                    ? 'border-amber-500'
                                    : 'border-rose-500'
                                }`}
                                title={item.foodType}
                              >
                                <div
                                  className={`w-2 h-2 rounded-full ${
                                    isVeg
                                      ? 'bg-emerald-500'
                                      : isEgg
                                      ? 'bg-amber-500'
                                      : 'bg-rose-500'
                                  }`}
                                />
                              </div>
                            </div>

                            {/* Quantity pill badge when added */}
                            {cartItem && (
                              <div className="absolute top-2 right-2 z-10">
                                <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white font-black text-xs shadow-md">
                                  {cartItem.quantity}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Food Name, Price & Add Button */}
                          <div className="p-2.5 sm:p-3 flex-1 flex flex-col justify-between gap-2">
                            <div className="min-w-0">
                              <h4 className="text-xs sm:text-sm font-bold text-white leading-tight line-clamp-2" title={item.name}>
                                {item.name}
                              </h4>
                              {item.shortName && (
                                <span className="text-[11px] text-slate-400 block mt-0.5 truncate">
                                  {item.shortName}
                                </span>
                              )}
                              <span className="text-xs sm:text-sm font-black text-slate-200 block mt-1">
                                {formatMoney(Math.round(item.price * 100), currencySymbol)}
                              </span>
                            </div>

                            {/* Quick Add / Stepper Button */}
                            <div className="pt-1">
                              {cartItem ? (
                                <div className="flex items-center justify-center">
                                  <QuantityStepper
                                    value={cartItem.quantity}
                                    min={0}
                                    onChange={(newQty) => {
                                      const delta = newQty - cartItem.quantity;
                                      handleUpdateQuantity(item.itemId, delta);
                                    }}
                                    onIncrement={() => handleUpdateQuantity(item.itemId, 1)}
                                    onDecrement={() => handleUpdateQuantity(item.itemId, -1)}
                                    itemLabel={item.name}
                                    size="md"
                                    theme="dark"
                                    className="w-full justify-between"
                                  />
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleAddItem(item)}
                                  data-testid={`btn-add-${item.itemId}`}
                                  className="w-full h-10 min-h-[40px] px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Add</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Bottom Floating Bar (When items in cart -> Next to Step 2) */}
              {cart.length > 0 && (
                <div className="absolute bottom-3 left-3 right-3 z-30 pointer-events-auto animate-in slide-in-from-bottom-3 duration-200">
                  <div className="bg-slate-950/95 backdrop-blur-md text-white rounded-2xl p-2.5 pl-4 pr-2.5 shadow-2xl border border-slate-700 flex items-center justify-between gap-3">
                    {/* Items & Total Summary */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="relative">
                        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shrink-0 shadow-xs">
                          <ShoppingCart className="w-4 h-4" />
                        </div>
                        <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 bg-rose-500 text-white font-black text-[10px] rounded-full flex items-center justify-center shadow-xs">
                          {totalItemsCount}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs sm:text-sm font-black text-white truncate leading-tight">
                          🛒 {totalItemsCount} {totalItemsCount === 1 ? 'Item' : 'Items'} • {formatMoney(subtotalMinor, currencySymbol)}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate leading-tight mt-0.5">
                          Table {table.tableNumber}
                        </div>
                      </div>
                    </div>

                    {/* Big Next Button */}
                    <button
                      type="button"
                      id="btn-next-review-order"
                      data-testid="btn-next-review-order"
                      onClick={() => setStep(2)}
                      className="flex items-center justify-center gap-2 h-12 min-h-[48px] px-5 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-black text-xs sm:text-sm shadow-md shadow-amber-500/25 active:scale-95 transition-all shrink-0 whitespace-nowrap"
                    >
                      <span>Next → Review Order</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================= STEP 2: REVIEW ORDER & SEND KOT ================= */}
          {step === 2 && (
            <div className="flex-1 min-h-0 flex flex-col animate-in fade-in slide-in-from-right-4 duration-150 bg-slate-900">
              {/* Step 2 Top Bar: Table Number, Guest count & Navigation */}
              <div className="p-3 sm:p-4 bg-slate-950/60 border-b border-slate-800 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center text-base">
                    🪑
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-black text-white leading-tight">
                      Table {table.tableNumber} Order Slip
                    </h3>
                    <p className="text-[11px] text-slate-400 leading-tight mt-0.5">
                      {session.guestCount || 2} Guests • {totalItemsCount} Total Items
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  id="btn-back-to-menu"
                  data-testid="btn-back-to-menu"
                  onClick={() => setStep(1)}
                  className="flex items-center gap-1.5 h-10 min-h-[40px] px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all active:scale-95"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>← Back to Menu</span>
                </button>
              </div>

              {/* Step 2 Main Content: Ordered Items List & Notes */}
              <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3">
                {/* Ordered Items with Image Thumbnails & Stepper Controls */}
                <div className="space-y-2">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
                    Selected Food Items
                  </div>

                  {cart.length === 0 ? (
                    <div className="p-8 text-center bg-slate-950/60 border border-slate-800 rounded-2xl text-slate-400 text-xs space-y-2">
                      <p>No items in cart.</p>
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold"
                      >
                        Go to Menu
                      </button>
                    </div>
                  ) : (
                    cart.map((ci) => {
                      const menuItem = menuItems.find((m) => m.itemId === ci.itemId);
                      const isVeg = menuItem?.foodType === 'veg';
                      const isEgg = menuItem?.foodType === 'egg';
                      const fallback = getItemFallbackVisual(ci.nameSnapshot, menuItem?.foodType);

                      return (
                        <div
                          key={ci.itemId}
                          className="p-3 rounded-2xl bg-slate-950 border border-slate-800 text-xs space-y-2.5 shadow-xs"
                        >
                          <div className="flex items-center justify-between gap-2.5">
                            {/* Left: Thumbnail & Item details */}
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 overflow-hidden shrink-0 relative flex items-center justify-center">
                                {menuItem?.imageUrl ? (
                                  <img
                                    src={menuItem.imageUrl}
                                    alt={ci.nameSnapshot}
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <span className="text-xl">{fallback.emoji}</span>
                                )}

                                {/* Veg/Non-veg dot */}
                                <div className="absolute top-1 left-1">
                                  <div
                                    className={`w-2.5 h-2.5 rounded-2xs border bg-slate-950 flex items-center justify-center ${
                                      isVeg
                                        ? 'border-emerald-500'
                                        : isEgg
                                        ? 'border-amber-500'
                                        : 'border-rose-500'
                                    }`}
                                  >
                                    <div
                                      className={`w-1 h-1 rounded-full ${
                                        isVeg
                                          ? 'bg-emerald-500'
                                          : isEgg
                                          ? 'bg-amber-500'
                                          : 'bg-rose-500'
                                      }`}
                                    />
                                  </div>
                                </div>
                              </div>

                              <div className="min-w-0">
                                <span className="font-bold text-white text-xs sm:text-sm block truncate leading-tight">
                                  {ci.nameSnapshot}
                                </span>
                                <span className="text-xs font-semibold text-slate-400 block leading-tight mt-1">
                                  {formatMoney(ci.unitPriceMinor, currencySymbol)} × {ci.quantity} = {formatMoney(ci.unitPriceMinor * ci.quantity, currencySymbol)}
                                </span>
                              </div>
                            </div>

                            {/* Right: Quantity Stepper & Remove */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              <QuantityStepper
                                value={ci.quantity}
                                min={1}
                                onIncrement={() => handleUpdateQuantity(ci.itemId, 1)}
                                onDecrement={() => handleUpdateQuantity(ci.itemId, -1)}
                                itemLabel={ci.nameSnapshot}
                                size="sm"
                                theme="dark"
                              />

                              <button
                                type="button"
                                aria-label={`Remove ${ci.nameSnapshot}`}
                                onClick={() => handleRemoveItem(ci.itemId)}
                                className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-rose-400 hover:bg-slate-900 border border-transparent hover:border-slate-800 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          {/* Item-specific kitchen note input */}
                          <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                            <MessageSquare className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <input
                              type="text"
                              placeholder="Item note (e.g. less spicy, extra cheese)..."
                              value={ci.notes || ''}
                              onChange={(e) => handleItemNoteChange(ci.itemId, e.target.value)}
                              className="w-full bg-slate-900/90 border border-slate-800/80 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-hidden focus:border-indigo-500"
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Overall Kitchen Instructions Box */}
                <div className="pt-2 space-y-1.5">
                  <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <CookingPot className="w-3.5 h-3.5 text-amber-400" />
                    <span>Overall Kitchen Instructions</span>
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Overall kitchen instructions (e.g. serve starters first)..."
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-indigo-500 transition-colors resize-none"
                  />
                </div>
              </div>

              {/* Step 2 Bottom Section: Estimated Total & Big Send to Kitchen Button */}
              <div className="p-3 sm:p-4 bg-slate-950 border-t border-slate-800 space-y-3 shrink-0">
                <div className="flex items-center justify-between text-xs sm:text-sm px-1">
                  <span className="text-slate-400 font-medium">Estimated Total ({totalItemsCount} items):</span>
                  <span className="font-black text-white text-base sm:text-lg">
                    {formatMoney(subtotalMinor, currencySymbol)}
                  </span>
                </div>

                {/* Big Send to Kitchen Button & Back to Menu Action */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="sm:col-span-1 h-12 min-h-[48px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Back to Menu</span>
                  </button>

                  <button
                    type="button"
                    id="btn-confirm-send-kitchen"
                    data-testid="btn-confirm-send-kitchen"
                    onClick={handleConfirmAndSendToKitchen}
                    disabled={isSubmitting || cart.length === 0}
                    className="sm:col-span-2 h-12 min-h-[48px] rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white font-black text-sm sm:text-base flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-600/30 active:scale-[0.99]"
                  >
                    <CookingPot className="w-5 h-5 text-white" />
                    <span>
                      {isSubmitting ? 'SENDING TO KITCHEN...' : 'SEND TO KITCHEN'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
