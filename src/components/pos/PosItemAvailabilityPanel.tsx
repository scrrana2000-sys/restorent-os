import React, { useMemo, useState } from 'react';
import { Check, Power, Search, Utensils, X } from 'lucide-react';
import { MenuItem } from '../../types/menu';

export interface PosItemAvailabilityPanelProps {
  isOpen: boolean;
  onClose: () => void;
  menuItems: MenuItem[];
  onToggleItemAvailability: (itemId: string, isAvailable: boolean) => Promise<void>;
}

export const PosItemAvailabilityPanel: React.FC<PosItemAvailabilityPanelProps> = ({
  isOpen,
  onClose,
  menuItems,
  onToggleItemAvailability
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const availableCount = menuItems.filter(item => item.isAvailable).length;
  const offlineCount = menuItems.length - availableCount;

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return menuItems;
    return menuItems.filter(item =>
      item.name.toLowerCase().includes(q) ||
      (item.shortName || '').toLowerCase().includes(q) ||
      (item.sku || '').toLowerCase().includes(q)
    );
  }, [menuItems, searchQuery]);

  if (!isOpen) return null;

  return (
    <div id="pos-item-availability-panel" className="fixed inset-0 z-[70] bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-3xl max-h-[94vh] sm:max-h-[90vh] bg-slate-50 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        <header className="shrink-0 bg-slate-900 text-white px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-400/20 flex items-center justify-center">
              <Utensils className="w-5 h-5 text-indigo-300" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-black truncate">POS Item Availability</h2>
              <p className="text-[11px] text-slate-400">Turn individual menu items ON or OFF for POS ordering.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 hover:text-white" aria-label="Close POS item availability">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4">
          <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <h3 className="text-sm font-black text-slate-900">Restaurant / POS Stock</h3>
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-[11px] font-semibold">
                  <span className="text-emerald-700">{availableCount} ON</span>
                  <span className="text-slate-300">•</span>
                  <span className="text-rose-600">{offlineCount} OFF</span>
                </div>
              </div>
              <div className="relative sm:w-72">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder="Search menu item..."
                  className="w-full h-10 pl-9 pr-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-indigo-400"
                  aria-label="Search menu items"
                />
              </div>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="max-h-[58vh] overflow-y-auto divide-y divide-slate-100">
              {filteredItems.map(item => {
                const available = item.isAvailable;
                const key = 'pos-item-' + item.itemId;
                return (
                  <div key={item.itemId} className="px-4 sm:px-5 py-3.5 flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 overflow-hidden shrink-0 border border-slate-200">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt="" className={'w-full h-full object-cover ' + (available ? '' : 'grayscale opacity-60')} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-400"><Utensils className="w-5 h-5" /></div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={'text-xs sm:text-sm font-black truncate ' + (available ? 'text-slate-900' : 'text-slate-500')}>{item.name}</p>
                      <p className="text-[10px] text-slate-500">{available ? 'Available for POS billing' : 'OFF — hidden from POS ordering'}</p>
                    </div>
                    <button
                      type="button"
                      disabled={busyKey !== null}
                      onClick={async () => {
                        setBusyKey(key);
                        try {
                          await onToggleItemAvailability(item.itemId, !available);
                        } finally {
                          setBusyKey(null);
                        }
                      }}
                      className={'relative w-16 h-9 rounded-full shrink-0 transition-colors ' + (available ? 'bg-emerald-600' : 'bg-slate-300')}
                      aria-label={(available ? 'Turn OFF ' : 'Turn ON ') + item.name}
                    >
                      <span className={'absolute top-1 w-7 h-7 rounded-full bg-white shadow-sm flex items-center justify-center ' + (available ? 'left-8' : 'left-1')}>
                        {available ? <Check className="w-4 h-4 text-emerald-600" /> : <Power className="w-4 h-4 text-slate-400" />}
                      </span>
                    </button>
                  </div>
                );
              })}
              {filteredItems.length === 0 && (
                <div className="p-10 text-center text-slate-500 text-xs">No matching menu items.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
