import { KOT, KOTStatus } from '../types/kot';
import { OrderStatus } from '../types/order';

export type OperationalGroup = 'waiting' | 'preparing' | 'ready' | 'terminal';

/**
 * Maps authoritative KOT status to operational group.
 */
export function getOperationalGroup(status: KOTStatus): OperationalGroup {
  switch (status) {
    case 'confirmed':
    case 'sentToKitchen':
      return 'waiting';
    case 'preparing':
      return 'preparing';
    case 'ready':
      return 'ready';
    case 'served':
    case 'cancelled':
    case 'draft':
    default:
      return 'terminal';
  }
}

/**
 * Calculates elapsed time in minutes for an active KOT.
 * Uses sentToKitchenAt or createdAt timestamp source deterministically.
 */
export function calculateKOTElapsedTimeMinutes(kot: KOT, nowTimestampMs?: number): number {
  const now = nowTimestampMs ?? Date.now();

  const startTime = kot.sentToKitchenAt?.toDate
    ? kot.sentToKitchenAt.toDate().getTime()
    : kot.createdAt?.toDate
    ? kot.createdAt.toDate().getTime()
    : new Date(kot.createdAt || now).getTime();

  const diffMs = now - startTime;
  return Math.max(0, Math.floor(diffMs / 60000));
}

/**
 * Formats elapsed minutes for kitchen card display (e.g. "05 min", "12 min", "28 min").
 */
export function formatElapsedTime(minutes: number): string {
  const pad = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${pad} min`;
}

/**
 * Returns the single valid next operational action for a given KOT status, or null if terminal.
 */
export function getNextValidKOTAction(
  status: KOTStatus
): { actionStatus: KOTStatus; label: string } | null {
  switch (status) {
    case 'confirmed':
    case 'sentToKitchen':
      return { actionStatus: 'preparing', label: 'Start Preparing' };
    case 'preparing':
      return { actionStatus: 'ready', label: 'Mark Ready' };
    case 'ready':
      return { actionStatus: 'served', label: 'Mark Served' };
    default:
      return null;
  }
}

/**
 * Sorts KOTs deterministically by creation time (oldest first).
 */
export function sortKOTsByCreationTime(kots: KOT[]): KOT[] {
  return [...kots].sort((a, b) => {
    const timeA = a.createdAt?.toDate
      ? a.createdAt.toDate().getTime()
      : new Date(a.createdAt || 0).getTime();
    const timeB = b.createdAt?.toDate
      ? b.createdAt.toDate().getTime()
      : new Date(b.createdAt || 0).getTime();

    if (timeA !== timeB) {
      return timeA - timeB;
    }
    return (a.kotNumber || '').localeCompare(b.kotNumber || '');
  });
}

/**
 * Groups active KOTs into WAITING, PREPARING, and READY operational buckets.
 * Each group is sorted deterministically by creation time.
 */
export function groupKOTsByOperationalStatus(kots: KOT[]): {
  waiting: KOT[];
  preparing: KOT[];
  ready: KOT[];
} {
  const waiting: KOT[] = [];
  const preparing: KOT[] = [];
  const ready: KOT[] = [];

  for (const kot of kots) {
    const group = getOperationalGroup(kot.status);
    if (group === 'waiting') waiting.push(kot);
    else if (group === 'preparing') preparing.push(kot);
    else if (group === 'ready') ready.push(kot);
  }

  return {
    waiting: sortKOTsByCreationTime(waiting),
    preparing: sortKOTsByCreationTime(preparing),
    ready: sortKOTsByCreationTime(ready)
  };
}

/**
 * Filters KOTs by operational filter choice ('all' | 'waiting' | 'preparing' | 'ready').
 */
export function filterKOTsByOperationalStatus(
  kots: KOT[],
  filter: 'all' | 'waiting' | 'preparing' | 'ready'
): KOT[] {
  const sorted = sortKOTsByCreationTime(kots);
  if (filter === 'all') return sorted;

  return sorted.filter((kot) => getOperationalGroup(kot.status) === filter);
}

/**
 * Calculates the authoritative aggregate OrderStatus based on all KOT tickets belonging to an order.
 * 
 * Rules:
 * 1. Considers all active (non-cancelled) KOTs.
 * 2. If no non-cancelled KOTs exist:
 *    - If all KOTs are cancelled, retains current status (or returns 'cancelled' if order is empty).
 *    - If no KOTs exist at all, returns current status (e.g. 'draft' or 'confirmed').
 * 3. If ALL non-cancelled KOTs are 'served' -> Order is 'served'.
 * 4. If ALL non-cancelled KOTs are 'ready' or 'served' (with at least one 'ready') -> Order is 'ready'.
 * 5. If ANY non-cancelled KOT is 'preparing' (or mix of 'ready' and 'sentToKitchen'/'preparing') -> Order is 'preparing'.
 * 6. If ALL non-cancelled KOTs are 'sentToKitchen' or 'confirmed' -> Order is 'sentToKitchen'.
 */
export function calculateAggregateOrderStatus(
  currentOrderStatus: OrderStatus,
  kots: KOT[]
): OrderStatus {
  // Never regress or overwrite terminal order states
  if (currentOrderStatus === 'completed' || currentOrderStatus === 'cancelled') {
    return currentOrderStatus;
  }

  // Filter out cancelled KOTs
  const activeKots = kots.filter((k) => k.status !== 'cancelled' && k.status !== 'draft');

  if (activeKots.length === 0) {
    // If all KOTs were cancelled and there were KOTs, return cancelled
    if (kots.length > 0 && kots.every((k) => k.status === 'cancelled')) {
      return 'cancelled';
    }
    return currentOrderStatus;
  }

  const allServed = activeKots.every((k) => k.status === 'served');
  if (allServed) {
    return 'served';
  }

  const allReadyOrServed = activeKots.every((k) => k.status === 'ready' || k.status === 'served');
  if (allReadyOrServed) {
    return 'ready';
  }

  const anyPreparing = activeKots.some((k) => k.status === 'preparing');
  const anyReady = activeKots.some((k) => k.status === 'ready');
  const anySentToKitchen = activeKots.some((k) => k.status === 'sentToKitchen' || k.status === 'confirmed');

  if (anyPreparing || (anyReady && anySentToKitchen)) {
    return 'preparing';
  }

  const allWaiting = activeKots.every((k) => k.status === 'sentToKitchen' || k.status === 'confirmed');
  if (allWaiting) {
    return 'sentToKitchen';
  }

  // Default fallback to current
  return currentOrderStatus;
}

