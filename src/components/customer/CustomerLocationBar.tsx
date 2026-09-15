import React, { useState } from 'react';
import { MapPin, ChevronDown } from 'lucide-react';
import { useCustomerLocation } from '../../context/CustomerLocationContext';
import { CustomerLocationSelectorModal } from './CustomerLocationSelectorModal';

export interface CustomerLocationBarProps {
  className?: string;
  variant?: 'compact' | 'pill' | 'banner';
}

export const CustomerLocationBar: React.FC<CustomerLocationBarProps> = ({
  className = '',
  variant = 'pill'
}) => {
  const { location, status } = useCustomerLocation();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const displayTitle = location?.city || 'Select Location';
  const displaySubtitle = location?.postalCode
    ? `${location.city}${location.state ? `, ${location.state}` : ''} (PIN ${location.postalCode})`
    : location?.area
    ? `${location.area}, ${location.city}`
    : location?.state
    ? `${location.city}, ${location.state}`
    : 'Choose your city to browse food';

  const subText = location?.postalCode
    ? `PIN ${location.postalCode}${location.area ? ` • ${location.area}` : ''}`
    : location?.area || location?.state;

  if (variant === 'banner') {
    return (
      <>
        <div
          id="customer-location-banner"
          className={`flex items-center justify-between p-3 bg-orange-50 border-b border-orange-100 text-slate-800 ${className}`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
              <MapPin className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-slate-500 font-medium">Your Delivery Location</div>
              <div className="text-sm font-bold text-slate-900 truncate">
                {location ? displaySubtitle : 'Tap to set your city'}
              </div>
            </div>
          </div>
          <button
            id="change-location-banner-btn"
            onClick={() => setIsModalOpen(true)}
            className="px-3 py-1.5 bg-white border border-orange-200 text-orange-700 text-xs font-bold rounded-lg shadow-xs hover:bg-orange-50 transition-colors shrink-0 min-h-[36px]"
          >
            {location ? 'Change' : 'Set City'}
          </button>
        </div>

        <CustomerLocationSelectorModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      </>
    );
  }

  return (
    <>
      <button
        id="customer-location-trigger-btn"
        onClick={() => setIsModalOpen(true)}
        className={`flex items-center gap-2 px-3 py-2 glass-neu-btn text-slate-800 rounded-full text-left min-h-[44px] cursor-pointer ${className}`}
        aria-label={`Current location: ${displayTitle}. Click to change.`}
      >
        <div className="w-6 h-6 rounded-full bg-orange-100/90 text-orange-600 flex items-center justify-center shrink-0 border border-white shadow-[2px_2px_5px_rgba(234,88,12,0.2)]">
          <MapPin className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-xs font-bold text-slate-900 truncate max-w-[140px] sm:max-w-[200px]">
              {displayTitle}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </div>
          {subText && (
            <div className="text-[10px] text-slate-500 truncate max-w-[140px] sm:max-w-[180px]">
              {subText}
            </div>
          )}
        </div>
      </button>

      <CustomerLocationSelectorModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
};
