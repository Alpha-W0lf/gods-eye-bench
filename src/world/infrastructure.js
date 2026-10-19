/**
 * Bundled OpenStreetMap infrastructure (datacenters, dams), read from the
 * pinned God's Eye View checkout, never copied into this repository.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const INFRASTRUCTURE_FILES = Object.freeze({
  datacenters: 'src/data/local_data/datacenters/datacenters.geojsonl',
  dams: 'src/data/local_data/dams/dams.geojsonl',
});

/**
 * One representative point per feature: the point itself, or the mean of the
 * outer ring's distinct vertices (a closed ring repeats its first vertex).
 */
export function representativePoint(geometry) {
  const ring =
    geometry?.type === 'Point'
      ? [geometry.coordinates]
      : geometry?.type === 'LineString'
        ? geometry.coordinates
        : geometry?.type === 'Polygon'
          ? geometry.coordinates[0]
          : geometry?.type === 'MultiPolygon'
            ? geometry.coordinates[0]?.[0]
            : null;
  if (!Array.isArray(ring) || !ring.length) return null;
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring.at(-1)[0] &&
    ring[0][1] === ring.at(-1)[1];
  const vertices = (closed ? ring.slice(0, -1) : ring).filter(
    (vertex) => Number.isFinite(vertex?.[0]) && Number.isFinite(vertex?.[1]),
  );
  if (!vertices.length) return null;
  const sum = vertices.reduce(
    ([lon, lat], [x, y]) => [lon + x, lat + y],
    [0, 0],
  );
  return { lon: sum[0] / vertices.length, lat: sum[1] / vertices.length };
}

const tagText = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/**
 * Parse GeoJSON lines into `{ id, name, operator, operatorUnclear, lat, lon }`
 * records. `operator` is the OSM `operator` tag; `operatorUnclear` marks
 * records with no such tag but another operator field, whose operator a
 * reader could take either way.
 */
export function parseInfrastructure(text) {
  const records = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const feature = JSON.parse(line);
    const point = representativePoint(feature.geometry);
    if (!point) continue;
    const tags = feature.properties?.tags ?? {};
    const operator = tagText(tags.operator);
    records.push({
      id: String(feature.properties?.osm_id ?? feature.id),
      name: tags.name ?? null,
      operator,
      operatorUnclear:
        !operator &&
        Boolean(
          tagText(feature.properties?.operator) ||
          tagText(tags['operator:short']),
        ),
      ...point,
    });
  }
  return records;
}

/** Read every bundled infrastructure kind from a God's Eye View checkout. */
export function readInfrastructure(gevDir) {
  return Object.fromEntries(
    Object.entries(INFRASTRUCTURE_FILES).map(([kind, file]) => [
      kind,
      parseInfrastructure(readFileSync(path.join(gevDir, file), 'utf8')),
    ]),
  );
}
