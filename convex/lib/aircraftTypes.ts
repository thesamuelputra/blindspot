// Static ICAO type-designator → intrinsic specs. Covers the common Vancouver
// Island traffic (regional turboprops, narrowbodies, floatplanes, helicopters,
// GA). Agents expand this; the enrichment falls back to the hexdb type name
// when a designator is missing here.
export interface AircraftTypeSpec {
  name: string; // human name
  role: 'airliner' | 'regional' | 'floatplane' | 'ga' | 'helicopter' | 'business' | 'cargo' | 'military';
  pax?: number; // typical max passengers
  engines?: string; // e.g. "2× turbofan"
  cruiseKt?: number;
  mtowKg?: number;
}

export const AIRCRAFT_TYPES: Record<string, AircraftTypeSpec> = {
  // regional turboprops — the VI workhorses
  DH8A: { name: 'Bombardier Dash 8-100', role: 'regional', pax: 39, engines: '2× PW120 turboprop', cruiseKt: 268 },
  DH8B: { name: 'Bombardier Dash 8-200', role: 'regional', pax: 39, engines: '2× PW123 turboprop', cruiseKt: 290 },
  DH8C: { name: 'Bombardier Dash 8-300', role: 'regional', pax: 50, engines: '2× PW123 turboprop', cruiseKt: 287 },
  DH8D: { name: 'Bombardier Dash 8-400', role: 'regional', pax: 78, engines: '2× PW150A turboprop', cruiseKt: 360, mtowKg: 30000 },
  AT72: { name: 'ATR 72', role: 'regional', pax: 72, engines: '2× PW127 turboprop', cruiseKt: 276 },
  AT76: { name: 'ATR 72-600', role: 'regional', pax: 78, engines: '2× PW127 turboprop', cruiseKt: 276 },
  SF34: { name: 'Saab 340', role: 'regional', pax: 34, engines: '2× CT7 turboprop', cruiseKt: 250 },
  BE99: { name: 'Beechcraft 99', role: 'regional', pax: 15, engines: '2× PT6A turboprop', cruiseKt: 247 },
  B190: { name: 'Beechcraft 1900', role: 'regional', pax: 19, engines: '2× PT6A turboprop', cruiseKt: 280 },

  // floatplanes / bush — Harbour Air, Pacific Coastal
  DHC6: { name: 'DHC-6 Twin Otter', role: 'floatplane', pax: 19, engines: '2× PT6A turboprop', cruiseKt: 160 },
  DHC2: { name: 'DHC-2 Beaver', role: 'floatplane', pax: 6, engines: '1× radial / turbine', cruiseKt: 130 },
  DHC3: { name: 'DHC-3 Otter', role: 'floatplane', pax: 10, engines: '1× turbine', cruiseKt: 130 },
  C208: { name: 'Cessna 208 Caravan', role: 'floatplane', pax: 9, engines: '1× PT6A turboprop', cruiseKt: 186 },

  // narrowbodies
  B737: { name: 'Boeing 737-700', role: 'airliner', pax: 149, engines: '2× CFM56 turbofan', cruiseKt: 453 },
  B738: { name: 'Boeing 737-800', role: 'airliner', pax: 189, engines: '2× CFM56 turbofan', cruiseKt: 453, mtowKg: 79000 },
  B39M: { name: 'Boeing 737 MAX 9', role: 'airliner', pax: 220, engines: '2× LEAP-1B turbofan', cruiseKt: 453 },
  B38M: { name: 'Boeing 737 MAX 8', role: 'airliner', pax: 210, engines: '2× LEAP-1B turbofan', cruiseKt: 453 },
  A319: { name: 'Airbus A319', role: 'airliner', pax: 156, engines: '2× turbofan', cruiseKt: 447 },
  A320: { name: 'Airbus A320', role: 'airliner', pax: 180, engines: '2× turbofan', cruiseKt: 447, mtowKg: 78000 },
  A21N: { name: 'Airbus A321neo', role: 'airliner', pax: 244, engines: '2× turbofan', cruiseKt: 453 },
  A20N: { name: 'Airbus A320neo', role: 'airliner', pax: 195, engines: '2× turbofan', cruiseKt: 450 },
  E75L: { name: 'Embraer E175', role: 'regional', pax: 88, engines: '2× CF34 turbofan', cruiseKt: 447 },
  CRJ9: { name: 'Bombardier CRJ900', role: 'regional', pax: 90, engines: '2× CF34 turbofan', cruiseKt: 470 },

  // widebodies (overflights)
  A332: { name: 'Airbus A330-200', role: 'airliner', pax: 247, engines: '2× turbofan', cruiseKt: 470 },
  A333: { name: 'Airbus A330-300', role: 'airliner', pax: 277, engines: '2× turbofan', cruiseKt: 470 },
  B763: { name: 'Boeing 767-300', role: 'airliner', pax: 269, engines: '2× turbofan', cruiseKt: 459 },
  B77W: { name: 'Boeing 777-300ER', role: 'airliner', pax: 396, engines: '2× GE90 turbofan', cruiseKt: 482 },

  // helicopters — air ambulance, Coast Guard, utility, RCAF
  B06: { name: 'Bell 206 JetRanger', role: 'helicopter', pax: 4, engines: '1× turboshaft', cruiseKt: 117 },
  B212: { name: 'Bell 212', role: 'helicopter', pax: 14, engines: '2× turboshaft', cruiseKt: 100 },
  B412: { name: 'Bell 412', role: 'helicopter', pax: 13, engines: '2× turboshaft', cruiseKt: 122 },
  H125: { name: 'Airbus H125 (AS350)', role: 'helicopter', pax: 6, engines: '1× turboshaft', cruiseKt: 137 },
  EC35: { name: 'Airbus H135', role: 'helicopter', pax: 7, engines: '2× turboshaft', cruiseKt: 137 },
  S92: { name: 'Sikorsky S-92', role: 'helicopter', pax: 19, engines: '2× turboshaft', cruiseKt: 151 },
  CH47: { name: 'Boeing CH-147 Chinook', role: 'military', pax: 33, engines: '2× turboshaft', cruiseKt: 160 },
  CL60: { name: 'AW101 / CH-149 Cormorant', role: 'military', pax: 30, engines: '3× turboshaft', cruiseKt: 150 },

  // business / GA
  C172: { name: 'Cessna 172', role: 'ga', pax: 3, engines: '1× piston', cruiseKt: 122 },
  C182: { name: 'Cessna 182', role: 'ga', pax: 3, engines: '1× piston', cruiseKt: 145 },
  PC12: { name: 'Pilatus PC-12', role: 'business', pax: 9, engines: '1× PT6A turboprop', cruiseKt: 280 },
  C25A: { name: 'Cessna Citation CJ2', role: 'business', pax: 7, engines: '2× turbofan', cruiseKt: 410 },
  GLF5: { name: 'Gulfstream G550', role: 'business', pax: 16, engines: '2× turbofan', cruiseKt: 488 },
};

export function lookupAircraftType(icaoType: string | undefined): AircraftTypeSpec | null {
  if (!icaoType) return null;
  return AIRCRAFT_TYPES[icaoType.toUpperCase()] ?? null;
}
