import { collection, query, getDocs, orderBy, where, limit } from 'firebase/firestore';
import { db } from '../config/firebase';
import { Order } from '../types/order';
import {
  RestaurantCustomer,
  RestaurantCustomerSummaryMetrics,
  CustomerSearchAndFilterOptions
} from '../types/restaurantCustomer';
import { enforcePermission } from '../utils/permissions';
import { parseTimestampToMillis } from '../utils/dateUtils';
import { handleFirestoreError, OperationType } from '../utils/firestoreError';

/**
 * Service providing restaurant-scoped Customer Management and CRM foundation.
 * Strictly adheres to tenant boundaries: only aggregates customer records from
 * orders placed at the specified restaurant.
 */
export class RestaurantCustomerService {
  /**
   * Finds an existing restaurant customer by mobile number.
   * POS billing stores a normalized 10-digit Indian mobile number in the order snapshot.
   * Legacy +91/space/dash variants are also searched so existing history can be recovered.
   */
  async findCustomerByPhone(
    restaurantId: string,
    phone: string
  ): Promise<RestaurantCustomer | null> {
    const cleanRestaurantId = restaurantId?.trim();
    const digits = String(phone || '').replace(/\D/g, '').slice(-10);
    if (!cleanRestaurantId || digits.length !== 10) return null;

    await enforcePermission(cleanRestaurantId, 'view_orders');

    const variants = [
      digits,
      `91${digits}`,
      `+91${digits}`,
      `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`,
      `+91 ${digits.slice(0, 5)}-${digits.slice(5)}`,
      `${digits.slice(0, 5)} ${digits.slice(5)}`
    ];

    try {
      const ordersCol = collection(db, 'restaurants', cleanRestaurantId, 'orders');
      const q = query(ordersCol, where('customerSnapshot.phone', 'in', variants.slice(0, 10)), limit(50));
      const snap = await getDocs(q);
      const orders = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Order))
        .sort((a, b) => parseTimestampToMillis(b.createdAt) - parseTimestampToMillis(a.createdAt));

      if (orders.length === 0) return null;

      const latest = orders[0];
      const spend = orders.filter((o) => o.status !== 'cancelled').reduce((sum, o) => sum + (o.grandTotalMinor || 0), 0);
      const completed = orders.filter((o) => o.status === 'completed' || o.status === 'served').length;
      const cancelled = orders.filter((o) => o.status === 'cancelled').length;

      return {
        id: `phone_${digits}`,
        customerId: null,
        isRegistered: false,
        name: latest.customerSnapshot?.name || 'Customer',
        email: latest.customerSnapshot?.email || null,
        phone: digits,
        address: latest.customerSnapshot?.address || null,
        orderCount: orders.length,
        completedOrderCount: completed,
        cancelledOrderCount: cancelled,
        totalSpendMinor: spend,
        averageOrderValueMinor: orders.length ? Math.round(spend / orders.length) : 0,
        firstOrderDate: this.formatDate(orders[orders.length - 1].createdAt),
        lastOrderDate: this.formatDate(latest.createdAt),
        lastOrderType: latest.orderType,
        lastOrderStatus: latest.status,
        lastOrderNumber: latest.orderNumber,
        recentOrders: orders
      };
    } catch (err: unknown) {
      throw handleFirestoreError(err, OperationType.LIST, `restaurants/${cleanRestaurantId}/orders`);
    }
  }

  /**
   * Retrieves aggregated customer profiles and activities for a given restaurant.
   * Multi-order registered customers are deduplicated by their stable Firebase Auth customerId.
   * Guest orders with a captured mobile are grouped by phone; anonymous guests remain separate.
   */
  async getRestaurantCustomers(
    restaurantId: string,
    options: CustomerSearchAndFilterOptions = {}
  ): Promise<{
    customers: RestaurantCustomer[];
    metrics: RestaurantCustomerSummaryMetrics;
  }> {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      throw new Error('restaurantId is required to fetch restaurant customers.');
    }

    await enforcePermission(cleanRestaurantId, 'view_orders');

    const path = `restaurants/${cleanRestaurantId}/orders`;
    try {
      const ordersCol = collection(db, 'restaurants', cleanRestaurantId, 'orders');
      const q = query(ordersCol, orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);

      const allOrders: Order[] = [];
      snap.forEach((d) => {
        allOrders.push({ id: d.id, ...d.data() } as Order);
      });

      // 1. Group orders by customer identity
      // Registered customers: grouped by customerId (Firebase Auth UID)
      // Guest orders: kept distinct by order id to avoid unauthorized fuzzy merging
      const registeredMap = new Map<string, Order[]>();
      const guestOrders: Order[] = [];

      for (const order of allOrders) {
        if (order.customerId && typeof order.customerId === 'string' && order.customerId.trim() !== '') {
          const cleanCustId = order.customerId.trim();
          const existing = registeredMap.get(cleanCustId) || [];
          existing.push(order);
          registeredMap.set(cleanCustId, existing);
        } else {
          guestOrders.push(order);
        }
      }

      const customerList: RestaurantCustomer[] = [];

      // 2. Build aggregated entries for registered customers
      for (const [custId, orders] of registeredMap.entries()) {
        // Sort customer's orders descending by date
        orders.sort((a, b) => parseTimestampToMillis(b.createdAt) - parseTimestampToMillis(a.createdAt));

        const latestOrder = orders[0];
        const oldestOrder = orders[orders.length - 1];

        const completedOrders = orders.filter((o) => o.status === 'completed' || o.status === 'served');
        const cancelledOrders = orders.filter((o) => o.status === 'cancelled');

        const totalSpendMinor = orders
          .filter((o) => o.status !== 'cancelled')
          .reduce((sum, o) => sum + (o.grandTotalMinor || 0), 0);

        const orderCount = orders.length;
        const averageOrderValueMinor = orderCount > 0 ? Math.round(totalSpendMinor / orderCount) : 0;

        // Resolve best contact details from recent snapshots
        const name =
          latestOrder.customerSnapshot?.name ||
          orders.find((o) => o.customerSnapshot?.name)?.customerSnapshot?.name ||
          'Customer';
        const email =
          latestOrder.customerSnapshot?.email ||
          orders.find((o) => o.customerSnapshot?.email)?.customerSnapshot?.email ||
          null;
        const phone =
          latestOrder.customerSnapshot?.phone ||
          orders.find((o) => o.customerSnapshot?.phone)?.customerSnapshot?.phone ||
          null;
        const address =
          latestOrder.customerSnapshot?.address ||
          orders.find((o) => o.customerSnapshot?.address)?.customerSnapshot?.address ||
          null;

        customerList.push({
          id: custId,
          customerId: custId,
          isRegistered: true,
          name,
          email,
          phone,
          address,
          orderCount,
          completedOrderCount: completedOrders.length,
          cancelledOrderCount: cancelledOrders.length,
          totalSpendMinor,
          averageOrderValueMinor,
          firstOrderDate: this.formatDate(oldestOrder.createdAt),
          lastOrderDate: this.formatDate(latestOrder.createdAt),
          lastOrderType: latestOrder.orderType,
          lastOrderStatus: latestOrder.status,
          lastOrderNumber: latestOrder.orderNumber,
          recentOrders: orders
        });
      }

      // 3. Build guest activity. If a POS bill captured a mobile number, that phone
      // becomes the stable restaurant-scoped guest identity so future visits share history.
      // Orders without a phone remain individual guest records.
      const guestByPhone = new Map<string, Order[]>();
      const anonymousGuests: Order[] = [];

      for (const gOrder of guestOrders) {
        const phoneDigits = String(gOrder.customerSnapshot?.phone || '').replace(/\\D/g, '').slice(-10);
        if (phoneDigits.length === 10) {
          const existing = guestByPhone.get(phoneDigits) || [];
          existing.push(gOrder);
          guestByPhone.set(phoneDigits, existing);
        } else {
          anonymousGuests.push(gOrder);
        }
      }

      for (const [phoneDigits, orders] of guestByPhone.entries()) {
        orders.sort((a, b) => parseTimestampToMillis(b.createdAt) - parseTimestampToMillis(a.createdAt));
        const latest = orders[0];
        const spend = orders
          .filter((o) => o.status !== 'cancelled')
          .reduce((sum, o) => sum + (o.grandTotalMinor || 0), 0);

        customerList.push({
          id: `phone_${phoneDigits}`,
          customerId: null,
          isRegistered: false,
          name: latest.customerSnapshot?.name || 'Customer',
          email: latest.customerSnapshot?.email || null,
          phone: phoneDigits,
          address: latest.customerSnapshot?.address || null,
          orderCount: orders.length,
          completedOrderCount: orders.filter((o) => o.status === 'completed' || o.status === 'served').length,
          cancelledOrderCount: orders.filter((o) => o.status === 'cancelled').length,
          totalSpendMinor: spend,
          averageOrderValueMinor: orders.length ? Math.round(spend / orders.length) : 0,
          firstOrderDate: this.formatDate(orders[orders.length - 1].createdAt),
          lastOrderDate: this.formatDate(latest.createdAt),
          lastOrderType: latest.orderType,
          lastOrderStatus: latest.status,
          lastOrderNumber: latest.orderNumber,
          recentOrders: orders
        });
      }

      for (const gOrder of anonymousGuests) {
        const isCancelled = gOrder.status === 'cancelled';
        const isCompleted = gOrder.status === 'completed' || gOrder.status === 'served';
        const spend = isCancelled ? 0 : gOrder.grandTotalMinor || 0;

        customerList.push({
          id: `guest_${gOrder.id}`,
          customerId: null,
          isRegistered: false,
          name: gOrder.customerSnapshot?.name || 'Guest Diner',
          email: gOrder.customerSnapshot?.email || null,
          phone: null,
          address: gOrder.customerSnapshot?.address || null,
          orderCount: 1,
          completedOrderCount: isCompleted ? 1 : 0,
          cancelledOrderCount: isCancelled ? 1 : 0,
          totalSpendMinor: spend,
          averageOrderValueMinor: spend,
          firstOrderDate: this.formatDate(gOrder.createdAt),
          lastOrderDate: this.formatDate(gOrder.createdAt),
          lastOrderType: gOrder.orderType,
          lastOrderStatus: gOrder.status,
          lastOrderNumber: gOrder.orderNumber,
          recentOrders: [gOrder]
        });
      }

      // 4. Compute overall restaurant summary metrics
      const totalCustomers = customerList.length;
      const registeredCustomersCount = customerList.filter((c) => c.isRegistered).length;
      const guestCustomersCount = customerList.filter((c) => !c.isRegistered).length;
      const totalOrders = allOrders.length;
      const totalRevenueMinor = allOrders
        .filter((o) => o.status !== 'cancelled')
        .reduce((sum, o) => sum + (o.grandTotalMinor || 0), 0);
      const averageOrderValueMinor =
        totalOrders > 0 ? Math.round(totalRevenueMinor / totalOrders) : 0;

      const metrics: RestaurantCustomerSummaryMetrics = {
        totalCustomers,
        registeredCustomersCount,
        guestCustomersCount,
        totalOrders,
        totalRevenueMinor,
        averageOrderValueMinor
      };

      // 5. Apply filters and search
      let filtered = [...customerList];

      // Category filter
      if (options.categoryFilter) {
        const now = Date.now();
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

        switch (options.categoryFilter) {
          case 'registered':
            filtered = filtered.filter((c) => c.isRegistered);
            break;
          case 'guest':
            filtered = filtered.filter((c) => !c.isRegistered);
            break;
          case 'recent':
            filtered = filtered.filter((c) => {
              const lastOrderMillis = new Date(c.lastOrderDate).getTime();
              return lastOrderMillis >= thirtyDaysAgo;
            });
            break;
          case 'multi_order':
            filtered = filtered.filter((c) => c.orderCount >= 2);
            break;
          case 'all':
          default:
            break;
        }
      }

      // Search query filter (matches name, email, phone, or customerId)
      if (options.searchQuery && options.searchQuery.trim() !== '') {
        const term = options.searchQuery.trim().toLowerCase();
        filtered = filtered.filter((c) => {
          const nameMatch = c.name.toLowerCase().includes(term);
          const emailMatch = (c.email || '').toLowerCase().includes(term);
          const phoneMatch = (c.phone || '').toLowerCase().includes(term);
          const idMatch = (c.customerId || '').toLowerCase().includes(term);
          return nameMatch || emailMatch || phoneMatch || idMatch;
        });
      }

      // Sort: Most recent order first
      filtered.sort((a, b) => {
        const timeA = new Date(a.lastOrderDate).getTime();
        const timeB = new Date(b.lastOrderDate).getTime();
        return timeB - timeA;
      });

      if (options.limitCount && options.limitCount > 0) {
        filtered = filtered.slice(0, options.limitCount);
      }

      return {
        customers: filtered,
        metrics
      };
    } catch (err: unknown) {
      throw handleFirestoreError(err, OperationType.LIST, path);
    }
  }

  /**
   * Retrieves orders for a specific customer strictly scoped to this restaurant.
   */
  async getCustomerOrders(
    restaurantId: string,
    customerIdOrGuestId: string
  ): Promise<Order[]> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanId = customerIdOrGuestId?.trim();
    if (!cleanRestaurantId || !cleanId) {
      throw new Error('restaurantId and customerId are required.');
    }

    await enforcePermission(cleanRestaurantId, 'view_orders');

    const path = `restaurants/${cleanRestaurantId}/orders`;
    try {
      const ordersCol = collection(db, 'restaurants', cleanRestaurantId, 'orders');

      // If it is a guest order ID
      if (cleanId.startsWith('guest_')) {
        const orderId = cleanId.replace('guest_', '');
        const q = query(ordersCol, where('__name__', '==', orderId));
        const snap = await getDocs(q);
        const orders: Order[] = [];
        snap.forEach((d) => orders.push({ id: d.id, ...d.data() } as Order));
        return orders;
      }

      // Query registered customer orders strictly within this restaurant
      const q = query(ordersCol, where('customerId', '==', cleanId));
      const snap = await getDocs(q);
      const orders: Order[] = [];
      snap.forEach((d) => orders.push({ id: d.id, ...d.data() } as Order));

      orders.sort((a, b) => parseTimestampToMillis(b.createdAt) - parseTimestampToMillis(a.createdAt));
      return orders;
    } catch (err: unknown) {
      throw handleFirestoreError(err, OperationType.LIST, path);
    }
  }

  private formatDate(val: any): string {
    if (!val) return new Date().toISOString();
    if (typeof val === 'string') return val;
    if (val.toDate && typeof val.toDate === 'function') {
      return val.toDate().toISOString();
    }
    if (val instanceof Date) return val.toISOString();
    return new Date().toISOString();
  }
}

export const restaurantCustomerService = new RestaurantCustomerService();
