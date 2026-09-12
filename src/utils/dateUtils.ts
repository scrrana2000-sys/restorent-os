/**
 * Unified Date and Timestamp Utilities for RestaurantOS
 * 
 * Safely parses any Firestore Timestamp, serialized timestamp object,
 * ISO date string, or JavaScript Date object into accurate millisecond numbers and Date objects.
 */

export interface SerializedFirestoreTimestamp {
  seconds: number;
  nanoseconds?: number;
  _seconds?: number;
  _nanoseconds?: number;
}

export function parseTimestampToMillis(ts: unknown): number {
  if (!ts) return 0;

  if (typeof ts === 'number') {
    if (!Number.isFinite(ts) || Number.isNaN(ts)) return 0;
    return ts;
  }

  // Firestore Timestamp instance
  if (typeof (ts as any).toMillis === 'function') {
    try {
      const millis = (ts as any).toMillis();
      if (typeof millis === 'number' && Number.isFinite(millis)) return millis;
    } catch {
      // Fallback
    }
  }

  if (typeof (ts as any).toDate === 'function') {
    try {
      const d = (ts as any).toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.getTime();
    } catch {
      // Fallback
    }
  }

  // Serialized Firestore timestamp { seconds, nanoseconds } or { _seconds, _nanoseconds }
  if (typeof ts === 'object' && ts !== null) {
    const obj = ts as Record<string, any>;
    const sec = typeof obj.seconds === 'number' ? obj.seconds : (typeof obj._seconds === 'number' ? obj._seconds : undefined);
    const nano = typeof obj.nanoseconds === 'number' ? obj.nanoseconds : (typeof obj._nanoseconds === 'number' ? obj._nanoseconds : 0);

    if (sec !== undefined && Number.isFinite(sec)) {
      return Math.floor(sec * 1000 + (nano / 1000000));
    }
  }

  // Standard Date object
  if (ts instanceof Date) {
    const time = ts.getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  // ISO string or date string
  if (typeof ts === 'string') {
    const parsed = new Date(ts).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return 0;
}

export function parseTimestampToDate(ts: unknown): Date {
  const millis = parseTimestampToMillis(ts);
  return millis > 0 ? new Date(millis) : new Date();
}

export function formatTimestamp(ts: unknown): { dateStr: string; timeStr: string } {
  const date = parseTimestampToDate(ts);
  return {
    dateStr: date.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }),
    timeStr: date.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
  };
}
