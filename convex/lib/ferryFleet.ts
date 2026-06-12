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

  // ── added: Salish class (LNG-fuelled, intermediate; built 2016, Remontowa) ──
  'salish-orca': { name: 'Salish Orca', class: 'Salish', builtYear: 2016, carCapacity: 138, passengerCapacity: 600, lengthM: 107, serviceSpeedKn: 15.5 },
  'salish-eagle': { name: 'Salish Eagle', class: 'Salish', builtYear: 2016, carCapacity: 138, passengerCapacity: 600, lengthM: 107, serviceSpeedKn: 15.5 },
  'salish-raven': { name: 'Salish Raven', class: 'Salish', builtYear: 2016, carCapacity: 138, passengerCapacity: 600, lengthM: 107, serviceSpeedKn: 15.5 },
  'salish-heron': { name: 'Salish Heron', class: 'Salish', builtYear: 2021, carCapacity: 138, passengerCapacity: 600, lengthM: 107, serviceSpeedKn: 15.5 },

  // ── added: intermediate / I-class (Island Sky renamed Malaspina Sky 2019) ──
  // Keyed under both the historical and current names so the feed's
  // slugify(vesselName) extId matches whichever the API now emits.
  'island-sky': { name: 'Malaspina Sky (ex Island Sky)', class: 'I', builtYear: 2008, carCapacity: 112, passengerCapacity: 450, lengthM: 100, serviceSpeedKn: 14.5 },
  'malaspina-sky': { name: 'Malaspina Sky (ex Island Sky)', class: 'I', builtYear: 2008, carCapacity: 112, passengerCapacity: 450, lengthM: 100, serviceSpeedKn: 14.5 },

  // ── added: cable ferry (Buckley Bay–Denman Island, longest cable crossing) ──
  'baynes-sound-connector': { name: 'Baynes Sound Connector', class: 'Cable', builtYear: 2015, carCapacity: 45, passengerCapacity: 150, lengthM: 78.5, serviceSpeedKn: 8.5 },

  // ── added: Q-class and small/utility vessels serving VI routes ──
  quinsam: { name: 'Quinsam', class: 'Q', builtYear: 1982, carCapacity: 63, passengerCapacity: 400, lengthM: 81, serviceSpeedKn: 12 },
  quinitsa: { name: 'Quinitsa', class: 'Q', builtYear: 1977, carCapacity: 44, passengerCapacity: 394, lengthM: 65, serviceSpeedKn: 12 },
  tachek: { name: 'Tachek', class: 'T', builtYear: 1969, carCapacity: 26, passengerCapacity: 243, lengthM: 49, serviceSpeedKn: 11 },
  klitsa: { name: 'Klitsa', class: 'K', builtYear: 1972, carCapacity: 19, passengerCapacity: 195, lengthM: 47, serviceSpeedKn: 10 },
  kahloke: { name: 'Kahloke', class: 'K', builtYear: 1973, carCapacity: 21, passengerCapacity: 200, lengthM: 55, serviceSpeedKn: 12 },
  kuper: { name: "Pune'luxutth (ex Kuper)", class: 'K', builtYear: 1985, carCapacity: 26, passengerCapacity: 100, lengthM: 49, serviceSpeedKn: 11 },
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

  // ── added: reciprocals of the existing minor-route codes ──
  FULSWB: 'Fulford Harbour (Salt Spring) to Swartz Bay',
  SGISWB: 'Southern Gulf Islands to Swartz Bay',
  // ── added: Tsawwassen–Southern Gulf Islands (Salish-class) ──
  TSASGI: 'Tsawwassen to Southern Gulf Islands',
  SGITSA: 'Southern Gulf Islands to Tsawwassen',
  // ── added: Comox (Little River) ⇄ Powell River (Westview), Salish-class ──
  CMXPWR: 'Comox (Little River) to Powell River (Westview)',
  PWRCMX: 'Powell River (Westview) to Comox (Little River)',
  // ── added: Bowen Island (BOW terminal code) ──
  HSBBOW: 'Horseshoe Bay to Snug Cove (Bowen Island)',
  BOWHSB: 'Snug Cove (Bowen Island) to Horseshoe Bay',
};

export function lookupFerry(extId: string): FerrySpec | null {
  return FERRY_FLEET[extId] ?? null;
}
