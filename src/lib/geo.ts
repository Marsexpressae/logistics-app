export type GeoPoint = { lat: number; lng: number };

const valid = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

// String.raw keeps the backslashes literal, so these are real regex escapes.
const NUM = String.raw`-?\d{1,3}(?:\.\d+)?`;

const PATTERNS = [
  new RegExp(String.raw`^(${NUM})\s*[,\s]\s*(${NUM})$`), // plain "lat, lng"
  new RegExp(String.raw`@(${NUM}),(${NUM})`), // .../@25.2,55.3,15z
  new RegExp(String.raw`!3d(${NUM})!4d(${NUM})`), // .../data=!3d25.2!4d55.3
  new RegExp(String.raw`[?&](?:q|query|ll|destination|center)=(${NUM}),\s*(${NUM})`), // ?q=25.2,55.3
];

/**
 * Accepts "25.2048, 55.2708" or a full Google Maps link (@lat,lng, !3d..!4d.., ?q=lat,lng).
 * Short links (maps.app.goo.gl) hide the coordinates, so they return null.
 */
export function parseGeo(input: string): GeoPoint | null {
  let text = input.trim();
  try {
    text = decodeURIComponent(text);
  } catch {
    // malformed % sequence: parse the raw text instead
  }
  if (!text) return null;

  for (const re of PATTERNS) {
    const m = text.match(re);
    if (m && valid(Number(m[1]), Number(m[2]))) return { lat: Number(m[1]), lng: Number(m[2]) };
  }
  return null;
}

export const formatGeo = (lat: number | null, lng: number | null) =>
  lat === null || lng === null ? "" : `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;

/** Google Maps link: exact pin when coordinates exist, otherwise an address search. */
export function mapsUrl(b: { geo_lat: number | null; geo_lng: number | null; pickup_address: string }) {
  const query = b.geo_lat !== null && b.geo_lng !== null ? `${b.geo_lat},${b.geo_lng}` : b.pickup_address;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
