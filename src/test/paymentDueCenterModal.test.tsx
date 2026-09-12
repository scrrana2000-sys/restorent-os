import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentDueCenterModal } from '../components/pos/PaymentDueCenterModal';
import { Order } from '../types/order';

describe('PaymentDueCenterModal UI Component', () => {
  const mockOrders: Order[] = [
    {
      id: 'ord-1',
      restaurantId: 'rest-1',
      orderNumber: '101',
      orderType: 'takeaway',
      status: 'ready',
      paymentStatus: 'unpaid',
      source: 'pos',
      subtotalMinor: 15750,
      discountMinor: 0,
      cgstMinor: 0,
      sgstMinor: 0,
      igstMinor: 0,
      grandTotalMinor: 15750,
      paidAmountMinor: 0,
      dueAmountMinor: 15750,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'staff-1',
      items: [{ itemId: 'item-1', nameSnapshot: 'Chicken Roll', shortNameSnapshot: 'Chicken Roll', quantity: 1, unitPriceMinor: 15750, taxRate: 0, taxInclusive: false, discountMinor: 0, lineSubtotalMinor: 15750, lineTaxMinor: 0, lineTotalMinor: 15750 }]
    },
    {
      id: 'ord-2',
      restaurantId: 'rest-1',
      orderNumber: '102',
      orderType: 'dineIn',
      status: 'served',
      paymentStatus: 'unpaid',
      source: 'pos',
      subtotalMinor: 65000,
      discountMinor: 0,
      cgstMinor: 0,
      sgstMinor: 0,
      igstMinor: 0,
      grandTotalMinor: 65000,
      paidAmountMinor: 0,
      dueAmountMinor: 65000,
      tableId: 'Table 4',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'staff-1',
      items: [{ itemId: 'item-2', nameSnapshot: 'Paneer Tikka', shortNameSnapshot: 'Paneer Tikka', quantity: 2, unitPriceMinor: 32500, taxRate: 0, taxInclusive: false, discountMinor: 0, lineSubtotalMinor: 65000, lineTaxMinor: 0, lineTotalMinor: 65000 }]
    }
  ];

  it('renders correctly when open and displays orders count and outstanding total', () => {
    render(
      <PaymentDueCenterModal
        isOpen={true}
        onClose={vi.fn()}
        orders={mockOrders}
        loading={false}
        error={null}
        onCollectPayment={vi.fn()}
        symbol="₹"
      />
    );

    expect(screen.getByRole('heading', { name: /Payment Due Center/i })).toBeDefined();
    expect(screen.getByText(/2 Orders/i)).toBeDefined();
    expect(screen.getByText('#101')).toBeDefined();
    expect(screen.getByText('#102')).toBeDefined();
    expect(screen.getByText(/Table 4/i)).toBeDefined();
  });

  it('filters orders by order type when tab clicked', () => {
    render(
      <PaymentDueCenterModal
        isOpen={true}
        onClose={vi.fn()}
        orders={mockOrders}
        loading={false}
        error={null}
        onCollectPayment={vi.fn()}
        symbol="₹"
      />
    );

    // Click Takeaway tab
    const takeawayTab = screen.getByRole('button', { name: /Takeaway/i });
    fireEvent.click(takeawayTab);

    expect(screen.getByText('#101')).toBeDefined();
    expect(screen.queryByText('#102')).toBeNull();
  });

  it('calls onCollectPayment with the order when Collect Payment clicked', () => {
    const handleCollect = vi.fn();
    render(
      <PaymentDueCenterModal
        isOpen={true}
        onClose={vi.fn()}
        orders={mockOrders}
        loading={false}
        error={null}
        onCollectPayment={handleCollect}
        symbol="₹"
      />
    );

    const collectBtns = screen.getAllByRole('button', { name: /Collect Payment/i });
    fireEvent.click(collectBtns[0]);

    expect(handleCollect).toHaveBeenCalledWith(mockOrders[0]);
  });

  it('displays error message and retry button on error state instead of empty state', () => {
    const handleRetry = vi.fn();
    render(
      <PaymentDueCenterModal
        isOpen={true}
        onClose={vi.fn()}
        orders={[]}
        loading={false}
        error="Permission denied loading dues"
        onRetry={handleRetry}
        symbol="₹"
      />
    );

    expect(screen.getByText(/Unable to load payment dues/i)).toBeDefined();
    expect(screen.getByText(/Permission denied loading dues/i)).toBeDefined();

    const retryBtn = screen.getByRole('button', { name: /Retry/i });
    fireEvent.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });
});
