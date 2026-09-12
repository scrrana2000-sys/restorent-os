import React, { useState, useEffect, useMemo } from 'react';
import { useRestaurant } from '../context/RestaurantContext';
import { useAuth } from '../context/AuthContext';
import { subscribeToCategories, subscribeToMenuItems } from '../services/menuService';
import { orderService } from '../services/orderService';
import { kotService } from '../services/kotService';
import { tableSessionService } from '../services/tableSessionService';
import { Category, MenuItem } from '../types/menu';
import { CartItem } from '../types/cart';
import { Order, OrderType } from '../types/order';
import { KOT } from '../types/kot';
import { Table, TableSession } from '../types/table';
import { DiscountSpec } from '../types/discount';
import { toMoneyMinor, formatMoney } from '../utils/money';

import { PosHeader } from '../components/pos/PosHeader';
import { CategoryBar } from '../components/pos/CategoryBar';
import { MenuGrid } from '../components/pos/MenuGrid';
import { CartPanel } from '../components/pos/CartPanel';
import { TableSelectorModal } from '../components/pos/TableSelectorModal';
import { OrderSentModal } from '../components/pos/OrderSentModal';
import { PaymentModal } from '../components/pos/PaymentModal';
import { BillReceiptModal } from '../components/pos/BillReceiptModal';
import { HeldOrdersModal, HeldOrderDraft } from '../components/pos/HeldOrdersModal';
import { PaymentDueCenterModal } from '../components/pos/PaymentDueCenterModal';
import { AdminView } from '../components/layout/Sidebar';

import { CheckCircle2, AlertCircle, RefreshCw, X, ShoppingBag, ShoppingCart, ArrowRight, ChevronLeft } from 'lucide-react';

interface PosPageProps {
  onNavigate?: (view: AdminView) => void;
  onOpenMobileMenu?: () => void;
}

export const PosPage: React.FC<PosPageProps> = ({ onNavigate, onOpenMobileMenu }) => {
  const { restaurant, loading: restaurantLoading, error: restaurantError } = useRestaurant();
  const { user } = useAuth();
  const restaurantId = restaurant?.restaurantId || '';

  // Menu Categories & Items state
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState<boolean>(true);
  const [menuError, setMenuError] = useState<string | null>(null);

  // POS Filter & Search state
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Order & Cart state
  const [orderType, setOrderType] = useState<OrderType>('dineIn');
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [activeSession, setActiveSession] = useState<TableSession | null>(null);

  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [orderDiscount, setOrderDiscount] = useState<DiscountSpec | undefined>(undefined);
  const [orderNotes, setOrderNotes] = useState<string>('');

  // Held Carts state
  const [heldDrafts, setHeldDrafts] = useState<HeldOrderDraft[]>([]);

  // Payment Due Center state
  const [paymentDueOrders, setPaymentDueOrders] = useState<Order[]>([]);
  const [paymentDueLoading, setPaymentDueLoading] = useState<boolean>(true);
  const [paymentDueError, setPaymentDueError] = useState<string | null>(null);
  const [isPaymentDueModalOpen, setIsPaymentDueModalOpen] = useState<boolean>(false);

  // Modals
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isBillModalOpen, setIsBillModalOpen] = useState(false);
  const [isHeldOrdersModalOpen, setIsHeldOrdersModalOpen] = useState(false);

  const [activeOrderForPayment, setActiveOrderForPayment] = useState<Order | null>(null);
  const [activeOrderForBill, setActiveOrderForBill] = useState<Order | null>(null);
  const [sentOrderInfo, setSentOrderInfo] = useState<{ order: Order; kot: KOT } | null>(null);

  // Processing & Toast feedback
  const [activeMobileTab, setActiveMobileTab] = useState<'menu' | 'cart'>('menu');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const symbol = restaurant?.currencySymbol || '₹';
  const cartItemsCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems]
  );
  const cartSubtotalMinor = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.unitPriceMinor * item.quantity, 0),
    [cartItems]
  );

  // 1. Subscribe to real-time Categories and MenuItems
  useEffect(() => {
    if (!restaurantId) return;

    setMenuLoading(true);
    setMenuError(null);

    let unsubCats = () => {};
    let unsubItems = () => {};

    try {
      unsubCats = subscribeToCategories(
        restaurantId,
        (cats) => {
          setCategories(cats.filter((c) => c.isActive));
        },
        (err) => console.error('Categories error:', err)
      );

      unsubItems = subscribeToMenuItems(
        restaurantId,
        (items) => {
          setMenuItems(items);
          setMenuLoading(false);
        },
        (err: any) => {
          console.error('Menu items error:', err);
          setMenuError(err.message || 'Failed to load menu items');
          setMenuLoading(false);
        }
      );
    } catch (err: any) {
      setMenuError(err.message || 'Error subscribing to menu data');
      setMenuLoading(false);
    }

    return () => {
      unsubCats();
      unsubItems();
    };
  }, [restaurantId]);

  // Subscribe to real-time changes on activeSession to clear state when session is closed automatically or by another user
  useEffect(() => {
    if (!restaurantId || !activeSession?.id) return;

    const unsubscribe = tableSessionService.subscribeToTableSession(
      restaurantId,
      activeSession.id,
      (updatedSession) => {
        if (updatedSession?.status === 'closed') {
          setActiveSession(null);
          setSelectedTable(null);
        } else if (updatedSession) {
          setActiveSession(updatedSession);
        }
      },
      (err) => console.error('Table session listener error:', err)
    );

    return () => unsubscribe();
  }, [restaurantId, activeSession?.id]);

  // Subscribe to real-time payment due orders
  useEffect(() => {
    if (!restaurantId) return;

    setPaymentDueLoading(true);
    setPaymentDueError(null);

    const unsubscribe = orderService.subscribeToPaymentDueOrders(
      restaurantId,
      (dueOrders) => {
        setPaymentDueOrders(dueOrders);
        setPaymentDueLoading(false);
        setPaymentDueError(null);
      },
      (err) => {
        console.error('[PosPage] Payment due subscription error:', err);
        setPaymentDueError(err?.message || 'Failed to load payment due orders.');
        setPaymentDueLoading(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  const totalPaymentDueMinor = useMemo(() => {
    return paymentDueOrders.reduce((sum, ord) => {
      const due = ord.dueAmountMinor ?? Math.max(0, (ord.grandTotalMinor || 0) - (ord.paidAmountMinor || 0));
      return sum + due;
    }, 0);
  }, [paymentDueOrders]);

  const handleCloseTableSession = async (
    tableToClose?: Table | null,
    sessionToClose?: TableSession | null
  ) => {
    const targetTable = tableToClose || selectedTable;
    const targetSession = sessionToClose || activeSession;

    if (!restaurantId || (!targetTable && !targetSession)) return;

    const targetSessionId = targetSession?.id || targetTable?.activeSessionId;
    if (!targetSessionId) {
      setStatusMessage({ type: 'info', text: 'Table has no active session.' });
      return;
    }

    setIsSubmitting(true);
    try {
      await tableSessionService.closeSession(
        restaurantId,
        targetSessionId,
        user?.uid || 'cashier',
        { autoCompleteSettledOrders: true, source: 'pos_manual' }
      );

      setStatusMessage({
        type: 'success',
        text: `Table ${targetTable?.tableNumber || ''} session successfully closed. Table is now available.`
      });

      if (selectedTable?.id === targetTable?.id || activeSession?.id === targetSessionId) {
        setSelectedTable(null);
        setActiveSession(null);
        setCartItems([]);
      }
    } catch (err: any) {
      console.error('POS Manual Table Close Error:', err);
      setStatusMessage({
        type: 'error',
        text: err.message || 'Failed to close table session.'
      });
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered Items computation
  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      // Category filter
      if (selectedCategoryId && item.categoryId !== selectedCategoryId) {
        return false;
      }
      // Search query filter
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase().trim();
        const matchName = item.name.toLowerCase().includes(q);
        const matchShort = item.shortName?.toLowerCase().includes(q);
        const matchDesc = item.description?.toLowerCase().includes(q);
        const matchSku = item.sku?.toLowerCase().includes(q);
        return matchName || matchShort || matchDesc || matchSku;
      }
      return true;
    });
  }, [menuItems, selectedCategoryId, searchQuery]);

  // Cart item quantity map for instant card-level steppers
  const cartItemQuantityMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of cartItems) {
      map[item.itemId] = (map[item.itemId] || 0) + item.quantity;
    }
    return map;
  }, [cartItems]);

  // Update item quantity directly by itemId from MenuGrid card stepper
  const handleUpdateQuantityByItemId = React.useCallback(
    (itemId: string, delta: number) => {
      setCartItems((prev) => {
        const existingIdx = prev.findIndex((ci) => ci.itemId === itemId);
        if (existingIdx >= 0) {
          const item = prev[existingIdx];
          const newQty = item.quantity + delta;
          if (newQty <= 0) {
            return prev.filter((_, idx) => idx !== existingIdx);
          } else {
            const updated = [...prev];
            updated[existingIdx] = { ...item, quantity: newQty };
            return updated;
          }
        } else if (delta > 0) {
          const menuItem = menuItems.find((m) => m.itemId === itemId);
          if (menuItem) {
            const newCartItem: CartItem = {
              cartItemId: `cart_${menuItem.itemId}_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
              itemId: menuItem.itemId,
              nameSnapshot: menuItem.name,
              shortNameSnapshot: menuItem.shortName || menuItem.name.slice(0, 16),
              unitPriceMinor: toMoneyMinor(menuItem.price),
              taxRate: menuItem.taxRate || restaurant?.defaultTaxRate || 5,
              taxInclusive: !!menuItem.taxInclusive,
              quantity: 1
            };
            return [...prev, newCartItem];
          }
        }
        return prev;
      });
    },
    [menuItems, restaurant?.defaultTaxRate]
  );

  // Add Item to Cart
  const handleAddToCart = React.useCallback((item: MenuItem) => {
    if (!item.isAvailable) {
      setStatusMessage({ type: 'error', text: `${item.name} is currently marked unavailable.` });
      return;
    }

    setCartItems((prev) => {
      const existingIdx = prev.findIndex((ci) => ci.itemId === item.itemId);
      if (existingIdx >= 0) {
        const updated = [...prev];
        updated[existingIdx] = {
          ...updated[existingIdx],
          quantity: updated[existingIdx].quantity + 1
        };
        return updated;
      } else {
        const newCartItem: CartItem = {
          cartItemId: `cart_${item.itemId}_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          itemId: item.itemId,
          nameSnapshot: item.name,
          shortNameSnapshot: item.shortName || item.name.slice(0, 16),
          unitPriceMinor: toMoneyMinor(item.price),
          taxRate: item.taxRate || restaurant?.defaultTaxRate || 5,
          taxInclusive: !!item.taxInclusive,
          quantity: 1
        };
        return [...prev, newCartItem];
      }
    });
  }, [restaurant?.defaultTaxRate]);

  // Remove Item
  const handleRemoveItem = React.useCallback((cartItemId: string) => {
    setCartItems((prev) => prev.filter((ci) => ci.cartItemId !== cartItemId));
  }, []);

  // Cart quantity changes
  const handleUpdateQuantity = React.useCallback((cartItemId: string, newQty: number) => {
    if (newQty <= 0) {
      handleRemoveItem(cartItemId);
      return;
    }
    setCartItems((prev) =>
      prev.map((ci) => (ci.cartItemId === cartItemId ? { ...ci, quantity: newQty } : ci))
    );
  }, [handleRemoveItem]);

  // Item notes update
  const handleUpdateItemNotes = React.useCallback((cartItemId: string, notes: string) => {
    setCartItems((prev) =>
      prev.map((ci) => (ci.cartItemId === cartItemId ? { ...ci, notes } : ci))
    );
  }, []);

  // Clear Cart
  const handleClearCart = React.useCallback(() => {
    setCartItems([]);
    setOrderDiscount(undefined);
    setOrderNotes('');
  }, []);

  // Hold Order
  const handleHoldOrder = () => {
    if (cartItems.length === 0) return;

    const draft: HeldOrderDraft = {
      id: `draft_${Date.now()}`,
      heldAt: new Date(),
      cartItems: [...cartItems],
      orderType,
      orderDiscount,
      orderNotes,
      tableId: selectedTable?.id,
      tableSessionId: activeSession?.id
    };

    setHeldDrafts((prev) => [draft, ...prev]);
    handleClearCart();
    setStatusMessage({ type: 'info', text: 'Cart moved to Held Orders.' });
  };

  // Resume Draft
  const handleResumeDraft = (draft: HeldOrderDraft) => {
    setCartItems(draft.cartItems);
    setOrderType(draft.orderType);
    setOrderDiscount(draft.orderDiscount);
    setOrderNotes(draft.orderNotes || '');
    setHeldDrafts((prev) => prev.filter((d) => d.id !== draft.id));
    setStatusMessage({ type: 'info', text: 'Held cart resumed successfully.' });
  };

  // Delete Draft
  const handleDeleteDraft = (id: string) => {
    setHeldDrafts((prev) => prev.filter((d) => d.id !== id));
  };

  // Create Order & KOT Flow
  const handleCreateKot = async () => {
    if (cartItems.length === 0) {
      setStatusMessage({ type: 'error', text: 'Cart is empty.' });
      return;
    }

    let targetSessionId: string | undefined = undefined;
    let targetTableId: string | undefined = undefined;

    if (orderType === 'dineIn') {
      if (!selectedTable) {
        setIsTableModalOpen(true);
        setStatusMessage({ type: 'error', text: 'Please select an active table for Dine-In order.' });
        return;
      }

      targetTableId = selectedTable.id;
      let currentSession = activeSession;

      if (!currentSession) {
        try {
          currentSession = await tableSessionService.getActiveSession(
            restaurantId,
            selectedTable.id,
            selectedTable.activeSessionId
          );
          if (!currentSession) {
            currentSession = await tableSessionService.openSession(
              restaurantId,
              selectedTable.id,
              2,
              user?.uid || 'staff',
              `req_session_${selectedTable.id}_${Date.now()}`
            );
          }
          setActiveSession(currentSession);
        } catch (recoverErr: any) {
          console.error('Session recovery failed:', recoverErr);
          setIsTableModalOpen(true);
          setStatusMessage({ type: 'error', text: 'Please select an active table for Dine-In order.' });
          return;
        }
      }
      targetSessionId = currentSession?.id;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const clientReqId = `req_ord_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      // 1. Authoritatively create order and KOT atomically
      const { order: newOrder, kot: newKot } = await orderService.createOrderAndKOTFromCart({
        restaurantId,
        cartState: { items: cartItems, orderDiscount, notes: orderNotes },
        orderType,
        source: 'pos',
        tableId: targetTableId || null,
        tableSessionId: targetSessionId || null,
        notes: orderNotes,
        createdBy: user?.uid || 'pos_cashier',
        clientRequestId: clientReqId
      });

      // 2. Success state
      handleClearCart();
      setSentOrderInfo({ order: newOrder, kot: newKot });
      setStatusMessage({
        type: 'success',
        text: `Order #${newOrder.orderNumber} placed & sent to Kitchen! (KOT: ${newKot.kotNumber})`
      });
    } catch (err: any) {
      console.error('KOT creation error:', err);
      setStatusMessage({ type: 'error', text: err.message || 'Failed to create order or KOT.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Payment Open Flow
  const handleOpenPayment = async () => {
    if (cartItems.length === 0) {
      setStatusMessage({ type: 'error', text: 'Cart is empty.' });
      return;
    }

    let targetSessionId: string | undefined = undefined;
    let targetTableId: string | undefined = undefined;

    if (orderType === 'dineIn') {
      if (!selectedTable) {
        setIsTableModalOpen(true);
        setStatusMessage({ type: 'error', text: 'Please select an active table for Dine-In order.' });
        return;
      }

      targetTableId = selectedTable.id;
      let currentSession = activeSession;

      if (!currentSession) {
        try {
          currentSession = await tableSessionService.getActiveSession(
            restaurantId,
            selectedTable.id,
            selectedTable.activeSessionId
          );
          if (!currentSession) {
            currentSession = await tableSessionService.openSession(
              restaurantId,
              selectedTable.id,
              2,
              user?.uid || 'staff',
              `req_session_${selectedTable.id}_${Date.now()}`
            );
          }
          setActiveSession(currentSession);
        } catch (recoverErr: any) {
          console.error('Session recovery failed:', recoverErr);
          setIsTableModalOpen(true);
          setStatusMessage({ type: 'error', text: 'Please select an active table for Dine-In order.' });
          return;
        }
      }
      targetSessionId = currentSession?.id;
    }

    setIsSubmitting(true);
    setStatusMessage(null);

    try {
      const clientReqId = `req_ord_pay_${Date.now()}`;

      // Create Order and KOT atomically so the kitchen is instantly notified of the new order
      const { order: newOrder, kot: newKot } = await orderService.createOrderAndKOTFromCart({
        restaurantId,
        cartState: { items: cartItems, orderDiscount, notes: orderNotes },
        orderType,
        source: 'pos',
        tableId: targetTableId || null,
        tableSessionId: targetSessionId || null,
        notes: orderNotes,
        createdBy: user?.uid || 'pos_cashier',
        clientRequestId: clientReqId
      });

      setActiveOrderForPayment(newOrder);
      setIsPaymentModalOpen(true);
    } catch (err: any) {
      console.error('Order creation for payment error:', err);
      setStatusMessage({ type: 'error', text: err.message || 'Failed to prepare order for payment.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Payment Settlement Success
  const handlePaymentSuccess = (updatedOrder: Order) => {
    handleClearCart();
    setActiveOrderForPayment(null);
    setActiveOrderForBill(updatedOrder);
    setIsBillModalOpen(true);
    setStatusMessage({
      type: 'success',
      text: `Payment settled for Order #${updatedOrder.orderNumber}`
    });
  };

  return (
    <div className="min-h-[calc(100vh-4.5rem)] bg-slate-50 flex flex-col font-sans">
      {/* POS Top Header */}
      <PosHeader
        orderType={orderType}
        onOrderTypeChange={(type) => {
          setOrderType(type);
          if (type !== 'dineIn') {
            setSelectedTable(null);
            setActiveSession(null);
          }
        }}
        selectedTable={selectedTable}
        activeSession={activeSession}
        onOpenTableModal={() => setIsTableModalOpen(true)}
        onClearTable={() => {
          setSelectedTable(null);
          setActiveSession(null);
        }}
        heldOrdersCount={heldDrafts.length}
        onOpenHeldOrders={() => setIsHeldOrdersModalOpen(true)}
        paymentDueCount={paymentDueOrders.length}
        totalPaymentDueMinor={totalPaymentDueMinor}
        onOpenPaymentDue={() => setIsPaymentDueModalOpen(true)}
        cartItemsCount={cartItemsCount}
        onOpenCart={() => setActiveMobileTab('cart')}
        onOpenMobileMenu={onOpenMobileMenu}
        onOpenRecentOrders={() => {
          if (activeOrderForBill) {
            setIsBillModalOpen(true);
          } else if (onNavigate) {
            onNavigate('orders');
          } else {
            setStatusMessage({ type: 'info', text: 'No recent receipt open.' });
          }
        }}
      />

      {/* Status Toast Notification */}
      {statusMessage && (
        <div
          className={`px-3 py-2 flex items-center justify-between text-xs font-bold transition-all shrink-0 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-600 text-white'
              : statusMessage.type === 'error'
              ? 'bg-rose-600 text-white'
              : 'bg-indigo-600 text-white'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
          <button
            onClick={() => setStatusMessage(null)}
            className="p-1 hover:bg-black/10 rounded-lg"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Terminal Area (Split View: Menu Left 65%, Cart Right 35%) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 relative">
        {/* LEFT AREA: Categories & Menu Items */}
        <div className={`lg:col-span-7 xl:col-span-8 flex flex-col min-h-0 bg-slate-50 ${activeMobileTab === 'menu' ? 'flex' : 'hidden lg:flex'}`}>
          <CategoryBar
            categories={categories}
            selectedCategoryId={selectedCategoryId}
            onSelectCategory={setSelectedCategoryId}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            totalItemsCount={filteredItems.length}
          />

          <div className="flex-1 overflow-y-auto pb-28 lg:pb-4">
            <MenuGrid
              items={filteredItems}
              loading={menuLoading || restaurantLoading}
              error={menuError || restaurantError}
              onRetry={() => {
                setMenuLoading(true);
                setMenuError(null);
              }}
              onAddToCart={handleAddToCart}
              cartItemQuantityMap={cartItemQuantityMap}
              onUpdateQuantityByItemId={handleUpdateQuantityByItemId}
            />
          </div>
        </div>

        {/* RIGHT AREA: Cart Panel */}
        <div className={`lg:col-span-5 xl:col-span-4 flex flex-col min-h-0 bg-white border-l border-slate-200 ${activeMobileTab === 'cart' ? 'flex' : 'hidden lg:flex'}`}>
          {/* Mobile Back-to-Menu banner when viewing cart on small screens */}
          <div className="lg:hidden flex items-center justify-between px-3 py-2 bg-indigo-50 border-b border-indigo-100 shrink-0">
            <button
              type="button"
              onClick={() => setActiveMobileTab('menu')}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white border border-indigo-200 text-indigo-700 text-xs font-bold shadow-2xs active:scale-95"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Back to Menu</span>
            </button>
            <span className="text-xs font-bold text-indigo-950">
              {cartItemsCount} {cartItemsCount === 1 ? 'item' : 'items'}
            </span>
          </div>

          <CartPanel
            cartItems={cartItems}
            orderType={orderType}
            selectedTable={selectedTable}
            activeSession={activeSession}
            orderDiscount={orderDiscount}
            onApplyDiscount={setOrderDiscount}
            orderNotes={orderNotes}
            onOrderNotesChange={setOrderNotes}
            onUpdateQuantity={handleUpdateQuantity}
            onUpdateItemNotes={handleUpdateItemNotes}
            onRemoveItem={handleRemoveItem}
            onClearCart={handleClearCart}
            onHoldOrder={handleHoldOrder}
            onCreateKot={handleCreateKot}
            onOpenPayment={handleOpenPayment}
            onCloseTable={() => handleCloseTableSession()}
            isSubmitting={isSubmitting}
          />
        </div>

        {/* Mobile Sticky Floating Cart Bar (Matching Reference Image) */}
        {activeMobileTab === 'menu' && cartItemsCount > 0 && (
          <div className="lg:hidden fixed bottom-[72px] left-4 right-4 max-w-lg mx-auto z-30 pointer-events-auto animate-in slide-in-from-bottom-3 duration-200">
            <div className="bg-slate-900/95 backdrop-blur-md text-white rounded-xl px-3.5 py-2 shadow-xl border border-slate-800 flex items-center justify-between gap-3">
              {/* Left: Cart Icon with Badge, Item Count, and Total Amount (Tapping opens Cart) */}
              <div
                className="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1 select-none"
                onClick={() => setActiveMobileTab('cart')}
                title="Tap to review order slip"
              >
                <div className="relative">
                  <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-white shrink-0">
                    <ShoppingCart className="w-4 h-4" />
                  </div>
                  <span className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 bg-rose-500 text-white font-bold text-[10px] rounded-full flex items-center justify-center shadow-xs">
                    {cartItemsCount}
                  </span>
                </div>

                <div className="min-w-0 flex items-baseline gap-2">
                  <span className="text-xs font-bold text-slate-200 truncate">
                    {cartItemsCount} {cartItemsCount === 1 ? 'Item' : 'Items'}
                  </span>
                  <span className="text-sm font-black text-white tracking-tight">
                    {formatMoney(cartSubtotalMinor, symbol)}
                  </span>
                </div>
              </div>

              {/* Right: SEND TO KITCHEN Action Button (Direct 1-tap KOT dispatch) */}
              <button
                type="button"
                id="floating-send-to-kitchen-btn"
                disabled={isSubmitting}
                onClick={() => {
                  if (orderType === 'dineIn' && !selectedTable) {
                    setIsTableModalOpen(true);
                    setStatusMessage({ type: 'info', text: 'Please select a table to send order to kitchen.' });
                  } else {
                    handleCreateKot();
                  }
                }}
                className="flex items-center justify-center gap-1.5 h-10 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-black text-xs sm:text-sm shadow-sm active:scale-95 transition-all shrink-0"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <span className="text-sm">🔥</span>
                    <span>SEND TO KITCHEN</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <OrderSentModal
        isOpen={!!sentOrderInfo}
        order={sentOrderInfo?.order || null}
        kot={sentOrderInfo?.kot || null}
        tableName={selectedTable ? `Table ${selectedTable.tableNumber}` : null}
        onClose={() => setSentOrderInfo(null)}
        onViewBill={(ord) => {
          setActiveOrderForBill(ord);
          setIsBillModalOpen(true);
        }}
      />

      <TableSelectorModal
        isOpen={isTableModalOpen}
        onClose={() => setIsTableModalOpen(false)}
        selectedTable={selectedTable}
        activeSession={activeSession}
        onSelectTableAndSession={(table, session) => {
          setSelectedTable(table);
          setActiveSession(session);
        }}
        onCloseTableSession={handleCloseTableSession}
      />

      <PaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        order={activeOrderForPayment}
        onPaymentSuccess={handlePaymentSuccess}
      />

      <BillReceiptModal
        isOpen={isBillModalOpen}
        onClose={() => setIsBillModalOpen(false)}
        order={activeOrderForBill}
      />

      <HeldOrdersModal
        isOpen={isHeldOrdersModalOpen}
        onClose={() => setIsHeldOrdersModalOpen(false)}
        heldDrafts={heldDrafts}
        onResumeDraft={handleResumeDraft}
        onDeleteDraft={handleDeleteDraft}
      />

      <PaymentDueCenterModal
        isOpen={isPaymentDueModalOpen}
        onClose={() => setIsPaymentDueModalOpen(false)}
        orders={paymentDueOrders}
        loading={paymentDueLoading}
        error={paymentDueError}
        onRetry={() => {
          setPaymentDueLoading(true);
          setPaymentDueError(null);
        }}
        onCollectPayment={(orderToCollect) => {
          setIsPaymentDueModalOpen(false);
          setActiveOrderForPayment(orderToCollect);
          setIsPaymentModalOpen(true);
        }}
        symbol={restaurant?.currencySymbol || '₹'}
        restaurantId={restaurantId}
      />
    </div>
  );
};
