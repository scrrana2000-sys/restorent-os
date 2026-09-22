import React, { useEffect, useState } from 'react';
import { X, User, Phone, Search, History, CheckCircle2, Loader2 } from 'lucide-react';
import { CustomerSnapshot } from '../../types/order';
import { RestaurantCustomerService } from '../../services/restaurantCustomerService';

interface CustomerBillingModalProps {
  isOpen: boolean;
  onClose: () => void;
  restaurantId: string;
  initialCustomer?: CustomerSnapshot | null;
  onSelectCustomer: (customer: CustomerSnapshot) => void;
}

const customerService = new RestaurantCustomerService();

export const CustomerBillingModal: React.FC<CustomerBillingModalProps> = ({
  isOpen,
  onClose,
  restaurantId,
  initialCustomer,
  onSelectCustomer
}) => {
  const [name, setName] = useState(initialCustomer?.name || '');
  const [phone, setPhone] = useState(initialCustomer?.phone || '');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [history, setHistory] = useState<{
    name: string;
    phone: string | null;
    orderCount: number;
    totalSpendMinor: number;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(initialCustomer?.name || '');
    setPhone(initialCustomer?.phone || '');
    setLookupError(null);
    setHistory(null);
  }, [isOpen, initialCustomer]);

  if (!isOpen) return null;

  const normalizedPhone = phone.replace(/\D/g, '').slice(-10);
  const canLookup = normalizedPhone.length === 10;

  const lookupCustomer = async () => {
    if (!canLookup || !restaurantId) return;
    setLookupLoading(true);
    setLookupError(null);
    try {
      const customer = await customerService.findCustomerByPhone(restaurantId, normalizedPhone);
      if (customer) {
        setName(customer.name || name);
        setPhone(customer.phone || normalizedPhone);
        setHistory({
          name: customer.name,
          phone: customer.phone || normalizedPhone,
          orderCount: customer.orderCount,
          totalSpendMinor: customer.totalSpendMinor
        });
      } else {
        setHistory(null);
      }
    } catch (err: any) {
      setLookupError(err?.message || 'Customer history lookup failed.');
    } finally {
      setLookupLoading(false);
    }
  };

  const handleContinue = () => {
    if (!name.trim() && !normalizedPhone) {
      setLookupError('Enter customer name or mobile number, or continue as Guest.');
      return;
    }
    onSelectCustomer({
      name: name.trim() || 'Customer',
      phone: normalizedPhone || undefined
    });
    onClose();
  };

  const handleGuest = () => {
    onSelectCustomer({});
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden border border-slate-200">
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 flex items-center justify-center">
              <User className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <h3 className="text-sm font-black">Customer for this Bill</h3>
              <p className="text-[11px] text-slate-400">Save name + mobile for future history</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-xl hover:bg-white/10 flex items-center justify-center">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3.5">
          <div>
            <label className="text-[11px] font-bold text-slate-700 mb-1.5 block">Customer Mobile Number</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="billing-customer-phone"
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
                    setHistory(null);
                    setLookupError(null);
                  }}
                  placeholder="10-digit mobile"
                  className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-300 bg-white text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="button"
                onClick={lookupCustomer}
                disabled={!canLookup || lookupLoading}
                className="h-11 px-3 rounded-xl bg-indigo-600 text-white font-bold text-xs disabled:opacity-40 flex items-center gap-1.5"
              >
                {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Find
              </button>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-700 mb-1.5 block">Customer Name</label>
            <input
              id="billing-customer-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter customer name"
              className="w-full h-11 px-3 rounded-xl border border-slate-300 bg-white text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {history && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <div className="flex items-center gap-2 text-emerald-800">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-xs font-black">Existing customer found</span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-emerald-900">
                <History className="w-3.5 h-3.5" />
                <span>{history.orderCount} previous order{history.orderCount === 1 ? '' : 's'} found</span>
              </div>
              <p className="text-[11px] text-emerald-800 mt-1">
                Future bills using this mobile will continue the same restaurant history.
              </p>
            </div>
          )}

          {lookupError && (
            <p className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-2.5">
              {lookupError}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={handleGuest} className="flex-1 h-11 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs border border-slate-200">
              Continue as Guest
            </button>
            <button type="button" onClick={handleContinue} className="flex-1 h-11 rounded-xl bg-indigo-600 text-white font-black text-xs shadow-md">
              Save Customer & Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
