import { MoneyMinor } from './money';
import { TaxRate } from './tax';

export type OrderType = 'dineIn' | 'takeaway' | 'delivery' | 'online';

export type OrderSource = 'pos' | 'captain' | 'admin' | 'online' | 'api';

export type OrderStatus =
  | 'draft'
  | 'confirmed'
  | 'sentToKitchen'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'completed'
  | 'cancelled';

export interface OrderItemModifier {
  id: string;
  name: string;
  priceMinor: MoneyMinor;
}

export interface OrderItem {
  itemId: string;
  nameSnapshot: string;
  shortNameSnapshot: string;
  imageUrlSnapshot?: string | null;
  foodTypeSnapshot?: string | null;
  quantity: number; // Active billable quantity
  originalQuantity?: number; // Preserved original ordered quantity
  cancelledQuantity?: number; // Quantity cancelled
  cancellationReason?: string;
  cancelledAt?: Date | string | null;
  cancelledBy?: string | null;
  unitPriceMinor: MoneyMinor;
  taxRate: TaxRate;
  taxInclusive: boolean;
  discountMinor: MoneyMinor;
  lineSubtotalMinor: MoneyMinor;
  lineTaxMinor: MoneyMinor;
  lineTotalMinor: MoneyMinor;
  notes?: string;
  modifiers?: OrderItemModifier[];
}

export interface CustomerSnapshot {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  gstin?: string;
}

export interface Order {
  id: string;
  restaurantId: string;
  orderNumber: string;
  tableId?: string | null;
  tableSessionId?: string | null;
  orderType: OrderType;
  source: OrderSource;
  status: OrderStatus;
  items: OrderItem[];
  itemCount?: number;
  subtotalMinor: MoneyMinor;
  discountMinor: MoneyMinor;
  taxableAmountMinor?: MoneyMinor;
  taxableSubtotalMinor?: MoneyMinor;
  taxJurisdiction?: any;
  currency?: string;
  cgstMinor: MoneyMinor;
  sgstMinor: MoneyMinor;
  igstMinor: MoneyMinor;
  totalTaxMinor?: MoneyMinor;
  taxMinor?: MoneyMinor;
  grandTotalMinor: MoneyMinor;
  paidAmountMinor: MoneyMinor;
  dueAmountMinor: MoneyMinor;
  paymentStatus?: 'unpaid' | 'partially_paid' | 'paid' | string | null;
  notes?: string;
  customerSnapshot?: CustomerSnapshot | null;
  cancellationReason?: string | null;
  cancelledAt?: any | null;
  cancelledBy?: string | null;
  completedAt?: any | null;
  completedBy?: string | null;
  stockConsumptionStatus?: 'consumed' | 'failed' | 'reversed' | 'reversal_failed' | 'not_applicable' | null;
  stockConsumptionError?: string | null;
  createdAt: any;
  updatedAt: any;
  createdBy: string;
  updatedBy?: string | null;
}
