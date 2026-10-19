# Data in trial logs

The trial logs under `runs/` record what agents read through God's Eye View's
tools, so they contain extracts of the recorded feeds in
[`snapshots/`](../snapshots/). Those extracts are not covered by this
repository's MIT license; each keeps its source's terms, as listed in
[`config/sources.json`](../config/sources.json) and the `NOTICE.md` in each
source's snapshot folder:

- **USGS** earthquakes and **NOAA NHC/CPHC** cyclone advisories: U.S. public
  domain.
- **Launch Library 2** launches: The Space Devs' terms.
- **adsb.lol** aircraft and **OpenStreetMap** geocodes (via Nominatim): Open
  Database License 1.0. © adsb.lol contributors; © OpenStreetMap
  contributors. Extracts in these logs are shared under the same license.
