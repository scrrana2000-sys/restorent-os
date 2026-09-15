import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CustomerCart, CustomerCartItem, PublicRestaurantProfile } from '../types/customer';
import { MenuItem } from '../types/menu';
import {
  loadCustomerCartFromStorage,
  saveCustomerCartToStorage,
  clearSavedCustomerCart,
  calculateCustomerCartTotals,
  areCustomerCartItemsEqual,
  sanitizeCustomerCartItem,
  validateCustomerCart,
  StaleCartValidationResult,
  MAX_ITEM_QUANTITY,
  MIN_ITEM_QUANTITY
} from '../services/customerCartService';

export interface RestaurantPublicIdentifier {
  restaurantId: string;
  restaurantName: string;
  publicSlug: string;
  publicRestaurantCode?: string;
  currency?: string;
  currencySymbol?: string;
}

export interface CartConflictState {
  pendingItem: CustomerCartItem;
  pendingRestaurant: RestaurantPublicIdentifier;
}

export interface AddItemResult {
  added: boolean;
  conflict: boolean;
}

export interface CustomerCartContextValue {
  cart: CustomerCart | null;
  conflictState: CartConflictState | null;
  isCartDrawerOpen: boolean;
  setIsCartDrawerOpen: (open: boolean) => void;
  openCartDrawer: () => void;
  closeCartDrawer: () => void;
  addItem: (item: CustomerCartItem, restaurant: RestaurantPublicIdentifier) => AddItemResult;
  removeItem: (cartItemId: string) => void;
  updateQuantity: (cartItemId: string, newQuantity: number) => void;
  clearCart: () => void;
  confirmReplaceCart: () => void;
  cancelConflict: () => void;
  validateCart: (restaurant?: PublicRestaurantProfile | null, availableItems?: MenuItem[]) => StaleCartValidationResult;
}

const CustomerCartContext = createContext<CustomerCartContextValue | null>(null);

export interface CustomerCartProviderProps {
  children: React.ReactNode;
  initialCart?: CustomerCart | null;
}

export const CustomerCartProvider: React.FC<CustomerCartProviderProps> = ({
  children,
  initialCart
}) => {
  // Initialize from storage or initialCart
  const [cart, setCart] = useState<CustomerCart | null>(() => {
    if (initialCart !== undefined) {
      return initialCart;
    }
    return loadCustomerCartFromStorage();
  });

  const cartRef = useRef<CustomerCart | null>(cart);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  const [conflictState, setConflictState] = useState<CartConflictState | null>(null);
  const conflictStateRef = useRef<CartConflictState | null>(conflictState);
  useEffect(() => {
    conflictStateRef.current = conflictState;
  }, [conflictState]);

  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState<boolean>(false);

  // Sync cart mutations to localStorage
  useEffect(() => {
    saveCustomerCartToStorage(cart);
  }, [cart]);

  const openCartDrawer = useCallback(() => {
    setIsCartDrawerOpen(true);
  }, []);

  const closeCartDrawer = useCallback(() => {
    setIsCartDrawerOpen(false);
  }, []);

  /**
   * Adds an item to the customer cart enforcing the single restaurant invariant.
   * If cart has items from a different restaurant, triggers conflict state and DOES NOT add.
   */
  const addItem = useCallback(
    (item: CustomerCartItem, restaurant: RestaurantPublicIdentifier): AddItemResult => {
      if (!restaurant || !restaurant.restaurantId) {
        throw new Error('Restaurant identity is required to add items to customer cart.');
      }

      const sanitizedItem = sanitizeCustomerCartItem(item);
      const currentCart = cartRef.current;

      // Scenario 1: Cart is empty or has 0 items -> Start new cart for this restaurant
      if (!currentCart || !currentCart.restaurantId || currentCart.items.length === 0) {
        const newItems = [sanitizedItem];
        const { subtotal, itemCount } = calculateCustomerCartTotals(newItems);
        const newCart: CustomerCart = {
          restaurantId: restaurant.restaurantId,
          restaurantName: restaurant.restaurantName,
          publicSlug: restaurant.publicSlug,
          publicRestaurantCode: restaurant.publicRestaurantCode,
          currency: restaurant.currency || 'INR',
          currencySymbol: restaurant.currencySymbol || '₹',
          items: newItems,
          subtotal,
          itemCount
        };
        cartRef.current = newCart;
        setCart(newCart);
        return { added: true, conflict: false };
      }

      // Scenario 2: Item belongs to current restaurant -> Add or merge
      if (currentCart.restaurantId === restaurant.restaurantId) {
        let merged = false;
        const updatedItems: CustomerCartItem[] = [];

        for (const existingItem of currentCart.items) {
          if (!merged && areCustomerCartItemsEqual(existingItem, sanitizedItem)) {
            // Merge matching line by summing quantity
            const newQty = Math.min(MAX_ITEM_QUANTITY, existingItem.quantity + sanitizedItem.quantity);
            updatedItems.push({
              ...existingItem,
              quantity: newQty
            });
            merged = true;
          } else {
            updatedItems.push(existingItem);
          }
        }

        if (!merged) {
          updatedItems.push(sanitizedItem);
        }

        const { subtotal, itemCount } = calculateCustomerCartTotals(updatedItems);
        const updatedCart: CustomerCart = {
          ...currentCart,
          restaurantName: restaurant.restaurantName || currentCart.restaurantName,
          publicSlug: restaurant.publicSlug || currentCart.publicSlug,
          publicRestaurantCode: restaurant.publicRestaurantCode || currentCart.publicRestaurantCode,
          currency: restaurant.currency || currentCart.currency,
          currencySymbol: restaurant.currencySymbol || currentCart.currencySymbol,
          items: updatedItems,
          subtotal,
          itemCount
        };

        cartRef.current = updatedCart;
        setCart(updatedCart);
        return { added: true, conflict: false };
      }

      // Scenario 3: Item belongs to DIFFERENT restaurant -> Trigger conflict modal
      const newConflict: CartConflictState = {
        pendingItem: sanitizedItem,
        pendingRestaurant: restaurant
      };
      conflictStateRef.current = newConflict;
      setConflictState(newConflict);

      return { added: false, conflict: true };
    },
    []
  );

  /**
   * Confirms replacing the existing restaurant cart with the pending item from the new restaurant.
   */
  const confirmReplaceCart = useCallback(() => {
    const currentConflict = conflictStateRef.current;
    if (!currentConflict) return;

    const { pendingItem, pendingRestaurant } = currentConflict;
    const sanitized = sanitizeCustomerCartItem(pendingItem);
    const newItems = [sanitized];
    const { subtotal, itemCount } = calculateCustomerCartTotals(newItems);

    const newCart: CustomerCart = {
      restaurantId: pendingRestaurant.restaurantId,
      restaurantName: pendingRestaurant.restaurantName,
      publicSlug: pendingRestaurant.publicSlug,
      publicRestaurantCode: pendingRestaurant.publicRestaurantCode,
      currency: pendingRestaurant.currency || 'INR',
      currencySymbol: pendingRestaurant.currencySymbol || '₹',
      items: newItems,
      subtotal,
      itemCount
    };

    cartRef.current = newCart;
    setCart(newCart);
    conflictStateRef.current = null;
    setConflictState(null);
  }, []);

  /**
   * Cancels the restaurant switch conflict and keeps current cart intact.
   */
  const cancelConflict = useCallback(() => {
    conflictStateRef.current = null;
    setConflictState(null);
  }, []);

  /**
   * Removes a specific item from the cart.
   * If cart becomes empty, resets cart state to null.
   */
  const removeItem = useCallback((cartItemId: string) => {
    const current = cartRef.current;
    if (!current) {
      setCart(null);
      return;
    }

    const remainingItems = current.items.filter((item) => item.cartItemId !== cartItemId);
    if (remainingItems.length === 0) {
      clearSavedCustomerCart();
      cartRef.current = null;
      setCart(null);
      return;
    }

    const { subtotal, itemCount } = calculateCustomerCartTotals(remainingItems);
    const updatedCart: CustomerCart = {
      ...current,
      items: remainingItems,
      subtotal,
      itemCount
    };
    cartRef.current = updatedCart;
    setCart(updatedCart);
  }, []);

  /**
   * Updates quantity of a specific cart item.
   * If quantity <= 0, removes the item.
   */
  const updateQuantity = useCallback((cartItemId: string, newQuantity: number) => {
    const current = cartRef.current;
    if (!current) {
      setCart(null);
      return;
    }

    const numericQty = Math.floor(Number(newQuantity));
    if (isNaN(numericQty) || numericQty <= 0) {
      const remainingItems = current.items.filter((item) => item.cartItemId !== cartItemId);
      if (remainingItems.length === 0) {
        clearSavedCustomerCart();
        cartRef.current = null;
        setCart(null);
        return;
      }
      const { subtotal, itemCount } = calculateCustomerCartTotals(remainingItems);
      const updatedCart: CustomerCart = {
        ...current,
        items: remainingItems,
        subtotal,
        itemCount
      };
      cartRef.current = updatedCart;
      setCart(updatedCart);
      return;
    }

    const safeQty = Math.min(MAX_ITEM_QUANTITY, numericQty);
    const updatedItems = current.items.map((item) => {
      if (item.cartItemId === cartItemId) {
        return { ...item, quantity: safeQty };
      }
      return item;
    });

    const { subtotal, itemCount } = calculateCustomerCartTotals(updatedItems);
    const updatedCart: CustomerCart = {
      ...current,
      items: updatedItems,
      subtotal,
      itemCount
    };
    cartRef.current = updatedCart;
    setCart(updatedCart);
  }, []);

  /**
   * Explicitly clears the entire cart.
   */
  const clearCart = useCallback(() => {
    cartRef.current = null;
    conflictStateRef.current = null;
    setCart(null);
    setConflictState(null);
    clearSavedCustomerCart();
  }, []);

  /**
   * Validates cart against authoritative restaurant profile and menu.
   */
  const validateCart = useCallback(
    (restaurant?: PublicRestaurantProfile | null, availableItems?: MenuItem[]): StaleCartValidationResult => {
      return validateCustomerCart(cartRef.current, restaurant, availableItems);
    },
    []
  );

  const value = useMemo<CustomerCartContextValue>(
    () => ({
      cart,
      conflictState,
      isCartDrawerOpen,
      setIsCartDrawerOpen,
      openCartDrawer,
      closeCartDrawer,
      addItem,
      removeItem,
      updateQuantity,
      clearCart,
      confirmReplaceCart,
      cancelConflict,
      validateCart
    }),
    [
      cart,
      conflictState,
      isCartDrawerOpen,
      openCartDrawer,
      closeCartDrawer,
      addItem,
      removeItem,
      updateQuantity,
      clearCart,
      confirmReplaceCart,
      cancelConflict,
      validateCart
    ]
  );

  return <CustomerCartContext.Provider value={value}>{children}</CustomerCartContext.Provider>;
};

export const useCustomerCart = (): CustomerCartContextValue => {
  const ctx = useContext(CustomerCartContext);
  if (!ctx) {
    throw new Error('useCustomerCart must be used within a CustomerCartProvider');
  }
  return ctx;
};
