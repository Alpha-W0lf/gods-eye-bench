# 0006. Commit only data that may be redistributed

**Status:** Accepted, 2026-10-03

## Context

God's Eye View's code is MIT, but its feeds have their own terms. A public
benchmark must not republish data it has no right to share.

## Decision

`config/sources.json` lists every source the recorder may store, with its
license and credit, checked against the source's own terms on 2026-10-03.
Anything else is never written. Each source's files sit in their own snapshot
folder with a `NOTICE.md`; ODbL data stays ODbL.

| Source                                               | Terms                                               | In public snapshots                                  |
| ---------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| USGS earthquakes                                     | U.S. public domain                                  | Yes, credited                                        |
| NOAA NHC/CPHC cyclones (via God's Eye View's server) | U.S. public domain; not to be presented as official | Yes, with a not-official note                        |
| Launch Library 2 (The Space Devs)                    | Free to use and share; asks for added value         | Yes, credited; the benchmark is the added value      |
| adsb.lol military aircraft                           | ODbL 1.0                                            | Yes, under ODbL                                      |
| OpenStreetMap Nominatim geocodes                     | ODbL 1.0; at most one request per second            | Yes, under ODbL; a few names, recorded once          |
| NASA FIRMS, AISStream                                | Need keys                                           | Only the keyless error responses, which hold no data |
| OpenSky                                              | Non-profit research only; no redistribution         | No                                                   |
| CelesTrak                                            | No license found                                    | No                                                   |
| NIFC WFIGS perimeters                                | No license stated                                   | No                                                   |

Datacenter data is read from the pinned God's Eye View
checkout, never copied here.

## Consequences

v0.1 asks no questions about civil aircraft, satellites or fire perimeters. A
recorder run against those sources is possible locally, but the result stays
out of git.
