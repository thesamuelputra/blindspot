// Static BC Ferries fleet specs, keyed by slugified vessel name (matches the
// bc-ferries feed extId). Public fleet data. Agents expand toward the full
// ~35-vessel roster; routeNames decode the route codes the feed emits.
export interface FerrySpec {
  name: string;
  class?: string;
  builtYear?: number;
  carCapacity?: number;
  passengerCapacity?: number;
  lengthM?: number;
  serviceSpeedKn?: number;
}

export const FERRY_FLEET: Record<string, FerrySpec> = {
  'spirit-of-british-columbia': { name: 'Spirit of British Columbia', class: 'Spirit', builtYear: 1993, carCapacity: 358, passengerCapacity: 2100, lengthM: 167, serviceSpeedKn: 19 },
  'spirit-of-vancouver-island': { name: 'Spirit of Vancouver Island', class: 'Spirit', builtYear: 1994, carCapacity: 358, passengerCapacity: 2100, lengthM: 167, serviceSpeedKn: 19 },
  'coastal-celebration': { name: 'Coastal Celebration', class: 'Coastal', builtYear: 2008, carCapacity: 370, passengerCapacity: 1650, lengthM: 160, serviceSpeedKn: 23 },
  'coastal-inspiration': { name: 'Coastal Inspiration', class: 'Coastal', builtYear: 2008, carCapacity: 370, passengerCapacity: 1650, lengthM: 160, serviceSpeedKn: 23 },
  'coastal-renaissance': { name: 'Coastal Renaissance', class: 'Coastal', builtYear: 2008, carCapacity: 370, passengerCapacity: 1650, lengthM: 160, serviceSpeedKn: 23 },
  'queen-of-new-westminster': { name: 'Queen of New Westminster', class: 'V', builtYear: 1964, carCapacity: 320, passengerCapacity: 1426, lengthM: 139, serviceSpeedKn: 19 },
  'queen-of-alberni': { name: 'Queen of Alberni', class: 'C', builtYear: 1976, carCapacity: 280, passengerCapacity: 1200, lengthM: 139, serviceSpeedKn: 20 },
  'queen-of-coquitlam': { name: 'Queen of Coquitlam', class: 'C', builtYear: 1976, carCapacity: 280, passengerCapacity: 1492, lengthM: 139, serviceSpeedKn: 20 },
  'queen-of-cowichan': { name: 'Queen of Cowichan', class: 'C', builtYear: 1976, carCapacity: 280, passengerCapacity: 1466, lengthM: 139, serviceSpeedKn: 20 },
  'queen-of-oak-bay': { name: 'Queen of Oak Bay', class: 'C', builtYear: 1981, carCapacity: 280, passengerCapacity: 1494, lengthM: 139, serviceSpeedKn: 20 },
  'queen-of-surrey': { name: 'Queen of Surrey', class: 'C', builtYear: 1981, carCapacity: 280, passengerCapacity: 1494, lengthM: 139, serviceSpeedKn: 20 },
  'coastal-naden': { name: 'Coastal Naden', class: 'Island', builtYear: 2020, carCapacity: 47, passengerCapacity: 300, lengthM: 81, serviceSpeedKn: 15 },
  'island-discovery': { name: 'Island Discovery', class: 'Island', builtYear: 2022, carCapacity: 47, passengerCapacity: 300, lengthM: 81, serviceSpeedKn: 15 },
  'island-aurora': { name: 'Island Aurora', class: 'Island', builtYear: 2021, carCapacity: 47, passengerCapacity: 300, lengthM: 81, serviceSpeedKn: 15 },
  'skeena-queen': { name: 'Skeena Queen', builtYear: 1997, carCapacity: 92, passengerCapacity: 450, lengthM: 80, serviceSpeedKn: 14 },
  'mayne-queen': { name: 'Mayne Queen', builtYear: 1965, carCapacity: 70, passengerCapacity: 400, lengthM: 60, serviceSpeedKn: 13 },
  'bowen-queen': { name: 'Bowen Queen', builtYear: 1965, carCapacity: 70, passengerCapacity: 400, lengthM: 60, serviceSpeedKn: 13 },
};

// BC Ferries route codes → readable origin/destination.
export const FERRY_ROUTES: Record<string, string> = {
  TSASWB: 'Tsawwassen to Swartz Bay',
  SWBTSA: 'Swartz Bay to Tsawwassen',
  TSADUK: 'Tsawwassen to Duke Point (Nanaimo)',
  DUKTSA: 'Duke Point (Nanaimo) to Tsawwassen',
  HSBNAN: 'Horseshoe Bay to Departure Bay (Nanaimo)',
  NANHSB: 'Departure Bay (Nanaimo) to Horseshoe Bay',
  HSBLNG: 'Horseshoe Bay to Langdale',
  LNGHSB: 'Langdale to Horseshoe Bay',
  SWBFUL: 'Swartz Bay to Fulford Harbour (Salt Spring)',
  SWBSGI: 'Swartz Bay to Southern Gulf Islands',
};

export function lookupFerry(extId: string): FerrySpec | null {
  return FERRY_FLEET[extId] ?? null;
}
