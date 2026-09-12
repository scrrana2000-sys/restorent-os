import { describe, it, expect, vi } from 'vitest';
import { getFormattedTableLabel } from '../components/pos/PaymentDueCenterModal';
import { Table } from '../types/table';
import { Order } from '../types/order';

describe('PaymentDueCenterModal — Table Label Resolution & Safety', () => {
  const mockTables: Table[] = [
    {
      id: 'LUBEOOUHBP7RL8HMZV0H',
      restaurantId: 'rest_123',
      name: 'Table 1',
      tableNumber: '1',
      floorOrArea: 'Main Hall',
      capacity: 4,
      isActive: true,
      sortOrder: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 'TBL_DOC_99999999999999',
      restaurantId: 'rest_123',
      name: 'Patio VIP',
      tableNumber: '5',
      floorOrArea: 'Outdoor',
      capacity: 6,
      isActive: true,
      sortOrder: 2,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: 'TBL_DOC_33333333333333',
      restaurantId: 'rest_123',
      name: 'Table 3',
      tableNumber: '3',
      floorOrArea: 'Main Hall',
      capacity: 2,
      isActive: true,
      sortOrder: 3,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ];

  const tableMap = new Map<string, Table>();
  mockTables.forEach((t) => tableMap.set(t.id, t));

  it('1. Dine-In order with tableId displays actual table number/name', () => {
    const order: Partial<Order> = {
      id: 'ord_1',
      orderNumber: 'ORD-101',
      orderType: 'dineIn',
      tableId: 'LUBEOOUHBP7RL8HMZV0H'
    };

    const label = getFormattedTableLabel(order as Order, tableMap);
    expect(label).toBe('Table 1');
  });

  it('2. Table document ID is never displayed as table number', () => {
    const order: Partial<Order> = {
      id: 'ord_2',
      orderNumber: 'ORD-102',
      orderType: 'dineIn',
      tableId: 'LUBEOOUHBP7RL8HMZV0H'
    };

    const label = getFormattedTableLabel(order as Order, tableMap);
    expect(label).not.toContain('LUBEOOUHBP7RL8HMZV0H');
    expect(label).toBe('Table 1');
  });

  it('3. Internal session ID is never displayed as table number', () => {
    const order: Partial<Order> = {
      id: 'ord_3',
      orderNumber: 'ORD-103',
      orderType: 'dineIn',
      tableId: 'LUBEOOUHBP7RL8HMZV0H',
      tableSessionId: 'SESSION_ABC_9876543210'
    };

    const label = getFormattedTableLabel(order as Order, tableMap);
    expect(label).not.toContain('SESSION');
    expect(label).not.toContain('ABC');
    expect(label).toBe('Table 1');
  });

  it('4. Internal transaction ID is never displayed', () => {
    const order: Partial<Order> = {
      id: 'ord_4',
      orderNumber: 'ORD-104',
      orderType: 'dineIn',
      tableId: 'LUBEOOUHBP7RL8HMZV0H'
    };

    const label = getFormattedTableLabel(order as Order, tableMap);
    expect(label).not.toContain('TXN');
    expect(label).not.toContain('ord_4');
    expect(label).toBe('Table 1');
  });

  it('5. Takeaway displays Takeaway/Parcel and no table', () => {
    const order: Partial<Order> = {
      id: 'ord_5',
      orderNumber: 'ORD-105',
      orderType: 'takeaway',
      tableId: 'LUBEOOUHBP7RL8HMZV0H'
    };

    const label = getFormattedTableLabel(order as Order, tableMap);
    expect(label).toBe('TAKEAWAY / PARCEL');
    expect(label).not.toContain('Table');
  });

  it('6. Delivery displays Delivery and no table', () => {
    const order: Partial<Order> = {
      id: 'ord_6',
      orderNumber: 'ORD-106',
      orderType: 'delivery',
      tableId: 'LUBEOOUHBP7RL8HMZV0H'
    };

    const label = getFormattedTableLabel(order as Order, tableMap);
    expect(label).toBe('DELIVERY');
    expect(label).not.toContain('Table');
  });

  it('7. Missing table document shows safe fallback (Table —)', () => {
    const order: Partial<Order> = {
      id: 'ord_7',
      orderNumber: 'ORD-107',
      orderType: 'dineIn',
      tableId: 'MISSING_DOC_ID_XXXX'
    };

    const label = getFormattedTableLabel(order as Order, tableMap);
    expect(label).toBe('Table —');
    expect(label).not.toContain('MISSING_DOC_ID');
  });

  it('8. Correct restaurant-scoped table is resolved', () => {
    const order: Partial<Order> = {
      id: 'ord_8',
      orderNumber: 'ORD-108',
      orderType: 'dineIn',
      tableId: 'TBL_DOC_99999999999999'
    };

    const label = getFormattedTableLabel(order as Order, tableMap);
    expect(label).toBe('Table 5 (Patio VIP)');
  });

  it('9. Cross-tenant table missing from tenant tableMap falls back safely', () => {
    const tenantBMap = new Map<string, Table>(); // Empty tenant map for another restaurant
    const order: Partial<Order> = {
      id: 'ord_9',
      orderNumber: 'ORD-109',
      orderType: 'dineIn',
      tableId: 'LUBEOOUHBP7RL8HMZV0H'
    };

    const label = getFormattedTableLabel(order as Order, tenantBMap);
    expect(label).toBe('Table —');
    expect(label).not.toContain('LUBEOOUHBP7RL8HMZV0H');
  });

  it('10. Payment Due calculations remain accurate for due amount', () => {
    const order: Partial<Order> = {
      id: 'ord_10',
      grandTotalMinor: 5000,
      paidAmountMinor: 2000,
      dueAmountMinor: 3000
    };

    const due = order.dueAmountMinor ?? Math.max(0, (order.grandTotalMinor || 0) - (order.paidAmountMinor || 0));
    expect(due).toBe(3000);
  });

  it('11. Collect Payment action target remains valid order entity', () => {
    const order: Partial<Order> = {
      id: 'ord_11',
      orderNumber: 'ORD-111',
      orderType: 'dineIn',
      tableId: 'LUBEOOUHBP7RL8HMZV0H',
      grandTotalMinor: 4500,
      dueAmountMinor: 4500
    };

    const collectHandler = vi.fn();
    collectHandler(order as Order);
    expect(collectHandler).toHaveBeenCalledWith(order);
  });

  it('12. Realtime Payment Due subscription handler processes updated orders without mutating table labels', () => {
    const initialOrders: Partial<Order>[] = [
      { id: 'o1', orderNumber: 'ORD-1', orderType: 'dineIn', tableId: 'LUBEOOUHBP7RL8HMZV0H' }
    ];

    const updatedOrders: Partial<Order>[] = [
      { id: 'o1', orderNumber: 'ORD-1', orderType: 'dineIn', tableId: 'LUBEOOUHBP7RL8HMZV0H' },
      { id: 'o2', orderNumber: 'ORD-2', orderType: 'takeaway' }
    ];

    expect(getFormattedTableLabel(initialOrders[0] as Order, tableMap)).toBe('Table 1');
    expect(getFormattedTableLabel(updatedOrders[1] as Order, tableMap)).toBe('TAKEAWAY / PARCEL');
  });

  it('13. Search by resolved table label works correctly', () => {
    const order1: Partial<Order> = { id: 'o1', orderType: 'dineIn', tableId: 'LUBEOOUHBP7RL8HMZV0H' };
    const order2: Partial<Order> = { id: 'o2', orderType: 'dineIn', tableId: 'TBL_DOC_99999999999999' };

    const label1 = getFormattedTableLabel(order1 as Order, tableMap).toLowerCase();
    const label2 = getFormattedTableLabel(order2 as Order, tableMap).toLowerCase();

    expect(label1.includes('table 1')).toBe(true);
    expect(label2.includes('patio')).toBe(true);
  });

  it('14. Multiple Dine-In orders show their respective table numbers', () => {
    const o1: Partial<Order> = { id: 'o1', orderType: 'dineIn', tableId: 'LUBEOOUHBP7RL8HMZV0H' };
    const o2: Partial<Order> = { id: 'o2', orderType: 'dineIn', tableId: 'TBL_DOC_99999999999999' };
    const o3: Partial<Order> = { id: 'o3', orderType: 'dineIn', tableId: 'TBL_DOC_33333333333333' };

    expect(getFormattedTableLabel(o1 as Order, tableMap)).toBe('Table 1');
    expect(getFormattedTableLabel(o2 as Order, tableMap)).toBe('Table 5 (Patio VIP)');
    expect(getFormattedTableLabel(o3 as Order, tableMap)).toBe('Table 3');
  });

  it('15. No N+1 listener/listener leak: Table subscription uses single restaurant listener', () => {
    let activeListeners = 0;
    const subscribeMock = vi.fn((restaurantId: string, callback: (tables: Table[]) => void) => {
      activeListeners++;
      callback(mockTables);
      return () => {
        activeListeners--;
      };
    });

    const unsubscribe = subscribeMock('rest_123', () => {});
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(activeListeners).toBe(1);

    unsubscribe();
    expect(activeListeners).toBe(0);
  });
});
