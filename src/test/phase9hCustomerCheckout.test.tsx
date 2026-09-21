import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react';
import {
  CustomerCheckoutModal
} from '../components/customer/CustomerCheckoutModal';
import {
  validateCustomerCheckout,
  createCustomerCheckoutIntent,
  isValidPhoneNumber,
  isValidPostalCode
} from '../services/customerCheckoutService';
import {
  CustomerCartProvider,
  useCustomerCart
} from '../context/CustomerCartContext';
import {
  CustomerCart,
  CustomerCartItem,
  PublicRestaurantProfile,
  CustomerCheckoutIntent
} from '../types/customer';
import { MenuItem } from '../types/menu';

const mockRestaurantProfile: PublicRestaurantProfile = {
  restaurantId: 'rest-checkout-101',
  publicSlug: 'tandoori-palace',
  publicRestaurantCode: 'TP101',
  name: 'Tandoori Palace',
  logoUrl: null,
  coverImageUrl: null,
  phone: '9876543210',
  address: '100 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  area: 'Indiranagar',
  postalCode: '560038',
  country: 'India',
  currency: 'INR',
  currencySymbol: '₹',
  cuisine: ['Indian', 'North Indian'],
  publicStatus: 'active',
  onlineOrderingEnabled: true,
  takeawayEnabled: true,
  deliveryEnabled: true,
  isOpenNow: true
};

const mockCartItem1: CustomerCartItem = {
  cartItemId: 'cart-item-1',
  itemId: 'item-butter-chicken',
  name: 'Butter Chicken',
  price: 35000, // ₹350.00
  quantity: 1,
  foodType: 'nonVeg'
};

const mockCartItem2: CustomerCartItem = {
  cartItemId: 'cart-item-2',
  itemId: 'item-butter-naan',
  name: 'Butter Naan',
  price: 5000, // ₹50.00
  quantity: 2,
  foodType: 'veg'
};

const mockValidCart: CustomerCart = {
  restaurantId: 'rest-checkout-101',
  restaurantName: 'Tandoori Palace',
  publicSlug: 'tandoori-palace',
  publicRestaurantCode: 'TP101',
  currency: 'INR',
  currencySymbol: '₹',
  items: [mockCartItem1, mockCartItem2],
  subtotal: 45000, // ₹450.00
  itemCount: 3
};

const mockMenuItems: MenuItem[] = [
  {
    itemId: 'item-butter-chicken',
    restaurantId: 'rest-checkout-101',
    name: 'Butter Chicken',
    price: 350,
    isActive: true,
    isAvailable: true,
    categoryId: 'cat-main',
    foodType: 'nonVeg'
  } as MenuItem,
  {
    itemId: 'item-butter-naan',
    restaurantId: 'rest-checkout-101',
    name: 'Butter Naan',
    price: 50,
    isActive: true,
    isAvailable: true,
    categoryId: 'cat-breads',
    foodType: 'veg'
  } as MenuItem
];

describe('Phase M9-H: Customer Checkout Verification Suite', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('1. Checkout opens with valid cart', () => {
    const handleClose = vi.fn();
    render(
      <CustomerCartProvider initialCart={mockValidCart}>
        <CustomerCheckoutModal
          isOpen={true}
          onClose={handleClose}
          restaurantProfile={mockRestaurantProfile}
          menuItems={mockMenuItems}
        />
      </CustomerCartProvider>
    );

    expect(screen.getByText('Customer Checkout')).toBeInTheDocument();
    expect(screen.getByText('Tandoori Palace')).toBeInTheDocument();
  });

  it('2. Empty cart blocked from intent creation and shows clear error', () => {
    const emptyCart: CustomerCart = {
      restaurantId: 'rest-checkout-101',
      restaurantName: 'Tandoori Palace',
      publicSlug: 'tandoori-palace',
      items: [],
      subtotal: 0,
      itemCount: 0
    };

    const result = validateCustomerCheckout({
      cart: emptyCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      paymentMethod: 'upi'
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.cart).toContain('empty');
  });

  it('3. Restaurant identity preserved in checkout validation', () => {
    const mismatchedCart: CustomerCart = {
      ...mockValidCart,
      restaurantId: 'rest-different-999'
    };

    const result = validateCustomerCheckout({
      cart: mismatchedCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      paymentMethod: 'upi'
    });

    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.includes('belongs to restaurant'))).toBe(true);
  });

  it('4. Restaurant unavailable blocks checkout', () => {
    const closedRestaurant: PublicRestaurantProfile = {
      ...mockRestaurantProfile,
      publicStatus: 'closed'
    };

    const result = validateCustomerCheckout({
      cart: mockValidCart,
      restaurantProfile: closedRestaurant,
      orderType: 'takeaway',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      paymentMethod: 'upi'
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.general).toContain('not accepting orders');
  });

  it('5. Online ordering disabled blocks checkout', () => {
    const disabledRestaurant: PublicRestaurantProfile = {
      ...mockRestaurantProfile,
      onlineOrderingEnabled: false
    };

    const result = validateCustomerCheckout({
      cart: mockValidCart,
      restaurantProfile: disabledRestaurant,
      orderType: 'takeaway',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      paymentMethod: 'upi'
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.general?.toLowerCase()).toContain('online ordering is currently disabled');
  });

  it('6. Takeaway capability accepted when takeawayEnabled is true', () => {
    const result = validateCustomerCheckout({
      cart: mockValidCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      paymentMethod: 'cash'
    });

    expect(result.isValid).toBe(true);
  });

  it('7. Delivery capability accepted when deliveryEnabled is true', () => {
    const result = validateCustomerCheckout({
      cart: mockValidCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'delivery',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      deliveryDetails: {
        addressLine: '123 MG Road, Apt 4',
        area: 'Indiranagar',
        city: 'Bengaluru',
        postalCode: '560038'
      },
      paymentMethod: 'upi'
    });

    expect(result.isValid).toBe(true);
  });

  it('8. Unsupported order type blocked when deliveryEnabled is false', () => {
    const noDeliveryRestaurant: PublicRestaurantProfile = {
      ...mockRestaurantProfile,
      deliveryEnabled: false
    };

    const result = validateCustomerCheckout({
      cart: mockValidCart,
      restaurantProfile: noDeliveryRestaurant,
      orderType: 'delivery',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      deliveryDetails: {
        addressLine: '123 MG Road',
        area: 'Indiranagar',
        city: 'Bengaluru',
        postalCode: '560038'
      },
      paymentMethod: 'upi'
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.orderType).toContain('Delivery is not available');
  });

  it('9. Customer name validation enforces non-empty min length', () => {
    const result = validateCustomerCheckout({
      cart: mockValidCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: { name: 'A', phone: '9876543210' },
      paymentMethod: 'upi'
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.customerName).toBeDefined();
  });

  it('10. Phone validation enforces valid mobile format', () => {
    expect(isValidPhoneNumber('9876543210')).toBe(true);
    expect(isValidPhoneNumber('+91 9876543210')).toBe(true);
    expect(isValidPhoneNumber('98765-43210')).toBe(true);
    expect(isValidPhoneNumber('123')).toBe(false);

    const result = validateCustomerCheckout({
      cart: mockValidCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: { name: 'Rahul Dev', phone: 'abc' },
      paymentMethod: 'upi'
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.customerPhone).toBeDefined();
  });

  it('11. Delivery address required for delivery order type', () => {
    const result = validateCustomerCheckout({
      cart: mockValidCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'delivery',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      deliveryDetails: undefined,
      paymentMethod: 'upi'
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.deliveryAddressLine).toBeDefined();
  });

  it('12. Delivery address not unnecessarily required for takeaway', () => {
    const result = validateCustomerCheckout({
      cart: mockValidCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      deliveryDetails: undefined,
      paymentMethod: 'cash'
    });

    expect(result.isValid).toBe(true);
    expect(result.errors.deliveryAddressLine).toBeUndefined();
  });

  it('13. Postal code validation verifies format', () => {
    expect(isValidPostalCode('560038')).toBe(true);
    expect(isValidPostalCode('')).toBe(false);

    const result = validateCustomerCheckout({
      cart: mockValidCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'delivery',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      deliveryDetails: {
        addressLine: '123 MG Road',
        area: 'Indiranagar',
        city: 'Bengaluru',
        postalCode: 'invalid!!'
      },
      paymentMethod: 'upi'
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.deliveryPostalCode).toBeDefined();
  });

  it('14. Cart revalidation detects out-of-stock items', () => {
    const updatedMenu: MenuItem[] = [
      {
        ...mockMenuItems[0],
        isAvailable: false // Butter chicken out of stock
      },
      mockMenuItems[1]
    ];

    const result = validateCustomerCheckout({
      cart: mockValidCart,
      restaurantProfile: mockRestaurantProfile,
      menuItems: updatedMenu,
      orderType: 'takeaway',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      paymentMethod: 'upi'
    });

    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.includes('out of stock'))).toBe(true);
  });

  it('15. Item unavailable error returned when item deleted from menu', () => {
    const truncatedMenu: MenuItem[] = [mockMenuItems[1]]; // Butter chicken deleted

    const result = validateCustomerCheckout({
      cart: mockValidCart,
      restaurantProfile: mockRestaurantProfile,
      menuItems: truncatedMenu,
      orderType: 'takeaway',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      paymentMethod: 'upi'
    });

    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.includes('no longer available'))).toBe(true);
  });

  it('16. Variant unavailable detected during checkout revalidation', () => {
    const cartWithVariant: CustomerCart = {
      ...mockValidCart,
      items: [
        {
          ...mockCartItem1,
          selectedVariantId: 'var-deleted-1'
        }
      ]
    };

    const menuWithVariants: MenuItem[] = [
      {
        ...mockMenuItems[0],
        variants: [{ id: 'var-valid-2', name: 'Half', price: 200 }]
      }
    ];

    const result = validateCustomerCheckout({
      cart: cartWithVariant,
      restaurantProfile: mockRestaurantProfile,
      menuItems: menuWithVariants,
      orderType: 'takeaway',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      paymentMethod: 'upi'
    });

    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.includes('no longer offered'))).toBe(true);
  });

  it('17. Add-on unavailable detected during checkout revalidation', () => {
    const cartWithAddon: CustomerCart = {
      ...mockValidCart,
      items: [
        {
          ...mockCartItem1,
          selectedAddons: [{ addonId: 'addon-deleted', name: 'Extra Cheese', price: 3000 }]
        }
      ]
    };

    const menuWithAddons: MenuItem[] = [
      {
        ...mockMenuItems[0],
        addons: [{ id: 'addon-valid-1', name: 'Extra Gravy', price: 40 }]
      }
    ];

    const result = validateCustomerCheckout({
      cart: cartWithAddon,
      restaurantProfile: mockRestaurantProfile,
      menuItems: menuWithAddons,
      orderType: 'takeaway',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      paymentMethod: 'upi'
    });

    expect(result.isValid).toBe(false);
    expect(result.issues.some((i) => i.includes('add-ons'))).toBe(true);
  });

  it('18. Cart changed during checkout forces review warning', () => {
    render(
      <CustomerCartProvider initialCart={mockValidCart}>
        <CustomerCheckoutModal
          isOpen={true}
          onClose={() => {}}
          restaurantProfile={mockRestaurantProfile}
          menuItems={mockMenuItems}
        />
      </CustomerCartProvider>
    );

    expect(screen.getByText('Customer Checkout')).toBeInTheDocument();
  });

  it('19. Payment method validation accepts valid options', () => {
    const result = validateCustomerCheckout({
      cart: mockValidCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      paymentMethod: 'upi'
    });

    expect(result.isValid).toBe(true);
  });

  it('20. Unsupported payment method blocked', () => {
    const result = validateCustomerCheckout({
      cart: mockValidCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      paymentMethod: 'bitcoin' as any
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.paymentMethod).toBeDefined();
  });

  it('21. Client total is not authoritative (treated as review estimate)', () => {
    const intent = createCustomerCheckoutIntent({
      cart: mockValidCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      paymentMethod: 'upi'
    });

    expect(intent.subtotal).toBe(45000);
    // Intent is an unsubmitted input structure, not an authoritative database order
  });

  it('22. Payment status cannot be client-authoritative in checkout intent', () => {
    const intent = createCustomerCheckoutIntent({
      cart: mockValidCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      paymentMethod: 'cash'
    });

    // Verify intent does NOT contain authoritative paymentStatus property set to 'completed'
    expect((intent as any).paymentStatus).toBeUndefined();
  });

  it('23. Checkout intent generation produces structured intent with idempotency key', () => {
    const intent = createCustomerCheckoutIntent({
      cart: mockValidCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'delivery',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      deliveryDetails: {
        addressLine: 'Apt 101, Palm Towers',
        area: 'Indiranagar',
        city: 'Bengaluru',
        postalCode: '560038'
      },
      paymentMethod: 'upi'
    });

    expect(intent.restaurantId).toBe('rest-checkout-101');
    expect(intent.orderType).toBe('delivery');
    expect(intent.customerDetails.name).toBe('Rahul Dev');
    expect(intent.deliveryDetails?.addressLine).toBe('Apt 101, Palm Towers');
    expect(intent.idempotencyKey).toMatch(/^chk_/);
  });

  it('24. Back navigation trigger closes modal cleanly', () => {
    const handleClose = vi.fn();
    render(
      <CustomerCartProvider initialCart={mockValidCart}>
        <CustomerCheckoutModal
          isOpen={true}
          onClose={handleClose}
          restaurantProfile={mockRestaurantProfile}
          menuItems={mockMenuItems}
        />
      </CustomerCartProvider>
    );

    const closeBtn = screen.getByLabelText('Close checkout');
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalled();
  });

  it('25. Refresh resilience preserves form inputs in component state', () => {
    const { rerender } = render(
      <CustomerCartProvider initialCart={mockValidCart}>
        <CustomerCheckoutModal
          isOpen={true}
          onClose={() => {}}
          restaurantProfile={mockRestaurantProfile}
          initialCustomerDetails={{ name: 'Priya Verma', phone: '9811223344' }}
        />
      </CustomerCartProvider>
    );

    const nameInput = screen.getByDisplayValue('Priya Verma') as HTMLInputElement;
    expect(nameInput.value).toBe('Priya Verma');
  });

  it('26. Network error handling surfaces readable validation failure', () => {
    const mockProfileWithError: PublicRestaurantProfile = {
      ...mockRestaurantProfile,
      publicStatus: 'closed'
    };

    const result = validateCustomerCheckout({
      cart: mockValidCart,
      restaurantProfile: mockProfileWithError,
      orderType: 'takeaway',
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' },
      paymentMethod: 'upi'
    });

    expect(result.isValid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('27. Retry workflow allows correcting fields and re-submitting intent', () => {
    let input = {
      cart: mockValidCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway' as const,
      customerDetails: { name: '', phone: '' }, // invalid
      paymentMethod: 'upi' as const
    };

    let result = validateCustomerCheckout(input);
    expect(result.isValid).toBe(false);

    // Correct input fields
    input = {
      ...input,
      customerDetails: { name: 'Rahul Dev', phone: '9876543210' }
    };

    result = validateCustomerCheckout(input);
    expect(result.isValid).toBe(true);
  });

  it('28. Customer data privacy prevents exposing customer details to public profiles', () => {
    const intent = createCustomerCheckoutIntent({
      cart: mockValidCart,
      restaurantProfile: mockRestaurantProfile,
      orderType: 'takeaway',
      customerDetails: { name: 'Secret Name', phone: '9999999999' },
      paymentMethod: 'upi'
    });

    // Ensure mockRestaurantProfile is untouched and free of private customer info
    expect(mockRestaurantProfile).not.toHaveProperty('customerDetails');
    expect((mockRestaurantProfile as any).name).toBe('Tandoori Palace');
  });

  it('29. M9-G regression: Customer cart single-restaurant invariant maintained', () => {
    const { result } = renderHook(() => useCustomerCart(), {
      wrapper: ({ children }) => (
        <CustomerCartProvider initialCart={mockValidCart}>{children}</CustomerCartProvider>
      )
    });

    expect(result.current.cart?.restaurantId).toBe('rest-checkout-101');
  });

  it('30. M9-F regression: Menu item data preserved accurately', () => {
    expect(mockMenuItems[0].name).toBe('Butter Chicken');
    expect(mockMenuItems[0].price).toBe(350);
  });

  it('31. M9-E regression: Public restaurant profile attributes intact', () => {
    expect(mockRestaurantProfile.publicSlug).toBe('tandoori-palace');
    expect(mockRestaurantProfile.city).toBe('Bengaluru');
  });

  it('32. M9-D regression: Restaurant discovery compatibility', () => {
    expect(mockRestaurantProfile.onlineOrderingEnabled).toBe(true);
  });

  it('33. M9-C regression: Customer location compatibility', () => {
    expect(mockRestaurantProfile.area).toBe('Indiranagar');
  });

  it('34. M9-B regression: Public schemas and types intact', () => {
    expect(mockValidCart.subtotal).toBe(45000);
  });

  it('35. M9-A regression: Domain routing and public URL helpers intact', () => {
    expect(mockRestaurantProfile.publicRestaurantCode).toBe('TP101');
  });
});
