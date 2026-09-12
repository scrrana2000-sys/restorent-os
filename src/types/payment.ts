import { MoneyMinor } from './money';

export type PaymentMethod = 'cash' | 'card' | 'upi' | 'other';

export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'refunded';

export interface Payment {
  id: string;
  restaurantId: string;
  orderId: string;
  amountMinor: MoneyMinor;
  method: PaymentMethod;
  status: PaymentStatus;
  reference?: string | null;
  idempotencyKey?: string | null;
  refundReason?: string | null;
  refundedAt?: any;
  refundedBy?: string | null;
  createdBy: string;
  updatedBy?: string | null;
  createdAt: any;
  updatedAt?: any;
}

export interface PaymentHistoryFilterOptions {
  startDate?: Date | null;
  endDate?: Date | null;
  method?: PaymentMethod | 'all';
  status?: PaymentStatus | 'all';
  orderId?: string;
  searchQuery?: string;
  limitCount?: number;
}

export interface PaymentTotalsSummary {
  totalCollectedMinor: MoneyMinor;
  totalRefundedMinor: MoneyMinor;
  totalPendingMinor: MoneyMinor;
  count: number;
}

export interface PaymentHistoryResult {
  payments: Payment[];
  totalCount: number;
  totals: PaymentTotalsSummary;
}

