/**
 * Parsers that turn recorded feed responses into plain records for ground
 * truth. They read the raw responses directly, never through the tools under
 * test, and decide each feed's data status from the servers' own signals.
 *
 * Every parser takes a response `{ status, headers, body }` (or undefined when
 * the snapshot lacks it) and returns `{ status, ...records }`, where status is
 * `complete`, `stale` or `unavailable`.
 */

const UNAVAILABLE = Object.freeze({ status: 'unavailable' });

function readJson(response) {
  if (!response || response.status < 200 || response.status >= 300) return null;
  try {
    return JSON.parse(response.body);
  } catch {
    return null;
  }
}

/**
 * USGS GeoJSON: every event of magnitude 2.5 or more, whatever its event type,
 * which is what the feed and the tools call an earthquake.
 */
export function parseEarthquakes(response) {
  const payload = readJson(response);
  if (!Array.isArray(payload?.features)) return UNAVAILABLE;
  const events = payload.features
    .filter((feature) => Number.isFinite(feature?.properties?.mag))
    .filter((feature) => feature.properties.mag >= 2.5)
    .map((feature) => {
      const [lon, lat, depthKm] = feature.geometry.coordinates;
      return {
        id: String(feature.id),
        magnitude: feature.properties.mag,
        place: feature.properties.place ?? null,
        time: feature.properties.time,
        lat,
        lon,
        depthKm: depthKm ?? null,
      };
    });
  return { status: 'complete', events };
}

/** NOAA NHC/CPHC storms from God's Eye View's cyclone payload. */
export function parseCyclones(response) {
  const payload = readJson(response);
  if (
    !payload ||
    payload.unavailable === true ||
    !Array.isArray(payload.storms)
  )
    return UNAVAILABLE;
  return {
    status: payload.stale === true ? 'stale' : 'complete',
    storms: payload.storms.map((storm) => ({
      name: storm.name,
      classification: storm.classification ?? null,
      basin: storm.basin ?? null,
      windKt: storm.windKt ?? null,
      pressureHpa: storm.pressureHpa ?? null,
      lat: storm.position?.latitude ?? null,
      lon: storm.position?.longitude ?? null,
    })),
  };
}

/** Launch Library 2 launches from God's Eye View's 30-day launch payload. */
export function parseLaunches(response) {
  const payload = readJson(response);
  if (!Array.isArray(payload?.results)) return UNAVAILABLE;
  return {
    status:
      response.headers?.['x-gev-cache'] === 'STALE-ERROR'
        ? 'stale'
        : 'complete',
    launches: payload.results
      .filter((launch) => typeof launch?.name === 'string' && launch.name)
      .map((launch) => ({
        name: launch.name,
        net: launch.net ?? null,
        outcome: launch.status?.name ?? null,
        provider: launch.launch_service_provider?.name ?? null,
        rocket: launch.rocket?.configuration?.full_name ?? null,
        mission: launch.mission?.name ?? null,
        orbit: launch.mission?.orbit?.name ?? null,
        location: launch.pad?.location?.name ?? null,
        countryCode:
          launch.pad?.location?.country_code ??
          launch.pad?.country?.alpha_2_code ??
          null,
      })),
  };
}

/** adsb.lol military aircraft that report a position. */
export function parseMilitaryAircraft(response) {
  const payload = readJson(response);
  if (!Array.isArray(payload?.ac)) return UNAVAILABLE;
  return {
    status:
      response.headers?.['x-ads-b-cache'] === 'STALE' ? 'stale' : 'complete',
    aircraft: payload.ac
      .filter((row) => Number.isFinite(row?.lat) && Number.isFinite(row?.lon))
      .map((row) => ({
        hex: String(row.hex).toLowerCase(),
        callsign: typeof row.flight === 'string' ? row.flight.trim() : '',
        lat: row.lat,
        lon: row.lon,
        onGround: row.alt_baro === 'ground',
        altitudeFt: Number.isFinite(row.alt_baro)
          ? row.alt_baro
          : Number.isFinite(row.alt_geom)
            ? row.alt_geom
            : null,
      })),
  };
}

/** A feed recorded only as its keyless error answer: unavailable unless it holds data. */
export function parseKeylessFeed(response) {
  return response && response.status >= 200 && response.status < 300
    ? { status: 'complete' }
    : UNAVAILABLE;
}
