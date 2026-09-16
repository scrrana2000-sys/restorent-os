import { findIndianCityByName, IndianCity } from '../data/indianLocations';

export interface ResolvedPinLocation {
  postalCode: string;
  city: string;
  state: string;
  area?: string;
  district?: string;
  source: 'local_database' | 'postal_api' | 'prefix_lookup';
}

export interface PinResolutionResult {
  success: boolean;
  location?: ResolvedPinLocation;
  error?: string;
  isNetworkError?: boolean;
}

/**
 * Known specific 6-digit PIN Code Mappings for precision resolution.
 * PIN codes map to City and State for complete city-wide restaurant discovery.
 * Sub-areas are intentionally omitted so customers are not restricted to an isolated locality.
 */
const SPECIFIC_PIN_MAPPINGS: Record<string, { city: string; state: string; area?: string }> = {
  // Bengaluru / Bangalore (560xxx)
  '560001': { city: 'Bengaluru', state: 'Karnataka' },
  '560002': { city: 'Bengaluru', state: 'Karnataka' },
  '560004': { city: 'Bengaluru', state: 'Karnataka' },
  '560008': { city: 'Bengaluru', state: 'Karnataka' },
  '560011': { city: 'Bengaluru', state: 'Karnataka' },
  '560025': { city: 'Bengaluru', state: 'Karnataka' },
  '560034': { city: 'Bengaluru', state: 'Karnataka' },
  '560037': { city: 'Bengaluru', state: 'Karnataka' },
  '560038': { city: 'Bengaluru', state: 'Karnataka' },
  '560066': { city: 'Bengaluru', state: 'Karnataka' },
  '560076': { city: 'Bengaluru', state: 'Karnataka' },
  '560078': { city: 'Bengaluru', state: 'Karnataka' },
  '560100': { city: 'Bengaluru', state: 'Karnataka' },
  '560102': { city: 'Bengaluru', state: 'Karnataka' },

  // Raichur (584xxx) - Covers full Raichur city-wide
  '584101': { city: 'Raichur', state: 'Karnataka' },
  '584102': { city: 'Raichur', state: 'Karnataka' },
  '584103': { city: 'Raichur', state: 'Karnataka' },

  // Mysuru (570xxx)
  '570001': { city: 'Mysuru', state: 'Karnataka' },
  '570002': { city: 'Mysuru', state: 'Karnataka' },

  // Hubballi (580xxx)
  '580020': { city: 'Hubballi-Dharwad', state: 'Karnataka' },

  // Mumbai (400xxx)
  '400001': { city: 'Mumbai', state: 'Maharashtra' },
  '400050': { city: 'Mumbai', state: 'Maharashtra' },

  // Delhi (110xxx)
  '110001': { city: 'Delhi', state: 'Delhi' },
  '110016': { city: 'Delhi', state: 'Delhi' },

  // Hyderabad (500xxx)
  '500001': { city: 'Hyderabad', state: 'Telangana' },
  '500081': { city: 'Hyderabad', state: 'Telangana' },

  // Chennai (600xxx)
  '600001': { city: 'Chennai', state: 'Tamil Nadu' },
  '600017': { city: 'Chennai', state: 'Tamil Nadu' },

  // Pune (411xxx)
  '411001': { city: 'Pune', state: 'Maharashtra' },
  '411004': { city: 'Pune', state: 'Maharashtra' },

  // Kolkata (700xxx)
  '700001': { city: 'Kolkata', state: 'West Bengal' },
  '700016': { city: 'Kolkata', state: 'West Bengal' }
};

/**
 * 3-digit prefix fallback mappings for Indian Postal Circles.
 */
const PREFIX_PIN_MAPPINGS: Record<string, { city: string; state: string }> = {
  // Karnataka (560-591)
  '560': { city: 'Bengaluru', state: 'Karnataka' },
  '561': { city: 'Bengaluru', state: 'Karnataka' },
  '562': { city: 'Bengaluru', state: 'Karnataka' },
  '570': { city: 'Mysuru', state: 'Karnataka' },
  '571': { city: 'Mysuru', state: 'Karnataka' },
  '574': { city: 'Mangaluru', state: 'Karnataka' },
  '575': { city: 'Mangaluru', state: 'Karnataka' },
  '577': { city: 'Shivamogga', state: 'Karnataka' },
  '580': { city: 'Hubballi-Dharwad', state: 'Karnataka' },
  '581': { city: 'Hubballi-Dharwad', state: 'Karnataka' },
  '583': { city: 'Ballari', state: 'Karnataka' },
  '584': { city: 'Raichur', state: 'Karnataka' },
  '585': { city: 'Kalaburagi', state: 'Karnataka' },
  '590': { city: 'Belagavi', state: 'Karnataka' },

  // Maharashtra (400-444)
  '400': { city: 'Mumbai', state: 'Maharashtra' },
  '401': { city: 'Mumbai', state: 'Maharashtra' },
  '411': { city: 'Pune', state: 'Maharashtra' },
  '412': { city: 'Pune', state: 'Maharashtra' },
  '440': { city: 'Nagpur', state: 'Maharashtra' },

  // Delhi NCR
  '110': { city: 'Delhi', state: 'Delhi' },
  '122': { city: 'Gurugram', state: 'Haryana' },
  '201': { city: 'Noida', state: 'Uttar Pradesh' },

  // Telangana & AP (500-535)
  '500': { city: 'Hyderabad', state: 'Telangana' },
  '501': { city: 'Hyderabad', state: 'Telangana' },

  // Tamil Nadu (600-643)
  '600': { city: 'Chennai', state: 'Tamil Nadu' },
  '641': { city: 'Coimbatore', state: 'Tamil Nadu' },

  // West Bengal
  '700': { city: 'Kolkata', state: 'West Bengal' },

  // Gujarat
  '380': { city: 'Ahmedabad', state: 'Gujarat' },
  '395': { city: 'Surat', state: 'Gujarat' },

  // Rajasthan
  '302': { city: 'Jaipur', state: 'Rajasthan' },

  // Uttar Pradesh
  '226': { city: 'Lucknow', state: 'Uttar Pradesh' },

  // Kerala
  '682': { city: 'Kochi', state: 'Kerala' },
  '695': { city: 'Thiruvananthapuram', state: 'Kerala' },

  // Bihar & Jharkhand
  '800': { city: 'Patna', state: 'Bihar' },
  '834': { city: 'Ranchi', state: 'Jharkhand' }
};

/**
 * 1-digit region mapping fallback for any 6-digit Indian PIN code.
 */
function getRegionalFallbackByPin(pin: string): { city: string; state: string } {
  const firstDigit = pin.charAt(0);
  switch (firstDigit) {
    case '1':
      return { city: 'Delhi', state: 'Delhi' };
    case '2':
      return { city: 'Lucknow', state: 'Uttar Pradesh' };
    case '3':
      return { city: 'Jaipur', state: 'Rajasthan' };
    case '4':
      return { city: 'Mumbai', state: 'Maharashtra' };
    case '5':
      return { city: 'Bengaluru', state: 'Karnataka' };
    case '6':
      return { city: 'Chennai', state: 'Tamil Nadu' };
    case '7':
      return { city: 'Kolkata', state: 'West Bengal' };
    case '8':
      return { city: 'Patna', state: 'Bihar' };
    default:
      return { city: 'Bengaluru', state: 'Karnataka' };
  }
}

/**
 * Resolves an Indian 6-digit PIN code to location data.
 * First checks local database & prefix lookup, then attempts postal API with fallback.
 */
export async function resolveIndianPinCode(pinCode: string): Promise<PinResolutionResult> {
  const cleanPin = pinCode ? pinCode.trim() : '';

  // Validation: Must be exactly 6 numeric digits
  if (!/^\d{6}$/.test(cleanPin)) {
    return {
      success: false,
      error: 'Please enter a valid 6-digit Indian PIN code (e.g. 560001).'
    };
  }

  // 1. Check specific exact PIN mappings first
  if (SPECIFIC_PIN_MAPPINGS[cleanPin]) {
    const match = SPECIFIC_PIN_MAPPINGS[cleanPin];
    return {
      success: true,
      location: {
        postalCode: cleanPin,
        city: match.city,
        state: match.state,
        area: match.area,
        source: 'local_database'
      }
    };
  }

  // 2. Check 3-digit prefix mapping
  const prefix = cleanPin.substring(0, 3);
  if (PREFIX_PIN_MAPPINGS[prefix]) {
    const match = PREFIX_PIN_MAPPINGS[prefix];
    return {
      success: true,
      location: {
        postalCode: cleanPin,
        city: match.city,
        state: match.state,
        source: 'prefix_lookup'
      }
    };
  }

  // 3. Attempt external Postal API lookup with timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`https://api.postalpincode.in/pincode/${cleanPin}`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (
        Array.isArray(data) &&
        data[0] &&
        data[0].Status === 'Success' &&
        Array.isArray(data[0].PostOffice) &&
        data[0].PostOffice.length > 0
      ) {
        const po = data[0].PostOffice[0];
        const rawDistrict = po.District || po.Block || po.Division || '';
        const rawState = po.State || '';
        const rawName = po.Name || '';

        // Match district to known Indian city dataset if possible
        const matchedCity = findIndianCityByName(rawDistrict) || findIndianCityByName(rawName);
        const resolvedCityName = matchedCity ? matchedCity.name : rawDistrict || 'Bengaluru';
        const resolvedStateName = matchedCity ? matchedCity.state : rawState || 'Karnataka';

        return {
          success: true,
          location: {
            postalCode: cleanPin,
            city: resolvedCityName,
            state: resolvedStateName,
            area: undefined,
            district: rawDistrict,
            source: 'postal_api'
          }
        };
      }
    }
  } catch (err: any) {
    // If user is offline or fetch failed, fallback gracefully to regional prefix/digit match
    console.warn('[RestaurantOS PinResolver] Postal API fetch warning/fallback:', err);
  }

  // 4. Fallback: 1-digit region mapping
  const regionalMatch = getRegionalFallbackByPin(cleanPin);
  return {
    success: true,
    location: {
      postalCode: cleanPin,
      city: regionalMatch.city,
      state: regionalMatch.state,
      source: 'prefix_lookup'
    }
  };
}
