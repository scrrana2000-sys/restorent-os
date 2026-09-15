import React, { useState, useMemo } from 'react';
import {
  MapPin,
  Search,
  Crosshair,
  ChevronRight,
  X,
  AlertCircle,
  Check,
  Building2,
  Loader2
} from 'lucide-react';
import { useCustomerLocation } from '../../context/CustomerLocationContext';
import {
  IndianCity,
  INDIAN_CITIES,
  searchIndianCities
} from '../../data/indianLocations';

export interface CustomerLocationSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
}

export const CustomerLocationSelectorModal: React.FC<CustomerLocationSelectorModalProps> = ({
  isOpen,
  onClose,
  title = 'Select Your City & Area'
}) => {
  const {
    location,
    status,
    isLoading,
    isDenied,
    errorMessage,
    requestLocation,
    selectCity,
    setManualLocation
  } = useCustomerLocation();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCityObj, setSelectedCityObj] = useState<IndianCity | null>(null);
  const [customArea, setCustomArea] = useState('');

  // Filtered cities based on search
  const filteredCities = useMemo(() => {
    return searchIndianCities(searchQuery);
  }, [searchQuery]);

  if (!isOpen) return null;

  const handleUseGps = async () => {
    const loc = await requestLocation();
    if (loc) {
      onClose();
    }
  };

  const handleSelectCity = (city: IndianCity) => {
    setSelectedCityObj(city);
    // If city has no popular areas or user doesn't want area, select immediately
    if (!city.popularAreas || city.popularAreas.length === 0) {
      selectCity(city);
      onClose();
    }
  };

  const handleConfirmWithArea = (areaName?: string) => {
    if (!selectedCityObj) return;
    const finalArea = areaName || customArea.trim() || undefined;
    selectCity(selectedCityObj, finalArea);
    onClose();
  };

  const handleDirectManualConfirm = () => {
    if (!searchQuery.trim()) return;
    setManualLocation(searchQuery.trim(), undefined, customArea.trim() || undefined);
    onClose();
  };

  return (
    <div
      id="customer-location-selector-modal"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-modal-title"
    >
      <div
        className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in slide-in-from-bottom duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h2 id="location-modal-title" className="text-base font-bold text-slate-800">
                {selectedCityObj ? `Select Area in ${selectedCityObj.name}` : title}
              </h2>
              <p className="text-xs text-slate-500">
                {selectedCityObj ? `${selectedCityObj.state}, India` : 'Find restaurants & food nearby'}
              </p>
            </div>
          </div>
          <button
            id="close-location-modal-btn"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Close location selector"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* Geolocation Trigger / GPS Button */}
          {!selectedCityObj && (
            <div>
              <button
                id="use-current-location-btn"
                onClick={handleUseGps}
                disabled={isLoading}
                className="w-full flex items-center justify-between p-3.5 bg-orange-50/70 hover:bg-orange-100/70 text-orange-700 rounded-xl border border-orange-200/80 font-medium text-sm transition-all min-h-[48px]"
              >
                <div className="flex items-center gap-2.5">
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-orange-600" />
                  ) : (
                    <Crosshair className="w-4 h-4 text-orange-600" />
                  )}
                  <span>
                    {isLoading ? 'Detecting your location...' : 'Use my current location (GPS)'}
                  </span>
                </div>
                <span className="text-xs text-orange-600 font-semibold uppercase tracking-wider">
                  Auto-Detect
                </span>
              </button>

              {/* Status or Permission Message */}
              {errorMessage && (
                <div
                  id="location-status-message"
                  className="mt-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span>{errorMessage}</span>
                    {isDenied && (
                      <span className="block mt-0.5 text-amber-900 font-medium">
                        You can still easily pick your city from the list below.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Area Selection Step (When City Is Clicked) */}
          {selectedCityObj ? (
            <div className="space-y-4">
              <button
                id="back-to-cities-btn"
                onClick={() => setSelectedCityObj(null)}
                className="text-xs font-semibold text-orange-600 hover:text-orange-700 flex items-center gap-1 min-h-[36px]"
              >
                ← Back to city list
              </button>

              {/* Whole City Button */}
              <button
                id="select-entire-city-btn"
                onClick={() => handleConfirmWithArea(undefined)}
                className="w-full flex items-center justify-between p-3.5 rounded-xl border-2 border-orange-500 bg-orange-50/50 hover:bg-orange-100/50 text-slate-800 font-semibold text-sm min-h-[48px] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-orange-600" />
                  <span>All of {selectedCityObj.name}</span>
                </div>
                <span className="text-xs text-orange-600 font-bold">City-Wide</span>
              </button>

              {/* Popular Localities */}
              {selectedCityObj.popularAreas.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Popular Areas / Localities
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedCityObj.popularAreas.map((areaName) => (
                      <button
                        key={areaName}
                        id={`area-chip-${areaName.toLowerCase().replace(/\s+/g, '-')}`}
                        onClick={() => handleConfirmWithArea(areaName)}
                        className="p-2.5 text-left text-xs font-medium text-slate-700 bg-slate-50 hover:bg-orange-50 hover:text-orange-700 hover:border-orange-300 border border-slate-200 rounded-lg transition-colors flex items-center justify-between min-h-[44px]"
                      >
                        <span className="truncate">{areaName}</span>
                        {location?.city.toLowerCase() === selectedCityObj.name.toLowerCase() &&
                          location?.area?.toLowerCase() === areaName.toLowerCase() && (
                            <Check className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                          )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom Area Input */}
              <div className="pt-2 border-t border-slate-100">
                <label
                  htmlFor="custom-area-input"
                  className="block text-xs font-medium text-slate-600 mb-1"
                >
                  Or enter specific colony / street name
                </label>
                <div className="flex gap-2">
                  <input
                    id="custom-area-input"
                    type="text"
                    value={customArea}
                    onChange={(e) => setCustomArea(e.target.value)}
                    placeholder="e.g. Station Road, Gandhi Chowk..."
                    className="flex-1 px-3.5 py-2 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-hidden min-h-[44px]"
                  />
                  <button
                    id="confirm-custom-area-btn"
                    onClick={() => handleConfirmWithArea(customArea)}
                    disabled={!customArea.trim()}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors min-h-[44px]"
                  >
                    Confirm
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* City Search & Selection List */
            <div className="space-y-3">
              {/* Search Bar */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="city-search-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search city (e.g. Bengaluru, Raichur, Mumbai, Delhi...)"
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 hover:bg-slate-100/80 focus:bg-white text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-hidden transition-colors min-h-[44px]"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-full min-h-[32px] min-w-[32px] flex items-center justify-center"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* City List */}
              <div className="space-y-1 max-h-[40vh] overflow-y-auto pr-1">
                {filteredCities.length > 0 ? (
                  filteredCities.map((city) => {
                    const isSelected =
                      location?.city.toLowerCase() === city.name.toLowerCase();
                    return (
                      <button
                        key={`${city.name}-${city.state}`}
                        id={`city-item-${city.name.toLowerCase().replace(/\s+/g, '-')}`}
                        onClick={() => handleSelectCity(city)}
                        className={`w-full flex items-center justify-between p-3 rounded-xl text-left transition-colors min-h-[48px] ${
                          isSelected
                            ? 'bg-orange-50 border border-orange-200 text-orange-950 font-semibold'
                            : 'hover:bg-slate-50 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <Building2
                            className={`w-4 h-4 ${
                              isSelected ? 'text-orange-600' : 'text-slate-400'
                            }`}
                          />
                          <div>
                            <div className="text-sm font-semibold flex items-center gap-1.5">
                              <span>{city.name}</span>
                              {city.aliases && city.aliases.length > 0 && (
                                <span className="text-xs text-slate-400 font-normal">
                                  ({city.aliases[0]})
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500">
                              {city.state} • {city.popularAreas.length} localities
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-400">
                          {isSelected && <Check className="w-4 h-4 text-orange-600 mr-1" />}
                          <ChevronRight className="w-4 h-4" />
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="py-8 text-center space-y-2">
                    <p className="text-xs text-slate-500">
                      No matching predefined cities found for &quot;{searchQuery}&quot;
                    </p>
                    <button
                      id="custom-city-submit-btn"
                      onClick={handleDirectManualConfirm}
                      className="px-4 py-2 bg-orange-600 text-white rounded-xl text-xs font-semibold hover:bg-orange-700 min-h-[44px]"
                    >
                      Use &quot;{searchQuery}&quot; as My City
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-slate-400" />
            {location ? (
              <span className="font-medium text-slate-700">
                Current: {location.city}
                {location.area ? `, ${location.area}` : ''}
              </span>
            ) : (
              <span>No location chosen</span>
            )}
          </span>
          <span className="text-[11px] text-slate-400">Never shares exact GPS</span>
        </div>
      </div>
    </div>
  );
};
