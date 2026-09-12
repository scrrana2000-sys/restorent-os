import { OrderItemModifier } from './order';

export type KOTStatus =
  | 'draft'
  | 'confirmed'
  | 'sentToKitchen'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'cancelled';

export interface KOTItem {
  itemId: string;
  nameSnapshot: string;
  shortNameSnapshot?: string;
  imageUrlSnapshot?: string | null;
  foodTypeSnapshot?: string | null;
  quantity: number; // Active quantity to prepare/fulfill
  originalQuantity?: number; // Preserved original ordered quantity
  cancelledQuantity?: number; // Quantity cancelled
  cancellationReason?: string;
  cancelledAt?: Date | string | null;
  cancelledBy?: string | null;
  notes?: string;
  modifiers?: OrderItemModifier[];
}

export interface KOT {
  id: string;
  kotNumber: string;
  restaurantId: string;
  orderId: string;
  orderNumber?: string | null;
  orderType?: any;
  tableId?: string | null;
  tableSessionId?: string | null;
  items: KOTItem[];
  notes?: string;
  status: KOTStatus;
  cancellationReason?: string | null;
  cancelledAt?: any;
  cancelledBy?: string | null;
  sentToKitchenAt?: any;
  preparingAt?: any;
  readyAt?: any;
  servedAt?: any;
  createdBy: string;
  updatedBy?: string | null;
  createdAt: any;
  updatedAt: any;
}
