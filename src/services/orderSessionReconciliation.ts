import { TableSession } from '../types/table';

export function reconcileCancelledOrderInTableSession(
  sessionData: Pick<TableSession, 'activeOrderId' | 'activeOrderIds'>,
  cancelledOrderId: string
): Pick<TableSession, 'activeOrderId' | 'activeOrderIds'> {
  const cancelledId = String(cancelledOrderId || '').trim();
  const activeIds = Array.isArray(sessionData.activeOrderIds)
    ? sessionData.activeOrderIds.filter(
        (id): id is string => typeof id === 'string' && id.trim() !== ''
      )
    : [];

  const remainingIds = activeIds.filter((id) => id !== cancelledId);
  const canonicalId = String(sessionData.activeOrderId || '').trim();

  return {
    activeOrderIds: remainingIds,
    activeOrderId:
      canonicalId && canonicalId !== cancelledId
        ? canonicalId
        : (remainingIds[remainingIds.length - 1] || null)
  };
}
