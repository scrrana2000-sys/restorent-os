import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isViewAllowed, hasPermission } from '../utils/permissions';
import { restaurantCustomerService } from '../services/restaurantCustomerService';
import { getRestaurantOperatingProfile } from '../config/restaurantOperatingModes';
import { Restaurant } from '../types/restaurant';
import { Order } from '../types/order';

// Mock Firebase
vi.mock('../config/firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'owner-uid-123' } }
}));

// Mock firestore helpers
const mockOrderDocsRestaurantA: Order[] = [
  {
    id: 'ord-101',
    restaurantId: 'rest-A',
    orderNumber: 'A101',
    customerId: 'cust-user-1',
    orderType: 'takeaway',
    source: 'online',
    status: 'completed',
    items: [
      {
        itemId: 'item-1',
        nameSnapshot: 'Paneer Butter Masala',
        shortNameSnapshot: 'Paneer Butter',
        quantity: 2,
        unitPriceMinor: 25000,
        taxRate: 5,
        taxInclusive: false,
        discountMinor: 0,
        lineSubtotalMinor: 50000,
        lineTaxMinor: 2500,
        lineTotalMinor: 52500
      }
    ],
    subtotalMinor: 50000,
    discountMinor: 0,
    cgstMinor: 1250,
    sgstMinor: 1250,
    igstMinor: 0,
    grandTotalMinor: 52500,
    paidAmountMinor: 52500,
    dueAmountMinor: 0,
    customerSnapshot: {
      name: 'Alice Sharma',
      phone: '9876543210',
      email: 'alice@example.com'
    },
    createdAt: '2026-09-10T10:00:00.000Z',
    updatedAt: '2026-09-10T10:30:00.000Z',
    createdBy: 'cust-user-1'
  },
  {
    id: 'ord-102',
    restaurantId: 'rest-A',
    orderNumber: 'A102',
    customerId: 'cust-user-1', // Same customer (second order)
    orderType: 'delivery',
    source: 'online',
    status: 'completed',
    items: [
      {
        itemId: 'item-2',
        nameSnapshot: 'Butter Naan',
        shortNameSnapshot: 'Naan',
        quantity: 4,
        unitPriceMinor: 5000,
        taxRate: 5,
        taxInclusive: false,
        discountMinor: 0,
        lineSubtotalMinor: 20000,
        lineTaxMinor: 1000,
        lineTotalMinor: 21000
      }
    ],
    subtotalMinor: 20000,
    discountMinor: 0,
    cgstMinor: 500,
    sgstMinor: 500,
    igstMinor: 0,
    grandTotalMinor: 21000,
    paidAmountMinor: 21000,
    dueAmountMinor: 0,
    customerSnapshot: {
      name: 'Alice Sharma',
      phone: '9876543210',
      email: 'alice@example.com',
      address: 'Flat 402, Green Valley Apartments, Bengaluru'
    },
    createdAt: '2026-09-14T12:00:00.000Z',
    updatedAt: '2026-09-14T12:45:00.000Z',
    createdBy: 'cust-user-1'
  },
  {
    id: 'ord-103',
    restaurantId: 'rest-A',
    orderNumber: 'A103',
    customerId: null, // Guest Order
    orderType: 'takeaway',
    source: 'online',
    status: 'completed',
    items: [
      {
        itemId: 'item-3',
        nameSnapshot: 'Veg Biryani',
        shortNameSnapshot: 'Biryani',
        quantity: 1,
        unitPriceMinor: 22000,
        taxRate: 5,
        taxInclusive: false,
        discountMinor: 0,
        lineSubtotalMinor: 22000,
        lineTaxMinor: 1100,
        lineTotalMinor: 23100
      }
    ],
    subtotalMinor: 22000,
    discountMinor: 0,
    cgstMinor: 550,
    sgstMinor: 550,
    igstMinor: 0,
    grandTotalMinor: 23100,
    paidAmountMinor: 23100,
    dueAmountMinor: 0,
    customerSnapshot: {
      name: 'Bob Guest',
      phone: '9123456780',
      email: 'bob.guest@example.com'
    },
    createdAt: '2026-09-15T14:00:00.000Z',
    updatedAt: '2026-09-15T14:30:00.000Z',
    createdBy: 'guest'
  },
  {
    id: 'ord-104',
    restaurantId: 'rest-A',
    orderNumber: 'A104',
    customerId: null, // Another Guest order with same name to test no-auto-merging
    orderType: 'takeaway',
    source: 'online',
    status: 'cancelled',
    items: [],
    subtotalMinor: 15000,
    discountMinor: 0,
    cgstMinor: 375,
    sgstMinor: 375,
    igstMinor: 0,
    grandTotalMinor: 15750,
    paidAmountMinor: 0,
    dueAmountMinor: 0,
    customerSnapshot: {
      name: 'Bob Guest',
      phone: '9123456780',
      email: 'bob.guest@example.com'
    },
    createdAt: '2026-09-16T09:00:00.000Z',
    updatedAt: '2026-09-16T09:10:00.000Z',
    createdBy: 'guest'
  }
];

const mockOrderDocsRestaurantB: Order[] = [
  {
    id: 'ord-B201',
    restaurantId: 'rest-B',
    orderNumber: 'B201',
    customerId: 'cust-user-tenant-b-only',
    orderType: 'takeaway',
    source: 'online',
    status: 'completed',
    items: [],
    subtotalMinor: 30000,
    discountMinor: 0,
    cgstMinor: 750,
    sgstMinor: 750,
    igstMinor: 0,
    grandTotalMinor: 31500,
    paidAmountMinor: 31500,
    dueAmountMinor: 0,
    customerSnapshot: {
      name: 'Charlie Tenant B',
      phone: '9988776655',
      email: 'charlie@tenantb.com'
    },
    createdAt: '2026-09-15T11:00:00.000Z',
    updatedAt: '2026-09-15T11:30:00.000Z',
    createdBy: 'cust-user-tenant-b-only'
  }
];

vi.mock('firebase/firestore', () => {
  return {
    collection: vi.fn((_db, _r, restId, _orders) => ({ path: `restaurants/${restId}/orders` })),
    query: vi.fn((col) => col),
    orderBy: vi.fn(),
    where: vi.fn(),
    getDocs: vi.fn(async (colRef: any) => {
      if (colRef.path?.includes('rest-A')) {
        return {
          docs: mockOrderDocsRestaurantA.map((data) => ({
            id: data.id,
            data: () => data
          })),
          forEach(cb: any) {
            mockOrderDocsRestaurantA.forEach((data) => cb({ id: data.id, data: () => data }));
          }
        };
      } else if (colRef.path?.includes('rest-B')) {
        return {
          docs: mockOrderDocsRestaurantB.map((data) => ({
            id: data.id,
            data: () => data
          })),
          forEach(cb: any) {
            mockOrderDocsRestaurantB.forEach((data) => cb({ id: data.id, data: () => data }));
          }
        };
      }
      return { docs: [], forEach: () => {} };
    })
  };
});

describe('Milestone 9 Phase 5 — Restaurant Customer Management / CRM Foundation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. RBAC & Staff Permissions', () => {
    it('allows owner, manager, and cashier to access customers view', () => {
      expect(isViewAllowed('owner', 'customers')).toBe(true);
      expect(isViewAllowed('manager', 'customers')).toBe(true);
      expect(isViewAllowed('cashier', 'customers')).toBe(true);
    });

    it('denies kitchen, captain, and accountant from accessing customers view', () => {
      expect(isViewAllowed('kitchen', 'customers')).toBe(false);
      expect(isViewAllowed('captain', 'customers')).toBe(false);
      expect(isViewAllowed('accountant', 'customers')).toBe(false);
    });

    it('verifies explicit permission matrix actions for customer data', () => {
      expect(hasPermission('owner', 'access_customers')).toBe(true);
      expect(hasPermission('owner', 'view_customers')).toBe(true);
      expect(hasPermission('manager', 'access_customers')).toBe(true);
      expect(hasPermission('cashier', 'access_customers')).toBe(true);
      expect(hasPermission('kitchen', 'access_customers')).toBe(false);
      expect(hasPermission('captain', 'access_customers')).toBe(false);
    });
  });

  describe('2. Navigation and Operating Profile', () => {
    it('includes isCustomersVisible in resolved operating profile', () => {
      const mockRest: Restaurant = {
        id: 'rest-A',
        restaurantId: 'rest-A',
        name: 'Spice Garden',
        city: 'Bengaluru',
        ownerId: 'owner-1',
        restaurantOperatingMode: 'full_service'
      } as any;

      const profile = getRestaurantOperatingProfile(mockRest);
      expect(profile.navigation.isCustomersVisible).toBe(true);
    });
  });

  describe('3. Multi-Tenant Isolation', () => {
    it('retrieves ONLY customers for Restaurant A and excludes Restaurant B customers', async () => {
      const resA = await restaurantCustomerService.getRestaurantCustomers('rest-A');
      const resB = await restaurantCustomerService.getRestaurantCustomers('rest-B');

      // Restaurant A should see Alice Sharma and Bob Guest
      const customerNamesA = resA.customers.map((c) => c.name);
      expect(customerNamesA).toContain('Alice Sharma');
      expect(customerNamesA).toContain('Bob Guest');
      expect(customerNamesA).not.toContain('Charlie Tenant B');

      // Restaurant B should see only Charlie Tenant B
      const customerNamesB = resB.customers.map((c) => c.name);
      expect(customerNamesB).toContain('Charlie Tenant B');
      expect(customerNamesB).not.toContain('Alice Sharma');
    });
  });

  describe('4. Registered Customer Deduplication & Aggregation', () => {
    it('aggregates multiple orders placed by the same registered customer into one customer record', async () => {
      const res = await restaurantCustomerService.getRestaurantCustomers('rest-A');
      const alice = res.customers.find((c) => c.customerId === 'cust-user-1');

      expect(alice).toBeDefined();
      expect(alice?.isRegistered).toBe(true);
      expect(alice?.orderCount).toBe(2);
      expect(alice?.completedOrderCount).toBe(2);
      expect(alice?.cancelledOrderCount).toBe(0);

      // Total Spend = 52500 + 21000 = 73500 paise
      expect(alice?.totalSpendMinor).toBe(73500);
      expect(alice?.averageOrderValueMinor).toBe(Math.round(73500 / 2));
      expect(alice?.recentOrders.length).toBe(2);
      expect(alice?.email).toBe('alice@example.com');
      expect(alice?.phone).toBe('9876543210');
    });
  });

  describe('5. Guest Customer Handling & Mobile History Grouping', () => {
    it('groups POS guest orders by mobile without fabricating fake customer UIDs', async () => {
      const res = await restaurantCustomerService.getRestaurantCustomers('rest-A');
      const guestEntries = res.customers.filter((c) => !c.isRegistered);

      // The same mobile number represents one restaurant-scoped guest customer with two orders.
      expect(guestEntries.length).toBe(1);
      expect(guestEntries[0].customerId).toBeNull();
      expect(guestEntries[0].id).toBe('phone_9123456780');
      expect(guestEntries[0].isRegistered).toBe(false);
      expect(guestEntries[0].orderCount).toBe(2);
      expect(guestEntries[0].recentOrders.length).toBe(2);
    });
  });

  describe('6. Search & Filtering', () => {
    it('searches customers by name, email, or phone', async () => {
      const byName = await restaurantCustomerService.getRestaurantCustomers('rest-A', {
        searchQuery: 'Alice'
      });
      expect(byName.customers.length).toBe(1);
      expect(byName.customers[0].name).toBe('Alice Sharma');

      const byPhone = await restaurantCustomerService.getRestaurantCustomers('rest-A', {
        searchQuery: '9123456780'
      });
      expect(byPhone.customers.length).toBe(1); // Same mobile is one guest customer history
    });

    it('filters customers by registered category', async () => {
      const registeredOnly = await restaurantCustomerService.getRestaurantCustomers('rest-A', {
        categoryFilter: 'registered'
      });
      expect(registeredOnly.customers.length).toBe(1);
      expect(registeredOnly.customers[0].isRegistered).toBe(true);
    });

    it('filters customers by guest activity category', async () => {
      const guestOnly = await restaurantCustomerService.getRestaurantCustomers('rest-A', {
        categoryFilter: 'guest'
      });
      expect(guestOnly.customers.length).toBe(1);
      guestOnly.customers.forEach((c) => expect(c.isRegistered).toBe(false));
    });

    it('filters customers with multiple orders (2+ orders)', async () => {
      const multiOrder = await restaurantCustomerService.getRestaurantCustomers('rest-A', {
        categoryFilter: 'multi_order'
      });
      expect(multiOrder.customers.length).toBe(2);
      expect(multiOrder.customers.some((c) => c.customerId === 'cust-user-1')).toBe(true);
      expect(multiOrder.customers.some((c) => c.id === 'phone_9123456780')).toBe(true);
    });
  });

  describe('7. Restaurant Summary Metrics', () => {
    it('computes accurate restaurant customer summary metrics', async () => {
      const { metrics } = await restaurantCustomerService.getRestaurantCustomers('rest-A');

      expect(metrics.totalCustomers).toBe(2); // 1 registered + 1 phone-linked guest
      expect(metrics.registeredCustomersCount).toBe(1);
      expect(metrics.guestCustomersCount).toBe(1);
      expect(metrics.totalOrders).toBe(4);

      // Revenue: 52500 + 21000 + 23100 = 96600 paise (ord-104 is cancelled so not counted in revenue)
      expect(metrics.totalRevenueMinor).toBe(96600);
      expect(metrics.averageOrderValueMinor).toBe(Math.round(96600 / 4));
    });
  });

  describe('8. Strict Invariants & Anti-Regression Checks', () => {
    it('ensures no phone OTP or marketing campaign fields exist in the data model', async () => {
      const res = await restaurantCustomerService.getRestaurantCustomers('rest-A');
      res.customers.forEach((c) => {
        // Assert no unsolicited fields
        expect((c as any).otp).toBeUndefined();
        expect((c as any).phoneOtp).toBeUndefined();
        expect((c as any).loyaltyPoints).toBeUndefined();
        expect((c as any).marketingConsent).toBeUndefined();
        expect((c as any).aiScore).toBeUndefined();
      });
    });
  });
});
