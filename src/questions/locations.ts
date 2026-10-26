/**
 * Places questions are asked about. Questions give the coordinates; the names
 * are geocoded while recording so an agent that searches by name still gets
 * an answer (a box around the place, not the stated radius).
 */

export interface Location {
  name: string;
  lat: number;
  lon: number;
}

export const LOCATIONS: readonly Location[] = Object.freeze([
  { name: 'Tokyo', lat: 35.68, lon: 139.69 },
  { name: 'Anchorage', lat: 61.22, lon: -149.9 },
  { name: 'Los Angeles', lat: 34.05, lon: -118.24 },
  { name: 'San Diego', lat: 32.72, lon: -117.16 },
  { name: 'Santiago, Chile', lat: -33.45, lon: -70.67 },
  { name: 'Jakarta', lat: -6.21, lon: 106.85 },
  { name: 'Manila', lat: 14.6, lon: 120.98 },
  { name: 'Reykjavik', lat: 64.15, lon: -21.94 },
  { name: 'Athens', lat: 37.98, lon: 23.73 },
  { name: 'Honolulu', lat: 21.31, lon: -157.86 },
  { name: 'Mexico City', lat: 19.43, lon: -99.13 },
  { name: 'Lima', lat: -12.05, lon: -77.04 },
  { name: 'Norfolk, Virginia', lat: 36.85, lon: -76.29 },
  { name: 'Kaiserslautern', lat: 49.44, lon: 7.77 },
  { name: 'Washington, D.C.', lat: 38.9, lon: -77.04 },
  { name: 'Ashburn, Virginia', lat: 39.04, lon: -77.49 },
  { name: 'Hagåtña, Guam', lat: 13.47, lon: 144.75 },
  { name: 'Naha, Okinawa', lat: 26.21, lon: 127.68 },
  { name: 'Dallas', lat: 32.78, lon: -96.8 },
  { name: 'Frankfurt', lat: 50.11, lon: 8.68 },
  { name: 'Singapore', lat: 1.35, lon: 103.82 },
  { name: 'Wellington', lat: -41.29, lon: 174.78 },
  { name: 'Istanbul', lat: 41.01, lon: 28.98 },
  { name: 'Seattle', lat: 47.61, lon: -122.33 },
  { name: 'Miami', lat: 25.76, lon: -80.19 },
]);
