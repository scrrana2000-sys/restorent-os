import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  runTransaction
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { Payment, PaymentMethod, PaymentStatus, PaymentHistoryFilterOptions, PaymentHistoryResult, PaymentTotalsSummary } from '../types/payment';
import { Order } from '../types/order';
import { MoneyMinor } from '../types/money';
import { IPaymentService } from './transactionInterfaces';
import { paymentsPath, paymentDocPath, orderDocPath } from '../utils/paths';
import { handleFirestoreError, OperationType } from '../utils/firestoreError';
import { enforcePermission } from '../utils/permissions';
import { validatePayment, validatePaymentStatusTransition } from '../utils/transactionValidation';
import { calculateOrderSettlement, OrderSettlementState } from '../domain/settlement';
import { isValidMoney } from '../utils/money';
import { idempotencyService } from './idempotencyService';
import { auditService } from './auditService';
import { orderFinalizationService } from './orderFinalizationService';
import { parseTimestampToMillis } from '../utils/dateUtils';

export interface RecordPaymentInput {
  restaurantId?: string;
  orderId: string;
  amountMinor: MoneyMinor;
  method: PaymentMethod;
  status?: PaymentStatus; // Defaults to 'completed' if not provided
  reference?: string | null;
  idempotencyKey?: string | null;
  createdBy?: string;
}

/**
 * PaymentService
 * 
 * Centralized Payment, Billing & Split Settlement Service for RestaurantOS.
 * 
 * CRITICAL ARCHITECTURAL INVARIANTS:
 * 1. Multi-Tenant Restaurant Isolation: Every query and mutation is strictly scoped
 *    under `restaurants/{restaurantId}/payments/{paymentId}`.
 * 2. Identity Decoupling: auth.uid is NEVER assumed to be equal to restaurantId.
 * 3. Authoritative Order Total: Payment processing NEVER recalculates the order's financial
 *    grand total independently. It reads the validated `grandTotalMinor` from the authoritative Order doc.
 * 4. Money Minor (Paise): All financial calculations remain strictly integer paise.
 * 5. Multiple Payment Events & Split Settlement: An Order can have multiple Payment records
 *    (e.g. Cash ₹500 + UPI ₹1000). There remains ONE Order with multiple Payment event docs.
 * 6. Overpayment Prevention: Completed payments that would cause `paidAmountMinor > grandTotalMinor`
 *    are strictly rejected.
 * 7. Transactional Atomicity: Payment creation and Order `paidAmountMinor`/`dueAmountMinor` updates
 *    are executed inside Firestore transactions (or atomic synchronizations) preventing split-state corruption.
 * 8. Immutability & Auditability: Payment records are never hard-deleted. Refund transitions
 *    preserve the payment document for financial auditing while deducting it from active paid totals.
 */
export class PaymentService implements IPaymentService {
  /**
   * Retrieves a single Payment by ID within a restaurant.
   */
  async getPaymentById(restaurantId: string, paymentId: string): Promise<Payment | null> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanPaymentId = paymentId?.trim();
    if (!cleanRestaurantId || !cleanPaymentId) {
      throw new Error('restaurantId and paymentId are required to fetch a Payment.');
    }

    try {
      const docRef = doc(db, paymentDocPath(cleanRestaurantId, cleanPaymentId));
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        return null;
      }
      return { id: snap.id, ...snap.data() } as Payment;
    } catch (err) {
      throw handleFirestoreError(err, OperationType.GET, paymentDocPath(cleanRestaurantId, cleanPaymentId));
    }
  }

  /**
   * Retrieves all Payment records for a specific order.
   */
  async getPaymentsForOrder(restaurantId: string, orderId: string): Promise<Payment[]> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanOrderId = orderId?.trim();
    if (!cleanRestaurantId || !cleanOrderId) {
      throw new Error('restaurantId and orderId are required to fetch payments for an order.');
    }

    await enforcePermission(cleanRestaurantId, 'view_financial_info');

    try {
      const paymentsCol = collection(db, paymentsPath(cleanRestaurantId));
      const q = query(
        paymentsCol,
        where('orderId', '==', cleanOrderId)
      );
      const snap = await getDocs(q);
      const payments = snap.docs.map(d => ({ id: d.id, ...d.data() } as Payment));
      return payments.sort((a, b) => {
        const timeA = (a.createdAt as any)?.toMillis?.() || (a.createdAt ? new Date(a.createdAt as any).getTime() : 0);
        const timeB = (b.createdAt as any)?.toMillis?.() || (b.createdAt ? new Date(b.createdAt as any).getTime() : 0);
        return timeA - timeB;
      });
    } catch (err) {
      throw handleFirestoreError(err, OperationType.LIST, paymentsPath(cleanRestaurantId));
    }
  }

  /**
   * Calculates the current settlement state for an order by aggregating its payments.
   */
  async getOrderSettlement(restaurantId: string, orderId: string): Promise<OrderSettlementState> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanOrderId = orderId?.trim();
    if (!cleanRestaurantId || !cleanOrderId) {
      throw new Error('restaurantId and orderId are required to get order settlement.');
    }

    await enforcePermission(cleanRestaurantId, 'view_financial_info');

    // 1. Fetch Order
    let orderDoc: Order;
    try {
      const orderRef = doc(db, orderDocPath(cleanRestaurantId, cleanOrderId));
      const orderSnap = await getDoc(orderRef);
      if (!orderSnap.exists()) {
        throw new Error(`Order "${cleanOrderId}" does not exist in restaurant "${cleanRestaurantId}".`);
      }
      orderDoc = { id: orderSnap.id, ...orderSnap.data() } as Order;
    } catch (err: any) {
      if (err.message && err.message.includes('does not exist')) {
        throw err;
      }
      throw handleFirestoreError(err, OperationType.GET, orderDocPath(cleanRestaurantId, cleanOrderId));
    }

    if (orderDoc.restaurantId !== cleanRestaurantId) {
      throw new Error(
        `Cross-tenant violation: Order "${cleanOrderId}" belongs to restaurant "${orderDoc.restaurantId}", not "${cleanRestaurantId}".`
      );
    }

    // 2. Fetch Payments
    const payments = await this.getPaymentsForOrder(cleanRestaurantId, cleanOrderId);

    // 3. Pure Calculation
    return calculateOrderSettlement(orderDoc, payments);
  }

  /**
   * Low-level / high-level authoritative method to record a payment for an order.
   * Uses a Firestore transaction to:
   * 1. Validate the Order existence and cross-tenant ownership.
   * 2. Enforce amount validity and prevent overpayment.
   * 3. Create the Payment document under `restaurants/{restaurantId}/payments/{paymentId}`.
   * 4. Atomically update the Order's `paidAmountMinor` and `dueAmountMinor`.
   */
  async recordPayment(
    restaurantId: string,
    paymentInput: Omit<Payment, 'id' | 'createdAt'> | RecordPaymentInput,
    idempotencyKey?: string
  ): Promise<Payment> {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      throw new Error('Valid restaurantId is required to record a payment.');
    }

    await enforcePermission(cleanRestaurantId, 'process_payments');

    const cleanOrderId = paymentInput.orderId?.trim();
    if (!cleanOrderId) {
      throw new Error('Valid orderId is required to record a payment.');
    }

    if (paymentInput.restaurantId && paymentInput.restaurantId !== cleanRestaurantId) {
      throw new Error(
        `Payload restaurantId "${paymentInput.restaurantId}" does not match target restaurantId "${cleanRestaurantId}".`
      );
    }

    const resolvedStatus: PaymentStatus = paymentInput.status || 'completed';
    const resolvedIdempotencyKey = idempotencyKey || paymentInput.idempotencyKey || null;
    const resolvedUserId = auth.currentUser?.uid;
    if (!resolvedUserId) {
      throw new Error('Authenticated user is required to record a payment.');
    }

    // Validate payment fields
    const validation = validatePayment({
      restaurantId: cleanRestaurantId,
      orderId: cleanOrderId,
      amountMinor: paymentInput.amountMinor,
      method: paymentInput.method,
      status: resolvedStatus
    });

    if (!validation.isValid) {
      throw new Error(`Payment validation failed: ${validation.error}`);
    }

    // Sanitize reference info (ensure no sensitive card/pin data is stored)
    let sanitizedReference: string | null = null;
    if (paymentInput.reference && typeof paymentInput.reference === 'string') {
      sanitizedReference = paymentInput.reference.trim().substring(0, 100);
    }

    try {
      const orderRef = doc(db, orderDocPath(cleanRestaurantId, cleanOrderId));
      const paymentsCol = collection(db, paymentsPath(cleanRestaurantId));
      const newPaymentRef = doc(paymentsCol);
      const now = new Date();

      let createdPaymentDoc: Payment | null = null;
      let cachedPaymentDoc: Payment | null = null;
      let resultingDueAmountMinor: number | null = null;

      const maxRetries = 3;
      let attempt = 0;
      while (attempt < maxRetries) {
        attempt++;
        try {
          await runTransaction(db, async (transaction) => {
            // 0. Idempotency Check inside transaction
            if (resolvedIdempotencyKey) {
              const check = await idempotencyService.checkOrAcquire<Payment>(
                cleanRestaurantId,
                resolvedIdempotencyKey,
                'record_payment',
                {
                  orderId: cleanOrderId,
                  amountMinor: paymentInput.amountMinor,
                  method: paymentInput.method,
                  status: resolvedStatus
                },
                transaction
              );

              if (check.action === 'return_cached' && check.cachedResult) {
                cachedPaymentDoc = check.cachedResult;
                return;
              }
            }

            const orderSnap = await transaction.get(orderRef);
            if (!orderSnap || (typeof orderSnap.exists === 'function' && !orderSnap.exists())) {
              throw new Error(
                `Order "${cleanOrderId}" does not exist in restaurant "${cleanRestaurantId}". (Cross-tenant violation or invalid order reference)`
              );
            }

            const orderData = orderSnap.data() as Order;
            if (orderData.restaurantId !== cleanRestaurantId) {
              throw new Error(
                `Cross-tenant violation: Order "${cleanOrderId}" belongs to restaurant "${orderData.restaurantId}", not "${cleanRestaurantId}".`
              );
            }

            if (orderData.status === 'cancelled') {
              throw new Error(`Cannot record payment for cancelled order "${cleanOrderId}".`);
            }

            const currentGrandTotal = orderData.grandTotalMinor ?? 0;
            const currentPaid = orderData.paidAmountMinor ?? 0;

            if (!isValidMoney(currentGrandTotal)) {
              throw new Error(`Corrupted order grandTotalMinor: ${currentGrandTotal}`);
            }
            if (!isValidMoney(currentPaid)) {
              throw new Error(`Corrupted order paidAmountMinor: ${currentPaid}`);
            }

            // Only completed payments increment the Order's paid amount
            let newPaidAmountMinor = currentPaid;
            if (resolvedStatus === 'completed') {
              newPaidAmountMinor = currentPaid + paymentInput.amountMinor;

              // Overpayment rejection policy:
              // Completed payments must NOT cause paidAmountMinor > grandTotalMinor
              if (newPaidAmountMinor > currentGrandTotal) {
                throw new Error(
                  `Overpayment rejected: Order grand total is ₹${(currentGrandTotal / 100).toFixed(2)} (${currentGrandTotal} paise), already paid ₹${(currentPaid / 100).toFixed(2)} (${currentPaid} paise), but attempted payment of ₹${(paymentInput.amountMinor / 100).toFixed(2)} (${paymentInput.amountMinor} paise) would exceed total by ₹${((newPaidAmountMinor - currentGrandTotal) / 100).toFixed(2)}.`
                );
              }
            }

            const newDueAmountMinor = Math.max(0, currentGrandTotal - newPaidAmountMinor);
            resultingDueAmountMinor = newDueAmountMinor;

            const paymentPayload: Record<string, any> = {
              id: newPaymentRef.id,
              restaurantId: cleanRestaurantId,
              orderId: cleanOrderId,
              amountMinor: paymentInput.amountMinor,
              method: paymentInput.method,
              status: resolvedStatus,
              reference: sanitizedReference,
              idempotencyKey: resolvedIdempotencyKey,
              createdBy: resolvedUserId,
              createdAt: serverTimestamp()
            };

            // 1. Write Payment document
            transaction.set(newPaymentRef, paymentPayload);

            // 2. Atomically update Order paid & due amounts and paymentStatus
            const orderPaymentStatus =
              newDueAmountMinor === 0 ? 'paid' : newPaidAmountMinor > 0 ? 'partially_paid' : 'unpaid';

            const orderUpdatePayload: Record<string, any> = {
              paidAmountMinor: newPaidAmountMinor,
              dueAmountMinor: newDueAmountMinor,
              paymentStatus: orderPaymentStatus,
              lastPaymentId: newPaymentRef.id,
              updatedBy: resolvedUserId,
              updatedAt: serverTimestamp()
            };

            transaction.update(orderRef, orderUpdatePayload);

            createdPaymentDoc = {
              id: newPaymentRef.id,
              restaurantId: cleanRestaurantId,
              orderId: cleanOrderId,
              amountMinor: paymentInput.amountMinor,
              method: paymentInput.method,
              status: resolvedStatus,
              reference: sanitizedReference,
              idempotencyKey: resolvedIdempotencyKey,
              createdBy: resolvedUserId,
              createdAt: now
            };

            // 3. Complete idempotency record in transaction
            if (resolvedIdempotencyKey) {
              await idempotencyService.recordSuccess(
                cleanRestaurantId,
                resolvedIdempotencyKey,
                'record_payment',
                {
                  orderId: cleanOrderId,
                  amountMinor: paymentInput.amountMinor,
                  method: paymentInput.method,
                  status: resolvedStatus
                },
                createdPaymentDoc.id,
                createdPaymentDoc,
                transaction
              );
            }
          });

          // Break out of retry loop on success
          break;
        } catch (txErr: any) {
          const isBusinessError =
            txErr?.message &&
            (txErr.message.includes('Overpayment rejected') ||
              txErr.message.includes('Cross-tenant') ||
              txErr.message.includes('does not exist') ||
              txErr.message.includes('Cannot record payment for cancelled order') ||
              txErr.message.includes('Idempotency') ||
              txErr.message.includes('idempotency') ||
              txErr.message.includes('Corrupted order'));

          if (isBusinessError) {
            throw txErr;
          }

          const isTransient =
            txErr?.code === 'unavailable' ||
            txErr?.message?.includes('Connection failed') ||
            txErr?.message?.includes('Failed to get document because the client is offline') ||
            txErr?.message?.includes('network error') ||
            txErr?.message?.includes('transport errored');

          if (isTransient && attempt < maxRetries) {
            console.warn(
              `[PaymentService] Transient transaction connection failure (attempt ${attempt}/${maxRetries}). Retrying in ${attempt * 350}ms...`
            );
            await new Promise((res) => setTimeout(res, attempt * 350));
            continue;
          }

          throw txErr;
        }
      }

      if (cachedPaymentDoc) {
        return cachedPaymentDoc;
      }

      if (!createdPaymentDoc) {
        throw new Error('Transaction succeeded but payment document was not instantiated.');
      }

      await auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'payment',
        entityId: (createdPaymentDoc as Payment).id,
        action: 'payment_created',
        actorUid: resolvedUserId,
        metadata: {
          orderId: cleanOrderId,
          amountMinor: paymentInput.amountMinor,
          method: paymentInput.method,
          status: resolvedStatus
        }
      });

      // Finalization is only relevant after the order becomes fully paid.
      // Partial payments no longer trigger a second Cloud Run/API workflow.
      if (resolvedStatus === 'completed' && resultingDueAmountMinor === 0) {
        try {
          await orderFinalizationService.evaluateAndFinalizeOrderAndSession(
            cleanRestaurantId,
            cleanOrderId,
            resolvedUserId
          );
        } catch (autoErr) {
          console.warn('[PaymentService] Notice: auto-completion/session-closure check after payment encountered:', autoErr);
        }
      }

      return createdPaymentDoc;
    } catch (err: any) {
      if (
        err.message &&
        (err.message.includes('Overpayment rejected') ||
          err.message.includes('Cross-tenant') ||
          err.message.includes('does not exist') ||
          err.message.includes('Cannot record payment for cancelled order') ||
          err.message.includes('Idempotency') ||
          err.message.includes('idempotency'))
      ) {
        throw err;
      }
      throw handleFirestoreError(err, OperationType.WRITE, paymentsPath(cleanRestaurantId));
    }
  }

  /**
   * Updates the status of an existing payment (e.g. pending -> completed or pending -> failed)
   * with full state transition validation and atomic recalculation of the parent Order.
   */
  async updatePaymentStatus(
    restaurantId: string,
    paymentId: string,
    newStatus: PaymentStatus,
    updatedBy: string
  ): Promise<void> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanPaymentId = paymentId?.trim();
    if (!cleanRestaurantId || !cleanPaymentId) {
      throw new Error('restaurantId and paymentId are required to update payment status.');
    }

    try {
      const paymentRef = doc(db, paymentDocPath(cleanRestaurantId, cleanPaymentId));

      await runTransaction(db, async (transaction) => {
        const paymentSnap = await transaction.get(paymentRef);
        if (!paymentSnap.exists()) {
          throw new Error(`Payment "${cleanPaymentId}" does not exist in restaurant "${cleanRestaurantId}".`);
        }

        const paymentData = paymentSnap.data() as Payment;
        if (paymentData.restaurantId !== cleanRestaurantId) {
          throw new Error(`Cross-tenant payment update violation.`);
        }

        // Validate status transition
        const transitionValidation = validatePaymentStatusTransition(paymentData.status, newStatus);
        if (!transitionValidation.isValid) {
          throw new Error(transitionValidation.error);
        }

        if (paymentData.status === newStatus) {
          return; // No-op
        }

        const orderRef = doc(db, orderDocPath(cleanRestaurantId, paymentData.orderId));
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists()) {
          throw new Error(`Order "${paymentData.orderId}" not found for payment recalculation.`);
        }

        const orderData = orderSnap.data() as Order;
        const currentGrandTotal = orderData.grandTotalMinor ?? 0;
        const currentPaid = orderData.paidAmountMinor ?? 0;

        let newPaid = currentPaid;

        // Transition: pending -> completed (adds to paidAmount)
        if (paymentData.status !== 'completed' && newStatus === 'completed') {
          newPaid = currentPaid + paymentData.amountMinor;
          if (newPaid > currentGrandTotal) {
            throw new Error(`Overpayment rejected during payment completion.`);
          }
        }
        // Transition: completed -> refunded / failed (deducts from paidAmount)
        else if (paymentData.status === 'completed' && newStatus !== 'completed') {
          newPaid = Math.max(0, currentPaid - paymentData.amountMinor);
        }

        const newDue = Math.max(0, currentGrandTotal - newPaid);
        const resolvedUserId = updatedBy || auth.currentUser?.uid || 'system';
        const orderPaymentStatus =
          newDue === 0 ? 'paid' : newPaid > 0 ? 'partially_paid' : 'unpaid';

        // 1. Update Payment status
        transaction.update(paymentRef, {
          status: newStatus,
          updatedBy: resolvedUserId,
          updatedAt: serverTimestamp()
        });

        // 2. Update Order paid/due & paymentStatus
        transaction.update(orderRef, {
          paidAmountMinor: newPaid,
          dueAmountMinor: newDue,
          paymentStatus: orderPaymentStatus,
          updatedBy: resolvedUserId,
          updatedAt: serverTimestamp()
        });
      });

      await auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'payment',
        entityId: cleanPaymentId,
        action: 'payment_status_changed',
        actorUid: updatedBy || auth.currentUser?.uid || 'system',
        metadata: {
          newStatus
        }
      });
    } catch (err: any) {
      if (err.message && (err.message.includes('Illegal payment status transition') || err.message.includes('does not exist') || err.message.includes('Overpayment rejected'))) {
        throw err;
      }
      throw handleFirestoreError(err, OperationType.UPDATE, paymentDocPath(cleanRestaurantId, cleanPaymentId));
    }
  }

  /**
   * Authoritatively transitions a completed payment to 'refunded',
   * deducting it from active paid totals while permanently preserving the record for auditing.
   */
  async refundPayment(
    restaurantId: string,
    paymentId: string,
    refundedBy: string,
    reason?: string
  ): Promise<void> {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      throw new Error('restaurantId is required to refund a payment.');
    }
    await enforcePermission(cleanRestaurantId, 'refund_payments');
    const cleanPaymentId = paymentId?.trim();
    if (!cleanRestaurantId || !cleanPaymentId) {
      throw new Error('restaurantId and paymentId are required to refund a payment.');
    }

    try {
      const paymentRef = doc(db, paymentDocPath(cleanRestaurantId, cleanPaymentId));

      await runTransaction(db, async (transaction) => {
        const paymentSnap = await transaction.get(paymentRef);
        if (!paymentSnap.exists()) {
          throw new Error(`Payment "${cleanPaymentId}" does not exist in restaurant "${cleanRestaurantId}".`);
        }

        const paymentData = paymentSnap.data() as Payment;
        if (paymentData.restaurantId !== cleanRestaurantId) {
          throw new Error(`Cross-tenant payment refund violation.`);
        }

        // Validate status transition
        const transitionValidation = validatePaymentStatusTransition(paymentData.status, 'refunded');
        if (!transitionValidation.isValid) {
          throw new Error(transitionValidation.error);
        }

        const orderRef = doc(db, orderDocPath(cleanRestaurantId, paymentData.orderId));
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap.exists()) {
          throw new Error(`Order "${paymentData.orderId}" not found for payment refund.`);
        }

        const orderData = orderSnap.data() as Order;
        const currentGrandTotal = orderData.grandTotalMinor ?? 0;
        const currentPaid = orderData.paidAmountMinor ?? 0;

        const newPaid = Math.max(0, currentPaid - paymentData.amountMinor);
        const newDue = Math.max(0, currentGrandTotal - newPaid);
        const resolvedUserId = refundedBy || auth.currentUser?.uid || 'system';
        const orderPaymentStatus =
          newDue === 0 ? 'paid' : newPaid > 0 ? 'partially_paid' : 'unpaid';

        // 1. Update Payment status to 'refunded' and record refund reason/metadata
        transaction.update(paymentRef, {
          status: 'refunded',
          refundReason: reason?.trim() || null,
          refundedAt: serverTimestamp(),
          refundedBy: resolvedUserId,
          updatedBy: resolvedUserId,
          updatedAt: serverTimestamp()
        });

        // 2. Deduct from Order paidAmountMinor and re-increase dueAmountMinor & update paymentStatus
        transaction.update(orderRef, {
          paidAmountMinor: newPaid,
          dueAmountMinor: newDue,
          paymentStatus: orderPaymentStatus,
          updatedBy: resolvedUserId,
          updatedAt: serverTimestamp()
        });
      });

      await auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'payment',
        entityId: cleanPaymentId,
        action: 'payment_refunded',
        actorUid: refundedBy || auth.currentUser?.uid || 'system',
        metadata: {
          reason: reason?.trim() || null
        }
      });
    } catch (err: any) {
      if (err.message && (err.message.includes('Illegal payment status transition') || err.message.includes('does not exist'))) {
        throw err;
      }
      throw handleFirestoreError(err, OperationType.UPDATE, paymentDocPath(cleanRestaurantId, cleanPaymentId));
    }
  }

  /**
   * Fetches all payments for a restaurant.
   */
  async getPayments(restaurantId: string): Promise<Payment[]> {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      throw new Error('Valid restaurantId is required to fetch payments.');
    }

    try {
      const paymentsCol = collection(db, paymentsPath(cleanRestaurantId));
      const snap = await getDocs(paymentsCol);
      const payments = snap.docs.map(
        (d) =>
          ({
            id: d.id,
            ...d.data()
          } as Payment)
      );

      payments.sort((a, b) => {
        const timeA = parseTimestampToMillis(a.createdAt);
        const timeB = parseTimestampToMillis(b.createdAt);
        return timeB - timeA; // Descending (latest first)
      });

      return payments;
    } catch (err: any) {
      throw handleFirestoreError(err, OperationType.LIST, paymentsPath(cleanRestaurantId));
    }
  }

  /**
   * Authoritative Payment History Querying and Aggregation.
   * Performs multi-condition filtering (dates, method, status, search query) and computes exact summary totals.
   */
  async queryPaymentHistory(
    restaurantId: string,
    options: PaymentHistoryFilterOptions = {}
  ): Promise<PaymentHistoryResult> {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      throw new Error('Valid restaurantId is required to query payment history.');
    }

    try {
      const allPayments = await this.getPayments(cleanRestaurantId);

      let filtered = allPayments;

      // Filter by Order ID
      if (options.orderId?.trim()) {
        const targetOrderId = options.orderId.trim();
        filtered = filtered.filter((p) => p.orderId === targetOrderId);
      }

      // Filter by Method
      if (options.method && options.method !== 'all') {
        filtered = filtered.filter((p) => p.method === options.method);
      }

      // Filter by Status
      if (options.status && options.status !== 'all') {
        filtered = filtered.filter((p) => p.status === options.status);
      }

      // Filter by Start Date
      if (options.startDate) {
        const startMillis = parseTimestampToMillis(options.startDate);
        if (startMillis > 0) {
          filtered = filtered.filter((p) => {
            const time = parseTimestampToMillis(p.createdAt);
            return time >= startMillis;
          });
        }
      }

      // Filter by End Date
      if (options.endDate) {
        const endMillis = parseTimestampToMillis(options.endDate);
        if (endMillis > 0) {
          filtered = filtered.filter((p) => {
            const time = parseTimestampToMillis(p.createdAt);
            return time <= endMillis;
          });
        }
      }

      // Filter by Search Query (ID, OrderId, Reference, CreatedBy)
      if (options.searchQuery?.trim()) {
        const queryLower = options.searchQuery.trim().toLowerCase();
        filtered = filtered.filter((p) => {
          const idMatch = p.id.toLowerCase().includes(queryLower);
          const orderMatch = p.orderId.toLowerCase().includes(queryLower);
          const refMatch = p.reference ? p.reference.toLowerCase().includes(queryLower) : false;
          const actorMatch = p.createdBy ? p.createdBy.toLowerCase().includes(queryLower) : false;
          const refundActorMatch = p.refundedBy ? p.refundedBy.toLowerCase().includes(queryLower) : false;
          const refundReasonMatch = p.refundReason ? p.refundReason.toLowerCase().includes(queryLower) : false;
          return idMatch || orderMatch || refMatch || actorMatch || refundActorMatch || refundReasonMatch;
        });
      }

      // Calculate authoritative financial totals
      let totalCollectedMinor = 0;
      let totalRefundedMinor = 0;
      let totalPendingMinor = 0;

      for (const p of filtered) {
        if (p.status === 'completed') {
          totalCollectedMinor += p.amountMinor || 0;
        } else if (p.status === 'refunded') {
          totalRefundedMinor += p.amountMinor || 0;
        } else if (p.status === 'pending') {
          totalPendingMinor += p.amountMinor || 0;
        }
      }

      // Apply limit if specified
      const totalCount = filtered.length;
      if (options.limitCount && options.limitCount > 0) {
        filtered = filtered.slice(0, options.limitCount);
      }

      return {
        payments: filtered,
        totalCount,
        totals: {
          totalCollectedMinor,
          totalRefundedMinor,
          totalPendingMinor,
          count: totalCount
        }
      };
    } catch (err: any) {
      throw handleFirestoreError(err, OperationType.LIST, paymentsPath(cleanRestaurantId));
    }
  }

  /**
   * Subscribes to real-time payments across the entire restaurant.
   */
  subscribeToPayments(
    restaurantId: string,
    onUpdate: (payments: Payment[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      throw new Error('Valid restaurantId is required to subscribe to payments.');
    }

    const paymentsCol = collection(db, paymentsPath(cleanRestaurantId));
    return onSnapshot(
      paymentsCol,
      (snapshot) => {
        const payments = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data()
        } as Payment));

        payments.sort((a, b) => {
          const timeA = parseTimestampToMillis(a.createdAt);
          const timeB = parseTimestampToMillis(b.createdAt);
          return timeB - timeA; // Latest first
        });

        onUpdate(payments);
      },
      (error) => {
        const handledError = handleFirestoreError(error, OperationType.LIST, paymentsPath(cleanRestaurantId));
        if (onError) {
          onError(handledError);
        } else {
          console.error('Restaurant payments subscription error:', handledError);
        }
      }
    );
  }

  /**
   * Subscribes to real-time payment updates for a specific order.
   */
  subscribeToPaymentsForOrder(
    restaurantId: string,
    orderId: string,
    onUpdate: (payments: Payment[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanOrderId = orderId?.trim();
    if (!cleanRestaurantId || !cleanOrderId) {
      throw new Error('restaurantId and orderId are required to subscribe to payments.');
    }

    const paymentsCol = collection(db, paymentsPath(cleanRestaurantId));
    const q = query(
      paymentsCol,
      where('orderId', '==', cleanOrderId)
    );

    return onSnapshot(
      q,
      (snapshot) => {
        const payments = snapshot.docs.map(d => ({
          id: d.id,
          ...d.data()
        } as Payment));
        payments.sort((a, b) => {
          const timeA = parseTimestampToMillis(a.createdAt);
          const timeB = parseTimestampToMillis(b.createdAt);
          return timeA - timeB;
        });
        onUpdate(payments);
      },
      (error) => {
        const handledError = handleFirestoreError(error, OperationType.LIST, paymentsPath(cleanRestaurantId));
        if (onError) {
          onError(handledError);
        } else {
          console.error('Payments subscription error:', handledError);
        }
      }
    );
  }
}


export const paymentService = new PaymentService();
