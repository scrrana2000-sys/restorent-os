import React, { useState, useEffect } from 'react';
import {
  User,
  Mail,
  Phone,
  MapPin,
  LogOut,
  Save,
  X,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  Loader2,
  Edit3,
  ShieldCheck,
  ShoppingBag,
  Compass,
  Clock
} from 'lucide-react';
import { useCustomerAuth } from '../../context/CustomerAuthContext';
import { CustomerAddress } from '../../types/customer';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import {
  getTrackedOrders,
  getCustomerOrders,
  getCustomerStatusDetails,
  TrackedOrderReference
} from '../../services/customerOrderTrackingService';
import { formatMoney } from '../../utils/money';

export interface CustomerProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTrackOrder?: (restaurantId: string, orderId: string) => void;
  defaultTab?: 'profile' | 'orders';
}

export const CustomerProfileModal: React.FC<CustomerProfileModalProps> = ({
  isOpen,
  onClose,
  onTrackOrder,
  defaultTab = 'profile'
}) => {
  const {
    customer,
    firebaseUser,
    isSigningIn,
    authError,
    signInWithGoogle,
    signOut,
    updateProfile,
    clearAuthError,
    refreshProfile
  } = useCustomerAuth();

  const currentUid = customer?.customerId || firebaseUser?.uid || null;

  const [activeTab, setActiveTab] = useState<'profile' | 'orders'>(defaultTab);
  const [ordersSubTab, setOrdersSubTab] = useState<'active' | 'history'>('active');
  const [myOrders, setMyOrders] = useState<TrackedOrderReference[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState<boolean>(false);

  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);

  // Profile is a page/modal-scoped read. An existing Firebase session does
  // not trigger Firestore until the customer actually opens their profile.
  useEffect(() => {
    if (!isOpen || !firebaseUser || customer) return;
    refreshProfile().catch((err) => {
      console.warn('[CustomerProfile] Profile refresh warning:', err);
    });
  }, [isOpen, firebaseUser, customer, refreshProfile]);

  // Load orders when modal is open
  useEffect(() => {
    if (!isOpen) return;
    setIsLoadingOrders(true);
    const tracked = getTrackedOrders(currentUid);
    setMyOrders(tracked);

    if (currentUid) {
      getCustomerOrders(currentUid)
        .then((fullOrders) => {
          if (fullOrders && fullOrders.length > 0) {
            const mapped: TrackedOrderReference[] = fullOrders.map((o) => ({
              orderId: o.id,
              restaurantId: o.restaurantId,
              orderNumber: o.orderNumber || o.id,
              restaurantName: o.restaurantId,
              orderType: o.orderType,
              status: o.status,
              grandTotalMinor: o.grandTotalMinor,
              itemCount: o.items?.reduce((s, i) => s + i.quantity, 0) || 0,
              placedAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
              customerId: o.customerId
            }));
            setMyOrders(mapped);
          }
        })
        .catch((err) => console.warn('[CustomerProfile] Orders load warning:', err))
        .finally(() => setIsLoadingOrders(false));
    } else {
      setIsLoadingOrders(false);
    }
  }, [isOpen, currentUid]);

  // New address mini-form state
  const [isAddingAddress, setIsAddingAddress] = useState<boolean>(false);
  const [newLabel, setNewLabel] = useState<'home' | 'work' | 'other'>('home');
  const [newAddressLine, setNewAddressLine] = useState<string>('');
  const [newArea, setNewArea] = useState<string>('');
  const [newCity, setNewCity] = useState<string>('');
  const [newPostalCode, setNewPostalCode] = useState<string>('');

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync state when customer profile changes
  useEffect(() => {
    if (customer) {
      setName(customer.name || '');
      setPhone(customer.phone || '');
      setAddresses(customer.addresses || []);
    } else if (firebaseUser) {
      setName(firebaseUser.displayName || '');
      setPhone(firebaseUser.phoneNumber || '');
      setAddresses([]);
    }
  }, [customer, firebaseUser]);

  // Back button handling
  useModalBackHandler(isOpen, onClose, 'customer-profile-modal');

  if (!isOpen) return null;

  const handleStartEditing = () => {
    clearAuthError();
    setErrorMessage(null);
    setSaveSuccess(false);
    setIsEditing(true);
  };

  const handleCancelEditing = () => {
    if (customer) {
      setName(customer.name || '');
      setPhone(customer.phone || '');
      setAddresses(customer.addresses || []);
    }
    setIsEditing(false);
    setIsAddingAddress(false);
    setErrorMessage(null);
  };

  const handleAddAddress = () => {
    if (!newAddressLine.trim()) {
      setErrorMessage('Please enter an address line.');
      return;
    }
    if (!newCity.trim()) {
      setErrorMessage('Please enter a city.');
      return;
    }

    const newAddr: CustomerAddress = {
      id: `addr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      label: newLabel,
      addressLine: newAddressLine.trim(),
      area: newArea.trim(),
      city: newCity.trim(),
      postalCode: newPostalCode.trim(),
      isDefault: addresses.length === 0
    };

    setAddresses((prev) => [...prev, newAddr]);
    setNewAddressLine('');
    setNewArea('');
    setNewCity('');
    setNewPostalCode('');
    setIsAddingAddress(false);
    setErrorMessage(null);
  };

  const handleRemoveAddress = (id: string) => {
    setAddresses((prev) => prev.filter((a) => a.id !== id));
  };

  const handleSetDefaultAddress = (id: string) => {
    setAddresses((prev) =>
      prev.map((a) => ({
        ...a,
        isDefault: a.id === id
      }))
    );
  };

  const handleSaveProfile = async () => {
    setErrorMessage(null);
    setSaveSuccess(false);

    if (!name.trim()) {
      setErrorMessage('Name cannot be empty.');
      return;
    }

    setIsSaving(true);
    try {
      await updateProfile({
        name: name.trim(),
        phone: phone.trim(),
        addresses
      });
      setSaveSuccess(true);
      setIsEditing(false);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Could not save profile changes.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to sign out.');
    }
  };

  return (
    <div
      id="customer-profile-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        id="customer-profile-modal"
        className="w-full max-w-md bg-white/95 backdrop-blur-xl rounded-3xl border border-white/80 shadow-[0_20px_50px_rgba(0,0,0,0.25)] overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between gap-3 bg-gradient-to-r from-orange-50/50 to-amber-50/30">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-500 text-white flex items-center justify-center shadow-sm">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 id="customer-profile-title" className="text-base font-extrabold text-slate-900 tracking-tight">
                Customer Profile
              </h2>
              <p className="text-[11px] text-slate-500 font-medium">RestaurantOS Customer Account</p>
            </div>
          </div>
          <button
            id="close-profile-modal-btn"
            onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer min-h-[44px] min-w-[44px]"
            aria-label="Close profile modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs (Profile vs My Orders) */}
        <div className="px-4 pt-2.5 pb-2 bg-slate-50 border-b border-slate-200/80 flex gap-2 shrink-0">
          <button
            type="button"
            id="profile-tab-btn"
            onClick={() => setActiveTab('profile')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer min-h-[40px] ${
              activeTab === 'profile'
                ? 'bg-white text-orange-700 shadow-xs border border-orange-200/60'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Profile</span>
          </button>

          <button
            type="button"
            id="profile-my-orders-tab-btn"
            onClick={() => setActiveTab('orders')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer min-h-[40px] ${
              activeTab === 'orders'
                ? 'bg-white text-orange-700 shadow-xs border border-orange-200/60'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>My Orders</span>
            {myOrders.filter(o => o.status !== 'completed' && o.status !== 'served' && o.status !== 'cancelled').length > 0 && (
              <span className="w-4 h-4 rounded-full bg-orange-600 text-white text-[10px] font-extrabold flex items-center justify-center">
                {myOrders.filter(o => o.status !== 'completed' && o.status !== 'served' && o.status !== 'cancelled').length}
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5">
          {activeTab === 'orders' ? (
            /* My Orders Tab Content */
            <div id="profile-my-orders-content" className="space-y-4">
              {/* Active / History sub-toggle */}
              <div className="p-1 bg-slate-100 rounded-xl flex gap-1 text-xs">
                <button
                  type="button"
                  id="profile-orders-active-toggle"
                  onClick={() => setOrdersSubTab('active')}
                  className={`flex-1 py-1.5 rounded-lg font-bold transition-all ${
                    ordersSubTab === 'active'
                      ? 'bg-white text-orange-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Active ({myOrders.filter(o => o.status !== 'completed' && o.status !== 'served' && o.status !== 'cancelled').length})
                </button>
                <button
                  type="button"
                  id="profile-orders-history-toggle"
                  onClick={() => setOrdersSubTab('history')}
                  className={`flex-1 py-1.5 rounded-lg font-bold transition-all ${
                    ordersSubTab === 'history'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Past Orders ({myOrders.filter(o => o.status === 'completed' || o.status === 'served' || o.status === 'cancelled').length})
                </button>
              </div>

              {isLoadingOrders && (
                <div className="py-8 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-6 h-6 text-orange-600 animate-spin" />
                  <span className="text-xs text-slate-500">Loading your orders...</span>
                </div>
              )}

              {!isLoadingOrders && (
                <>
                  {myOrders.filter(o =>
                    ordersSubTab === 'active'
                      ? o.status !== 'completed' && o.status !== 'served' && o.status !== 'cancelled'
                      : o.status === 'completed' || o.status === 'served' || o.status === 'cancelled'
                  ).length === 0 ? (
                    <div id="profile-orders-empty-state" className="py-8 text-center space-y-2">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                        <ShoppingBag className="w-6 h-6" />
                      </div>
                      <h4 className="text-xs font-bold text-slate-800">
                        {ordersSubTab === 'active' ? 'No active orders' : 'No past orders yet'}
                      </h4>
                      <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                        {ordersSubTab === 'active'
                          ? 'When you place an online order, its real-time progress will appear here.'
                          : 'Your completed orders will be listed here.'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {myOrders
                        .filter(o =>
                          ordersSubTab === 'active'
                            ? o.status !== 'completed' && o.status !== 'served' && o.status !== 'cancelled'
                            : o.status === 'completed' || o.status === 'served' || o.status === 'cancelled'
                        )
                        .map(order => {
                          const details = getCustomerStatusDetails(order.status, order.orderType);
                          return (
                            <div
                              key={`${order.restaurantId}-${order.orderId}`}
                              id={`profile-order-card-${order.orderId}`}
                              className="p-3.5 bg-white border border-slate-200/80 rounded-2xl shadow-xs space-y-2.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <span className="font-mono font-extrabold text-xs text-slate-900 block truncate">
                                    #{order.orderNumber}
                                  </span>
                                  <span className="text-[10px] text-slate-400 capitalize">
                                    {order.orderType}
                                  </span>
                                </div>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                    order.status === 'cancelled'
                                      ? 'bg-red-100 text-red-700'
                                      : order.status === 'completed' || order.status === 'served'
                                      ? 'bg-emerald-100 text-emerald-700'
                                      : 'bg-orange-100 text-orange-800'
                                  }`}
                                >
                                  {details.label}
                                </span>
                              </div>

                              <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                                <span className="text-slate-500 font-medium">
                                  {order.itemCount} item{order.itemCount !== 1 ? 's' : ''}
                                </span>
                                <span className="font-mono font-bold text-slate-900">
                                  {formatMoney(order.grandTotalMinor)}
                                </span>
                              </div>

                              <button
                                type="button"
                                id={`profile-track-btn-${order.orderId}`}
                                onClick={() => {
                                  onClose();
                                  if (onTrackOrder) {
                                    onTrackOrder(order.restaurantId, order.orderId);
                                  }
                                }}
                                className="w-full py-2 bg-orange-50 hover:bg-orange-100 text-orange-800 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <Compass className="w-3.5 h-3.5 text-orange-600" />
                                <span>Track Order</span>
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            /* Existing Profile Tab Content */
            <>
          {/* Notification Messages */}
          {saveSuccess && (
            <div
              id="profile-save-success-msg"
              className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-2 text-emerald-800 text-xs font-semibold animate-in fade-in"
            >
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Profile saved successfully!</span>
            </div>
          )}

          {(errorMessage || authError) && (
            <div
              id="profile-error-msg"
              className="p-3 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-2 text-red-800 text-xs font-semibold animate-in fade-in"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{errorMessage || authError}</span>
            </div>
          )}

          {/* Not Signed In View */}
          {!customer && !firebaseUser && (
            <div id="customer-not-signed-in" className="text-center py-6 space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-orange-100 text-orange-600 flex items-center justify-center mx-auto shadow-inner">
                <User className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">Sign in with Google</h3>
                <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                  Sign in to save your name, phone number, and delivery addresses for quick checkout on future orders.
                </p>
              </div>

              <button
                id="google-signin-btn"
                onClick={() => signInWithGoogle()}
                disabled={isSigningIn}
                className="w-full px-5 py-3.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-2xl shadow-md transition-all flex items-center justify-center gap-3 cursor-pointer min-h-[48px] disabled:opacity-50"
              >
                {isSigningIn ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Signing in with Google...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    <span>Continue with Google</span>
                  </>
                )}
              </button>

              <div className="pt-2 text-[11px] text-slate-400">
                <span>Guest checkout is always supported. You do not have to sign in to place an order.</span>
              </div>
            </div>
          )}

          {/* Signed In Profile View */}
          {(customer || firebaseUser) && (
            <div id="customer-signed-in-profile" className="space-y-5">
              {/* Profile Card Summary */}
              <div className="flex items-center gap-3.5 p-3.5 bg-slate-50/80 rounded-2xl border border-slate-200/70">
                <div className="w-13 h-13 rounded-2xl overflow-hidden bg-orange-100 border border-white shadow-xs shrink-0 flex items-center justify-center">
                  {customer?.photoURL || firebaseUser?.photoURL ? (
                    <img
                      src={customer?.photoURL || firebaseUser?.photoURL || ''}
                      alt={customer?.name || 'Customer'}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-lg font-extrabold text-orange-600 uppercase">
                      {(customer?.name || firebaseUser?.displayName || 'C')[0]}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 id="customer-profile-name-display" className="text-sm font-extrabold text-slate-900 truncate">
                      {customer?.name || firebaseUser?.displayName || 'Customer'}
                    </h3>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                      <ShieldCheck className="w-3 h-3" />
                      Google
                    </span>
                  </div>
                  <p id="customer-profile-email-display" className="text-xs text-slate-500 truncate mt-0.5">
                    {customer?.email || firebaseUser?.email || ''}
                  </p>
                </div>
              </div>

              {/* View / Edit Mode */}
              {!isEditing ? (
                <div className="space-y-4">
                  {/* Info Grid */}
                  <div className="space-y-2.5">
                    <div className="p-3 bg-white rounded-xl border border-slate-200/80 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Phone className="w-4 h-4 text-slate-400" />
                        <div>
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                            Phone Number
                          </span>
                          <span id="customer-phone-display" className="text-xs font-bold text-slate-800">
                            {customer?.phone ? customer.phone : 'Not provided yet'}
                          </span>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full font-medium">
                        No OTP
                      </span>
                    </div>

                    {/* Addresses count */}
                    <div className="p-3 bg-white rounded-xl border border-slate-200/80 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <MapPin className="w-4 h-4 text-slate-400" />
                        <div>
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                            Saved Addresses
                          </span>
                          <span id="customer-addresses-count" className="text-xs font-bold text-slate-800">
                            {addresses.length > 0 ? `${addresses.length} saved address(es)` : 'None saved yet'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Saved Addresses list preview */}
                  {addresses.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-xs font-bold text-slate-700 block">Delivery Addresses:</span>
                      <div className="space-y-2">
                        {addresses.map((addr) => (
                          <div
                            key={addr.id}
                            className="p-3 rounded-xl border border-slate-200 bg-white text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-800 capitalize flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-orange-500" />
                                {addr.label}
                                {addr.isDefault && (
                                  <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.2 rounded font-semibold">
                                    Default
                                  </span>
                                )}
                              </span>
                            </div>
                            <p className="text-slate-600">{addr.addressLine}</p>
                            <p className="text-slate-400 text-[11px]">
                              {[addr.area, addr.city, addr.postalCode].filter(Boolean).join(', ')}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="pt-2 flex flex-col gap-2">
                    <button
                      id="edit-profile-btn"
                      onClick={handleStartEditing}
                      className="w-full px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer min-h-[44px]"
                    >
                      <Edit3 className="w-4 h-4" />
                      <span>Edit Profile & Addresses</span>
                    </button>

                    <button
                      id="customer-signout-btn"
                      onClick={handleSignOut}
                      className="w-full px-4 py-2.5 bg-slate-100 hover:bg-red-50 text-slate-700 hover:text-red-700 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer min-h-[44px]"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Edit Mode Form */
                <div id="customer-profile-edit-form" className="space-y-4">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">Full Name</label>
                    <input
                      id="edit-customer-name-input"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your Full Name"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 min-h-[44px]"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">
                      Phone Number (Optional)
                    </label>
                    <input
                      id="edit-customer-phone-input"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="e.g. 9876543210"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 min-h-[44px]"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      Used for delivery contact. Standard profile field only — NO OTP required.
                    </p>
                  </div>

                  {/* Addresses Management */}
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-800">Saved Addresses</label>
                      {!isAddingAddress && (
                        <button
                          id="add-address-toggle-btn"
                          type="button"
                          onClick={() => setIsAddingAddress(true)}
                          className="text-[11px] font-bold text-orange-600 hover:text-orange-700 flex items-center gap-1 cursor-pointer py-1 px-2"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add Address</span>
                        </button>
                      )}
                    </div>

                    {/* Address List */}
                    {addresses.map((addr) => (
                      <div
                        key={addr.id}
                        className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs flex items-start justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-800 capitalize">{addr.label}</span>
                            {addr.isDefault ? (
                              <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.2 rounded font-semibold">
                                Default
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSetDefaultAddress(addr.id)}
                                className="text-[10px] text-slate-500 hover:text-orange-600 underline cursor-pointer"
                              >
                                Set default
                              </button>
                            )}
                          </div>
                          <p className="text-slate-600 truncate mt-0.5">{addr.addressLine}</p>
                          <p className="text-slate-400 text-[11px]">
                            {[addr.area, addr.city, addr.postalCode].filter(Boolean).join(', ')}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveAddress(addr.id)}
                          className="text-slate-400 hover:text-red-600 p-1 cursor-pointer"
                          aria-label="Remove address"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}

                    {/* Add Address Mini-Form */}
                    {isAddingAddress && (
                      <div className="p-3 bg-orange-50/60 border border-orange-200 rounded-xl space-y-2.5 animate-in fade-in">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-orange-900">New Address</span>
                          <div className="flex items-center gap-1">
                            {(['home', 'work', 'other'] as const).map((lbl) => (
                              <button
                                key={lbl}
                                type="button"
                                onClick={() => setNewLabel(lbl)}
                                className={`px-2 py-0.5 text-[10px] font-bold rounded capitalize cursor-pointer ${
                                  newLabel === lbl
                                    ? 'bg-orange-600 text-white'
                                    : 'bg-white text-slate-600 border border-slate-200'
                                }`}
                              >
                                {lbl}
                              </button>
                            ))}
                          </div>
                        </div>

                        <input
                          type="text"
                          value={newAddressLine}
                          onChange={(e) => setNewAddressLine(e.target.value)}
                          placeholder="Flat / House / Building / Street *"
                          className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:border-orange-500 min-h-[38px]"
                        />

                        <div className="grid grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={newArea}
                            onChange={(e) => setNewArea(e.target.value)}
                            placeholder="Area / Locality"
                            className="px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:border-orange-500 min-h-[38px]"
                          />
                          <input
                            type="text"
                            value={newCity}
                            onChange={(e) => setNewCity(e.target.value)}
                            placeholder="City *"
                            className="px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:border-orange-500 min-h-[38px]"
                          />
                          <input
                            type="text"
                            value={newPostalCode}
                            onChange={(e) => setNewPostalCode(e.target.value)}
                            placeholder="PIN code"
                            className="px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:border-orange-500 min-h-[38px]"
                          />
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setIsAddingAddress(false)}
                            className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 cursor-pointer font-medium"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleAddAddress}
                            className="px-3.5 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-lg cursor-pointer shadow-xs"
                          >
                            Save Address
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Form Actions */}
                  <div className="pt-3 flex items-center gap-2 border-t border-slate-100">
                    <button
                      id="save-profile-btn"
                      type="button"
                      onClick={handleSaveProfile}
                      disabled={isSaving}
                      className="flex-1 px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer min-h-[44px] disabled:opacity-50"
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          <span>Save Changes</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleCancelEditing}
                      disabled={isSaving}
                      className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer min-h-[44px]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
};
