import React, { useState, useEffect, useMemo } from 'react';
import { useRestaurant } from '../context/RestaurantContext';
import { useAuth } from '../context/AuthContext';
import { getCategoriesOnce, getMenuItemsOnce } from '../services/menuService';
import { orderService } from '../services/orderService';
import { kotService } from '../services/kotService';
import { tableSessionService } from '../services/tableSessionService';
import { Category, MenuItem } from '../types/menu';
import { CartItem } from '../types/cart';
import { CustomerSnapshot, Order, OrderType } from '../types/order';
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
import { OnlineOrdersQueue } from '../components/orders/OnlineOrdersQueue';
import { LiveOperationsControlPanel } from '../components/pos/LiveOperationsControlPanel';
import { PosItemAvailabilityPanel } from '../components/pos/PosItemAvailabilityPanel';
import { CustomerBillingModal } from '../components/pos/CustomerBillingModal';
import { toggleItemAvailability, toggleItemOnlineAvailability } from '../services/menuService';
import { VoiceOrderModal } from '../components/voice/VoiceOrderModal';
import { AdminView } from '../components/layout/Sidebar';
import { useModalBackHandler } from '../hooks/useModalBackHandler';

import { CheckCircle2, AlertCircle, RefreshCw, X, ShoppingBag, ShoppingCart, ArrowRight, ChevronLeft } from 'lucide-react';

interface PosPageProps {
  onNavigate?: (view: AdminView) => void;
  onOpenMobileMenu?: () => void;
}

export const PosPage: React.FC<PosPageProps> = ({ onNavigate, onOpenMobileMenu }) => {
  const { restaurant, operatingProfile, loading: restaurantLoading, error: restaurantError, updateSettings: updateRestaurantSettings } = useRestaurant();
  const { user, profile } = useAuth();
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
  const [orderType, setOrderType] = useState<OrderType>(
    operatingProfile?.posBehavior?.defaultOrderType || 'dineIn'
  );
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [activeSession, setActiveSession] = useState<TableSession | null>(null);

  // Sync default order type when operatingProfile loads or changes
  useEffect(() => {
    const allowed = operatingProfile?.posBehavior?.allowedOrderTypes;
    if (allowed && allowed.length > 0 && !allowed.includes(orderType)) {
      setOrderType(operatingProfile.posBehavior.defaultOrderType || allowed[0]);
    } else if (orderType === 'dineIn' && !operatingProfile?.workflow?.hasTableFlow) {
      if (operatingProfile?.posBehavior?.defaultOrderType) {
        setOrderType(operatingProfile.posBehavior.defaultOrderType);
      }
    }
  }, [operatingProfile, orderType]);

  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [orderDiscount, setOrderDiscount] = useState<DiscountSpec | undefined>(undefined);
  const [orderNotes, setOrderNotes] = useState<string>('');

  // Held Carts state
  const [heldDrafts, setHeldDrafts] = useState<HeldOrderDraft[]>([]);

  // Payment Due Center state
  const [paymentDueOrders, setPaymentDueOrders] = useState<Order[]>([]);
  const [paymentDueLoading, setPaymentDueLoading] = useState<boolean>(false);
  const [paymentDueError, setPaymentDueError] = useState<string | null>(null);
  const [paymentDueReloadToken, setPaymentDueReloadToken] = useState(0);
  const [isPaymentDueModalOpen, setIsPaymentDueModalOpen] = useState<boolean>(false);

  // Live online-order counter and management center for POS.
  const [onlineOrderCount, setOnlineOrderCount] = useState<number>(0);
  const [isOnlineOrdersModalOpen, setIsOnlineOrdersModalOpen] = useState<boolean>(false);
  const [isLiveOperationsOpen, setIsLiveOperationsOpen] = useState<boolean>(false);
  const [isPosItemAvailabilityOpen, setIsPosItemAvailabilityOpen] = useState<boolean>(false);

  // Modals
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isBillModalOpen, setIsBillModalOpen] = useState(false);
  const [isHeldOrdersModalOpen, setIsHeldOrdersModalOpen] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [customerSnapshot, setCustomerSnapshot] = useState<CustomerSnapshot | null>(null);
  const [pendingCustomerAction, setPendingCustomerAction] = useState<'payment' | null>(null);

  const [activeOrderForPayment, setActiveOrderForPayment] = useState<Order | null>(null);
  const [activeOrderForBill, setActiveOrderForBill] = useState<Order | null>(null);
  const [sentOrderInfo, setSentOrderInfo] = useState<{ order: Order; kot: KOT | null } | null>(null);

  // Processing & Toast feedback
  const [activeMobileTab, setActiveMobileTab] = useState<'menu' | 'cart'>('menu');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Deterministic back-button history management for mobile drawer/cart & modals
  useModalBackHandler(activeMobileTab === 'cart', () => setActiveMobileTab('menu'), 'pos-mobile-cart');
  useModalBackHandler(isTableModalOpen, () => setIsTableModalOpen(false), 'pos-table-modal');
  useModalBackHandler(isPaymentDueModalOpen, () => setIsPaymentDueModalOpen(false), 'pos-payment-due-modal');
  useModalBackHandler(isHeldOrdersModalOpen, () => setIsHeldOrdersModalOpen(false), 'pos-held-orders-modal');
  useModalBackHandler(isPaymentModalOpen, () => setIsPaymentModalOpen(false), 'pos-payment-modal');
  useModalBackHandler(isBillModalOpen, () => setIsBillModalOpen(false), 'pos-bill-modal');
  useModalBackHandler(isVoiceModalOpen, () => setIsVoiceModalOpen(false), 'pos-voice-modal');
  useModalBackHandler(isCustomerModalOpen, () => setIsCustomerModalOpen(false), 'pos-customer-modal');
  useModalBackHandler(isPosItemAvailabilityOpen, () => setIsPosItemAvailabilityOpen(false), 'pos-item-availability-modal');
  useModalBackHandler(!!sentOrderInfo, () => setSentOrderInfo(null), 'pos-order-sent-modal');

  const symbol = restaurant?.currencySymbol || '₹';
  const cartItemsCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems]
  );
  const cartSubtotalMinor = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.unitPriceMinor * item.quantity, 0),
    [cartItems]
  );

  // 1. Load only the POS menu data needed by this page.
  // One-shot + browser cache replaces always-on realtime listeners.
  useEffect(() => {
    if (!restaurantId) return;

    let cancelled = false;
    setMenuLoading(true);
    setMenuError(null);

    (async () => {
      try {
        const [cats, items] = await Promise.all([
          getCategoriesOnce(restaurantId),
          getMenuItemsOnce(restaurantId)
        ]);

        if (cancelled) return;
        setCategories(cats.filter((c) => c.isActive));
        setMenuItems(items);
      } catch (err: any) {
        if (cancelled) return;
        console.error('[POS] Menu load error:', err);
        setMenuError(err?.message || 'Failed to load menu data');
      } finally {
        if (!cancelled) setMenuLoading(false);
      }
    })();

    return () => {
      cancelled = true;
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

  // Payment-due orders stay live on the POS terminal so outstanding COD/counter balances
  // are visible without first opening the collection modal.
  useEffect(() => {
    if (!restaurantId) return;

    setPaymentDueLoading(true);
    setPaymentDueError(null);

    const unsubscribe = orderService.subscribeToPaymentDueOrders(
      restaurantId,
      (orders) => {
        setPaymentDueOrders(orders);
        setPaymentDueLoading(false);
      },
      (err) => {
        console.warn('[PosPage] Payment due subscription notice:', err);
        setPaymentDueError(err?.message || 'Failed to sync payment due orders.');
        setPaymentDueLoading(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId, paymentDueReloadToken]);

  // Open the POS online-order center when the global incoming-order notification is tapped.
  useEffect(() => {
    const handleOpenOnlineOrders = () => setIsOnlineOrdersModalOpen(true);
    window.addEventListener('ros-open-online-orders', handleOpenOnlineOrders);
    return () => window.removeEventListener('ros-open-online-orders', handleOpenOnlineOrders);
  }, []);

  // Keep a live count of pending online orders on the POS terminal.
  useEffect(() => {
    if (!restaurantId) return;

    const unsubscribe = orderService.subscribeToOnlineOrders(
      restaurantId,
      (orders) => {
        const pending = orders.filter((order) => order.status === 'confirmed' || order.status === 'draft');
        setOnlineOrderCount(pending.length);
      },
      (err) => {
        console.warn('[PosPage] Online order counter subscription notice:', err);
        setOnlineOrderCount(0);
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
              imageUrlSnapshot: menuItem.imageUrl || null,
              foodTypeSnapshot: menuItem.foodType || null,
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
          imageUrlSnapshot: item.imageUrl || null,
          foodTypeSnapshot: item.foodType || null,
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
    setCustomerSnapshot(null);
  }, []);

  // Voice Add Batch To Cart
  const handleVoiceAddToCart = React.useCallback(
    (itemsToAdd: { item: MenuItem; quantity: number }[]) => {
      setCartItems((prev) => {
        let updated = [...prev];
        for (const { item, quantity } of itemsToAdd) {
          if (!item.isAvailable) continue;
          const priceMinor = toMoneyMinor(item.price);
          const existingIdx = updated.findIndex((ci) => ci.itemId === item.itemId);
          if (existingIdx >= 0) {
            updated[existingIdx] = {
              ...updated[existingIdx],
              quantity: updated[existingIdx].quantity + quantity
            };
          } else {
            updated.push({
              cartItemId: `cart_${item.itemId}_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
              itemId: item.itemId,
              nameSnapshot: item.name,
              shortNameSnapshot: item.shortName || item.name.slice(0, 16),
              imageUrlSnapshot: item.imageUrl || null,
              foodTypeSnapshot: item.foodType || null,
              unitPriceMinor: priceMinor,
              taxRate: item.taxRate || restaurant?.defaultTaxRate || 5,
              taxInclusive: !!item.taxInclusive,
              quantity: quantity
            });
          }
        }
        return updated;
      });

      setStatusMessage({
        type: 'success',
        text: `Voice items added to cart!`
      });
    },
    [restaurant?.defaultTaxRate]
  );

  // Listen for Global Voice Assistant events
  React.useEffect(() => {
    const handleVoiceAddEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && Array.isArray(detail.itemsToAdd)) {
        handleVoiceAddToCart(detail.itemsToAdd);
      }
    };

    const handleVoiceClearEvent = () => {
      handleClearCart();
    };

    window.addEventListener('ros-voice-add-to-cart', handleVoiceAddEvent);
    window.addEventListener('ros-voice-clear-cart', handleVoiceClearEvent);

    return () => {
      window.removeEventListener('ros-voice-add-to-cart', handleVoiceAddEvent);
      window.removeEventListener('ros-voice-clear-cart', handleVoiceClearEvent);
    };
  }, [handleVoiceAddToCart, handleClearCart]);

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

  const handleOpenCustomer = () => {
    setPendingCustomerAction(null);
    setIsCustomerModalOpen(true);
  };

  const handleCustomerSelected = (snapshot: CustomerSnapshot) => {
    setCustomerSnapshot(snapshot);
    const nextAction = pendingCustomerAction;
    setPendingCustomerAction(null);
    setIsCustomerModalOpen(false);
    if (nextAction === 'payment') {
      void handleOpenPayment(snapshot);
    }
  };

  // Create Order & KOT Flow (Adaptive based on operating mode)
  const handleCreateKot = async (customerOverride: CustomerSnapshot | null = customerSnapshot) => {
    if (cartItems.length === 0) {
      setStatusMessage({ type: 'error', text: 'Cart is empty.' });
      return;
    }

    let targetSessionId: string | undefined = undefined;
    let targetTableId: string | undefined = undefined;

    const hasTableFlow = operatingProfile?.workflow?.hasTableFlow ?? true;

    if (orderType === 'dineIn' && hasTableFlow) {
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

      // Authoritatively create order (and KOT if kitchen workflow is active)
      const { order: newOrder, kot: newKot } = await orderService.createOrderForOperatingMode({
        restaurant,
        operatingProfile,
        restaurantId,
        cartState: { items: cartItems, orderDiscount, notes: orderNotes },
        orderType,
        source: 'pos',
        tableId: targetTableId || null,
        tableSessionId: targetSessionId || null,
        notes: orderNotes,
        createdBy: user?.uid || 'pos_cashier',
        clientRequestId: clientReqId,
        customerSnapshot: customerOverride
      });

      // Success state
      handleClearCart();
      if (newKot) {
        setSentOrderInfo({ order: newOrder, kot: newKot });
        setStatusMessage({
          type: 'success',
          text: `Order #${newOrder.orderNumber} placed & sent to Kitchen! (KOT: ${newKot.kotNumber})`
        });
      } else {
        setSentOrderInfo({ order: newOrder, kot: null });
        setStatusMessage({
          type: 'success',
          text: `Order #${newOrder.orderNumber} placed successfully!`
        });
      }
    } catch (err: any) {
      console.error('Order creation error:', err);
      setStatusMessage({ type: 'error', text: err.message || 'Failed to create order.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Payment Open Flow (Adaptive based on operating mode)
  const handleOpenPayment = async (customerOverride: CustomerSnapshot | null = customerSnapshot) => {
    if (cartItems.length === 0) {
      setStatusMessage({ type: 'error', text: 'Cart is empty.' });
      return;
    }

    if (customerOverride === null) {
      setPendingCustomerAction('payment');
      setIsCustomerModalOpen(true);
      return;
    }

    let targetSessionId: string | undefined = undefined;
    let targetTableId: string | undefined = undefined;

    const hasTableFlow = operatingProfile?.workflow?.hasTableFlow ?? true;

    if (orderType === 'dineIn' && hasTableFlow) {
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

      // Create Order (and KOT if kitchen enabled) through authoritative operating mode abstraction
      const { order: newOrder } = await orderService.createOrderForOperatingMode({
        restaurant,
        operatingProfile,
        restaurantId,
        cartState: { items: cartItems, orderDiscount, notes: orderNotes },
        orderType,
        source: 'pos',
        tableId: targetTableId || null,
        tableSessionId: targetSessionId || null,
        notes: orderNotes,
        createdBy: user?.uid || 'pos_cashier',
        clientRequestId: clientReqId,
        customerSnapshot: customerOverride
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

  const handleTogglePosItemAvailability = React.useCallback(async (itemId: string, isAvailable: boolean) => {
    if (!restaurantId) return;
    const previous = menuItems.find(item => item.itemId === itemId)?.isAvailable;
    setMenuItems(prev => prev.map(item => item.itemId === itemId ? { ...item, isAvailable } : item));
    try {
      await toggleItemAvailability(restaurantId, itemId, isAvailable);
      setStatusMessage({
        type: 'success',
        text: isAvailable ? 'Item is ON for POS billing.' : 'Item is OFF for POS billing.'
      });
    } catch (error: any) {
      setMenuItems(prev => prev.map(item => item.itemId === itemId && previous !== undefined ? { ...item, isAvailable: previous } : item));
      setStatusMessage({ type: 'error', text: error?.message || 'Failed to update POS item availability.' });
      throw error;
    }
  }, [restaurantId, menuItems]);

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
        allowedOrderTypes={operatingProfile?.posBehavior?.allowedOrderTypes}
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
        showTableSelector={operatingProfile?.posBehavior?.showTableSelector ?? true}
        heldOrdersCount={heldDrafts.length}
        onOpenHeldOrders={() => setIsHeldOrdersModalOpen(true)}
        paymentDueCount={paymentDueOrders.length}
        totalPaymentDueMinor={totalPaymentDueMinor}
        onOpenPaymentDue={() => setIsPaymentDueModalOpen(true)}
        onlineOrderCount={onlineOrderCount}
        onOpenOnlineOrders={() => setIsOnlineOrdersModalOpen(true)}
        onlineOrderingLive={restaurant?.publicStatus === 'active' && restaurant?.onlineOrderingEnabled !== false}
        onOpenLiveOperations={() => setIsLiveOperationsOpen(true)}
        onOpenPosItemAvailability={() => setIsPosItemAvailabilityOpen(true)}
        cartItemsCount={cartItemsCount}
        onOpenCart={() => setActiveMobileTab((prev) => (prev === 'cart' ? 'menu' : 'cart'))}
        onOpenMobileMenu={onOpenMobileMenu}
        onOpenVoiceModal={() => setIsVoiceModalOpen(true)}
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
            type="button"
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
              onToggleAvailability={handleTogglePosItemAvailability}
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
            showCreateKot={operatingProfile?.posBehavior?.showCreateKot ?? true}
            primaryAction={operatingProfile?.posBehavior?.defaultCheckoutAction ?? 'send_to_kitchen'}
            isSubmitting={isSubmitting}
            customerSnapshot={customerSnapshot}
            onOpenCustomer={handleOpenCustomer}
          />
        </div>

        <CustomerBillingModal
        isOpen={isCustomerModalOpen}
        onClose={() => {
          setIsCustomerModalOpen(false);
          setPendingCustomerAction(null);
        }}
        restaurantId={restaurantId}
        initialCustomer={customerSnapshot}
        onSelectCustomer={handleCustomerSelected}
      />

      {/* Mobile Sticky Floating Cart Bar (Matching Reference Image) */}
        {activeMobileTab === 'menu' && cartItemsCount > 0 && (
          <div className="lg:hidden fixed bottom-[calc(56px+env(safe-area-inset-bottom,0px)+8px)] left-3 right-3 max-w-lg mx-auto z-20 pointer-events-auto animate-in slide-in-from-bottom-3 duration-200">
            <div className="bg-slate-900/95 backdrop-blur-md text-white rounded-xl px-3.5 py-2 shadow-xl border border-slate-800 flex items-center justify-between gap-3">
              {/* Left: Cart Icon with Badge, Item Count, and Total Amount (Tapping opens Cart) */}
              <button
                type="button"
                id="floating-cart-review-btn"
                className="flex items-center gap-2.5 min-w-0 cursor-pointer flex-1 select-none text-left bg-transparent border-0 p-0 active:opacity-80"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveMobileTab('cart');
                }}
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
              </button>

              {/* Right: SEND TO KITCHEN Action Button (Direct 1-tap KOT dispatch) */}
              <button
                type="button"
                id="floating-send-to-kitchen-btn"
                disabled={isSubmitting}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
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

      <PosItemAvailabilityPanel
        isOpen={isPosItemAvailabilityOpen}
        onClose={() => setIsPosItemAvailabilityOpen(false)}
        menuItems={menuItems}
        onToggleItemAvailability={handleTogglePosItemAvailability}
      />

      {profile?.role === 'owner' && (
        <LiveOperationsControlPanel
          isOpen={isLiveOperationsOpen}
          onClose={() => setIsLiveOperationsOpen(false)}
          restaurant={restaurant}
          menuItems={menuItems}
          onUpdateRestaurant={async (data) => {
            await import('../context/RestaurantContext').then(() => undefined);
            // The active RestaurantContext update function is wired below through the
            // local callback to keep the panel independent from global context details.
            await updateRestaurantSettings(data);
          }}
          onToggleItemAvailability={async (itemId, isAvailable) => {
            await toggleItemOnlineAvailability(restaurantId, itemId, isAvailable);
            setMenuItems((prev) => prev.map((item) => item.itemId === itemId ? { ...item, isOnlineAvailable: isAvailable } : item));
          }}
        />
      )}

      <div
        id="pos-online-orders-modal"
        className={`fixed inset-0 z-50 ${isOnlineOrdersModalOpen ? 'flex' : 'hidden'} items-end sm:items-center justify-center bg-slate-950/70 backdrop-blur-xs p-0 sm:p-4`}
      >
        <div className="w-full max-w-6xl h-[94vh] sm:h-[90vh] bg-slate-50 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col">
          <div className="shrink-0 px-4 sm:px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-tight">Online Orders</h2>
              <p className="text-[11px] text-slate-400 mt-0.5">Accept, send to kitchen, mark ready, and hand over customer orders.</p>
            </div>
            <button
              type="button"
              onClick={() => setIsOnlineOrdersModalOpen(false)}
              className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 hover:text-white"
              aria-label="Close online orders"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">
            <OnlineOrdersQueue
              onCollectPayment={(orderToCollect) => {
                setIsOnlineOrdersModalOpen(false);
                setActiveOrderForPayment(orderToCollect);
                setIsPaymentModalOpen(true);
              }}
              onViewBillModal={(order) => {
                setIsOnlineOrdersModalOpen(false);
                setActiveOrderForBill(order);
                setIsBillModalOpen(true);
              }}
            />
          </div>
        </div>
      </div>

      <PaymentDueCenterModal
        isOpen={isPaymentDueModalOpen}
        onClose={() => setIsPaymentDueModalOpen(false)}
        orders={paymentDueOrders}
        loading={paymentDueLoading}
        error={paymentDueError}
        onRetry={() => {
          setPaymentDueError(null);
          setPaymentDueLoading(true);
          setPaymentDueReloadToken((value) => value + 1);
        }}
        onCollectPayment={(orderToCollect) => {
          setIsPaymentDueModalOpen(false);
          setActiveOrderForPayment(orderToCollect);
          setIsPaymentModalOpen(true);
        }}
        symbol={restaurant?.currencySymbol || '₹'}
        restaurantId={restaurantId}
      />

      <VoiceOrderModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        menuItems={menuItems}
        currencySymbol={symbol}
        restaurantId={restaurantId}
        userRole={user?.email ? 'staff' : 'cashier'}
        userId={user?.uid || 'cashier'}
        userName={user?.displayName || user?.email || 'Cashier'}
        onAddToCart={handleVoiceAddToCart}
        onClearCart={handleClearCart}
      />
    </div>
  );
};
