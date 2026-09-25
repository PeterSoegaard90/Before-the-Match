// Spilområdet: Latinerkvarteret, Åboulevarden, Store Torv, Strøget → Banegården,
// Rådhuspladsen og ARoS. Origo (0,0) ligger midt i området.
export const BBOX = { south: 56.1488, west: 10.1965, north: 56.1612, east: 10.2158 };
export const ORIGIN = { lat: 56.1552, lon: 10.2062 };

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** WGS84 → lokale meter. x = øst, z = syd (Three.js: -z er nord). */
export function project(lat: number, lon: number): [number, number] {
  return [
    +((lon - ORIGIN.lon) * M_PER_DEG_LON).toFixed(2),
    +(-(lat - ORIGIN.lat) * M_PER_DEG_LAT).toFixed(2),
  ];
}
