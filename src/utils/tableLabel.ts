import { Order } from '../types/order';
import { Table } from '../types/table';

/**
 * Derives authoritative human-readable location/table label for an order.
 * Strictly hides internal table document IDs, session IDs, transaction IDs, and activeSessionId.
 * - For takeaway: 'TAKEAWAY / PARCEL'
 * - For delivery: 'DELIVERY'
 * - For dineIn: 'Table 1' or 'Table 5 (Patio VIP)'
 * - For dineIn without table: 'Table —'
 */
export function getFormattedTableLabel(
  ord: Order | null | undefined,
  tableMap?: Map<string, Table> | null
): string {
  if (!ord) return 'N/A';

  if (ord.orderType === 'takeaway') {
    return 'TAKEAWAY / PARCEL';
  }
  if (ord.orderType === 'delivery') {
    return 'DELIVERY';
  }
  if (ord.orderType === 'dineIn' || (ord.orderType as any) === 'dine_in') {
    if (!ord.tableId) {
      return 'Table —';
    }

    const tableObj = tableMap?.get(ord.tableId);
    if (tableObj) {
      const num = tableObj.tableNumber?.trim();
      const name = tableObj.name?.trim();

      if (name && name !== `Table ${num}` && name !== num) {
        return name.toLowerCase().startsWith('table') ? name : `Table ${num} (${name})`;
      }
      if (num) {
        return num.toLowerCase().startsWith('table') ? num : `Table ${num}`;
      }
      if (name) {
        return name.toLowerCase().startsWith('table') ? name : `Table ${name}`;
      }
    }

    // If ord.tableId is already formatted as a human-readable label (e.g., "Table 4")
    const cleanTableId = ord.tableId.trim();
    if (cleanTableId.toLowerCase().startsWith('table ')) {
      return cleanTableId;
    }

    // Requirement: If Dine-In order has an internal tableId but corresponding table document cannot be found,
    // do NOT display raw tableId or internal identifier. Use safe fallback "Table —".
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[PaymentDueCenter] Table document missing for tableId "${ord.tableId}" on order ${ord.id || ord.orderNumber}`);
    }

    return 'Table —';
  }

  return 'N/A';
}
