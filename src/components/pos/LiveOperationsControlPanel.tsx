import React, { useMemo, useState } from 'react';
import { Activity, Bike, Check, Clock, Globe2, Power, Search, ShoppingBag, Utensils, X } from 'lucide-react';
import { Restaurant, RestaurantFormData } from '../../types/restaurant';
import { MenuItem } from '../../types/menu';

export interface LiveOperationsControlPanelProps {
  isOpen: boolean;
  onClose: () => void;
  restaurant: Restaurant | null;
  menuItems: MenuItem[];
  onUpdateRestaurant: (data: Partial<RestaurantFormData>) => Promise<void>;
  onToggleItemAvailability: (itemId: string, isAvailable: boolean) => Promise<void>;
}

type PublicStatus = 'active' | 'paused' | 'closed';
const defaults = { tablesEnabled:true, kitchenEnabled:true, captainEnabled:true, inventoryEnabled:true, paymentsEnabled:true, deliveryEnabled:true, takeawayEnabled:true };

export const LiveOperationsControlPanel: React.FC<LiveOperationsControlPanelProps> = ({
  isOpen, onClose, restaurant, menuItems, onUpdateRestaurant, onToggleItemAvailability
}) => {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  if (!isOpen) return null;

  const caps = restaurant?.restaurantCapabilities || defaults;
  const onlineOrderingEnabled = restaurant?.onlineOrderingEnabled !== false;
  const publicStatus: PublicStatus = (restaurant?.publicStatus as PublicStatus) || (restaurant?.isActive === false ? 'closed' : 'active');
  const websiteOnline = publicStatus === 'active' && onlineOrderingEnabled;
  const availableCount = menuItems.filter(i => i.isAvailable !== false).length;
  const unavailableCount = menuItems.length - availableCount;

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return menuItems;
    return menuItems.filter(i => i.name.toLowerCase().includes(q) || (i.shortName || '').toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q));
  }, [menuItems, searchQuery]);

  const update = async (key: string, data: Partial<RestaurantFormData>) => {
    setBusyKey(key);
    try { await onUpdateRestaurant(data); } finally { setBusyKey(null); }
  };

  const setStatus = async (status: PublicStatus) => {
    await update('status', { publicStatus: status, onlineOrderingEnabled: status === 'active' });
  };

  const toggleOnline = async () => {
    await update('online', { onlineOrderingEnabled: !onlineOrderingEnabled });
  };

  const toggleCapability = async (key: 'deliveryEnabled' | 'takeawayEnabled') => {
    await update(key, { restaurantCapabilities: { ...caps, [key]: !caps[key] } });
  };

  return (
    <div id="live-operations-control-panel" className="fixed inset-0 z-[70] bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-5xl max-h-[94vh] sm:max-h-[90vh] bg-slate-50 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        <header className="shrink-0 bg-slate-900 text-white px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-400/20 flex items-center justify-center"><Activity className="w-5 h-5 text-emerald-400" /></div>
            <div className="min-w-0"><h2 className="text-base sm:text-lg font-black truncate">Live Restaurant Operations</h2><p className="text-[11px] text-slate-400">Changes publish to the customer website automatically.</p></div>
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-300 hover:text-white"><X className="w-5 h-5" /></button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          <section className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2"><span className={'w-2.5 h-2.5 rounded-full ' + (websiteOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500')} /><h3 className="text-sm font-black text-slate-900">Customer Website Status</h3></div>
                <p className="text-xs text-slate-500 mt-1">{websiteOnline ? 'Customers can place online orders now.' : publicStatus === 'paused' ? 'Menu is visible, but new online orders are paused.' : 'Restaurant is not accepting online orders.'}</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['active','paused','closed'] as PublicStatus[]).map(status => (
                  <button key={status} type="button" disabled={busyKey !== null} onClick={() => setStatus(status)}
                    className={'min-w-[86px] px-3 py-2.5 rounded-xl border text-xs font-black ' + (publicStatus === status ? (status === 'active' ? 'bg-emerald-600 text-white border-emerald-600' : status === 'paused' ? 'bg-amber-500 text-slate-950 border-amber-500' : 'bg-slate-900 text-white border-slate-900') : 'bg-white text-slate-600 border-slate-200')}>
                    {status === 'active' ? 'ONLINE' : status === 'paused' ? 'PAUSED' : 'CLOSED'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <button type="button" disabled={busyKey !== null} onClick={toggleOnline} className={'p-3.5 rounded-2xl border text-left ' + (onlineOrderingEnabled ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200')}>
                <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Globe2 className="w-4 h-4 text-emerald-600" /><span className="text-xs font-black">Accept Online Orders</span></div><span className="text-[10px] font-black">{onlineOrderingEnabled ? 'ON' : 'OFF'}</span></div>
                <p className="text-[11px] text-slate-500 mt-1.5">Master customer ordering switch.</p>
              </button>

              <button type="button" disabled={busyKey !== null} onClick={() => toggleCapability('deliveryEnabled')} className={'p-3.5 rounded-2xl border text-left ' + (caps.deliveryEnabled ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200')}>
                <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Bike className="w-4 h-4 text-blue-600" /><span className="text-xs font-black">Home Delivery</span></div><span className="text-[10px] font-black">{caps.deliveryEnabled ? 'AVAILABLE' : 'OFF'}</span></div>
                <p className="text-[11px] text-slate-500 mt-1.5">Controls the delivery choice for customers.</p>
              </button>

              <button type="button" disabled={busyKey !== null} onClick={() => toggleCapability('takeawayEnabled')} className={'p-3.5 rounded-2xl border text-left ' + (caps.takeawayEnabled ? 'bg-violet-50 border-violet-200' : 'bg-slate-50 border-slate-200')}>
                <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><ShoppingBag className="w-4 h-4 text-violet-600" /><span className="text-xs font-black">Takeaway / Parcel</span></div><span className="text-[10px] font-black">{caps.takeawayEnabled ? 'AVAILABLE' : 'OFF'}</span></div>
                <p className="text-[11px] text-slate-500 mt-1.5">Controls the takeaway choice for customers.</p>
              </button>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="p-4 sm:p-5 border-b border-slate-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div><div className="flex items-center gap-2"><Utensils className="w-4 h-4 text-indigo-600" /><h3 className="text-sm font-black text-slate-900">Live Item Availability</h3></div>
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] font-semibold"><span className="text-emerald-700">{availableCount} available</span><span className="text-slate-300">•</span><span className="text-rose-600">{unavailableCount} unavailable</span></div>
                </div>
                <div className="relative sm:w-72"><Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search item..." className="w-full h-10 pl-9 pr-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-indigo-400" /></div>
              </div>
            </div>
            <div className="max-h-[42vh] overflow-y-auto divide-y divide-slate-100">
              {filteredItems.map(item => {
                const available = item.isAvailable !== false;
                const key = 'item-' + item.itemId;
                return (
                  <div key={item.itemId} className="px-4 sm:px-5 py-3.5 flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 overflow-hidden shrink-0 border border-slate-200">{item.imageUrl ? <img src={item.imageUrl} alt="" className={'w-full h-full object-cover ' + (available ? '' : 'grayscale opacity-60')} /> : <div className="w-full h-full flex items-center justify-center text-slate-400"><Utensils className="w-5 h-5" /></div>}</div>
                    <div className="flex-1 min-w-0"><p className={'text-xs sm:text-sm font-black truncate ' + (available ? 'text-slate-900' : 'text-slate-500')}>{item.name}</p><p className="text-[10px] text-slate-500">{available ? 'Customers can order this item' : 'Unavailable to customers'}</p></div>
                    <button type="button" disabled={busyKey !== null} onClick={async () => { setBusyKey(key); try { await onToggleItemAvailability(item.itemId, !available); } finally { setBusyKey(null); } }} className={'relative w-16 h-9 rounded-full shrink-0 ' + (available ? 'bg-emerald-600' : 'bg-slate-300')} aria-label={(available ? 'Mark unavailable: ' : 'Mark available: ') + item.name}>
                      <span className={'absolute top-1 w-7 h-7 rounded-full bg-white shadow-sm flex items-center justify-center ' + (available ? 'left-8' : 'left-1')}>{available ? <Check className="w-4 h-4 text-emerald-600" /> : <Power className="w-4 h-4 text-slate-400" />}</span>
                    </button>
                  </div>
                );
              })}
              {filteredItems.length === 0 && <div className="p-10 text-center text-slate-500 text-xs">No matching menu items.</div>}
            </div>
          </section>

          <div className="p-3.5 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-900 text-[11px] leading-relaxed"><strong>Live publishing:</strong> restaurant status, online ordering, delivery, takeaway and item availability use the same data consumed by the customer website.</div>
          <div className="text-[10px] text-slate-400 flex items-center gap-1.5"><Clock className="w-3 h-3" /><span>Use PAUSED for a temporary rush; CLOSED when the restaurant is not taking orders.</span></div>
        </div>
      </div>
    </div>
  );
};
