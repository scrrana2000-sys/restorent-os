import React, { useState, useEffect, useRef } from 'react';
import {
  ShoppingBag,
  X,
  ArrowLeft,
  Check,
  AlertTriangle,
  MapPin,
  Phone,
  User,
  CreditCard,
  QrCode,
  Banknote,
  Truck,
  ShoppingBag as TakeawayIcon,
  ShieldCheck,
  Info,
  Edit2,
  ChevronRight,
  FileText,
  Loader2,
  CheckCircle2,
  Lock
} from 'lucide-react';
import { useCustomerCart } from '../../context/CustomerCartContext';
import {
  PublicRestaurantProfile,
  CustomerCheckoutDetails,
  CustomerDeliveryDetails,
  CustomerCheckoutIntent,
  PaymentMethod
} from '../../types/customer';
import { MenuItem } from '../../types/menu';
import {
  validateCustomerCheckout,
  createCustomerCheckoutIntent,
  submitCustomerOnlineOrder,
  CheckoutValidationResult
} from '../../services/customerCheckoutService';
import { FoodTypeBadge } from './FoodTypeBadge';
import { useModalBackHandler } from '../../hooks/useModalBackHandler';
import { Order } from '../../types/order';
import { KOT } from '../../types/kot';

export interface CustomerCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  restaurantProfile?: PublicRestaurantProfile | null;
  menuItems?: MenuItem[];
  onProceedToSubmitIntent?: (intent: CustomerCheckoutIntent) => void;
  onOrderSubmitted?: (order: Order, kot: KOT | null) => void;
  onEditCart?: () => void;
  initialCustomerDetails?: Partial<CustomerCheckoutDetails>;
  initialDeliveryDetails?: Partial<CustomerDeliveryDetails>;
}

export const CustomerCheckoutModal: React.FC<CustomerCheckoutModalProps> = ({
  isOpen,
  onClose,
  restaurantProfile,
  menuItems,
  onProceedToSubmitIntent,
  onOrderSubmitted,
  onEditCart,
  initialCustomerDetails,
  initialDeliveryDetails
}) => {
  const { cart, clearCart } = useCustomerCart();

  // Mode state: 'form' | 'review' | 'intent_created' | 'order_submitted'
  const [currentStep, setCurrentStep] = useState<'form' | 'review' | 'intent_created' | 'order_submitted'>('form');

  // Form states
  const [orderType, setOrderType] = useState<'takeaway' | 'delivery' | 'dineIn'>('takeaway');

  const [customerDetails, setCustomerDetails] = useState<CustomerCheckoutDetails>({
    name: initialCustomerDetails?.name || '',
    phone: initialCustomerDetails?.phone || ''
  });

  const [deliveryDetails, setDeliveryDetails] = useState<CustomerDeliveryDetails>({
    recipientName: initialDeliveryDetails?.recipientName || initialCustomerDetails?.name || '',
    phone: initialDeliveryDetails?.phone || initialCustomerDetails?.phone || '',
    addressLine: initialDeliveryDetails?.addressLine || '',
    area: initialDeliveryDetails?.area || restaurantProfile?.area || '',
    city: initialDeliveryDetails?.city || restaurantProfile?.city || '',
    state: initialDeliveryDetails?.state || restaurantProfile?.state || '',
    postalCode: initialDeliveryDetails?.postalCode || '',
    deliveryInstructions: initialDeliveryDetails?.deliveryInstructions || ''
  });

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [validationResult, setValidationResult] = useState<CheckoutValidationResult | null>(null);
  const [createdIntent, setCreatedIntent] = useState<CustomerCheckoutIntent | null>(null);

  // Submission States
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedOrder, setSubmittedOrder] = useState<Order | null>(null);
  const [submittedKot, setSubmittedKot] = useState<KOT | null>(null);

  const idempotencyKeyRef = useRef<string>(
    `chk_${cart?.restaurantId || 'guest'}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  );

  // Auto-set available order type on load
  useEffect(() => {
    if (restaurantProfile) {
      if (restaurantProfile.takeawayEnabled !== false) {
        setOrderType('takeaway');
      } else if (restaurantProfile.deliveryEnabled === true) {
        setOrderType('delivery');
      }
    }
  }, [restaurantProfile]);

  // Handle modal back navigation
  useModalBackHandler(isOpen, onClose, 'customer-checkout-modal');

  if (!isOpen) return null;

  const currencySymbol = cart?.currencySymbol || restaurantProfile?.currencySymbol || '₹';

  // Availability flags
  const isTakeawaySupported = restaurantProfile ? restaurantProfile.takeawayEnabled !== false : true;
  const isDeliverySupported = restaurantProfile ? restaurantProfile.deliveryEnabled === true : true;

  const handleValidateForm = (): boolean => {
    const input = {
      cart,
      restaurantProfile,
      menuItems,
      orderType,
      customerDetails,
      deliveryDetails: orderType === 'delivery' ? deliveryDetails : undefined,
      paymentMethod
    };

    const res = validateCustomerCheckout(input);
    setValidationResult(res);
    return res.isValid;
  };

  const handleProceedToReview = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (handleValidateForm()) {
      setSubmitError(null);
      setCurrentStep('review');
    }
  };

  const handleGenerateIntent = () => {
    const input = {
      cart,
      restaurantProfile,
      menuItems,
      orderType,
      customerDetails,
      deliveryDetails: orderType === 'delivery' ? deliveryDetails : undefined,
      paymentMethod
    };

    try {
      const intent = createCustomerCheckoutIntent(input, idempotencyKeyRef.current);
      setCreatedIntent(intent);
      setCurrentStep('intent_created');

      if (onProceedToSubmitIntent) {
        onProceedToSubmitIntent(intent);
      }
    } catch (err: any) {
      setValidationResult({
        isValid: false,
        errors: { general: err.message || 'Validation failed.' },
        issues: [err.message || 'Validation failed.']
      });
    }
  };

  const handleSubmitOrder = async () => {
    if (!handleValidateForm()) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const input = {
      cart,
      restaurantProfile,
      menuItems,
      orderType,
      customerDetails,
      deliveryDetails: orderType === 'delivery' ? deliveryDetails : undefined,
      paymentMethod
    };

    try {
      const intent = createCustomerCheckoutIntent(input, idempotencyKeyRef.current);
      setCreatedIntent(intent);

      const res = await submitCustomerOnlineOrder({
        intent,
        restaurantProfile,
        menuItems
      });

      setSubmittedOrder(res.order);
      setSubmittedKot(res.kot);
      setCurrentStep('order_submitted');

      // Clear customer cart upon canonical success
      clearCart();

      if (onOrderSubmitted) {
        onOrderSubmitted(res.order, res.kot);
      }
      if (onProceedToSubmitIntent) {
        onProceedToSubmitIntent(intent);
      }
    } catch (err: any) {
      console.warn('[RestaurantOS] Online order submission error:', err);
      setSubmitError(err.message || 'Failed to submit online order. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="customer-checkout-modal-overlay"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex justify-end sm:items-center sm:justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        id="customer-checkout-modal"
        className="w-full max-w-lg bg-white h-full sm:h-auto sm:max-h-[90vh] sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom sm:slide-in-from-bottom-0 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/90 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            {currentStep === 'review' ? (
              <button
                id="back-to-form-btn"
                onClick={() => setCurrentStep('form')}
                className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 rounded-xl transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Back to details"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            ) : (
              <div className="w-10 h-10 rounded-2xl bg-orange-600 text-white flex items-center justify-center font-bold shadow-xs">
                <ShoppingBag className="w-5 h-5" />
              </div>
            )}
            <div>
              <h2 id="checkout-modal-title" className="text-base font-extrabold text-slate-900 tracking-tight">
                {currentStep === 'review'
                  ? 'Review Your Order'
                  : currentStep === 'order_submitted'
                  ? 'Order Placed!'
                  : currentStep === 'intent_created'
                  ? 'Order Boundary Ready'
                  : 'Customer Checkout'}
              </h2>
              {cart && (
                <p id="checkout-restaurant-name" className="text-xs text-slate-500 font-medium truncate max-w-[240px]">
                  {cart.restaurantName}
                </p>
              )}
            </div>
          </div>

          <button
            id="close-checkout-modal-btn"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-xl transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Close checkout"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Validation Errors Summary Bar */}
        {validationResult && !validationResult.isValid && (
          <div
            id="checkout-validation-error-summary"
            className="p-4 bg-red-50 border-b border-red-200 text-xs text-red-900 space-y-1.5 shrink-0"
          >
            <div className="flex items-center gap-2 font-bold text-red-800">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>Please resolve the following before continuing:</span>
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-[11px] text-red-700 pl-1">
              {validationResult.issues.map((issue, idx) => (
                <li key={idx}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Submission Error Alert */}
        {submitError && (
          <div id="checkout-submit-error-banner" className="p-4 bg-red-50 border-b border-red-200 text-xs text-red-900 flex items-center gap-2 shrink-0">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span className="font-medium">{submitError}</span>
          </div>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* STEP 1: FORM INPUTS */}
          {currentStep === 'form' && (
            <form onSubmit={handleProceedToReview} className="space-y-6">
              {/* 1. Order Type Selection */}
              <div className="space-y-2.5">
                <label className="block text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                  Order Type
                </label>

                <div className="grid grid-cols-2 gap-3">
                  {/* Takeaway Option */}
                  <button
                    type="button"
                    id="checkout-order-type-takeaway"
                    disabled={!isTakeawaySupported}
                    onClick={() => setOrderType('takeaway')}
                    className={`p-3.5 rounded-2xl border text-left flex items-center gap-3 transition-all min-h-[52px] ${
                      orderType === 'takeaway'
                        ? 'border-orange-600 bg-orange-50/60 text-orange-900 shadow-xs'
                        : !isTakeawaySupported
                        ? 'border-slate-200 bg-slate-100 text-slate-400 opacity-60 cursor-not-allowed'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        orderType === 'takeaway' ? 'bg-orange-600 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <TakeawayIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <span className="block text-xs font-bold text-slate-900">Takeaway</span>
                      <span className="block text-[10px] text-slate-500">Pick up at restaurant</span>
                    </div>
                  </button>

                  {/* Delivery Option */}
                  <button
                    type="button"
                    id="checkout-order-type-delivery"
                    disabled={!isDeliverySupported}
                    onClick={() => setOrderType('delivery')}
                    className={`p-3.5 rounded-2xl border text-left flex items-center gap-3 transition-all min-h-[52px] ${
                      orderType === 'delivery'
                        ? 'border-orange-600 bg-orange-50/60 text-orange-900 shadow-xs'
                        : !isDeliverySupported
                        ? 'border-slate-200 bg-slate-100 text-slate-400 opacity-60 cursor-not-allowed'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        orderType === 'delivery' ? 'bg-orange-600 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <Truck className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <span className="block text-xs font-bold text-slate-900">Delivery</span>
                      <span className="block text-[10px] text-slate-500">Deliver to door</span>
                    </div>
                  </button>
                </div>

                {!isTakeawaySupported && !isDeliverySupported && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs">
                    This restaurant is currently not accepting online takeaway or delivery orders.
                  </div>
                )}
              </div>

              {/* 2. Customer Contact Details */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <label className="block text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                  Customer Contact Details
                </label>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="checkout-customer-name" className="block text-[11px] font-bold text-slate-700 mb-1">
                      Full Name *
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        id="checkout-customer-name"
                        type="text"
                        required
                        value={customerDetails.name}
                        onChange={(e) => setCustomerDetails({ ...customerDetails, name: e.target.value })}
                        placeholder="e.g. Rahul Sharma"
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 focus:border-orange-500 focus:bg-white rounded-xl text-xs text-slate-900 font-medium transition-colors outline-hidden min-h-[44px]"
                      />
                    </div>
                    {validationResult?.errors.customerName && (
                      <p className="mt-1 text-[11px] text-red-600 font-medium">
                        {validationResult.errors.customerName}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="checkout-customer-phone" className="block text-[11px] font-bold text-slate-700 mb-1">
                      Mobile Number *
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        id="checkout-customer-phone"
                        type="tel"
                        required
                        value={customerDetails.phone}
                        onChange={(e) => setCustomerDetails({ ...customerDetails, phone: e.target.value })}
                        placeholder="e.g. 9876543210"
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 focus:border-orange-500 focus:bg-white rounded-xl text-xs text-slate-900 font-medium transition-colors outline-hidden min-h-[44px]"
                      />
                    </div>
                    {validationResult?.errors.customerPhone && (
                      <p className="mt-1 text-[11px] text-red-600 font-medium">
                        {validationResult.errors.customerPhone}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* 3. Delivery Details (Conditionally Displayed ONLY for delivery) */}
              {orderType === 'delivery' && (
                <div id="delivery-address-section" className="space-y-3 pt-3 border-t border-slate-100 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                      Delivery Address
                    </label>
                    <span className="text-[10px] text-orange-600 font-bold bg-orange-50 px-2 py-0.5 rounded-md">
                      Required for Delivery
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label htmlFor="checkout-delivery-address" className="block text-[11px] font-bold text-slate-700 mb-1">
                        Street Address / House No. *
                      </label>
                      <div className="relative">
                        <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                        <textarea
                          id="checkout-delivery-address"
                          rows={2}
                          required
                          value={deliveryDetails.addressLine}
                          onChange={(e) => setDeliveryDetails({ ...deliveryDetails, addressLine: e.target.value })}
                          placeholder="e.g. Flat 304, Green Heights, 4th Main Road"
                          className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 focus:border-orange-500 focus:bg-white rounded-xl text-xs text-slate-900 font-medium transition-colors outline-hidden"
                        />
                      </div>
                      {validationResult?.errors.deliveryAddressLine && (
                        <p className="mt-1 text-[11px] text-red-600 font-medium">
                          {validationResult.errors.deliveryAddressLine}
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="checkout-delivery-area" className="block text-[11px] font-bold text-slate-700 mb-1">
                          Area / Locality *
                        </label>
                        <input
                          id="checkout-delivery-area"
                          type="text"
                          required
                          value={deliveryDetails.area}
                          onChange={(e) => setDeliveryDetails({ ...deliveryDetails, area: e.target.value })}
                          placeholder="e.g. Koramangala"
                          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 focus:border-orange-500 focus:bg-white rounded-xl text-xs text-slate-900 font-medium transition-colors outline-hidden min-h-[44px]"
                        />
                        {validationResult?.errors.deliveryArea && (
                          <p className="mt-1 text-[11px] text-red-600 font-medium">
                            {validationResult.errors.deliveryArea}
                          </p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="checkout-delivery-city" className="block text-[11px] font-bold text-slate-700 mb-1">
                          City *
                        </label>
                        <input
                          id="checkout-delivery-city"
                          type="text"
                          required
                          value={deliveryDetails.city}
                          onChange={(e) => setDeliveryDetails({ ...deliveryDetails, city: e.target.value })}
                          placeholder="e.g. Bengaluru"
                          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 focus:border-orange-500 focus:bg-white rounded-xl text-xs text-slate-900 font-medium transition-colors outline-hidden min-h-[44px]"
                        />
                        {validationResult?.errors.deliveryCity && (
                          <p className="mt-1 text-[11px] text-red-600 font-medium">
                            {validationResult.errors.deliveryCity}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="checkout-delivery-postal-code" className="block text-[11px] font-bold text-slate-700 mb-1">
                          Postal Code *
                        </label>
                        <input
                          id="checkout-delivery-postal-code"
                          type="text"
                          required
                          value={deliveryDetails.postalCode}
                          onChange={(e) => setDeliveryDetails({ ...deliveryDetails, postalCode: e.target.value })}
                          placeholder="e.g. 560034"
                          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 focus:border-orange-500 focus:bg-white rounded-xl text-xs text-slate-900 font-medium transition-colors outline-hidden min-h-[44px]"
                        />
                        {validationResult?.errors.deliveryPostalCode && (
                          <p className="mt-1 text-[11px] text-red-600 font-medium">
                            {validationResult.errors.deliveryPostalCode}
                          </p>
                        )}
                      </div>

                      <div>
                        <label htmlFor="checkout-delivery-state" className="block text-[11px] font-bold text-slate-700 mb-1">
                          State (Optional)
                        </label>
                        <input
                          id="checkout-delivery-state"
                          type="text"
                          value={deliveryDetails.state || ''}
                          onChange={(e) => setDeliveryDetails({ ...deliveryDetails, state: e.target.value })}
                          placeholder="e.g. Karnataka"
                          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 focus:border-orange-500 focus:bg-white rounded-xl text-xs text-slate-900 font-medium transition-colors outline-hidden min-h-[44px]"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="checkout-delivery-instructions" className="block text-[11px] font-bold text-slate-700 mb-1">
                        Delivery Instructions (Optional)
                      </label>
                      <input
                        id="checkout-delivery-instructions"
                        type="text"
                        value={deliveryDetails.deliveryInstructions || ''}
                        onChange={(e) => setDeliveryDetails({ ...deliveryDetails, deliveryInstructions: e.target.value })}
                        placeholder="e.g. Leave at gate, don't ring doorbell"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 focus:border-orange-500 focus:bg-white rounded-xl text-xs text-slate-900 font-medium transition-colors outline-hidden min-h-[40px]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* 4. Payment Method Selection */}
              <div className="space-y-3 pt-3 border-t border-slate-100">
                <label className="block text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                  Payment Method
                </label>

                <div className="space-y-2">
                  {/* UPI */}
                  <button
                    type="button"
                    id="checkout-payment-upi"
                    disabled={true}
                    className="w-full p-3 rounded-2xl border border-slate-100 bg-slate-50/60 text-slate-400 text-left flex items-center justify-between transition-all min-h-[48px] opacity-65 cursor-not-allowed"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center shrink-0">
                        <QrCode className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold block text-slate-400">UPI / QR Code</span>
                          <span className="px-1.5 py-0.5 bg-slate-200/80 text-slate-500 text-[8px] font-extrabold uppercase tracking-wider rounded-md">Coming soon</span>
                        </div>
                        <span className="text-[10px] text-slate-400">Google Pay, PhonePe, Paytm</span>
                      </div>
                    </div>
                    <Lock className="w-4 h-4 text-slate-400" />
                  </button>

                  {/* Card */}
                  <button
                    type="button"
                    id="checkout-payment-card"
                    disabled={true}
                    className="w-full p-3 rounded-2xl border border-slate-100 bg-slate-50/60 text-slate-400 text-left flex items-center justify-between transition-all min-h-[48px] opacity-65 cursor-not-allowed"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center shrink-0">
                        <CreditCard className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold block text-slate-400">Credit / Debit Card</span>
                          <span className="px-1.5 py-0.5 bg-slate-200/80 text-slate-500 text-[8px] font-extrabold uppercase tracking-wider rounded-md">Coming soon</span>
                        </div>
                        <span className="text-[10px] text-slate-400">Visa, Mastercard, RuPay</span>
                      </div>
                    </div>
                    <Lock className="w-4 h-4 text-slate-400" />
                  </button>

                  {/* Cash */}
                  <button
                    type="button"
                    id="checkout-payment-cash"
                    onClick={() => setPaymentMethod('cash')}
                    className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between transition-all min-h-[48px] ${
                      paymentMethod === 'cash'
                        ? 'border-emerald-600 bg-emerald-50/50 text-emerald-950 shadow-2xs font-bold'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                        <Banknote className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold block text-slate-900">
                            {orderType === 'delivery' ? 'Cash on Delivery' : 'Pay at Counter'}
                          </span>
                          <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[8px] font-extrabold uppercase tracking-wider rounded-md">Active</span>
                        </div>
                        <span className="text-[10px] text-slate-500">Pay when receiving order</span>
                      </div>
                    </div>
                    {paymentMethod === 'cash' && <Check className="w-4 h-4 text-emerald-600" />}
                  </button>
                </div>
              </div>

              {/* Security & Financial Authoritative Disclaimer */}
              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-2xl text-[11px] text-slate-500 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Displayed prices and subtotal are client review estimates. Final authoritative totals, taxes, and payment status are calculated securely upon order submission.
                </span>
              </div>
            </form>
          )}

          {/* STEP 2: FINAL REVIEW ORDER */}
          {currentStep === 'review' && (
            <div id="checkout-review-summary-view" className="space-y-5 animate-in fade-in duration-150">
              {/* Order Overview Card */}
              <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">Restaurant</span>
                  <span className="text-xs font-extrabold text-slate-900">{cart?.restaurantName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">Order Type</span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-orange-100 text-orange-800 text-xs font-bold rounded-lg capitalize">
                    {orderType === 'takeaway' ? <TakeawayIcon className="w-3.5 h-3.5" /> : <Truck className="w-3.5 h-3.5" />}
                    {orderType}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">Customer Name</span>
                  <span className="text-xs font-bold text-slate-900">{customerDetails.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">Phone</span>
                  <span className="text-xs font-mono font-bold text-slate-900">{customerDetails.phone}</span>
                </div>
                {orderType === 'delivery' && deliveryDetails && (
                  <div className="pt-2 border-t border-slate-200/60 space-y-1">
                    <span className="text-xs font-bold text-slate-500 block">Delivery Address</span>
                    <p className="text-xs text-slate-800 font-medium leading-relaxed">
                      {deliveryDetails.addressLine}, {deliveryDetails.area}, {deliveryDetails.city}{' '}
                      {deliveryDetails.postalCode}
                    </p>
                    {deliveryDetails.deliveryInstructions && (
                      <p className="text-[11px] text-slate-500 italic">
                        Instruction: "{deliveryDetails.deliveryInstructions}"
                      </p>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between pt-2 border-t border-slate-200/60">
                  <span className="text-xs font-bold text-slate-500">Payment Method</span>
                  <span className="text-xs font-bold uppercase text-slate-900">{paymentMethod}</span>
                </div>
              </div>

              {/* Items Summary list */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">
                    Cart Items ({cart?.itemCount || 0})
                  </h4>
                  {onEditCart && (
                    <button
                      type="button"
                      id="edit-cart-from-checkout-btn"
                      onClick={() => {
                        onClose();
                        onEditCart();
                      }}
                      className="text-xs text-orange-600 font-bold hover:underline flex items-center gap-1"
                    >
                      <Edit2 className="w-3 h-3" />
                      Edit Cart
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {cart?.items.map((item) => (
                    <div
                      key={item.cartItemId}
                      id={`review-cart-item-${item.cartItemId}`}
                      className="p-3 bg-white border border-slate-200/80 rounded-2xl flex items-center justify-between text-xs"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        {item.foodType && <FoodTypeBadge foodType={item.foodType} size="sm" className="mt-0.5" />}
                        <div className="min-w-0">
                          <span className="font-bold text-slate-900 block truncate">{item.name}</span>
                          {item.selectedVariantName && (
                            <span className="text-[10px] text-slate-500 block">Option: {item.selectedVariantName}</span>
                          )}
                          {item.selectedAddons && item.selectedAddons.length > 0 && (
                            <span className="text-[10px] text-slate-500 block truncate">
                              Addons: {item.selectedAddons.map((a) => a.name).join(', ')}
                            </span>
                          )}
                          <span className="text-[11px] font-mono text-slate-500">Qty: {item.quantity}</span>
                        </div>
                      </div>

                      <div className="font-mono font-extrabold text-slate-900 shrink-0">
                        {currencySymbol}
                        {((item.price * item.quantity) / 100).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Estimated Totals Summary */}
              <div className="p-4 bg-orange-50/60 border border-orange-200/80 rounded-2xl space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-700">
                  <span>Subtotal Estimate</span>
                  <span id="review-checkout-subtotal" className="font-mono font-bold text-slate-900">
                    {currencySymbol}
                    {((cart?.subtotal || 0) / 100).toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs font-extrabold text-slate-900 pt-2 border-t border-orange-200/80">
                  <span>Total Review Amount</span>
                  <span id="review-checkout-total" className="font-mono text-base text-orange-600">
                    {currencySymbol}
                    {((cart?.subtotal || 0) / 100).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: INTENT CREATED BOUNDARY CARD */}
          {currentStep === 'intent_created' && createdIntent && (
            <div id="checkout-intent-boundary-success" className="space-y-5 text-center py-4 animate-in zoom-in-95 duration-200">
              <div className="w-16 h-16 rounded-3xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
                <Check className="w-8 h-8 stroke-[3]" />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-base font-extrabold text-slate-900">Checkout Intent Ready</h3>
                <p className="text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
                  Your customer order details and cart have been validated cleanly. Click submit below to confirm your order.
                </p>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl text-left space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-bold">Restaurant</span>
                  <span className="font-extrabold text-slate-900">{createdIntent.restaurantName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-bold">Customer</span>
                  <span className="font-bold text-slate-900">{createdIntent.customerDetails.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-bold">Order Type</span>
                  <span className="font-bold text-slate-900 capitalize">{createdIntent.orderType}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-bold">Payment Method</span>
                  <span className="font-bold uppercase text-slate-900">{createdIntent.paymentMethod}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-bold">Subtotal</span>
                  <span className="font-mono font-bold text-slate-900">
                    {currencySymbol}
                    {(createdIntent.subtotal / 100).toFixed(2)}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200 text-[10px] font-mono text-slate-400 truncate">
                  Idempotency Key: {createdIntent.idempotencyKey}
                </div>
              </div>

              <button
                type="button"
                id="submit-online-order-btn"
                disabled={isSubmitting}
                onClick={handleSubmitOrder}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white text-xs font-extrabold rounded-2xl shadow-md transition-all flex items-center justify-center gap-2 min-h-[44px]"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Submitting Order...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 stroke-[3]" />
                    <span>Submit Order Now</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* STEP 4: ORDER SUBMITTED CONFIRMATION */}
          {currentStep === 'order_submitted' && submittedOrder && (
            <div id="checkout-order-submitted-confirmation" className="space-y-5 text-center py-4 animate-in zoom-in-95 duration-200">
              <div className="w-16 h-16 rounded-3xl bg-emerald-500 text-white flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
                <CheckCircle2 className="w-9 h-9" />
              </div>

              <div className="space-y-1">
                <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">Order Placed Successfully!</h3>
                <p className="text-xs text-slate-500 font-medium">
                  Your order has been sent to {cart?.restaurantName || restaurantProfile?.name || 'the restaurant'}.
                </p>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl text-left space-y-2.5 text-xs">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <span className="text-slate-500 font-bold">Order Number</span>
                  <span id="submitted-order-number" className="font-mono font-extrabold text-orange-600 text-sm">
                    {submittedOrder.orderNumber}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-bold">Status</span>
                  <span id="submitted-order-status" className="font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md uppercase text-[10px]">
                    {submittedOrder.status}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-bold">Order Type</span>
                  <span className="font-bold text-slate-900 capitalize">{submittedOrder.orderType}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-bold">Total Amount</span>
                  <span id="submitted-order-total" className="font-mono font-extrabold text-slate-900">
                    {currencySymbol}
                    {(submittedOrder.grandTotalMinor / 100).toFixed(2)}
                  </span>
                </div>
                {submittedKot && (
                  <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
                    <span>Kitchen Ticket</span>
                    <span className="font-mono font-bold text-slate-700">{submittedKot.kotNumber}</span>
                  </div>
                )}
                {submittedOrder.customerSnapshot && (
                  <div className="pt-2 border-t border-slate-200 space-y-1 text-[11px]">
                    <span className="text-slate-500 font-bold block">Customer Info</span>
                    <p className="font-medium text-slate-800">
                      {submittedOrder.customerSnapshot.name} ({submittedOrder.customerSnapshot.phone})
                    </p>
                    {submittedOrder.customerSnapshot.address && (
                      <p className="text-slate-600 leading-snug">{submittedOrder.customerSnapshot.address}</p>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                id="close-order-success-btn"
                onClick={onClose}
                className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold rounded-2xl transition-colors min-h-[44px]"
              >
                Done / Back to Menu
              </button>
            </div>
          )}
        </div>

        {/* Sticky Footer Action Bar */}
        {currentStep !== 'intent_created' && currentStep !== 'order_submitted' && (
          <div className="p-4 sm:p-5 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-4 shrink-0">
            <div className="min-w-0">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Total Estimate</span>
              <span id="checkout-modal-footer-amount" className="text-base font-mono font-extrabold text-slate-900">
                {currencySymbol}
                {((cart?.subtotal || 0) / 100).toFixed(2)}
              </span>
            </div>

            {currentStep === 'form' ? (
              <button
                type="button"
                id="proceed-to-review-btn"
                onClick={handleProceedToReview}
                className="px-6 py-3.5 bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white text-xs font-extrabold rounded-2xl shadow-md shadow-orange-600/20 transition-all flex items-center gap-2 min-h-[44px]"
              >
                <span>Review Order</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                id="place-order-intent-btn"
                disabled={isSubmitting}
                onClick={handleSubmitOrder}
                className="px-6 py-3.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-white text-xs font-extrabold rounded-2xl shadow-md shadow-emerald-600/20 transition-all flex items-center gap-2 min-h-[44px]"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Submitting Order...</span>
                  </>
                ) : (
                  <>
                    <span>Place Online Order</span>
                    <Check className="w-4 h-4 stroke-[3]" />
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
