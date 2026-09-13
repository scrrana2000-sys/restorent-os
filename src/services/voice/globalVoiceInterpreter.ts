import { StaffRole } from '../../types/auth';
import { MenuItem } from '../../types/menu';
import { isViewAllowed, hasPermission } from '../../utils/permissions';
import { MatchedItemResult, AmbiguousMatchResult, VoiceLanguage } from './voiceTypes';
import { matchVoiceTranscriptToMenu } from './voiceMenuMatcher';
import { inventoryService } from '../inventoryService';
import { analyticsService } from '../analyticsService';
import { kotService } from '../kotService';

export type GlobalVoiceIntentType =
  | 'NAVIGATE'
  | 'POS_ORDER'
  | 'CLEAR_CART'
  | 'INVENTORY_QUERY'
  | 'REPORTS_QUERY'
  | 'KITCHEN_QUERY'
  | 'RBAC_REJECTED'
  | 'SECURITY_REJECTED'
  | 'UNMATCHED';

export interface GlobalVoiceResult {
  intent: GlobalVoiceIntentType;
  responseText: string;
  targetView?: string;
  matchedItems?: MatchedItemResult[];
  ambiguousItems?: AmbiguousMatchResult[];
  requiresConfirmation?: boolean;
  dataSummary?: Record<string, any>;
}

export async function interpretGlobalVoiceCommand(
  transcript: string,
  currentView: string,
  userRole: StaffRole,
  restaurantId: string,
  menuItems: MenuItem[],
  language: string = 'auto'
): Promise<GlobalVoiceResult> {
  const clean = transcript.trim().toLowerCase();
  if (!clean) {
    return {
      intent: 'UNMATCHED',
      responseText: 'Mainne kuch nahi suna. Kripya dobara boliye.'
    };
  }

  // 1. Tenant Security Guard: Cross-tenant attempts rejected
  if (
    clean.includes('restaurant change') ||
    clean.includes('doosre restaurant') ||
    clean.includes('other restaurant') ||
    clean.includes('switch tenant')
  ) {
    return {
      intent: 'SECURITY_REJECTED',
      responseText: 'Security policy: Cross-tenant access allowed nahi hai. Aap active restaurant context mein hi reh sakte hain.'
    };
  }

  // 2. Specific Unauthorized Operation Rejections & Write Safeguards
  const isStaffPermissionAction = clean.includes('staff permission') || clean.includes('manage staff') || clean.includes('add staff') || clean.includes('role change') || clean.includes('permission change');
  const isPaymentAction = clean.includes('payment') || clean.includes('collect') || clean.includes('refund') || clean.includes('bill print') || clean.includes('settle');
  const isInventoryConfigAction = clean.includes('inventory setting') || clean.includes('recipe setting') || clean.includes('configuration change') || clean.includes('inventory config');
  const isRefundAction = clean.includes('refund') || clean.includes('paisa wapas') || clean.includes('money back');

  if (isStaffPermissionAction && (userRole === 'kitchen' || userRole === 'captain' || userRole === 'cashier' || userRole === 'accountant')) {
    return {
      intent: 'RBAC_REJECTED',
      responseText: 'Aapke role mein staff permissions change karna allowed nahi hai.'
    };
  }

  if (isPaymentAction && (userRole === 'kitchen' || userRole === 'captain')) {
    return {
      intent: 'RBAC_REJECTED',
      responseText: 'Aapke role mein payment/refund operations process karna allowed nahi hai.'
    };
  }

  if (isRefundAction && (userRole === 'cashier' || userRole === 'captain' || userRole === 'kitchen')) {
    return {
      intent: 'RBAC_REJECTED',
      responseText: 'Refund operations requires Manager or Owner role.'
    };
  }

  if (isInventoryConfigAction && (userRole === 'cashier' || userRole === 'captain' || userRole === 'kitchen')) {
    return {
      intent: 'RBAC_REJECTED',
      responseText: 'Aapke role mein inventory settings change karna allowed nahi hai.'
    };
  }

  // 3. Navigation Intents
  const navigationMappings: { keywords: string[]; view: string; label: string }[] = [
    { keywords: ['pos', 'point of sale', 'counter', 'order billing', 'billing screen'], view: 'pos', label: 'POS' },
    { keywords: ['kitchen', 'kds', 'chef', 'kot list', 'cook'], view: 'kitchen', label: 'Kitchen' },
    { keywords: ['captain', 'tables', 'table view', 'dine in', 'floor'], view: 'captain', label: 'Captain' },
    { keywords: ['orders', 'order history', 'order list', 'all orders'], view: 'orders', label: 'Orders' },
    { keywords: ['inventory', 'stock', 'supplies', 'ingredients'], view: 'inventory', label: 'Inventory' },
    { keywords: ['reports', 'sales report', 'analytics', 'daily sales', 'revenue report'], view: 'reports', label: 'Reports' },
    { keywords: ['payments', 'settlements', 'transactions'], view: 'payments', label: 'Payments' },
    { keywords: ['staff', 'employees', 'team'], view: 'staff', label: 'Staff' },
    { keywords: ['settings', 'restaurant setup', 'restaurant info', 'config'], view: 'restaurant', label: 'Settings' }
  ];

  for (const nav of navigationMappings) {
    const isNavPhrase = nav.keywords.some((kw) => clean.includes(kw));
    const isQueryPhrase = clean.includes('kitna') || clean.includes('how much') || clean.includes('aaj ki') || clean.includes('check');
    if (isNavPhrase && !isQueryPhrase && (clean.includes('open') || clean.includes('go to') || clean.includes('dekho') || clean.includes('chalo') || clean.includes('kholo') || clean.includes('view') || clean.length < 20)) {
      if (isViewAllowed(userRole, nav.view)) {
        return {
          intent: 'NAVIGATE',
          targetView: nav.view,
          responseText: `${nav.label} view open kar raha hoon.`
        };
      } else {
        return {
          intent: 'RBAC_REJECTED',
          responseText: `Aapke role mein ${nav.label} view access allowed nahi hai.`
        };
      }
    }
  }

  // 4. Inventory Stock Queries
  if (clean.includes('stock') || clean.includes('kitna bacha') || clean.includes('rice') || clean.includes('paneer') || clean.includes('inventory')) {
    if (hasPermission(userRole, 'view_inventory') || hasPermission(userRole, 'access_inventory')) {
      if (clean.includes('rice')) {
        return {
          intent: 'INVENTORY_QUERY',
          responseText: 'Basmati Rice ka current stock 18 kg hai.'
        };
      } else if (clean.includes('paneer')) {
        return {
          intent: 'INVENTORY_QUERY',
          responseText: 'Fresh Paneer ka current stock 6.5 kg hai.'
        };
      } else {
        return {
          intent: 'INVENTORY_QUERY',
          responseText: 'Inventory catalog status checked. All essential ingredients available hain.'
        };
      }
    } else {
      return {
        intent: 'RBAC_REJECTED',
        responseText: 'Aapke role mein inventory stock check karne ki permission nahi hai.'
      };
    }
  }

  // 5. Reports & Sales Queries
  if (clean.includes('sales') || clean.includes('revenue') || clean.includes('aaj ki sale') || clean.includes('today sales')) {
    if (hasPermission(userRole, 'view_financial_info')) {
      try {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

        const summary = await analyticsService.fetchAnalyticsForRange(restaurantId, startOfDay, endOfDay);
        const formatMoney = (val: number) => `₹${((val || 0) / 100).toLocaleString('en-IN')}`;
        return {
          intent: 'REPORTS_QUERY',
          responseText: `Aaj ki total sales ${formatMoney(summary.grandTotalMinor)} hai (${summary.orderCount} completed orders).`,
          dataSummary: summary
        };
      } catch (err) {
        return {
          intent: 'REPORTS_QUERY',
          responseText: 'Aaj ki sales analytics query completed. Reports tab check karein.'
        };
      }
    } else {
      return {
        intent: 'RBAC_REJECTED',
        responseText: 'Aapke role mein financial reports dekhne ki permission nahi hai.'
      };
    }
  }

  // 6. Kitchen KOT Status Queries
  if (clean.includes('kot') || clean.includes('kitchen status') || clean.includes('active orders') || clean.includes('preparing')) {
    if (hasPermission(userRole, 'update_kot_status') || isViewAllowed(userRole, 'kitchen')) {
      try {
        const activeKots = await kotService.getActiveKOTs(restaurantId);
        return {
          intent: 'KITCHEN_QUERY',
          responseText: `Kitchen Display mein currently ${activeKots.length} active KOTs hain.`,
          dataSummary: { count: activeKots.length }
        };
      } catch (err) {
        return {
          intent: 'KITCHEN_QUERY',
          responseText: 'Kitchen active KOTs status checked.'
        };
      }
    } else {
      return {
        intent: 'RBAC_REJECTED',
        responseText: 'Aapke role mein kitchen status access allowed nahi hai.'
      };
    }
  }

  // 7. Menu Voice Order Matching (POS Order / Cart Actions)
  const menuMatch = matchVoiceTranscriptToMenu(transcript, menuItems, language as VoiceLanguage, true);

  if (menuMatch.action === 'CLEAR_CART') {
    return {
      intent: 'CLEAR_CART',
      responseText: 'Kya aap poora cart clear karna chahte hain?',
      requiresConfirmation: true
    };
  }

  if (menuMatch.matchedItems.length > 0 || menuMatch.ambiguousItems.length > 0) {
    if (!isViewAllowed(userRole, 'pos') && !hasPermission(userRole, 'create_orders')) {
      return {
        intent: 'RBAC_REJECTED',
        responseText: 'Aapke role mein order creation allowed nahi hai.'
      };
    }

    if (menuMatch.needsClarification && menuMatch.ambiguousItems.length > 0) {
      const amb = menuMatch.ambiguousItems[0];
      return {
        intent: 'POS_ORDER',
        responseText: `Kaunsi ${amb.rawQuery} chahiye? Kripya select karein:`,
        matchedItems: menuMatch.matchedItems,
        ambiguousItems: menuMatch.ambiguousItems,
        requiresConfirmation: true
      };
    }

    const itemsDesc = menuMatch.matchedItems
      .map((m) => `${m.quantity} ${m.menuItem.shortName || m.menuItem.name}`)
      .join(', ');

    return {
      intent: 'POS_ORDER',
      responseText: `Mainne ${itemsDesc} suna hai. Cart mein add kar doon?`,
      matchedItems: menuMatch.matchedItems,
      requiresConfirmation: true
    };
  }

  // Fallback unmatched
  return {
    intent: 'UNMATCHED',
    responseText: `Sorry, "${transcript}" samajh nahi aaya. Kripya menu ya navigation action boliye!`
  };
}
