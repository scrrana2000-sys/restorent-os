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
import { TableSession } from '../types/table';
import { ITableSessionService } from './transactionInterfaces';
import { validateTableSession, validateTableSessionStatusTransition } from '../utils/transactionValidation';
import { tableSessionsPath, tableSessionDocPath, tableDocPath } from '../utils/paths';
import { handleFirestoreError, OperationType } from '../utils/firestoreError';
import { idempotencyService } from './idempotencyService';
import { auditService } from './auditService';
import { enforcePermission } from '../utils/permissions';

/**
 * TableSessionService
 * 
 * Provides centralized TableSession lifecycle management.
 * 
 * CRITICAL ARCHITECTURAL & CONCURRENCY INVARIANTS:
 * 1. Physical Table vs. TableSession:
 *    - Table represents the physical furniture asset (1:N relationship with historical sessions).
 *    - TableSession represents ONE specific dining occurrence.
 * 2. Lifecycle State Machine:
 *    - Valid transition: 'open' -> 'closed'.
 *    - 'closed' is a terminal state. Reopening a closed session ('closed' -> 'open') is strictly forbidden.
 *    - To reuse a physical table, a NEW TableSession instance must be created.
 * 3. Single Open Session Invariant:
 *    - For a given (restaurantId, tableId), at most 1 session can have status === 'open' at any time.
 *    - Pre-conditions for opening a session:
 *      * Table must exist in the specified restaurant (`restaurants/{restaurantId}/tables/{tableId}`).
 *      * Table must be active (`table.isActive === true`).
 *      * guestCount must be a positive integer <= table.capacity.
 *      * No currently open session may exist for this table.
 * 4. Closing a Session:
 *    - Sets status to 'closed'.
 *    - Sets closedAt timestamp (closedAt >= openedAt).
 *    - Preserves openedAt and historical reference arrays (e.g. activeOrderIds).
 * 5. Concurrency Notice:
 *    - In multi-operator environments, client-side pre-checks are subject to race conditions
 *      if two cashiers open a session simultaneously.
 *    - In production Firestore, this should be wrapped in a Firestore Transaction / backend authority
 *      for complete atomic serialization.
 */
export class TableSessionService implements ITableSessionService {
  /**
   * Finds the currently open/active TableSession for a table.
   * Returns null if no session is currently open.
   */
  async getActiveSession(
    restaurantId: string,
    tableId: string,
    knownSessionId?: string | null
  ): Promise<TableSession | null> {
    const path = tableSessionsPath(restaurantId);
    try {
      if (!restaurantId || !tableId) return null;

      // 1. Direct doc lookup if knownSessionId is supplied
      if (knownSessionId && knownSessionId.trim()) {
        const sessionDocRef = doc(
          db,
          'restaurants',
          restaurantId.trim(),
          'tableSessions',
          knownSessionId.trim()
        );
        const sessionSnap = await getDoc(sessionDocRef);
        if (sessionSnap.exists()) {
          const sessData = { id: sessionSnap.id, ...sessionSnap.data() } as TableSession;
          if (sessData.status === 'open') {
            return sessData;
          }
        }
      }

      // 2. Query open session by tableId
      const colRef = collection(db, 'restaurants', restaurantId.trim(), 'tableSessions');
      const q = query(
        colRef,
        where('tableId', '==', tableId.trim()),
        where('status', '==', 'open')
      );
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        return null;
      }
      const firstDoc = snapshot.docs[0];
      return { id: firstDoc.id, ...firstDoc.data() } as TableSession;
    } catch (err: unknown) {
      throw handleFirestoreError(err, OperationType.GET, path);
    }
  }

  /**
   * Opens a new TableSession for a physical table.
   * Atomically enforces table existence, active status, guest count within capacity, and no existing open session using Firestore runTransaction.
   */
  async openSession(
    restaurantId: string,
    tableId: string,
    guestCount: number,
    openedBy: string,
    clientRequestId?: string
  ): Promise<TableSession> {
    const sessionCollectionPath = tableSessionsPath(restaurantId);
    const cleanRestaurantId = restaurantId?.trim();
    const cleanTableId = tableId?.trim();
    const cleanKey = clientRequestId?.trim();

    if (!cleanRestaurantId) {
      throw new Error('Valid restaurantId is required to open a session.');
    }

    await enforcePermission(cleanRestaurantId, 'open_table_sessions');
    if (!cleanTableId) {
      throw new Error('Valid tableId is required to open a session.');
    }

    // 1. Pre-validate session structure
    const sessionValidation = validateTableSession({
      tableId: cleanTableId,
      guestCount,
      status: 'open'
    });
    if (!sessionValidation.isValid) {
      throw new Error(`TableSession validation failed: ${sessionValidation.error}`);
    }

    try {
      const tableRef = doc(db, 'restaurants', cleanRestaurantId, 'tables', cleanTableId);
      const colRef = collection(db, 'restaurants', cleanRestaurantId, 'tableSessions');
      const newDocRef = doc(colRef);
      const now = new Date();

      let createdSession: TableSession | null = null;
      let cachedSession: TableSession | null = null;

      await runTransaction(db, async (transaction) => {
        // Idempotency check inside transaction
        if (cleanKey) {
          const check = await idempotencyService.checkOrAcquire<TableSession>(
            cleanRestaurantId,
            cleanKey,
            'open_session',
            { tableId: cleanTableId, guestCount },
            transaction
          );

          if (check.action === 'return_cached' && check.cachedResult) {
            cachedSession = check.cachedResult;
            return;
          }
        }

        const tableSnap = await transaction.get(tableRef);
        if (!tableSnap.exists()) {
          throw new Error(`Cannot open session: Table "${tableId}" does not exist in restaurant "${restaurantId}".`);
        }

        const tableData = tableSnap.data();
        if (!tableData.isActive) {
          throw new Error(`Cannot open session: Table "${tableId}" is currently inactive.`);
        }

        if (guestCount > tableData.capacity) {
          throw new Error(
            `Cannot open session: guestCount (${guestCount}) exceeds table capacity (${tableData.capacity}).`
          );
        }

        // Atomic lock check on table
        if (tableData.activeSessionId) {
          const existingSessRef = doc(db, 'restaurants', cleanRestaurantId, 'tableSessions', tableData.activeSessionId);
          const existingSessSnap = await transaction.get(existingSessRef);
          if (existingSessSnap && typeof existingSessSnap.exists === 'function' && existingSessSnap.exists()) {
            const existingSess = { id: existingSessSnap.id, ...existingSessSnap.data() } as TableSession;
            if (existingSess.status === 'closed') {
              // Stale lock: clear stale lock and continue
            } else {
              throw new Error(`Cannot open session: Table "${cleanTableId}" already has an active open session.`);
            }
          } else {
            // activeSessionId exists on physical table document
            throw new Error(`Cannot open session: Table "${cleanTableId}" already has an active open session.`);
          }
        }

        const sessionData: Omit<TableSession, 'id'> = {
          restaurantId: cleanRestaurantId,
          tableId: cleanTableId,
          status: 'open',
          guestCount,
          openedAt: serverTimestamp() || now,
          closedAt: null,
          activeOrderIds: [],
          openedBy: openedBy || auth.currentUser?.uid || 'system',
          closedBy: null,
          createdAt: serverTimestamp() || now,
          updatedAt: serverTimestamp() || now
        };

        // 1. Write new session document. The Firestore document id is mirrored in `id`
        // because the deployed rules use it as an explicit tenant/lifecycle invariant.
        transaction.set(newDocRef, { ...sessionData, id: newDocRef.id });

        // 2. Lock physical table document with activeSessionId and status occupied
        transaction.update(tableRef, {
          activeSessionId: newDocRef.id,
          status: 'occupied',
          updatedAt: serverTimestamp() || now
        });

        createdSession = {
          id: newDocRef.id,
          ...sessionData,
          openedAt: now,
          createdAt: now,
          updatedAt: now
        };

        if (cleanKey) {
          await idempotencyService.recordSuccess(
            cleanRestaurantId,
            cleanKey,
            'open_session',
            { tableId: cleanTableId, guestCount },
            createdSession.id,
            createdSession,
            transaction
          );
        }
      });

      if (cachedSession) {
        return cachedSession;
      }

      if (!createdSession) {
        throw new Error('Transaction succeeded but table session was not created.');
      }

      auditService.logEvent(cleanRestaurantId, {
        entityType: 'tableSession',
        entityId: (createdSession as TableSession).id,
        action: 'session_opened',
        actorUid: openedBy || auth.currentUser?.uid || 'system',
        metadata: { tableId: cleanTableId, guestCount }
      });

      return createdSession;
    } catch (err: unknown) {
      if (cleanKey) {
        await idempotencyService.recordFailure(
          cleanRestaurantId,
          cleanKey,
          (err as any)?.message || 'Failed to open session'
        );
      }
      if (
        (err as any)?.message &&
        ((err as any).message.includes('Cannot open session') ||
          (err as any).message.includes('Idempotency') ||
          (err as any).message.includes('TableSession validation'))
      ) {
        throw err;
      }
      throw handleFirestoreError(err, OperationType.CREATE, sessionCollectionPath);
    }
  }

  /**
   * Closes an active TableSession.
   * Enforces valid lifecycle transition ('open' -> 'closed'), verifies no unpaid orders or active KOTs,
   * and clears activeSessionId from the physical table document using an atomic transaction.
   */
  async closeSession(
    restaurantId: string,
    sessionId: string,
    closedBy: string,
    options?: { autoCompleteSettledOrders?: boolean; source?: string }
  ): Promise<void> {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      throw new Error('restaurantId is required to close a session.');
    }
    const trustedServerContext = auth.currentUser?.email === 'system-server@restaurantos.app';
    if (!trustedServerContext) {
      await enforcePermission(cleanRestaurantId, 'close_sessions');
    }
    const cleanSessionId = sessionId?.trim();
    const path = tableSessionDocPath(cleanRestaurantId, cleanSessionId);

    try {
      const docRef = doc(db, 'restaurants', cleanRestaurantId, 'tableSessions', cleanSessionId);
      let sessionSnap: any = null;
      try {
        sessionSnap = await getDoc(docRef);
      } catch {
        // Continue to transaction
      }

      let currentSession: TableSession | null = null;
      if (sessionSnap && typeof sessionSnap.exists === 'function' && sessionSnap.exists()) {
        currentSession = typeof sessionSnap.data === 'function' ? sessionSnap.data() as TableSession : sessionSnap;

        // 1. Validate lifecycle transition
        const currentSessionStatus = currentSession?.status || 'open';
        const transitionCheck = validateTableSessionStatusTransition(currentSessionStatus, 'closed');
        if (!transitionCheck.isValid) {
          throw new Error(`Cannot close session: ${transitionCheck.error}`);
        }

        // 2. Query all orders linked to this tableSession
        try {
          const ordersCol = collection(db, 'restaurants', cleanRestaurantId, 'orders');
          const sessionOrdersQuery = query(ordersCol, where('tableSessionId', '==', cleanSessionId));
          const sessionOrdersSnap = await getDocs(sessionOrdersQuery);

          const ordersList: any[] = [];
          if (sessionOrdersSnap && Array.isArray((sessionOrdersSnap as any).docs)) {
            (sessionOrdersSnap as any).docs.forEach((d: any) => ordersList.push({ id: d.id, ...d.data() }));
          } else if (sessionOrdersSnap && typeof (sessionOrdersSnap as any).forEach === 'function') {
            sessionOrdersSnap.forEach((d) => ordersList.push({ id: d.id, ...d.data() }));
          }

          // Also check any activeOrderIds on the session document if not already in list
          if (Array.isArray(currentSession.activeOrderIds)) {
            for (const ordId of currentSession.activeOrderIds) {
              if (!ordersList.some((o) => o.id === ordId)) {
                const oSnap = await getDoc(doc(db, 'restaurants', cleanRestaurantId, 'orders', ordId));
                if (oSnap?.exists?.()) {
                  ordersList.push({ id: oSnap.id, ...oSnap.data() });
                }
              }
            }
          }

          // Validate each order
          for (const ord of ordersList) {
            if (ord.status !== 'completed' && ord.status !== 'cancelled') {
              if (options?.autoCompleteSettledOrders) {
                const dueAmount = ord.dueAmountMinor ?? Math.max(0, (ord.grandTotalMinor || 0) - (ord.paidAmountMinor || 0));
                if (dueAmount === 0) {
                  // Check if order has no unserved KOTs
                  const kotsCol = collection(db, 'restaurants', cleanRestaurantId, 'kots');
                  const kotQuery = query(kotsCol, where('orderId', '==', ord.id));
                  const kotSnap = await getDocs(kotQuery);
                  let hasActiveKot = false;
                  if (kotSnap && Array.isArray((kotSnap as any).docs)) {
                    for (const kd of (kotSnap as any).docs) {
                      const kotData = kd.data() as any;
                      if (kotData.status !== 'served' && kotData.status !== 'cancelled') {
                        hasActiveKot = true;
                        break;
                      }
                    }
                  }
                  if (!hasActiveKot) {
                    try {
                      const ordRef = doc(db, 'restaurants', cleanRestaurantId, 'orders', ord.id);
                      await updateDoc(ordRef, {
                        status: 'completed',
                        updatedAt: serverTimestamp(),
                        updatedBy: closedBy
                      });
                      ord.status = 'completed';
                    } catch (e) {
                      console.warn('Auto-completing settled order during closeSession failed:', e);
                    }
                  } else {
                    throw new Error(
                      `Cannot close session: Active kitchen orders must be served or cancelled before closing the table session.`
                    );
                  }
                }
              }
            }

            if (ord.status !== 'cancelled') {
              const dueAmount = ord.dueAmountMinor ?? Math.max(0, (ord.grandTotalMinor || 0) - (ord.paidAmountMinor || 0));
              if (dueAmount > 0) {
                throw new Error(
                  `Cannot close session: Order "${ord.orderNumber || ord.id}" has an unpaid balance of ₹${(dueAmount / 100).toFixed(2)}. All orders must be settled before closing the table session.`
                );
              }
            }

            // Check if order has active KOTs - automatically mark them as served since the table session is closing
            const kotsCol = collection(db, 'restaurants', cleanRestaurantId, 'kots');
            const kotQuery = query(kotsCol, where('orderId', '==', ord.id));
            const kotSnap = await getDocs(kotQuery);
            if (kotSnap && Array.isArray(kotSnap.docs)) {
              for (const kd of kotSnap.docs) {
                const kotData = kd.data() as any;
                if (kotData.status !== 'served' && kotData.status !== 'cancelled') {
                  try {
                    const kotRef = doc(db, 'restaurants', cleanRestaurantId, 'kots', kd.id);
                    await updateDoc(kotRef, {
                      status: 'served',
                      updatedAt: serverTimestamp(),
                      updatedBy: closedBy
                    });

                    // Log audit event for auto-served KOT
                    await auditService.logEvent(cleanRestaurantId, {
                      restaurantId: cleanRestaurantId,
                      entityType: 'kot',
                      entityId: kd.id,
                      action: 'kot_served_auto_close_session',
                      actorUid: closedBy || auth.currentUser?.uid || 'system',
                      metadata: {
                        kotNumber: kotData.kotNumber,
                        orderId: ord.id,
                        reason: 'Auto-served due to closing of table session'
                      }
                    });
                  } catch (kotErr) {
                    console.warn(`[RestaurantOS] Failed to auto-serve KOT ${kd.id} during closeSession:`, kotErr);
                  }
                }
              }
            }

            // Check if order has pending payments
            const paymentsCol = collection(db, 'restaurants', cleanRestaurantId, 'payments');
            const payQuery = query(paymentsCol, where('orderId', '==', ord.id));
            const paySnap = await getDocs(payQuery);
            if (paySnap && Array.isArray(paySnap.docs)) {
              for (const pd of paySnap.docs) {
                const payData = pd.data() as any;
                if (payData.status === 'pending') {
                  throw new Error(
                    `Cannot close session: Order "${ord.orderNumber || ord.id}" has a pending payment transaction.`
                  );
                }
              }
            }

            if (ord.status !== 'completed' && ord.status !== 'cancelled') {
              throw new Error(
                `Cannot close session: Order "${ord.orderNumber || ord.id}" is still in status "${ord.status}". Orders must be completed or cancelled before closing the table session.`
              );
            }
          }
        } catch (orderCheckErr: any) {
          if (orderCheckErr?.message && orderCheckErr.message.includes('Cannot close session')) {
            throw orderCheckErr;
          }
        }
      }

      const now = new Date();

      await runTransaction(db, async (transaction) => {
        const txSessionSnap = await transaction.get(docRef);
        if (txSessionSnap && typeof txSessionSnap.exists === 'function' && !txSessionSnap.exists()) {
          throw new Error(`Cannot close session: TableSession "${sessionId}" not found.`);
        }

        const txSession = (txSessionSnap && typeof txSessionSnap.data === 'function' && txSessionSnap.data())
          ? (txSessionSnap.data() as TableSession)
          : currentSession;

        const txSessionStatus = txSession?.status || currentSession?.status || 'open';
        const txTransition = validateTableSessionStatusTransition(txSessionStatus, 'closed');
        if (!txTransition.isValid) {
          throw new Error(`Cannot close session: ${txTransition.error}`);
        }

        // All reads must execute BEFORE any writes in Firestore transactions
        let tableRef: any = null;
        let shouldClearActiveSession = false;
        const targetTableId = txSession?.tableId || currentSession?.tableId;
        if (targetTableId) {
          tableRef = doc(db, 'restaurants', cleanRestaurantId, 'tables', targetTableId.trim());
          const tableSnap = await transaction.get(tableRef);
          if (tableSnap && typeof tableSnap.exists === 'function' && tableSnap.exists()) {
            const tableData = typeof tableSnap.data === 'function' ? tableSnap.data() : (tableSnap as any);
            if (tableData?.activeSessionId === cleanSessionId) {
              shouldClearActiveSession = true;
            }
          }
        }

        // Writes phase
        // 1. Update session
        transaction.update(docRef, {
          id: cleanSessionId,
          status: 'closed',
          closedAt: serverTimestamp() || now,
          closedBy: closedBy || auth.currentUser?.uid || 'system',
          updatedAt: serverTimestamp() || now
        });

        // 2. Clear activeSessionId on table doc if present and mark table available
        if (shouldClearActiveSession && tableRef) {
          transaction.update(tableRef, {
            activeSessionId: null,
            status: 'available',
            updatedAt: serverTimestamp() || now
          });
        }
      });

      auditService.logEvent(cleanRestaurantId, {
        restaurantId: cleanRestaurantId,
        entityType: 'tableSession',
        entityId: cleanSessionId,
        action: 'session_closed',
        actorUid: closedBy || auth.currentUser?.uid || 'system',
        metadata: {
          tableId: currentSession?.tableId || null,
          source: options?.source || 'pos_manual'
        }
      });
    } catch (err: unknown) {
      if ((err as any)?.message && (err as any).message.includes('Cannot close session')) {
        throw err;
      }
      throw handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  /**
   * Updates the guest count of an active open TableSession.
   * Atomically verifies the session is open and guestCount <= physical table capacity.
   */
  async updateGuestCount(
    restaurantId: string,
    sessionId: string,
    newGuestCount: number,
    updatedBy: string
  ): Promise<void> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanSessionId = sessionId?.trim();
    const path = tableSessionDocPath(cleanRestaurantId, cleanSessionId);

    if (!cleanRestaurantId) {
      throw new Error('Valid restaurantId is required to update session guest count.');
    }
    if (!cleanSessionId) {
      throw new Error('Valid sessionId is required to update session guest count.');
    }
    if (!Number.isInteger(newGuestCount) || newGuestCount <= 0) {
      throw new Error('guestCount must be a positive integer.');
    }

    await enforcePermission(cleanRestaurantId, 'modify_session_info');

    try {
      const docRef = doc(db, 'restaurants', cleanRestaurantId, 'tableSessions', cleanSessionId);
      const now = new Date();

      await runTransaction(db, async (transaction) => {
        const sessionSnap = await transaction.get(docRef);
        if (!sessionSnap.exists()) {
          throw new Error(`Cannot update guest count: TableSession "${sessionId}" not found.`);
        }

        const session = sessionSnap.data() as TableSession;

        if (session.guestCount === newGuestCount) {
          // Already updated (idempotent success)
          return;
        }

        if (session.status !== 'open') {
          throw new Error(`Cannot update guest count: TableSession is ${session.status}. Only open sessions can be updated.`);
        }

        // Verify against physical table capacity if table exists
        if (session.tableId) {
          const tableRef = doc(db, 'restaurants', cleanRestaurantId, 'tables', session.tableId.trim());
          const tableSnap = await transaction.get(tableRef);
          if (tableSnap.exists()) {
            const tableData = tableSnap.data();
            if (newGuestCount > tableData.capacity) {
              throw new Error(
                `Cannot update guest count: guestCount (${newGuestCount}) exceeds table capacity (${tableData.capacity}).`
              );
            }
          }
        }

        transaction.update(docRef, {
          id: cleanSessionId,
          guestCount: newGuestCount,
          updatedBy: updatedBy || auth.currentUser?.uid || 'system',
          updatedAt: serverTimestamp() || now
        });
      });

      auditService.logEvent(cleanRestaurantId, {
        entityType: 'tableSession',
        entityId: cleanSessionId,
        action: 'session_guest_count_updated',
        actorUid: updatedBy || auth.currentUser?.uid || 'system',
        metadata: { newGuestCount }
      });
    } catch (err: unknown) {
      if ((err as any)?.message && (err as any).message.includes('Cannot update guest count')) {
        throw err;
      }
      throw handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  /**
   * Subscribes to a specific TableSession document in real-time.
   */
  subscribeToTableSession(
    restaurantId: string,
    sessionId: string,
    onUpdate: (session: TableSession | null) => void,
    onError?: (err: Error) => void
  ): () => void {
    const docRef = doc(db, 'restaurants', restaurantId.trim(), 'tableSessions', sessionId.trim());

    return onSnapshot(
      docRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          onUpdate(null);
        } else {
          onUpdate({ id: snapshot.id, ...snapshot.data() } as TableSession);
        }
      },
      (err) => {
        if (!auth.currentUser) return;
        const errCode = (err as any)?.code;
        if (errCode === 'permission-denied' || errCode === 'unavailable') {
          console.warn('[RestaurantOS Debug] Table session subscription notice:', (err as any)?.message);
        } else {
          console.error('[RestaurantOS Debug] Error listening to table session:', err);
        }
        if (onError) onError(err as Error);
      }
    );
  }

  /**
   * Subscribes to all active ('open') sessions in a restaurant in real-time.
   */
  subscribeToActiveSessions(
    restaurantId: string,
    onUpdate: (sessions: TableSession[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    const colRef = collection(db, 'restaurants', restaurantId.trim(), 'tableSessions');
    const q = query(colRef, where('status', '==', 'open'));

    return onSnapshot(
      q,
      (snapshot) => {
        const sessions: TableSession[] = [];
        snapshot.forEach((d) => {
          sessions.push({ id: d.id, ...d.data() } as TableSession);
        });
        onUpdate(sessions);
      },
      (err) => {
        if (!auth.currentUser) return;
        const errCode = (err as any)?.code;
        if (errCode === 'permission-denied' || errCode === 'unavailable') {
          console.warn('[RestaurantOS Debug] Active table sessions subscription notice:', (err as any)?.message);
          onUpdate([]);
        } else {
          console.error('[RestaurantOS Debug] Error listening to active table sessions:', err);
        }
        if (onError) onError(err as Error);
      }
    );
  }

  /**
   * Retrieves historical (closed) TableSessions for a specific physical table.
   * Preserves session history without coupling to active table state.
   */
  async getHistoricalSessionsForTable(
    restaurantId: string,
    tableId: string,
    limitCount: number = 20
  ): Promise<TableSession[]> {
    const cleanRestaurantId = restaurantId?.trim();
    const cleanTableId = tableId?.trim();
    if (!cleanRestaurantId || !cleanTableId) {
      throw new Error('restaurantId and tableId are required to fetch historical sessions.');
    }

    const path = tableSessionsPath(cleanRestaurantId);
    try {
      const colRef = collection(db, 'restaurants', cleanRestaurantId, 'tableSessions');
      const q = query(
        colRef,
        where('tableId', '==', cleanTableId),
        where('status', '==', 'closed')
      );
      const snapshot = await getDocs(q);
      const sessions: TableSession[] = [];
      snapshot.forEach((d) => {
        sessions.push({ id: d.id, ...d.data() } as TableSession);
      });

      // Sort client-side by closedAt desc to avoid composite index requirement
      return sessions
        .sort((a, b) => {
          const timeA = (a.closedAt as any)?.toMillis?.() || (a.closedAt ? new Date(a.closedAt as any).getTime() : 0);
          const timeB = (b.closedAt as any)?.toMillis?.() || (b.closedAt ? new Date(b.closedAt as any).getTime() : 0);
          return timeB - timeA;
        })
        .slice(0, limitCount);
    } catch (err: unknown) {
      throw handleFirestoreError(err, OperationType.LIST, path);
    }
  }

  /**
   * Retrieves all historical (closed) TableSessions across the restaurant with a bounded limit.
   */
  async getHistoricalSessions(
    restaurantId: string,
    limitCount: number = 50
  ): Promise<TableSession[]> {
    const cleanRestaurantId = restaurantId?.trim();
    if (!cleanRestaurantId) {
      throw new Error('restaurantId is required to fetch historical sessions.');
    }

    const path = tableSessionsPath(cleanRestaurantId);
    try {
      const colRef = collection(db, 'restaurants', cleanRestaurantId, 'tableSessions');
      const q = query(
        colRef,
        where('status', '==', 'closed')
      );
      const snapshot = await getDocs(q);
      const sessions: TableSession[] = [];
      snapshot.forEach((d) => {
        sessions.push({ id: d.id, ...d.data() } as TableSession);
      });

      return sessions
        .sort((a, b) => {
          const timeA = (a.closedAt as any)?.toMillis?.() || (a.closedAt ? new Date(a.closedAt as any).getTime() : 0);
          const timeB = (b.closedAt as any)?.toMillis?.() || (b.closedAt ? new Date(b.closedAt as any).getTime() : 0);
          return timeB - timeA;
        })
        .slice(0, limitCount);
    } catch (err: unknown) {
      throw handleFirestoreError(err, OperationType.LIST, path);
    }
  }
}

export const tableSessionService = new TableSessionService();
