/** Geometry for ground truth, written independently of the tools under test. */

/** Mean Earth radius in kilometres (IUGG). */
export const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle (haversine) distance in kilometres between `{ lat, lon }` points. */
export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const sinLat = Math.sin(((b.lat - a.lat) * rad) / 2);
  const sinLon = Math.sin(((b.lon - a.lon) * rad) / 2);
  const h =
    sinLat * sinLat +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * sinLon * sinLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Records within 1% of a radius boundary make a count ambiguous. */
export const EDGE_MARGIN = 0.01;

/**
 * Split records with `lat`/`lon` around a circle into those clearly inside,
 * and those so close to the edge that another distance formula or
 * representative point could put them on the other side.
 */
export function splitByRadius(records, center, radiusKm, margin = EDGE_MARGIN) {
  const inside = [];
  const edge = [];
  for (const record of records) {
    const distance = distanceKm(center, record);
    if (Math.abs(distance - radiusKm) <= radiusKm * margin) edge.push(record);
    else if (distance < radiusKm)
      inside.push({ ...record, distanceKm: distance });
  }
  return { inside, edge };
}
