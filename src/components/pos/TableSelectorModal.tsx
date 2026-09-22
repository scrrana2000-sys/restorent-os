import React, { useState, useEffect } from 'react';
import { Table, TableSession } from '../../types/table';
import { tableService } from '../../services/tableService';
import { tableSessionService } from '../../services/tableSessionService';
import { useRestaurant } from '../../context/RestaurantContext';
import { useAuth } from '../../context/AuthContext';
import { X, RefreshCw, AlertCircle, Check } from 'lucide-react';

interface TableSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTable: Table | null;
  activeSession: TableSession | null;
  onSelectTableAndSession: (table: Table, session: TableSession | null) => void;
  onCloseTableSession?: (table: Table, session: TableSession | null) => Promise<void>;
}

export const TableSelectorModal: React.FC<TableSelectorModalProps> = ({
  isOpen,
  onClose,
  selectedTable,
  activeSession,
  onSelectTableAndSession,
  onCloseTableSession
}) => {
  const { restaurant } = useRestaurant();
  const { user } = useAuth();
  const restaurantId = restaurant?.restaurantId || '';

  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [chosenTable, setChosenTable] = useState<Table | null>(selectedTable);
  const [guestCount] = useState<number>(2);
  const [submitting, setSubmitting] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !restaurantId) return;

    setLoading(true);
    setError(null);
    setChosenTable(selectedTable);

    const unsubscribe = tableService.subscribeToTables(
      restaurantId,
      (updatedTables) => {
        setTables(updatedTables);
        setLoading(false);
      },
      (err) => {
        console.error('Table subscription error:', err);
        setError(err.message || 'Failed to fetch tables');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [isOpen, restaurantId, selectedTable]);

  if (!isOpen) return null;

  const handleSelectTableAndConfirm = async (table: Table) => {
    if (!restaurantId) return;
    setChosenTable(table);
    setSubmitting(true);
    setSessionError(null);

    try {
      // Selecting a free table must NOT make it occupied. The session opens only
      // when the first dine-in order is actually sent/paid.
      if (!table.activeSessionId) {
        onSelectTableAndSession({ ...table, activeSessionId: null }, null);
        onClose();
        return;
      }

      // An already occupied table is selectable and keeps its existing session.
      const session = await tableSessionService.getActiveSession(
        restaurantId,
        table.id,
        table.activeSessionId
      );

      if (!session) {
        throw new Error('This table is marked active but its session could not be found. Please refresh tables.');
      }

      onSelectTableAndSession({ ...table, activeSessionId: session.id }, session);
      onClose();
    } catch (err: any) {
      console.error('Failed to select table:', err);
      setSessionError(err.message || 'Could not select this table.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualCloseTable = async (table: Table) => {
    if (!table.activeSessionId || !restaurantId) return;

    setSubmitting(true);
    setSessionError(null);

    try {
      if (onCloseTableSession) {
        await onCloseTableSession(table, null);
      } else {
        await tableSessionService.closeSession(
          restaurantId,
          table.activeSessionId,
          user?.uid || 'staff',
          { autoCompleteSettledOrders: true, source: 'pos_manual' }
        );
      }
      setChosenTable(null);
    } catch (err: any) {
      console.error('POS Manual Table Close Error:', err);
      setSessionError(err.message || 'Cannot close table session.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90dvh] flex flex-col shadow-2xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Compact Header */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base">🪑</span>
            <div>
              <h3 className="text-sm font-black text-white">Select Floor Table</h3>
              <p className="text-[10px] text-slate-400">Tap table to assign order</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close table modal"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors active:scale-95"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Legend */}
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-[11px] font-bold text-slate-600 shrink-0">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Free
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Occupied
            </span>
          </div>
          {submitting && (
            <span className="flex items-center gap-1 text-indigo-600 text-xs">
              <RefreshCw className="w-3 h-3 animate-spin" /> Updating...
            </span>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-3 sm:p-4 overflow-y-auto flex-1 space-y-3">
          {sessionError && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{sessionError}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
              <span className="text-xs font-semibold">Loading tables...</span>
            </div>
          ) : error ? (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : tables.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs font-medium">
              No floor tables found. Please add tables in Settings.
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-4 gap-2">
              {tables.map((tbl) => {
                const isSelected = selectedTable?.id === tbl.id;
                const isOccupied = !!tbl.activeSessionId;

                return (
                  <button
                    key={tbl.id}
                    type="button"
                    disabled={submitting}
                    onClick={() => handleSelectTableAndConfirm(tbl)}
                    className={`p-2.5 sm:p-3 rounded-xl border text-center flex flex-col items-center justify-between transition-all min-h-[76px] active:scale-95 ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-50/80 ring-2 ring-indigo-500/30 shadow-xs'
                        : isOccupied
                        ? 'border-amber-300 bg-amber-50/60 hover:border-amber-400'
                        : 'border-slate-200 bg-white hover:border-indigo-300 shadow-2xs'
                    }`}
                  >
                    {/* Top status indicator */}
                    <div className="w-full flex items-center justify-between">
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          isOccupied ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                      />
                      <span className="text-[10px] text-slate-400 font-medium">
                        {tbl.capacity}p
                      </span>
                    </div>

                    {/* Bold Table Number */}
                    <div className="my-1">
                      <span className="text-base sm:text-lg font-black text-slate-900 block leading-tight">
                        {tbl.tableNumber}
                      </span>
                      {tbl.name && tbl.name !== tbl.tableNumber && (
                        <span className="text-[10px] font-semibold text-slate-500 block truncate max-w-[70px]">
                          {tbl.name}
                        </span>
                      )}
                    </div>

                    {/* Bottom Status label */}
                    <span
                      className={`text-[9px] font-black uppercase px-1.5 py-0.2 rounded ${
                        isSelected
                          ? 'bg-indigo-600 text-white'
                          : isOccupied
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {isSelected ? 'Current' : isOccupied ? 'Active' : 'Free'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          {selectedTable && selectedTable.activeSessionId ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleManualCloseTable(selectedTable)}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors shadow-2xs active:scale-95"
            >
              Close Table {selectedTable.tableNumber}
            </button>
          ) : (
            <span className="text-xs text-slate-500 font-medium">
              {selectedTable ? `Current: Table ${selectedTable.tableNumber}` : 'No table chosen'}
            </span>
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200/60 rounded-lg active:scale-95"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
