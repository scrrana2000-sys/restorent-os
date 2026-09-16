import { Order, OrderType, OrderStatus } from './order';
import { MoneyMinor } from './money';

export type CustomerCategoryFilter = 'all' | 'registered' | 'guest' | 'recent' | 'multi_order';

export interface RestaurantCustomer {
  id: string; // Unique identifier: customerId for registered customers, or 'guest_' + orderId for guest orders
  customerId: string | null; // Authenticated Firebase Auth UID or null for guest
  isRegistered: boolean;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  orderCount: number;
  completedOrderCount: number;
  cancelledOrderCount: number;
  totalSpendMinor: MoneyMinor;
  averageOrderValueMinor: MoneyMinor;
  firstOrderDate: string;
  lastOrderDate: string;
  lastOrderType?: OrderType;
  lastOrderStatus?: OrderStatus;
  lastOrderNumber?: string;
  recentOrders: Order[];
}

export interface RestaurantCustomerSummaryMetrics {
  totalCustomers: number;
  registeredCustomersCount: number;
  guestCustomersCount: number;
  totalOrders: number;
  totalRevenueMinor: MoneyMinor;
  averageOrderValueMinor: MoneyMinor;
}

export interface CustomerSearchAndFilterOptions {
  searchQuery?: string;
  categoryFilter?: CustomerCategoryFilter;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  limitCount?: number;
}
