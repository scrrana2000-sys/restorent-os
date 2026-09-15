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
  Loader2,
  Hash,
  RefreshCw
} from 'lucide-react';
import { useCustomerLocation } from '../../context/CustomerLocationContext';
import {
  IndianCity,
  searchIndianCities
} from '../../data/indianLocations';
import {
  resolveIndianPinCode,
  ResolvedPinLocation
} from '../../utils/pincodeResolver';

export interface CustomerLocationSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
}

type TabMode = 'gps' | 'city' | 'pincode';

export const CustomerLocationSelectorModal: React.FC<CustomerLocationSelectorModalProps> = ({
  isOpen,
  onClose,
  title = 'Choose Your Location'
}) => {
  const {
    location,
    isLoading,
    isDenied,
    errorMessage,
    requestLocation,
    selectCity,
    setManualLocation,
    setPincodeLocation
  } = useCustomerLocation();

  const [activeTab, setActiveTab] = useState<TabMode>('city');

  // City Search & Selection state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCityObj, setSelectedCityObj] = useState<IndianCity | null>(null);
  const [customArea, setCustomArea] = useState('');

  // PIN Code state
  const [pinInput, setPinInput] = useState('');
  const [pinValidationErr, setPinValidationErr] = useState<string | null>(null);
  const [isResolvingPin, setIsResolvingPin] = useState(false);
  const [pinResolutionErr, setPinResolutionErr] = useState<string | null>(null);
  const [resolvedPinLocation, setResolvedPinLocation] = useState<ResolvedPinLocation | null>(null);

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

  // PIN Code validation & lookup
  const handleLookupPinCode = async () => {
    const cleanPin = pinInput.trim();
    setPinValidationErr(null);
    setPinResolutionErr(null);

    if (!cleanPin) {
      setPinValidationErr('Please enter a 6-digit PIN code.');
      return;
    }

    if (!/^\d{6}$/.test(cleanPin)) {
      setPinValidationErr('PIN code must be exactly 6 numeric digits (e.g. 560001).');
      return;
    }

    setIsResolvingPin(true);
    try {
      const res = await resolveIndianPinCode(cleanPin);
      setIsResolvingPin(false);

      if (res.success && res.location) {
        setResolvedPinLocation(res.location);
      } else {
        setPinResolutionErr(res.error || 'Unable to resolve PIN code. Please try again.');
      }
    } catch (err: any) {
      setIsResolvingPin(false);
      setPinResolutionErr(err?.message || 'Network error while resolving PIN code. Please retry.');
    }
  };

  const handleConfirmPinLocation = () => {
    if (!resolvedPinLocation) return;
    setPincodeLocation(
      resolvedPinLocation.city,
      resolvedPinLocation.state,
      resolvedPinLocation.area,
      resolvedPinLocation.postalCode
    );
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h2 id="location-modal-title" className="text-base font-bold text-slate-800">
                {selectedCityObj ? `Select Area in ${selectedCityObj.name}` : title}
              </h2>
              <p className="text-xs text-slate-500">
                {selectedCityObj ? `${selectedCityObj.state}, India` : 'Set your location to see restaurants near you'}
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

        {/* 3 Selection Method Tabs (Only shown when not drilling down into a city's area) */}
        {!selectedCityObj && (
          <div className="px-5 pt-3 pb-1 border-b border-slate-100 bg-white">
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100/80 rounded-xl text-xs font-semibold">
              <button
                id="location-tab-city"
                onClick={() => setActiveTab('city')}
                className={`py-2 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 min-h-[38px] ${
                  activeTab === 'city'
                    ? 'bg-white text-orange-700 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span className="truncate">City / Area</span>
              </button>

              <button
                id="location-tab-pincode"
                onClick={() => setActiveTab('pincode')}
                className={`py-2 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 min-h-[38px] ${
                  activeTab === 'pincode'
                    ? 'bg-white text-orange-700 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Hash className="w-3.5 h-3.5" />
                <span className="truncate">PIN Code</span>
              </button>

              <button
                id="location-tab-gps"
                onClick={() => setActiveTab('gps')}
                className={`py-2 px-2 rounded-lg transition-all flex items-center justify-center gap-1.5 min-h-[38px] ${
                  activeTab === 'gps'
                    ? 'bg-white text-orange-700 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span className="truncate">GPS Location</span>
              </button>
            </div>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* TAB 1: GPS Auto-Detection */}
          {activeTab === 'gps' && !selectedCityObj && (
            <div className="space-y-4">
              <div className="p-4 bg-orange-50/70 rounded-2xl border border-orange-200/80 text-center space-y-3">
                <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mx-auto">
                  <Crosshair className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Use Device Geolocation</h3>
                  <p className="text-xs text-slate-600 mt-1 max-w-xs mx-auto">
                    Detect your current city and area automatically using your browser GPS permission.
                  </p>
                </div>

                <button
                  id="use-current-location-btn"
                  onClick={handleUseGps}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white font-bold text-sm rounded-xl transition-all shadow-xs min-h-[48px]"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Detecting your location...</span>
                    </>
                  ) : (
                    <>
                      <Crosshair className="w-4 h-4 text-white" />
                      <span>Detect My GPS Location</span>
                    </>
                  )}
                </button>
              </div>

              {/* Status or Permission Message */}
              {errorMessage && (
                <div
                  id="location-status-message"
                  className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <span className="font-semibold block mb-0.5">GPS Notice</span>
                    <span>{errorMessage}</span>
                    {isDenied && (
                      <span className="block mt-1 text-amber-900 font-medium">
                        Permission denied. You can easily switch to City or PIN Code search above.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: PIN CODE SEARCH */}
          {activeTab === 'pincode' && !selectedCityObj && (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="pincode-input"
                  className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5"
                >
                  Enter Indian 6-Digit Postal PIN Code
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Hash className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="pincode-input"
                      type="text"
                      maxLength={6}
                      value={pinInput}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        setPinInput(val);
                        if (pinValidationErr) setPinValidationErr(null);
                        if (pinResolutionErr) setPinResolutionErr(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleLookupPinCode();
                        }
                      }}
                      placeholder="e.g. 560001, 584101, 400001..."
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 focus:bg-white text-sm font-semibold text-slate-900 border border-slate-300 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-hidden tracking-wider min-h-[46px]"
                    />
                    {pinInput && (
                      <button
                        onClick={() => {
                          setPinInput('');
                          setResolvedPinLocation(null);
                          setPinValidationErr(null);
                          setPinResolutionErr(null);
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-full min-h-[32px] min-w-[32px] flex items-center justify-center"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <button
                    id="pincode-lookup-btn"
                    onClick={handleLookupPinCode}
                    disabled={isResolvingPin || !pinInput.trim()}
                    className="px-4 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors shrink-0 flex items-center gap-1.5 min-h-[46px]"
                  >
                    {isResolvingPin ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                        <span>Checking...</span>
                      </>
                    ) : (
                      <span>Resolve PIN</span>
                    )}
                  </button>
                </div>

                {/* Validation Error */}
                {pinValidationErr && (
                  <div
                    id="pincode-validation-error"
                    className="mt-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                    <span>{pinValidationErr}</span>
                  </div>
                )}

                {/* Network / Resolution Failure with Retry */}
                {pinResolutionErr && (
                  <div
                    id="pincode-resolution-error"
                    className="mt-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                      <span>{pinResolutionErr}</span>
                    </div>
                    <button
                      id="pincode-retry-btn"
                      onClick={handleLookupPinCode}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-[11px] flex items-center gap-1 min-h-[32px]"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Retry PIN Lookup</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Resolved PIN Location Preview Card */}
              {resolvedPinLocation && !isResolvingPin && (
                <div
                  id="resolved-pincode-card"
                  className="p-4 bg-orange-50/80 border-2 border-orange-400 rounded-2xl space-y-3 animate-in fade-in zoom-in-95 duration-150"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center shrink-0 mt-0.5">
                        <MapPin className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-orange-600 uppercase tracking-wider">
                          PIN Resolved Location
                        </div>
                        <div className="text-base font-extrabold text-slate-900 mt-0.5">
                          → {resolvedPinLocation.city}, {resolvedPinLocation.state}
                        </div>
                        {resolvedPinLocation.area && (
                          <div className="text-xs text-slate-600 font-medium">
                            Area: {resolvedPinLocation.area}
                          </div>
                        )}
                        <div className="text-xs font-mono font-bold text-orange-800 mt-0.5">
                          Postal PIN: {resolvedPinLocation.postalCode}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-orange-200">
                    <button
                      id="confirm-pincode-location-btn"
                      onClick={handleConfirmPinLocation}
                      className="flex-1 py-2.5 px-4 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 min-h-[42px]"
                    >
                      <Check className="w-4 h-4" />
                      <span>Use This Location</span>
                    </button>

                    <button
                      id="change-pincode-btn"
                      onClick={() => {
                        setResolvedPinLocation(null);
                        setPinInput('');
                      }}
                      className="px-3 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl min-h-[42px]"
                    >
                      Change PIN
                    </button>
                  </div>
                </div>
              )}

              {/* Popular Sample PIN Codes */}
              {!resolvedPinLocation && (
                <div className="pt-2">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                    Popular Sample PIN Codes
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { pin: '560001', label: 'Bengaluru MG Rd' },
                      { pin: '584101', label: 'Raichur Station' },
                      { pin: '400001', label: 'Mumbai Fort' },
                      { pin: '110001', label: 'Delhi Connaught' },
                      { pin: '500001', label: 'Hyderabad Abids' },
                      { pin: '600001', label: 'Chennai Town' }
                    ].map((sample) => (
                      <button
                        key={sample.pin}
                        id={`sample-pin-${sample.pin}`}
                        onClick={() => {
                          setPinInput(sample.pin);
                          setPinValidationErr(null);
                          setPinResolutionErr(null);
                          resolveIndianPinCode(sample.pin).then((res) => {
                            if (res.success && res.location) {
                              setResolvedPinLocation(res.location);
                            }
                          });
                        }}
                        className="px-2.5 py-1.5 bg-slate-50 hover:bg-orange-50 hover:border-orange-300 text-slate-700 hover:text-orange-700 border border-slate-200 rounded-lg text-xs font-medium transition-colors min-h-[34px]"
                      >
                        <span className="font-mono font-bold">{sample.pin}</span> ({sample.label})
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: CITY & AREA MANUAL SEARCH (Or Area Selection) */}
          {(activeTab === 'city' || selectedCityObj) && (
            <div>
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
                {location.postalCode ? ` (PIN ${location.postalCode})` : ''}
              </span>
            ) : (
              <span>No location chosen</span>
            )}
          </span>
          <span className="text-[11px] text-slate-400">Privacy protected</span>
        </div>
      </div>
    </div>
  );
};
