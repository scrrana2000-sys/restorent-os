/**
 * Indian Locations Dataset for Customer City & Area Selection (Milestone 9-C).
 * Comprehensive list of major Indian cities across states and union territories
 * with popular areas and geographical centers for distance approximation.
 */

export interface IndianCity {
  name: string;
  state: string;
  aliases?: string[];
  popularAreas: string[];
  latitude?: number;
  longitude?: number;
}

export const INDIAN_CITIES: IndianCity[] = [
  // Karnataka
  {
    name: 'Bengaluru',
    state: 'Karnataka',
    aliases: ['Bangalore', 'Bengaluru Urban', 'BLR'],
    popularAreas: ['Indiranagar', 'Koramangala', 'HSR Layout', 'Whitefield', 'Jayanagar', 'MG Road', 'BTM Layout', 'Malleshwaram', 'JP Nagar', 'Electronic City'],
    latitude: 12.9716,
    longitude: 77.5946
  },
  {
    name: 'Raichur',
    state: 'Karnataka',
    aliases: ['Raichuru'],
    popularAreas: ['Station Road', 'MG Road', 'LBS Nagar', 'Timmapur', 'Nijalingappa Colony', 'Gunj Road', 'Rampur'],
    latitude: 16.2076,
    longitude: 77.3463
  },
  {
    name: 'Mysuru',
    state: 'Karnataka',
    aliases: ['Mysore'],
    popularAreas: ['Gokulam', 'Jayalakshmipuram', 'Kuvempunagar', 'Saraswathipuram', 'Vontikoppal', 'Hebbal'],
    latitude: 12.2958,
    longitude: 76.6394
  },
  {
    name: 'Hubballi-Dharwad',
    state: 'Karnataka',
    aliases: ['Hubli', 'Dharwad', 'Hubballi'],
    popularAreas: ['Vidyanagar', 'Gokul Road', 'Navanagar', 'Keshwapur', 'Station Road'],
    latitude: 15.3647,
    longitude: 75.1240
  },
  {
    name: 'Mangaluru',
    state: 'Karnataka',
    aliases: ['Mangalore'],
    popularAreas: ['Kadri', 'Kodialbail', 'Bejai', 'Lalbagh', 'Hampankatta'],
    latitude: 12.9141,
    longitude: 74.8560
  },
  {
    name: 'Belagavi',
    state: 'Karnataka',
    aliases: ['Belgaum'],
    popularAreas: ['Tilakwadi', 'Camp', 'Khasbag', 'Udyambag', 'Hindwadi'],
    latitude: 15.8497,
    longitude: 74.4977
  },
  {
    name: 'Kalaburagi',
    state: 'Karnataka',
    aliases: ['Gulbarga'],
    popularAreas: ['Super Market', 'MSK Mill Area', 'Brahmpur', 'Sedam Road'],
    latitude: 17.3297,
    longitude: 76.8343
  },
  {
    name: 'Ballari',
    state: 'Karnataka',
    aliases: ['Bellary'],
    popularAreas: ['Cantonment', 'Gandhi Nagar', 'Brucepet', 'Kappagal Road'],
    latitude: 15.1394,
    longitude: 76.9214
  },
  {
    name: 'Shivamogga',
    state: 'Karnataka',
    aliases: ['Shimoga'],
    popularAreas: ['Durgigudi', 'Vinoba Nagara', 'Gopala Gowda Extension'],
    latitude: 13.9299,
    longitude: 75.5681
  },
  {
    name: 'Davangere',
    state: 'Karnataka',
    aliases: ['Davanagere'],
    popularAreas: ['MCC A Block', 'MCC B Block', 'PJ Extension', 'KB Extension'],
    latitude: 14.4644,
    longitude: 75.9218
  },

  // Maharashtra
  {
    name: 'Mumbai',
    state: 'Maharashtra',
    aliases: ['Bombay', 'BOM'],
    popularAreas: ['Bandra', 'Andheri', 'Juhu', 'Colaba', 'Powai', 'Worli', 'Lower Parel', 'Dadar', 'Borivali', 'Goregaon'],
    latitude: 19.0760,
    longitude: 72.8777
  },
  {
    name: 'Pune',
    state: 'Maharashtra',
    aliases: ['Poona', 'PNQ'],
    popularAreas: ['Koregaon Park', 'Kothrud', 'Viman Nagar', 'Baner', 'Aundh', 'Hinjawadi', 'FC Road', 'Kalyani Nagar', 'Wakad'],
    latitude: 18.5204,
    longitude: 73.8567
  },
  {
    name: 'Nagpur',
    state: 'Maharashtra',
    aliases: [],
    popularAreas: ['Dharampeth', 'Civil Lines', 'Sadar', 'Ramdaspeth', 'Sitabuldi'],
    latitude: 21.1458,
    longitude: 79.0882
  },
  {
    name: 'Thane',
    state: 'Maharashtra',
    aliases: [],
    popularAreas: ['Ghodbunder Road', 'Panchpakhadi', 'Majiwada', 'Naupada', 'Vasant Vihar'],
    latitude: 19.2183,
    longitude: 72.9781
  },
  {
    name: 'Nashik',
    state: 'Maharashtra',
    aliases: ['Nasik'],
    popularAreas: ['College Road', 'Gangapur Road', 'Indira Nagar', 'Panchavati'],
    latitude: 19.9975,
    longitude: 73.7898
  },
  {
    name: 'Navi Mumbai',
    state: 'Maharashtra',
    aliases: [],
    popularAreas: ['Vashi', 'Nerul', 'Kharghar', 'Belapur', 'Seawoods', 'Airoli'],
    latitude: 19.0330,
    longitude: 73.0297
  },
  {
    name: 'Aurangabad',
    state: 'Maharashtra',
    aliases: ['Chhatrapati Sambhajinagar'],
    popularAreas: ['Cidco', 'Samarth Nagar', 'Osmanpura', 'Garkheda'],
    latitude: 19.8762,
    longitude: 75.3433
  },

  // Delhi NCR
  {
    name: 'Delhi',
    state: 'Delhi',
    aliases: ['New Delhi', 'NCR', 'DEL'],
    popularAreas: ['Connaught Place', 'Hauz Khas', 'Saket', 'Khan Market', 'Lajpat Nagar', 'Karol Bagh', 'Dwarka', 'Rohini', 'Vasant Kunj'],
    latitude: 28.6139,
    longitude: 77.2090
  },
  {
    name: 'Gurugram',
    state: 'Haryana',
    aliases: ['Gurgaon'],
    popularAreas: ['Cyber Hub', 'Golf Course Road', 'Sector 29', 'Sohna Road', 'DLF Phase 1-5', 'MG Road'],
    latitude: 28.4595,
    longitude: 77.0266
  },
  {
    name: 'Noida',
    state: 'Uttar Pradesh',
    aliases: ['Greater Noida'],
    popularAreas: ['Sector 18', 'Sector 62', 'Sector 137', 'Sector 50', 'Greater Noida Knowledge Park'],
    latitude: 28.5355,
    longitude: 77.3910
  },

  // Telangana & Andhra Pradesh
  {
    name: 'Hyderabad',
    state: 'Telangana',
    aliases: ['HYD', 'Secunderabad'],
    popularAreas: ['Banjara Hills', 'Jubilee Hills', 'Gachibowli', 'Hitec City', 'Madhapur', 'Kondapur', 'Kukatpally', 'Begumpet', 'Ameerpet'],
    latitude: 17.3850,
    longitude: 78.4867
  },
  {
    name: 'Warangal',
    state: 'Telangana',
    aliases: ['Hanamkonda', 'Kazipet'],
    popularAreas: ['Hanamkonda', 'Kazipet', 'Subedari', 'Naimnagar'],
    latitude: 17.9689,
    longitude: 79.5941
  },
  {
    name: 'Visakhapatnam',
    state: 'Andhra Pradesh',
    aliases: ['Vizag'],
    popularAreas: ['MVP Colony', 'Siripuram', 'Gajuwaka', 'Beach Road', 'Dwaraka Nagar', 'Rushikonda'],
    latitude: 17.6868,
    longitude: 83.2185
  },
  {
    name: 'Vijayawada',
    state: 'Andhra Pradesh',
    aliases: ['Bezawada'],
    popularAreas: ['Benz Circle', 'MG Road', 'Governorpet', 'Moghalrajpuram', 'Patamata'],
    latitude: 16.5062,
    longitude: 80.6480
  },
  {
    name: 'Tirupati',
    state: 'Andhra Pradesh',
    aliases: [],
    popularAreas: ['Bhavani Nagar', 'KT Road', 'Alipiri Road', 'Air Bypass Road'],
    latitude: 13.6288,
    longitude: 79.4192
  },

  // Tamil Nadu
  {
    name: 'Chennai',
    state: 'Tamil Nadu',
    aliases: ['Madras', 'MAA'],
    popularAreas: ['T. Nagar', 'Anna Nagar', 'Adyar', 'Besant Nagar', 'Alwarpet', 'Nungambakkam', 'Velachery', 'OMR', 'Mylapore'],
    latitude: 13.0827,
    longitude: 80.2707
  },
  {
    name: 'Coimbatore',
    state: 'Tamil Nadu',
    aliases: ['Kovai'],
    popularAreas: ['RS Puram', 'Gandhipuram', 'Peelamedu', 'Race Course', 'Saibaba Colony'],
    latitude: 11.0168,
    longitude: 76.9558
  },
  {
    name: 'Madurai',
    state: 'Tamil Nadu',
    aliases: [],
    popularAreas: ['KK Nagar', 'Anna Nagar', 'Simmakkal', 'Town Hall Road'],
    latitude: 9.9252,
    longitude: 78.1198
  },

  // West Bengal
  {
    name: 'Kolkata',
    state: 'West Bengal',
    aliases: ['Calcutta', 'CCU'],
    popularAreas: ['Park Street', 'Salt Lake', 'New Town', 'Ballygunge', 'Gariahat', 'Sector V', 'Alipore', 'Behala'],
    latitude: 22.5726,
    longitude: 88.3639
  },

  // Gujarat
  {
    name: 'Ahmedabad',
    state: 'Gujarat',
    aliases: ['Amdavad', 'AMD'],
    popularAreas: ['Navrangpura', 'SG Highway', 'Bodakdev', 'Vastrapur', 'Prahlad Nagar', 'Satellite', 'Maninagar'],
    latitude: 23.0225,
    longitude: 72.5714
  },
  {
    name: 'Surat',
    state: 'Gujarat',
    aliases: [],
    popularAreas: ['Adajan', 'Vesu', 'Piplod', 'Ghopad Road', 'Varachha'],
    latitude: 21.1702,
    longitude: 72.8311
  },
  {
    name: 'Vadodara',
    state: 'Gujarat',
    aliases: ['Baroda'],
    popularAreas: ['Alkapuri', 'Sayajigunj', 'Gotri', 'Fatehgunj', 'Manjalpur'],
    latitude: 22.3072,
    longitude: 73.1812
  },

  // Rajasthan
  {
    name: 'Jaipur',
    state: 'Rajasthan',
    aliases: ['Pink City', 'JAI'],
    popularAreas: ['C-Scheme', 'Malviya Nagar', 'Vaishali Nagar', 'Mansarovar', 'Tonk Road', 'Raja Park'],
    latitude: 26.9124,
    longitude: 75.7873
  },
  {
    name: 'Udaipur',
    state: 'Rajasthan',
    aliases: ['City of Lakes'],
    popularAreas: ['Fateh Sagar', 'Hiran Magri', 'Panchwati', 'Old City'],
    latitude: 24.5854,
    longitude: 73.7125
  },

  // Kerala
  {
    name: 'Kochi',
    state: 'Kerala',
    aliases: ['Cochin', 'Ernakulam'],
    popularAreas: ['Kakkanad', 'Panampilly Nagar', 'Fort Kochi', 'MG Road', 'Edappally', 'Kaloor'],
    latitude: 9.9312,
    longitude: 76.2673
  },
  {
    name: 'Thiruvananthapuram',
    state: 'Kerala',
    aliases: ['Trivandrum'],
    popularAreas: ['Kowdiar', 'Vellayambalam', 'Pattom', 'Kazhakoottam', 'Palayam'],
    latitude: 8.5241,
    longitude: 76.9366
  },

  // Punjab & Chandigarh
  {
    name: 'Chandigarh',
    state: 'Chandigarh',
    aliases: ['Mohali', 'Panchkula', 'Tricity'],
    popularAreas: ['Sector 17', 'Sector 35', 'Sector 26', 'Sector 8', 'Phase 3B2 Mohali', 'Sector 9 Panchkula'],
    latitude: 30.7333,
    longitude: 76.7794
  },
  {
    name: 'Amritsar',
    state: 'Punjab',
    aliases: [],
    popularAreas: ['Ranjit Avenue', 'Mall Road', 'Lawrence Road', 'Golden Temple Area'],
    latitude: 31.6340,
    longitude: 74.8723
  },

  // Uttar Pradesh & Uttarakhand
  {
    name: 'Lucknow',
    state: 'Uttar Pradesh',
    aliases: ['LKO'],
    popularAreas: ['Gomti Nagar', 'Hazratganj', 'Aliganj', 'Indira Nagar', 'Mahanagar', 'Alambagh'],
    latitude: 26.8467,
    longitude: 80.9462
  },
  {
    name: 'Kanpur',
    state: 'Uttar Pradesh',
    aliases: [],
    popularAreas: ['Civil Lines', 'Swaroop Nagar', 'Kakadeo', 'Mall Road'],
    latitude: 26.4499,
    longitude: 80.3319
  },
  {
    name: 'Dehradun',
    state: 'Uttarakhand',
    aliases: [],
    popularAreas: ['Rajpur Road', 'Jakhan', 'Dalanwala', 'Chakrata Road'],
    latitude: 30.3165,
    longitude: 78.0322
  },

  // Goa
  {
    name: 'Goa',
    state: 'Goa',
    aliases: ['Panaji', 'Panjim', 'Margao'],
    popularAreas: ['Panaji', 'Calangute', 'Candolim', 'Anjuna', 'Margao', 'Vagator', 'Assagao'],
    latitude: 15.2993,
    longitude: 74.1240
  },

  // Madhya Pradesh
  {
    name: 'Indore',
    state: 'Madhya Pradesh',
    aliases: [],
    popularAreas: ['Vijay Nagar', 'Palasia', 'Chappan Dukan', 'Sarafa Bazar', 'Bhawarkua'],
    latitude: 22.7196,
    longitude: 75.8577
  },
  {
    name: 'Bhopal',
    state: 'Madhya Pradesh',
    aliases: [],
    popularAreas: ['Arera Colony', 'MP Nagar', 'TT Nagar', 'Hoshangabad Road'],
    latitude: 23.2599,
    longitude: 77.4126
  },

  // Bihar & Jharkhand
  {
    name: 'Patna',
    state: 'Bihar',
    aliases: [],
    popularAreas: ['Boring Road', 'Kankarbagh', 'Bailey Road', 'Frazer Road', 'Patliputra'],
    latitude: 25.5941,
    longitude: 85.1376
  },
  {
    name: 'Ranchi',
    state: 'Jharkhand',
    aliases: [],
    popularAreas: ['Main Road', 'Lalpur', 'Harmu', 'Doranda', 'Kanke Road'],
    latitude: 23.3441,
    longitude: 85.3096
  },

  // Odisha
  {
    name: 'Bhubaneswar',
    state: 'Odisha',
    aliases: ['Bhubaneshwar'],
    popularAreas: ['Saheed Nagar', 'Patia', 'Jayadev Vihar', 'Nayapalli', 'Khandagiri'],
    latitude: 20.2961,
    longitude: 85.8245
  },

  // Assam / North East
  {
    name: 'Guwahati',
    state: 'Assam',
    aliases: ['Gauhati'],
    popularAreas: ['GS Road', 'Christian Basti', 'Ulubari', 'Zoo Road', 'Paltan Bazaar'],
    latitude: 26.1445,
    longitude: 91.7362
  }
];

/**
 * Calculates distance in kilometers between two GPS coordinates using Haversine formula.
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Resolves the closest Indian city from coordinates if within a safe threshold (< 70 km).
 * Returns null if no city matches safely, preventing arbitrary city invention.
 */
export function resolveClosestCityFromCoordinates(
  lat: number,
  lon: number,
  maxThresholdKm: number = 70
): IndianCity | null {
  if (typeof lat !== 'number' || typeof lon !== 'number' || isNaN(lat) || isNaN(lon)) {
    return null;
  }

  let closestCity: IndianCity | null = null;
  let minDistance = Infinity;

  for (const city of INDIAN_CITIES) {
    if (city.latitude !== undefined && city.longitude !== undefined) {
      const dist = calculateHaversineDistanceKm(lat, lon, city.latitude, city.longitude);
      if (dist < minDistance) {
        minDistance = dist;
        closestCity = city;
      }
    }
  }

  if (closestCity && minDistance <= maxThresholdKm) {
    return closestCity;
  }

  return null;
}

/**
 * Searches the Indian cities dataset by search term (matches name, state, aliases, or popular areas).
 */
export function searchIndianCities(searchTerm: string): IndianCity[] {
  const term = searchTerm.trim().toLowerCase();
  if (!term) return INDIAN_CITIES;

  return INDIAN_CITIES.filter((city) => {
    if (city.name.toLowerCase().includes(term)) return true;
    if (city.state.toLowerCase().includes(term)) return true;
    if (city.aliases?.some((a) => a.toLowerCase().includes(term))) return true;
    if (city.popularAreas.some((area) => area.toLowerCase().includes(term))) return true;
    return false;
  });
}

/**
 * Finds exact city match by name or alias.
 */
export function findIndianCityByName(cityName: string): IndianCity | undefined {
  const term = cityName.trim().toLowerCase();
  if (!term) return undefined;

  return INDIAN_CITIES.find(
    (c) =>
      c.name.toLowerCase() === term ||
      c.aliases?.some((a) => a.toLowerCase() === term)
  );
}
