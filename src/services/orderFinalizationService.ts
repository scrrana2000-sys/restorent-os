import {
  doc,
  getDoc,
  getDocs,
  updateDoc,
  collection,
  query,
  where,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { Order } from '../types/order';
import { KOT } from '../types/kot';
import { TableSession, Table } from '../types/table';
import { Payment } from '../types/payment';
import { tableSessionService } from './tableSessionService';
import { auditService } from './auditService';

export class OrderFinalizationService {
  /**
   * Evaluates whether an order should automatically transition to 'completed'
   * and whether its parent TableSession should automatically close.
   * 
   * Order completion rules:
   * 1. Financial balance settled (dueAmountMinor === 0)
   * 2. All linked KOT tickets in terminal state ('served' or 'cancelled')
   * 3. Order is not cancelled (and not already completed)
   * 
   * Session closure rules:
   * 1. All orders belonging to the session are 'completed' or 'cancelled'
   * 2. All financial balances for session orders are settled (dueAmountMinor === 0)
   * 3. No active KOT tickets remaining across all session orders
   */
  async evaluateAndFinalizeOrderAndSession(
    restaurantId: string,
    orderId: string,
    actorUid?: string
  ): Promise<{ orderCompleted: boolean; sessionClosed: boolean }> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanOrderId = orderId?.trim();
    if (!cleanRestaurantId || !cleanOrderId) {
      return { orderCompleted: false, sessionClosed: false };
    }

    const resolvedUserId = actorUid || auth.currentUser?.uid || 'system';
    let orderCompleted = false;
    let sessionClosed = false;

    try {
      // 1. Fetch target order
      const orderRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', cleanOrderId);
      const orderSnap = await getDoc(orderRef);
      if (!orderSnap || (typeof orderSnap.exists === 'function' && !orderSnap.exists())) {
        return { orderCompleted: false, sessionClosed: false };
      }

      let order = { id: orderSnap.id, ...orderSnap.data() } as Order;

      // 2. Evaluate Order Completion
      if (order.status !== 'cancelled') {
        if (order.status !== 'completed') {
          const dueAmount =
            order.dueAmountMinor ??
            Math.max(0, (order.grandTotalMinor || 0) - (order.paidAmountMinor || 0));
          const isPaid = dueAmount === 0;

          // Check KOT status for this order
          const kotsCol = collection(db, 'restaurants', cleanRestaurantId, 'kots');
          const kotQuery = query(kotsCol, where('orderId', '==', cleanOrderId));
          const kotSnap = await getDocs(kotQuery);

          let allKotsTerminal = true;
          const kotDocs = kotSnap.docs || [];
          kotDocs.forEach((kd) => {
            const kotData = kd.data() as KOT;
            if (kotData.status !== 'served' && kotData.status !== 'cancelled') {
              allKotsTerminal = false;
            }
          });

          // Check for pending payment transactions
          const paymentsCol = collection(db, 'restaurants', cleanRestaurantId, 'payments');
          const payQuery = query(paymentsCol, where('orderId', '==', cleanOrderId));
          const paySnap = await getDocs(payQuery);
          let hasPendingPayment = false;
          const payDocs = paySnap.docs || [];
          payDocs.forEach((pd) => {
            const payData = pd.data() as Payment;
            if (payData.status === 'pending') {
              hasPendingPayment = true;
            }
          });

          if (isPaid && allKotsTerminal && !hasPendingPayment) {
            const now = new Date();
            await updateDoc(orderRef, {
              status: 'completed',
              paymentStatus: 'paid',
              completedAt: serverTimestamp() || now,
              completedBy: resolvedUserId,
              updatedAt: serverTimestamp() || now,
              updatedBy: resolvedUserId
            });

            await auditService.logEvent(cleanRestaurantId, {
              restaurantId: cleanRestaurantId,
              entityType: 'order',
              entityId: cleanOrderId,
              action: 'order_completed',
              actorUid: resolvedUserId,
              metadata: {
                orderNumber: order.orderNumber,
                grandTotalMinor: order.grandTotalMinor,
                paidAmountMinor: order.paidAmountMinor,
                reason: 'auto_completed_payment_and_kot_terminal'
              }
            });

            order.status = 'completed';
            order.paymentStatus = 'paid';
            orderCompleted = true;
          }
        } else {
          orderCompleted = true;
        }
      }

      // 3. Evaluate Table Session Closure
      let targetSessionId = order.tableSessionId || null;
      const tableId = order.tableId || null;

      // If tableSessionId is not set on order directly, check if table has an active session
      if (!targetSessionId && tableId) {
        const tableSnap = await getDoc(doc(db, 'restaurants', cleanRestaurantId, 'tables', tableId));
        if (tableSnap.exists()) {
          const tableData = tableSnap.data() as Table;
          if (tableData.activeSessionId) {
            targetSessionId = tableData.activeSessionId;
          }
        }
      }

      if (targetSessionId) {
        const sessionRef = doc(db, 'restaurants', cleanRestaurantId, 'tableSessions', targetSessionId);
        const sessionSnap = await getDoc(sessionRef);

        if (sessionSnap.exists()) {
          const sessionData = { id: sessionSnap.id, ...sessionSnap.data() } as TableSession;

          if (sessionData.status === 'open') {
            // Fetch all orders linked to this tableSession
            const sessionOrdersQuery = query(
              collection(db, 'restaurants', cleanRestaurantId, 'orders'),
              where('tableSessionId', '==', targetSessionId)
            );
            const sessionOrdersSnap = await getDocs(sessionOrdersQuery);

            let sessionOrdersList: Order[] = [];
            (sessionOrdersSnap.docs || []).forEach((d) => {
              sessionOrdersList.push({ id: d.id, ...d.data() } as Order);
            });

            // Include any orderIds from session.activeOrderIds if missing from query
            if (Array.isArray(sessionData.activeOrderIds)) {
              for (const ordId of sessionData.activeOrderIds) {
                if (!sessionOrdersList.some((o) => o.id === ordId)) {
                  const oSnap = await getDoc(doc(db, 'restaurants', cleanRestaurantId, 'orders', ordId));
                  if (oSnap.exists()) {
                    sessionOrdersList.push({ id: oSnap.id, ...oSnap.data() } as Order);
                  }
                }
              }
            }

            // Also check for any orders with tableId = session.tableId
            if (sessionData.tableId) {
              const tableOrdersQuery = query(
                collection(db, 'restaurants', cleanRestaurantId, 'orders'),
                where('tableId', '==', sessionData.tableId)
              );
              const tableOrdersSnap = await getDocs(tableOrdersQuery);
              (tableOrdersSnap.docs || []).forEach((td) => {
                const tOrder = { id: td.id, ...td.data() } as Order;
                if (!sessionOrdersList.some((o) => o.id === tOrder.id)) {
                  if (
                    tOrder.tableSessionId === targetSessionId ||
                    (!tOrder.tableSessionId && tOrder.status !== 'completed' && tOrder.status !== 'cancelled')
                  ) {
                    sessionOrdersList.push(tOrder);
                  }
                }
              });
            }

            // Ensure local sessionOrdersList reflects the completion status if we just completed cleanOrderId
            if (orderCompleted) {
              for (const ord of sessionOrdersList) {
                if (ord.id === cleanOrderId) {
                  ord.status = 'completed';
                  ord.paymentStatus = 'paid';
                  ord.dueAmountMinor = 0;
                }
              }
            }

            let canCloseSession = sessionOrdersList.length > 0;

            for (const ord of sessionOrdersList) {
              if (ord.status !== 'completed' && ord.status !== 'cancelled') {
                canCloseSession = false;
                break;
              }

              if (ord.status !== 'cancelled') {
                const due =
                  ord.dueAmountMinor ??
                  Math.max(0, (ord.grandTotalMinor || 0) - (ord.paidAmountMinor || 0));
                if (due > 0) {
                  canCloseSession = false;
                  break;
                }
              }

              // Check active KOTs for ord
              const ordKotQuery = query(
                collection(db, 'restaurants', cleanRestaurantId, 'kots'),
                where('orderId', '==', ord.id)
              );
              const ordKotSnap = await getDocs(ordKotQuery);
              let ordHasActiveKot = false;
              (ordKotSnap.docs || []).forEach((kd) => {
                const kData = kd.data() as KOT;
                if (kData.status !== 'served' && kData.status !== 'cancelled') {
                  ordHasActiveKot = true;
                }
              });

              if (ordHasActiveKot) {
                canCloseSession = false;
                break;
              }
            }

            if (canCloseSession) {
              await tableSessionService.closeSession(cleanRestaurantId, targetSessionId, resolvedUserId, {
                autoCompleteSettledOrders: true,
                source: 'automatic_completion'
              });
              sessionClosed = true;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[RestaurantOS] OrderFinalizationService evaluation notice:', err);
    }

    return { orderCompleted, sessionClosed };
  }
}

export const orderFinalizationService = new OrderFinalizationService();
