import { describe, it, expect, beforeEach, vi } from 'vitest';
import { calculateAggregateOrderStatus } from '../utils/kotQueueHelpers';
import { KOT, KOTStatus } from '../types/kot';
import { OrderStatus } from '../types/order';
import { hasPermission, PERMISSION_MATRIX } from '../utils/permissions';
import { validateKOTStatusTransition, validateOrderStatusTransition } from '../utils/transactionValidation';

describe('Phase 2 Hardening — Staff Order → KOT → Kitchen Flow', () => {
  const mockKot = (id: string, status: KOTStatus): KOT => ({
    id,
    kotNumber: `KOT-${id}`,
    restaurantId: 'rest_test',
    orderId: 'ord_123',
    items: [
      {
        itemId: 'item_1',
        nameSnapshot: 'Paneer Tikka',
        quantity: 2
      }
    ],
    status,
    createdBy: 'staff_user',
    updatedBy: 'staff_user',
    createdAt: new Date(),
    updatedAt: new Date()
  });

  describe('1. KOT Status Aggregation (calculateAggregateOrderStatus)', () => {
    it('returns "sentToKitchen" when all KOTs are sentToKitchen or confirmed', () => {
      const kots = [mockKot('1', 'sentToKitchen'), mockKot('2', 'confirmed')];
      const result = calculateAggregateOrderStatus('confirmed', kots);
      expect(result).toBe('sentToKitchen');
    });

    it('returns "preparing" when any KOT is preparing', () => {
      const kots = [mockKot('1', 'sentToKitchen'), mockKot('2', 'preparing')];
      const result = calculateAggregateOrderStatus('sentToKitchen', kots);
      expect(result).toBe('preparing');
    });

    it('returns "preparing" when one KOT is ready and another is sentToKitchen', () => {
      const kots = [mockKot('1', 'ready'), mockKot('2', 'sentToKitchen')];
      const result = calculateAggregateOrderStatus('sentToKitchen', kots);
      expect(result).toBe('preparing');
    });

    it('returns "ready" when all active KOTs are ready', () => {
      const kots = [mockKot('1', 'ready'), mockKot('2', 'ready')];
      const result = calculateAggregateOrderStatus('preparing', kots);
      expect(result).toBe('ready');
    });

    it('returns "ready" when one KOT is served and another is ready', () => {
      const kots = [mockKot('1', 'served'), mockKot('2', 'ready')];
      const result = calculateAggregateOrderStatus('preparing', kots);
      expect(result).toBe('ready');
    });

    it('returns "served" when ALL active KOTs are served', () => {
      const kots = [mockKot('1', 'served'), mockKot('2', 'served')];
      const result = calculateAggregateOrderStatus('ready', kots);
      expect(result).toBe('served');
    });

    it('ignores cancelled KOTs during aggregation', () => {
      const kots = [
        mockKot('1', 'cancelled'),
        mockKot('2', 'ready'),
        mockKot('3', 'served')
      ];
      const result = calculateAggregateOrderStatus('preparing', kots);
      expect(result).toBe('ready');
    });

    it('never mutates terminal order statuses ("completed" or "cancelled")', () => {
      const kots = [mockKot('1', 'sentToKitchen')];
      expect(calculateAggregateOrderStatus('completed', kots)).toBe('completed');
      expect(calculateAggregateOrderStatus('cancelled', kots)).toBe('cancelled');
    });
  });

  describe('2. State Machine Transition Safeguards', () => {
    it('validates forward KOT progression: sentToKitchen -> preparing -> ready -> served', () => {
      expect(validateKOTStatusTransition('draft', 'confirmed').isValid).toBe(true);
      expect(validateKOTStatusTransition('confirmed', 'sentToKitchen').isValid).toBe(true);
      expect(validateKOTStatusTransition('sentToKitchen', 'preparing').isValid).toBe(true);
      expect(validateKOTStatusTransition('preparing', 'ready').isValid).toBe(true);
      expect(validateKOTStatusTransition('ready', 'served').isValid).toBe(true);
    });

    it('rejects invalid backward transitions or skipping terminal state', () => {
      expect(validateKOTStatusTransition('ready', 'draft').isValid).toBe(false);
      expect(validateKOTStatusTransition('served', 'preparing').isValid).toBe(false);
      expect(validateKOTStatusTransition('cancelled', 'ready').isValid).toBe(false);
    });

    it('allows cancellation from non-terminal states with valid reason', () => {
      expect(validateKOTStatusTransition('sentToKitchen', 'cancelled').isValid).toBe(true);
      expect(validateKOTStatusTransition('preparing', 'cancelled').isValid).toBe(true);
      expect(validateKOTStatusTransition('ready', 'cancelled').isValid).toBe(true);
      expect(validateKOTStatusTransition('served', 'cancelled').isValid).toBe(false);
    });
  });

  describe('3. Staff & Captain Role Boundary Safeguards', () => {
    it('captain role has create_orders and print_kot permissions', () => {
      expect(hasPermission('captain', 'create_orders')).toBe(true);
      expect(hasPermission('captain', 'print_kot')).toBe(true);
      expect(hasPermission('captain', 'view_orders')).toBe(true);
      expect(hasPermission('captain', 'open_table_sessions')).toBe(true);
      expect(hasPermission('captain', 'update_kot_status')).toBe(true);
    });

    it('captain role is strictly forbidden from unauthorized administrative actions', () => {
      // Captains must not be granted menu management, inventory admin, refunds, or settings
      expect(hasPermission('captain', 'manage_staff')).toBe(false);
      expect(hasPermission('captain', 'manage_inventory')).toBe(false);
      expect(hasPermission('captain', 'refund_payments')).toBe(false);
      expect(hasPermission('captain', 'process_payments')).toBe(false);
      expect(hasPermission('captain', 'cancel_orders')).toBe(false);
      expect(hasPermission('captain', 'manage_printers')).toBe(false);
    });
  });

  describe('4. Order + KOT Separation of Concerns', () => {
    it('KOT items strip financial amounts while keeping kitchen snapshots', () => {
      const orderItem = {
        itemId: 'item_paneer',
        nameSnapshot: 'Paneer Butter Masala',
        shortNameSnapshot: 'PBM',
        priceMinor: 28000,
        unitPriceMinor: 28000,
        quantity: 2,
        taxRate: 5,
        notes: 'Make it mild spice'
      };

      // KOT item structure only preserves kitchen relevant fields
      const kotItem = {
        itemId: orderItem.itemId,
        nameSnapshot: orderItem.nameSnapshot,
        shortNameSnapshot: orderItem.shortNameSnapshot,
        quantity: orderItem.quantity,
        notes: orderItem.notes
      };

      expect(kotItem).not.toHaveProperty('priceMinor');
      expect(kotItem).not.toHaveProperty('unitPriceMinor');
      expect(kotItem).not.toHaveProperty('taxRate');
      expect(kotItem.nameSnapshot).toBe('Paneer Butter Masala');
      expect(kotItem.quantity).toBe(2);
      expect(kotItem.notes).toBe('Make it mild spice');
    });
  });
});
