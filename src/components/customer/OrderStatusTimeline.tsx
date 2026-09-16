import React from 'react';
import {
  CheckCircle2,
  Clock,
  UtensilsCrossed,
  Package,
  Bike,
  XCircle,
  AlertTriangle,
  ShoppingBag,
  Sparkles
} from 'lucide-react';
import { OrderStatus, OrderType } from '../../types/order';
import { getCustomerStatusDetails, CustomerStatusDetails } from '../../services/customerOrderTrackingService';

export interface OrderStatusTimelineProps {
  status: OrderStatus;
  orderType: OrderType | string;
  placedAt?: any;
  updatedAt?: any;
  estimatedPrepMinutes?: number | null;
  cancellationReason?: string;
}

export const OrderStatusTimeline: React.FC<OrderStatusTimelineProps> = ({
  status,
  orderType,
  placedAt,
  updatedAt,
  estimatedPrepMinutes,
  cancellationReason
}) => {
  const details: CustomerStatusDetails = getCustomerStatusDetails(status, orderType);

  const formatTime = (ts: any): string => {
    if (!ts) return '';
    try {
      if (typeof ts === 'object' && ts?.toDate) {
        return ts.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      if (typeof ts === 'string' || typeof ts === 'number') {
        const d = new Date(ts);
        if (!isNaN(d.getTime())) {
          return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
      }
    } catch {
      return '';
    }
    return '';
  };

  const getStepIcon = (key: string, stepStatus: 'completed' | 'current' | 'pending' | 'cancelled') => {
    if (stepStatus === 'completed') {
      return <CheckCircle2 className="w-5 h-5 text-emerald-600" />;
    }
    if (stepStatus === 'cancelled') {
      return <XCircle className="w-5 h-5 text-red-600" />;
    }

    switch (key) {
      case 'placed':
        return <ShoppingBag className="w-4 h-4 text-orange-600" />;
      case 'accepted':
        return <CheckCircle2 className="w-4 h-4 text-orange-600" />;
      case 'preparing':
        return <UtensilsCrossed className="w-4 h-4 text-orange-600" />;
      case 'ready':
        return <Package className="w-4 h-4 text-orange-600" />;
      case 'out_for_delivery':
        return <Bike className="w-4 h-4 text-orange-600" />;
      case 'delivered':
      case 'completed':
        return <Sparkles className="w-4 h-4 text-emerald-600" />;
      default:
        return <Clock className="w-4 h-4 text-slate-400" />;
    }
  };

  // Dedicated Cancelled View
  if (details.isCancelled) {
    return (
      <div id="order-cancelled-view" className="p-4 sm:p-5 bg-red-50/90 border border-red-200 rounded-2xl space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
            <XCircle className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <span id="order-cancelled-title" className="text-sm font-extrabold text-red-900 block">
              Order Cancelled
            </span>
            <span className="text-xs text-red-700 block">
              This order has been cancelled and is no longer being prepared.
            </span>
          </div>
        </div>

        {cancellationReason && (
          <div className="p-3 bg-white/80 border border-red-200 rounded-xl text-xs space-y-1">
            <span className="font-bold text-red-900 block">Reason for cancellation:</span>
            <p id="order-cancellation-reason" className="text-red-700 italic">
              "{cancellationReason}"
            </p>
          </div>
        )}

        {updatedAt && (
          <div className="text-[11px] text-red-500 font-medium">
            Cancelled at: {formatTime(updatedAt)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="order-status-timeline-container" className="space-y-4">
      {/* Current Headline Card */}
      <div
        id="order-current-status-card"
        className="p-4 rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50/70 to-amber-50/40 space-y-1.5"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-orange-700">
            Current Status
          </span>
          <span
            id="order-status-pill"
            className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-orange-500 text-white shadow-xs uppercase"
          >
            {details.label}
          </span>
        </div>

        <p id="order-status-description" className="text-xs font-medium text-slate-700">
          {details.description}
        </p>

        {estimatedPrepMinutes && !details.isCancelled && !details.isTerminal && (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-100/90 text-orange-900 font-bold text-xs border border-orange-200 mt-1">
            <Clock className="w-3.5 h-3.5 text-orange-600" />
            <span>Estimated Kitchen Prep Time: ~{estimatedPrepMinutes} mins</span>
          </div>
        )}

        <div className="flex items-center gap-4 text-[11px] text-slate-500 pt-1 font-mono">
          {placedAt && <span>Placed: {formatTime(placedAt)}</span>}
          {updatedAt && <span>Updated: {formatTime(updatedAt)}</span>}
        </div>
      </div>

      {/* Step Progress List */}
      <div id="order-timeline-steps" className="py-2 space-y-4">
        {details.steps.map((step, idx) => {
          const isCompleted = step.status === 'completed';
          const isCurrent = step.status === 'current';
          const isPending = step.status === 'pending';
          const isLast = idx === details.steps.length - 1;

          return (
            <div key={step.key} id={`timeline-step-${step.key}`} className="relative flex items-start gap-3.5 group">
              {/* Connector line */}
              {!isLast && (
                <div
                  className={`absolute left-4 top-8 -bottom-4 w-0.5 -ml-[1px] transition-colors ${
                    isCompleted ? 'bg-emerald-500' : 'bg-slate-200'
                  }`}
                />
              )}

              {/* Step Node Icon */}
              <div
                className={`relative w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all ${
                  isCompleted
                    ? 'bg-emerald-100 text-emerald-600 ring-2 ring-emerald-500'
                    : isCurrent
                    ? 'bg-orange-600 text-white shadow-md shadow-orange-600/30 ring-4 ring-orange-100 animate-pulse'
                    : 'bg-slate-100 text-slate-400 border border-slate-200'
                }`}
              >
                {getStepIcon(step.key, step.status)}
              </div>

              {/* Step Details */}
              <div className="min-w-0 pt-1 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-xs font-bold block ${
                      isCurrent
                        ? 'text-orange-950 font-extrabold'
                        : isCompleted
                        ? 'text-slate-900'
                        : 'text-slate-400'
                    }`}
                  >
                    {step.label}
                  </span>
                  {isCurrent && (
                    <span className="text-[10px] font-bold text-orange-600 bg-orange-100/80 px-2 py-0.5 rounded-md uppercase">
                      In Progress
                    </span>
                  )}
                  {isCompleted && (
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                      Done
                    </span>
                  )}
                </div>
                <p
                  className={`text-[11px] leading-relaxed mt-0.5 ${
                    isCurrent ? 'text-slate-600' : isCompleted ? 'text-slate-500' : 'text-slate-400'
                  }`}
                >
                  {step.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
