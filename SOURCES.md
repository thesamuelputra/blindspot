# SOURCES.md — Verified data-feed catalog

> **Phase 0 gate artifact.** Every entry below was checked with live requests on 2026-06-11 (16 recon agents + 3 addendum agents, ~750 endpoint checks). Statuses: **VERIFIED** = real data observed; **NEEDS-KEY** = endpoint confirmed live/documented but requires a key (signup documented); **VERIFY-FAILED** = could not confirm (what failed is recorded); **EXCLUDED** = legally/ethically unusable — do not build.
>
> The catalog is a floor, not a ceiling. `NEW` marks sources discovered during recon beyond the brief. Feed modules in Phase 3 must conform to the endpoint/auth/cadence/attribution facts recorded here; if reality diverges at build time, update this file in the same commit.

**Totals:** 158 sources — 127 verified · 20 needs-key · 7 verify-failed · 4 excluded.

| Cluster | Sources | Verified | Needs-key | Failed | Excluded |
|---|---|---|---|---|---|
| Weather & Atmosphere | 10 | 9 | 0 | 0 | 1 |
| Seismic & Tsunami | 11 | 9 | 2 | 0 | 0 |
| Space Weather | 5 | 5 | 0 | 0 | 0 |
| Skies (Air) | 11 | 10 | 0 | 1 | 0 |
| Seas (Marine) | 16 | 13 | 2 | 1 | 0 |
| Ground (Mobility) | 7 | 6 | 1 | 0 | 0 |
| RF / Signals | 11 | 7 | 2 | 0 | 2 |
| Infrastructure / Network / Cyber | 12 | 8 | 3 | 1 | 0 |
| Wildfire | 8 | 7 | 1 | 0 | 0 |
| Environment & Conditions | 14 | 12 | 2 | 0 | 0 |
| Space (Objects) | 9 | 8 | 1 | 0 | 0 |
| Pulse (News / Civic / Events) | 24 | 18 | 2 | 3 | 1 |
| World Mode (Global) | 10 | 7 | 3 | 0 | 0 |
| Cameras & Live Media (flagship) | 10 | 8 | 1 | 1 | 0 |

## Weather & Atmosphere

> Honest assessment: this is the strongest possible cluster for a Canadian build - four of five assigned sources verified with live data, zero keys needed, and everything ECCC sits under one licence (Data Servers End-use Licence v2.1, attribution mandatory) with Access-Control-Allow-Origin:* on both geo.weather.gc.ca and api.weather.gc.ca, so the browser could even load WMS rasters directly instead of proxying through Convex (still proxy the JSON feeds for caching/dedupe). The one real gap is lightning: Blitzortung is legally unusable for app ingestion (private/entertainment only, no sanctioned API, storm-warning use explicitly banned), and the free legal substitute (GeoMet Lightning_2.5km_Density) is a 10-minute density raster, not point strikes - accept that limitation or budget for Vaisala/Earth Networks later, or host a Blitzortung detector station to earn participant data rights. Cadence honesty: nothing here is truly real-time except swob-realtime (minutely station obs) and alert issuance; radar is PT6M, lightning/satellite PT10M, citypage ~hourly conditions, AQHI hourly, Open-Meteo current is a 900s model blend - schedule Convex crons to match and do not advertise fresher than the data. GeoMet's time dimensions use nearestValue=0, so cache the advertised extent (via &layer=NAME filtered GetCapabilities, never the 38 MB full doc) and request exact frame timestamps for animation. Coverage note: composite radar thins offshore west of Tofino; GOES-West satellite is the only full-offshore layer. Recommended build order: 1) weather-alerts poller (fast, tiny payloads, Polygon geometries drop straight into deck.gl), 2) RADAR_1KM_RRAI WMS layer with 6-min frame animation, 3) citypageweather-realtime for the conditions panel, 4) GOES-West_1km_DayVis-NightIR + Lightning_2.5km_Density map layers, 5) swob-realtime storm-mode detail, 6) AQHI + Open-Meteo as enrichment. Open-Meteo free tier is non-commercial only - fine for a single-operator tool, revisit if BlindSpot is ever sold or made public. Sources consulted beyond live endpoints: eccc-msc.github.io/open-data (licence, GeoMet usage), open-meteo.com/en/terms, docs.lightningmaps.org and Blitzortung forum threads 2511/2533 for the lightning ToS verdict.

### ECCC MSC GeoMet WMS (composite radar) — `msc-geomet-wms`

**T1 · VERIFIED** — Fully verified live. RADAR_1KM_RRAI is still the current composite rain-rate layer; GetMap returned a real 512x512 PNG for the VI bbox (HTTP 200, image/png) and the time dimension supports 6-minute animation frames over a 3-hour rolling window.

- **Endpoint:** `https://geo.weather.gc.ca/geomet?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=RADAR_1KM_RRAI&CRS=EPSG:4326&BBOX=48.20,-125.30,51.10,-123.10&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=true`
- **Auth:** none
- **Rate limits:** None published. MSC docs state access is anonymous and free of charge, support best-effort. Be polite: radar only produces a new frame every 6 minutes.
- **License:** ECCC Data Servers End-use Licence v2.1 (Sept 2022). Attribution mandatory; licence terminates automatically if omitted.
- **Attribution:** Data Source: Environment and Climate Change Canada
- **Cadence:** fast (120s capability check; new radar frames appear every 6 min, so effective new-data rate is PT6M)
- **CORS:** Access-Control-Allow-Origin: * (seen on GetMap response) - browser could load radar tiles directly, no Convex proxy needed for rasters
- **Response shape:** GetMap: binary PNG (200, image/png, 512x512 RGBA). GetCapabilities (filtered): <Layer> with <Name>RADAR_1KM_RRAI</Name> and <Dimension name="time" units="ISO8601" nearestValue="0" default=2026-06-11T12:18:00Z>2026-06-11T09:18:00Z/2026-06-11T12:18:00Z/PT6M</Dimension>. Legacy RADARURPPRECIPR* layers also still listed.
- **Gotchas:** Full GetCapabilities is 38 MB - always filter with &layer=RADAR_1KM_RRAI (returns ~21 KB). nearestValue=0 means TIME= must match an exact 6-min frame from the advertised extent; re-poll filtered capabilities to learn the current window before animating. WMS 1.3.0 + EPSG:4326 uses lat,lon axis order (BBOX=minLat,minLon,maxLat,maxLon). Default time = latest frame if TIME omitted. Same service also hosts Lightning_2.5km_Density and GOES-West satellite layers (see separate entries).

### ECCC Weather Alerts (OGC API Features) — `eccc-weather-alerts`

**T1 · VERIFIED** — Verified live. Collection is weather-alerts; bbox query for VI returned HTTP 200 with numberMatched:0 (genuinely no active VI alerts at test time), and a Canada-wide query returned a real active rainfall warning with full Polygon geometry, so the schema is confirmed from live data.

- **Endpoint:** `https://api.weather.gc.ca/collections/weather-alerts/items?bbox=-125.30,48.20,-123.10,51.10&f=json&limit=50`
- **Auth:** none
- **Rate limits:** None published; anonymous and free per MSC GeoMet docs.
- **License:** ECCC Data Servers End-use Licence v2.1. Attribution mandatory.
- **Attribution:** Data Source: Environment and Climate Change Canada
- **Cadence:** fast (60-120s) - highest-value low-latency feed in the cluster
- **CORS:** Access-Control-Allow-Origin: *
- **Response shape:** GeoJSON FeatureCollection with numberMatched/numberReturned. Feature: geometry=Polygon (full alert area, mappable in deck.gl); properties seen live: alert_code (RFW), alert_type (warning), alert_name_en/fr, alert_short_name_en/fr, publication_datetime, expiration_datetime, validity_datetime, event_end_datetime, alert_text_en/fr, risk_colour_en (yellow), confidence_en (High), impact_en (Moderate), feature_name_en, province, status_en (issued), feature_id.
- **Gotchas:** Schema is NOT CAP-style - there is no 'headline' or 'severity' field. Map severity from alert_type (warning/watch/statement/advisory) + risk_colour_en + impact_en. Empty result for VI is normal in fair weather; do not treat numberMatched:0 as failure. 37 alerts active Canada-wide at test time, so volume is small.

### ECCC Current Conditions + Forecasts (citypageweather-realtime, swob-realtime) — `eccc-conditions`

**T1 · VERIFIED** — Verified live. citypageweather-realtime is the best single collection for human-readable conditions + forecasts (Victoria Harbour bc-75 returned full currentConditions and forecast groups); swob-realtime gives raw minutely station obs (VICTORIA UNIVERSITY CS observation was timestamped the same minute as my query).

- **Endpoint:** `https://api.weather.gc.ca/collections/citypageweather-realtime/items?bbox=-125.30,48.20,-123.10,51.10&f=json&limit=50  |  raw obs: https://api.weather.gc.ca/collections/swob-realtime/items?bbox=-123.5,48.3,-123.2,48.55&f=json&limit=5&sortby=-date_tm-value`
- **Auth:** none
- **Rate limits:** None published; anonymous and free.
- **License:** ECCC Data Servers End-use Licence v2.1. Attribution mandatory.
- **Attribution:** Data Source: Environment and Climate Change Canada
- **Cadence:** medium (5-15 min) for citypage; swob can sustain fast (120s) during weather events
- **CORS:** Access-Control-Allow-Origin: *
- **Response shape:** citypageweather feature (id bc-75, Point geometry): properties = lastUpdated, identifier, name{en,fr}, region, url, currentConditions{iconCode, timestamp, relativeHumidity, wind, pressure, temperature, dewpoint, station, condition, windChill}, forecastGroup, hourlyForecastGroup, warnings, riseSet. swob feature: ~210 flattened properties in stem/-uom/-qa triplets, e.g. air_temp=6.3, air_temp-uom=°C, air_temp-qa=100, rel_hum=96, stn_nam-value=VICTORIA UNIVERSITY CS, date_tm-value (ISO).
- **Gotchas:** swob-realtime retains history: a tiny Victoria bbox matched 91,766 features - ALWAYS use sortby=-date_tm-value plus a small limit, or filter by station, or you will paginate a month of obs. citypageweather small Victoria bbox matched 5 city pages; the full VI bbox also pulls Sunshine Coast/mainland pages in the NE corner. citypage conditions refresh roughly hourly; swob is minutely for many stations - use swob for storm-mode detail.

### Open-Meteo Forecast API — `open-meteo`

**T1 · VERIFIED** — Verified live with the exact catalog URL: no key, instant JSON, CORS *, current temperature/wind/weather_code for Victoria returned in ~200ms. Free tier is explicitly non-commercial, which fits a single-operator personal tool.

- **Endpoint:** `https://api.open-meteo.com/v1/forecast?latitude=48.4284&longitude=-123.3656&current=temperature_2m,wind_speed_10m,weather_code`
- **Auth:** none (free non-commercial tier; commercial requires paid API key from open-meteo.com)
- **Rate limits:** Free tier: <10,000 calls/day, 5,000/hour, 600/minute (from open-meteo.com/en/terms, fetched live).
- **License:** Data under CC-BY 4.0; free tier restricted to non-commercial use (personal projects, home automation explicitly allowed). BlindSpot as a personal tool qualifies; would need a paid plan if ever commercialized.
- **Attribution:** Weather data by Open-Meteo.com (CC-BY 4.0)
- **Cadence:** medium (15 min - matches the 900s data interval; well under free-tier limits even with several VI points)
- **CORS:** access-control-allow-origin: * (confirmed with Origin header set; also allows GET/POST/OPTIONS)
- **Response shape:** {latitude:48.41939, longitude:-123.37453, generationtime_ms, utc_offset_seconds, timezone, elevation:21.0, current_units{...}, current{time:'2026-06-11T12:15', interval:900, temperature_2m:7.7, wind_speed_10m:5.4, weather_code:0}}
- **Gotchas:** current block has interval:900 - the 'current' value is a 15-minute model blend, not a live station ob, so do not poll faster than that. Coordinates are snapped to model grid (returned lat/lon differ slightly from request). Sibling endpoint air-quality-api.open-meteo.com/v1/air-quality (same terms) verified working for Victoria PM2.5/US-AQI if you want model AQ alongside ECCC AQHI. Tofino/offshore points work fine since it is model data, useful where radar/station coverage thins.

### Blitzortung.org / LightningMaps real-time strikes — `blitzortung-lightning`

**T2 · EXCLUDED** — Excluded as an ingestion source. Blitzortung's terms restrict data to private/entertainment purposes, prohibit commercial use and storm-warning applications, limit raw real-time data to project participants, and require third-party apps to serve data from their own server rather than Blitzortung's. The LightningMaps docs API section literally says 'work in progress' - there is no sanctioned third-party API or websocket in 2026.

- **Endpoint:** `n/a (the ws.blitzortung.org websockets used by community projects like homeassistant-blitzortung are unofficial and not sanctioned for third-party apps)`
- **Auth:** n/a (participant access requires building/hosting a hardware detector station - not a signup)
- **License:** Restrictive: private/entertainment use only; commercial use prohibited; explicitly banned for storm warning systems and risk analysis even when obtained via third parties; raw data limited to participants. Sources: docs.lightningmaps.org, forum.blitzortung.org threads 2511/2533, limaps.org terms.
- **Response shape:** n/a (not exercised - polling their servers from a third-party app is exactly what the ToS forbids)
- **Gotchas:** A future legitimate path exists: become a Blitzortung participant by hosting a ~100EUR detector station on the Island, which grants raw data rights and would itself be a great BlindSpot sensor. Commercial point-strike alternatives (Vaisala GLD360, Earth Networks) are paid. The free, legal alternative is the GeoMet lightning density layer (next entry).

### ECCC GeoMet Lightning_2.5km_Density WMS layer — `geomet-lightning-density`

**T2 · VERIFIED · NEW** — Verified live as the legal lightning replacement: GetMap returned a valid PNG for the VI bbox (transparent at test time - no strikes, plausible) with a 10-minute time dimension over a 3-hour window. Density raster from the Canadian Lightning Detection Network, not point strikes.

- **Endpoint:** `https://geo.weather.gc.ca/geomet?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Lightning_2.5km_Density&CRS=EPSG:4326&BBOX=48.20,-125.30,51.10,-123.10&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=true`
- **Auth:** none
- **Rate limits:** None published (same GeoMet service as radar).
- **License:** ECCC Data Servers End-use Licence v2.1. Attribution mandatory.
- **Attribution:** Data Source: Environment and Climate Change Canada
- **Cadence:** medium (5-10 min, matching the PT10M product cycle; drop to fast during active convection)
- **CORS:** Access-Control-Allow-Origin: * (same host/behavior verified on GetMap)
- **Response shape:** Binary PNG (200, image/png, 512x512 RGBA). Capabilities dimension seen live: 2026-06-11T09:10:00Z/2026-06-11T12:10:00Z/PT10M, nearestValue=0.
- **Gotchas:** It is 2.5 km gridded strike DENSITY per 10-min bin, not individual strike points - fine for 'is there lightning near X' situational awareness, not for strike-level forensics. ~10-min latency. Same exact-TIME requirement as radar (nearestValue=0). Pair with the thunderstorm_outlook collection on api.weather.gc.ca for convective risk context.

### ECCC GeoMet GOES-West satellite imagery WMS — `geomet-goes-west-satellite`

**T2 · VERIFIED · NEW** — Verified live: GOES-West_1km_DayVis-NightIR GetMap returned a real 56 KB PNG of cloud imagery for the VI bbox. This is the only cluster source with full offshore coverage (Tofino and west of the bbox), 10-minute cadence, multi-day archive in the time dimension.

- **Endpoint:** `https://geo.weather.gc.ca/geomet?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=GOES-West_1km_DayVis-NightIR&CRS=EPSG:4326&BBOX=48.20,-125.30,51.10,-123.10&WIDTH=512&HEIGHT=512&FORMAT=image/png`
- **Auth:** none
- **Rate limits:** None published (same GeoMet service).
- **License:** ECCC Data Servers End-use Licence v2.1. Attribution mandatory.
- **Attribution:** Data Source: Environment and Climate Change Canada
- **Cadence:** medium (10 min, matching PT10M frame cadence)
- **CORS:** Access-Control-Allow-Origin: * (same host verified)
- **Response shape:** Binary PNG (200, image/png, 512x512, 56 KB real imagery). DayVis dimension seen live: 2026-06-09T00:00:00Z/2026-06-11T06:00:00Z/PT10M (2+ day archive, 10-min steps).
- **Gotchas:** Do NOT use plain GOES-West_1km_DayVis for a 24/7 dashboard - it stops producing frames at night (latest frame was 06:00Z pre-dawn at my 12:21Z test). Use the DayVis-NightIR blend, or GOES-West_2km_NightIR. Other useful layers confirmed in capabilities: GOES-West_1km_SmokeABIband1-SWIR and GOES-West_1km_FireTemperature-SWIR (wildfire season), GOES-West_2km_Ash/Dust/SO2. Filter capabilities with &layer=NAME to avoid the 38 MB full document.

### ECCC Air Quality Health Index realtime (OGC API Features) — `eccc-aqhi-realtime`

**T2 · VERIFIED · NEW** — Verified live: aqhi-observations-realtime bbox query returned HTTP 200 with real hourly AQHI values (Point geometry, aqhi numeric, latest flag). Companion collections aqhi-forecasts-realtime and aqhi-stations exist on the same API. High value during wildfire smoke season.

- **Endpoint:** `https://api.weather.gc.ca/collections/aqhi-observations-realtime/items?bbox=-125.30,48.20,-123.10,51.10&f=json&limit=20&sortby=-observation_datetime`
- **Auth:** none
- **Rate limits:** None published; anonymous and free.
- **License:** ECCC Data Servers End-use Licence v2.1. Attribution mandatory.
- **Attribution:** Data Source: Environment and Climate Change Canada
- **Cadence:** slow (30-60 min; data is hourly. Promote to medium during wildfire smoke events)
- **CORS:** Access-Control-Allow-Origin: * (same API host verified)
- **Response shape:** GeoJSON Feature: geometry=Point; properties seen live: id (AQ_OBS-JBRIK-20260611120000), aqhi_type=AQHI-Observation, observation_type=original, location_name_en (Metro Vancouver - NW), location_id (JBRIK), observation_datetime (2026-06-11T12:00:00Z), observation_datetime_text_en, aqhi=1.16, special_notes_en, latest=True.
- **Gotchas:** The VI bbox NE corner overlaps the mainland, so Metro Vancouver locations appear in results - filter client-side by location_id or longitude < -123.3 for Island-only (VI locations include Victoria, Duncan, Nanaimo, Comox Valley, Port Alberni). numberMatched was 488 because history is retained - use sortby=-observation_datetime (tested) and dedupe on location_id, or filter on the latest property. Hourly product; polling faster gains nothing.

### UVic / Vancouver Island School-Based Weather Station Network (victoriaweather.ca) — `uvic-weather-mesh`

**T1 · VERIFIED · NEW** — Hyperlocal school-based weather mesh across south VI run by UVic SEOS Climate Modelling Group. Per-station XML verified live: GET https://www.victoriaweather.ca/stations/UVicSci/current.xml returned a fresh observation (Last-Modified within seconds of request; observation_time 2026/06/11 06:03 Pacific). Fields: station_long_name, station_name, station_id, latitude, longitude, elevation, observation_time, timezone, temperature (+daily low/high), humidity, dewpoint, wetbulb, pressure + pressure_trend, insolation (+predicted), uv_index, rain, rain_rate, wind_speed/direction/heading/max, each with units elements.

- **Endpoint:** `https://www.victoriaweather.ca/stations/{StationName}/current.xml (e.g. UVicSci); per-station webcam at /stations/{StationName}/cam/latest.jpg; HTML-only network status at /all_current_data.php`
- **Auth:** None
- **Rate limits:** None published. Education-first volunteer-run university project on a single Apache/Ubuntu box; be gentle. Observations update roughly every minute.
- **License:** CC BY-NC-SA 4.0 (stated on https://victoriaweather.ca/disclaimer.php). Data free to the public as-is for non-commercial use; commercial use requires a license (contact Ed Wiebe, ecwiebe at uvic.ca). The XML itself says: 'If you use this data check our license and tell us what you are doing. weather@uvic.ca'. For a personal OSINT dashboard this is fine, but email them as requested.
- **Attribution:** Credit element in every response: 'Vancouver Island School-Based Weather Station Network', credit_url https://www.victoriaweather.ca. Display both.
- **Cadence:** medium (5-15 min per station). Do not fast-poll all ~190 stations; a 10 min sweep of a curated subset is plenty.
- **CORS:** No Access-Control-Allow-Origin header observed. Browser fetch will fail; poll server-side from Convex (which is the plan anyway).
- **Response shape:** XML <current_observation> (Content-Type application/xml, ~2 KB). Numeric values as element text with sibling *_units elements. Coordinates per station inside the XML.
- **Gotchas:** 1) Longitude is degrees EAST 0-360: UVicSci returned 236.6909943, i.e. -123.309 W. Subtract 360 when > 180 or markers land in China. 2) observation_time is local Pacific with no UTC offset ('2026/06/11, 06:03'). 3) NO machine-readable station directory found: homepage links stations as station.php?id=N, /all_current_data.php is an HTML table grouped by region (Bamfield, North Island, Duncan, Nanaimo, Galiano, school districts 61-72/79, even SD36 Surrey), /XML/ directory is 403, and /stations/ serves a station page rather than an index. Building the full mesh means scraping the HTML region table once to map station slugs/ids/coords, or asking weather@uvic.ca for the list when you email about usage. 4) Sister site islandweather.ca covers the broader island.

### NWS Alerts for adjacent US waters (Juan de Fuca / northern inland waters) — `nws-adjacent-waters`

**T2 · VERIFIED · NEW** — Verified live with real alerts in the bbox-adjacent waters: two active Small Craft Advisories (Central and East Entrance Strait of Juan de Fuca, issued by NWS Seattle, severity Minor, certainty Likely, urgency Expected) at verification time. Zone enumeration confirmed via /zones?id=...: PZZ130 West Entrance US Waters Strait of Juan de Fuca, PZZ131 Central US Waters Strait of Juan de Fuca, PZZ132 East Entrance US Waters Strait of Juan de Fuca, PZZ133 Northern Inland Waters Including the San Juan Islands. Those four border VI waters and are the recommended set. PZZ134 (Admiralty Inlet) and PZZ135 (Puget Sound and Hood Canal) exist but do not border VI; skip or make optional.

- **Endpoint:** `https://api.weather.gov/alerts/active?zone=PZZ130,PZZ131,PZZ132,PZZ133 (comma-separated multi-zone confirmed working in one call). Zone metadata: https://api.weather.gov/zones?id=PZZ130,...`
- **Auth:** No key. Etiquette requirement: send an identifying User-Agent with contact info (used 'BlindSpot-recon (samuel.putra101@gmail.com)' and got 200s throughout); NWS documents that anonymous/generic UAs may be blocked.
- **Rate limits:** No hard published number; documented as generous for polite clients. Responses are edge-cached (cache-control: public, max-age=5 on alerts; 30 days on zone metadata).
- **License:** US Government work (NOAA/NWS), public domain. No restrictions.
- **Attribution:** Courtesy attribution 'NOAA / National Weather Service' (senderName in alerts, e.g. 'NWS Seattle WA').
- **Cadence:** fast (60-120 s) for the single multi-zone alerts call; it is one cheap cached request and this is an alerting layer. Zone metadata: fetch once and cache.
- **CORS:** access-control-allow-origin: * (verified). Browser-safe, but poll from Convex as planned.
- **Response shape:** CAP-over-GeoJSON FeatureCollection (application/geo+json): features[].properties carries the CAP fields: event, headline, areaDesc, severity, certainty, urgency, onset, ends/expires (ISO 8601 with offset), senderName, description, instruction, plus geocodes. geometry is null for zone-based marine alerts; join PZZ zone polygons from /zones/forecast/{id} if you want map shapes.
- **Gotchas:** 1) geometry: null on these marine alerts; render by zone polygon, not alert geometry. 2) expires is the message expiry, not hazard end; the observed alert had expires 10:15 PDT while the headline ran until 1:00 AM next day because NWS reissues/extends messages; track by alert id/replacedBy and prefer ends when present. 3) These are US zones only; the Canadian half of Juan de Fuca/Haro Strait comes from Environment Canada marine forecasts (separate source, already a different cluster concern). 4) Empty result is the norm: PZZ133 alone returned features:[] on first probe; do not treat empty as failure.

## Seismic & Tsunami

> Strong cluster: 7 of 10 sources fully verified with live data today, zero legal blockers. Gaps and caveats: (1) No open EEW API exists - NRCan EEW reaches the public only via NPAS/Pelmorex NAAD at M5+/MMI IV+ thresholds, so BlindSpot cannot get pre-shaking warnings for smaller events; technical-partner feeds need an NRCan agreement. (2) NRCan FDSN has no GeoJSON (verified 422) - budget a text/QuakeML parser. (3) ONC is the only key-gated must-have; get the free token early since seafloor bottom-pressure data is the best offshore tsunami signal in-region, and resolve location codes via /api/locations rather than memory. (4) No provincial landslide susceptibility layer exists - terrain stability mapping is a partial proxy; treat as a permanent gap or build from DEM later. (5) IOC gauges tfbc/whbc were transmitting -999 fill values at check time - per-station health checks are mandatory. (6) tsunami.gov Atom is current-state only, not an archive - persist alerts on ingest. Legal: OGL-Canada and OGL-BC attribution strings are required verbatim; review the Pelmorex NAAD User Agreement before any public redistribution (single-operator display is within the intended consumption class); everything NOAA/USGS is public domain. Recommended build order: 1) usgs-quakes + nrcan-quakes (trivial, immediate map value), 2) ntwc-tsunami + pelmorex-naad-cap (the alerting backbone; NAAD also future-proofs other clusters - wildfire/AMBER/weather alerts ride the same feed), 3) bc-hazard-layers static load for map context, 4) ioc-sealevel + ndbc-dart for event verification during alerts, 5) onc-oceans3 once token obtained, 6) usgs-dyfi enrichment. Skip gnss-earthscope.

### USGS Earthquake Catalog (FDSN event service + summary feeds) — `usgs-quakes`

**T1 · VERIFIED** — Live and excellent. FDSN query with Cascadia bbox returned reviewed events within minutes-to-hours of occurrence; static all_hour/all_day GeoJSON feeds also verified as fallback.

- **Endpoint:** `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minlatitude=46&maxlatitude=52&minlongitude=-132&maxlongitude=-121&orderby=time&limit=200  (fallback: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson)`
- **Auth:** none
- **Rate limits:** None published; responses are CloudFront-cached with cache-control max-age=60, so polling faster than 60s returns cached data. Be polite; USGS asks heavy users to use the static feeds.
- **License:** US Government public domain; courtesy attribution 'U.S. Geological Survey'
- **Attribution:** U.S. Geological Survey
- **Cadence:** fast (60-120s; matches 60s server cache)
- **CORS:** Access-Control-Allow-Origin: * observed on both query API and summary feeds
- **Response shape:** FeatureCollection; metadata{generated,url,title,status,api,count}; features[].properties{mag,place,time,updated,url,detail,felt,cdi,mmi,alert,status,tsunami,sig,net,code,ids,sources,types,nst,dmin,rms,gap,magType,type,title}; geometry.Point [lon,lat,depth_km]; feature.id (e.g. uw714014751)
- **Gotchas:** The 'tsunami' flag is only set for sea-based events that triggered messaging, not a hazard indicator. Cascadia box events mostly come from 'uw' (PNSN) net; NRCan-located BC events also appear but sometimes later or with different IDs than NRCan's catalog. Use 'detail' URL for products.

### Earthquakes Canada FDSN event web service (NRCan) — `nrcan-quakes`

**T1 · VERIFIED** — Live and authoritative for BC. Returned a real offshore swarm 115-121 km SSW of Port Alice (M2.2-2.9, Jun 9-10 2026) inside the VI box. EEW has no direct public API; EEW alerts flow through the National Public Alerting System (see pelmorex-naad-cap).

- **Endpoint:** `https://www.earthquakescanada.nrcan.gc.ca/fdsnws/event/1/query?format=text&minlatitude=46&maxlatitude=52&minlongitude=-132&maxlongitude=-121&starttime=2026-06-01&limit=200`
- **Auth:** none
- **Rate limits:** None published; standard FDSN service. Keep to minutes-scale polling out of politeness.
- **License:** Open Government Licence - Canada
- **Attribution:** Source: Earthquakes Canada, Natural Resources Canada
- **Cadence:** fast (120s) for the FDSN query; the Atom cache appears to regenerate every few minutes
- **CORS:** Access-Control-Allow-Origin: * observed
- **Response shape:** format=text returns pipe-delimited: #EventID|Time|Latitude|Longitude|Depth/km|MagType|Magnitude|EventLocationName (location bilingual EN/FR, magType e.g. Mw'). format=xml is QuakeML. format=json/geojson NOT supported: returns HTTP 422 {errors:[{value:'json',msg:'Invalid value',param:'format'}]} - you must parse text or QuakeML.
- **Gotchas:** Bare domain earthquakescanada.nrcan.gc.ca 301s to www. subdomain - use www. directly. No GeoJSON output (verified 422), unlike USGS. Atom fallback verified: https://www.earthquakescanada.nrcan.gc.ca/cache/earthquakes/canada-en.atom (last 30 days, georss). EEW status: operational in BC since spring 2024; public alerts only at ~M5+/intensity IV+ via NPAS; technical-partner low-latency feeds require an agreement with NRCan (EEWinfo-infoASP@nrcan-rncan.gc.ca) - there is no open EEW API. FDSN returns HTTP 204 No Content for an empty result window — treat as success with 0 records (verified 2026-06-11).

### Ocean Networks Canada Oceans 3.0 API — `onc-oceans3`

**T1 · NEEDS-KEY** — Endpoints confirmed live (documented errorCode 128 token rejection on both /api/locations and /api/scalardata/location), docs current, free token via account signup. Cannot pull data without a token.

- **Endpoint:** `https://data.oceannetworks.ca/api/scalardata/location?locationCode=BACAX&deviceCategoryCode=CTD&getLatest=true&rowLimit=100&token=YOUR_TOKEN  (discovery: https://data.oceannetworks.ca/api/locations?method=get&token=YOUR_TOKEN ; also /api/devices, /api/deviceCategories, /api/properties, /api/scalardata/device)`
- **Auth:** free key - register an Oceans 3.0 account at https://data.oceannetworks.ca, then Profile (top right) > Web Services API tab > Copy Token. Token passed as ?token= query param.
- **Rate limits:** No hard rate limit documented; hard cap of 100,000 rows per request confirmed in official API guide - use allPages/pagination for larger pulls. getLatest=true keeps responses tiny for dashboard use.
- **License:** ONC Data Policy: data freely available with required citation of Ocean Networks Canada; confirm exact citation text on the ONC data policy page when you register
- **Attribution:** Ocean Networks Canada (per ONC Data Policy citation requirements)
- **Cadence:** medium (5 min) using getLatest=true per location/property; do not fast-poll bulk ranges
- **CORS:** Access-Control-Allow-Credentials: true plus Allow-Methods/Allow-Headers observed; Allow-Origin not observed without an Origin header (likely echoed). Irrelevant server-side anyway.
- **Response shape:** Without token: 401 {errors:[{errorCode:128, errorMessage:'Either token or appToken must be specified', parameter:'token, appToken'}]}. Documented scalardata response: sensorData[] with {sensorCode, sensorName, unitOfMeasure, data:{sampleTimes[], values[], qaqcFlags[]}} per docs at https://oceannetworkscanada.github.io/Oceans3.0-API/ and https://data.oceannetworks.ca/OpenAPI
- **Gotchas:** Do NOT hardcode location codes from memory - resolve via /api/locations once you have a token. VI-relevant observatories: Saanich Inlet and Strait of Georgia nodes (Salish Sea/VENUS), Folger Passage (Barkley Sound), Barkley Canyon (BACAX = Barkley Canyon Axis appears in ONC's own examples), plus offshore NEPTUNE sites (Clayoquot Slope, Cascadia Basin, Endeavour) which carry bottom-pressure recorders directly relevant to tsunami detection west of the bbox. Near-real-time scalar latency is typically seconds-to-minutes but some instruments batch.

### NWS National Tsunami Warning Center (tsunami.gov) Atom + CAP feeds — `ntwc-tsunami`

**T1 · VERIFIED** — Live. PAAQ (NTWC Palmer, AK - the center responsible for BC coast) Atom feed returned a real Jun 8 2026 information statement with lat/lon, magnitude, CAP link, and map products; per-event CAP 1.2 XML also verified.

- **Endpoint:** `https://www.tsunami.gov/events/xml/PAAQAtom.xml  (latest event CAP 1.2: https://www.tsunami.gov/events/xml/PAAQCAP.xml ; Pacific-wide PTWC equivalent: https://www.tsunami.gov/events/xml/PHEBAtom.xml)`
- **Auth:** none
- **Rate limits:** None published; small XML documents. This is an emergency-alerting feed - 60s polling is the intended consumption pattern.
- **License:** NOAA/NWS, US Government public domain
- **Attribution:** NOAA / NWS National Tsunami Warning Center
- **Cadence:** fast (60-120s) - it is the cluster's primary alerting feed
- **CORS:** No Access-Control-Allow-Origin header observed - browser fetch would fail; fine for Convex server-side polling
- **Response shape:** Atom feed with geo:lat / geo:long per entry, xhtml summary containing Category (Information/Watch/Advisory/Warning), Bulletin Issue Time, Preliminary Magnitude, Lat/Lon, Affected Region, Note, and rel=related links to CAP XML (application/cap+xml), bulletin .txt, energy map and travel-time map JPGs. CAP doc: alert{identifier, sender, sent, status, msgType, scope, info{category, event, urgency, severity, certainty, expires, headline, description, areas...}}
- **Gotchas:** Feed only carries the most recent event(s) - it is a current-state feed, not an archive; persist what you see. PAAQ covers BC/AK/US west coast; for far-field Pacific events also watch PHEB (PTWC). Feed can sit stale for weeks between events (last-modified Jun 8 on Jun 11) - staleness is normal, not an outage. BC-specific public guidance is issued separately by EMCR via EmergencyInfoBC. PAAQ also publishes Atlantic-side products (WEXX32 seen live) — region-filter even on PAAQ; PHEBAtom.xml's rel=self link mislabels itself as PAAQAtom.xml (upstream bug).

### USGS Did You Feel It? (DYFI) aggregate products — `usgs-dyfi`

**T3 · VERIFIED** — Verified end-to-end: found a felt M2.9 near Whidbey Island (uw714010371, 36 responses, CDI 3.1) via minfelt query, and its event-detail GeoJSON exposed dyfi product with ready-to-map GeoJSON aggregates.

- **Endpoint:** `https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=EVENTID&format=geojson  (discover felt events with: https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minlatitude=46&maxlatitude=52&minlongitude=-132&maxlongitude=-121&minfelt=1&orderby=time&limit=20)`
- **Auth:** none
- **Rate limits:** Same as usgs-quakes: no published limit, 60s cache
- **License:** US Government public domain
- **Attribution:** U.S. Geological Survey 'Did You Feel It?'
- **Cadence:** slow / event-driven: only poll detail docs for events where summary 'felt' > 0, every 10-30 min for a few hours post-event
- **CORS:** Access-Control-Allow-Origin: * (same host as usgs-quakes)
- **Response shape:** Event detail properties.products.dyfi[0]: properties{depth, eventtime, latitude, longitude, magnitude, maxmmi, ...}; contents keyed by filename including dyfi_geo_1km.geojson, dyfi_geo_10km.geojson, dyfi_zip.geojson, cdi_geo.txt, cdi_geo.xml, ciim.jpg intensity map - each with a direct https://earthquake.usgs.gov/product/dyfi/... URL
- **Gotchas:** DYFI products only exist for events with felt reports, and update repeatedly for ~hours after an event (contents URLs are versioned by update timestamp - re-read the detail doc, do not cache product URLs). Canadian felt reports for BC events are split: NRCan runs its own separate felt-report system, so DYFI undercounts VI responses for NRCan-sourced events.

### EarthScope (UNAVCO/GAGE) GNSS data — `gnss-earthscope`

**T3 · NEEDS-KEY** — Feasibility verdict: not worth building on for BlindSpot. Everything useful is account-gated, and the real-time offering is raw 1 Hz RTCM3.3/BINEX NTRIP streams that require an NTRIP client plus GNSS processing - there is no simple JSON displacement/strain API.

- **Endpoint:** `https://gage-data.earthscope.org/ (file archive, free account via CILogon/Google); real-time NTRIP caster access via https://www.unavco.org/data/gps-gnss/real-time/real-time.html after registering at EarthScope's license management site`
- **Auth:** free key - register EarthScope account (CILogon or Google identity) at gage-data.earthscope.org; NTRIP streams additionally require accepting a noncommercial license and obtaining caster credentials
- **Rate limits:** Noncommercial license: unlimited stream access but no redistribution/resale of data or derived products
- **License:** Free for scientific/educational/humanitarian noncommercial use; no redistribution for a fee
- **Attribution:** EarthScope Consortium / NSF GAGE Facility
- **Cadence:** n/a (recommend not building)
- **CORS:** n/a (not a browser-consumable API)
- **Response shape:** Raw GNSS: RTCM 3.3 / BINEX binary streams at 1 Hz; archive holds RINEX files. No JSON.
- **Gotchas:** Cascadia slow-slip and coseismic displacement signals require PPP/RTK processing pipelines - far outside a Phase 0 OSINT dashboard. If you later want geodesy, the Nevada Geodetic Lab (geodesy.unr.edu) publishes open daily position time series for Cascadia stations as plain text with no key, but at daily latency. Recommendation: skip this source entirely for now.

### BC Data Catalogue / openmaps WFS hazard layers — `bc-hazard-layers`

**T3 · VERIFIED** — Tsunami Notification Zones verified: WFS 2.0 GetFeature returned real GeoJSON MultiPolygons in EPSG:4326. Landslide susceptibility: no dedicated provincial layer exists in the catalogue - closest proxy is Terrain Stability Mapping (TSM) polygons.

- **Endpoint:** `https://openmaps.gov.bc.ca/geo/pub/WHSE_LEGAL_ADMIN_BOUNDARIES.ADM_TSUNAMI_NOTIFY_ZONES_SP/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=pub:WHSE_LEGAL_ADMIN_BOUNDARIES.ADM_TSUNAMI_NOTIFY_ZONES_SP&outputFormat=application/json&srsName=EPSG:4326`
- **Auth:** none
- **Rate limits:** None published; this is a heavy static layer (full BC coast multipolygons) - fetch once, cache locally, do not poll
- **License:** Open Government Licence - British Columbia
- **Attribution:** Contains information licensed under the Open Government Licence - British Columbia
- **Cadence:** slow (fetch once at startup, refresh monthly)
- **CORS:** Vary: Access-Control-Request-Method observed (CORS-aware gateway); ACAO not observed without an Origin header
- **Response shape:** GeoJSON FeatureCollection; features[].id like WHSE_LEGAL_ADMIN_BOUNDARIES.ADM_TSUNAMI_NOTIFY_ZONES_SP.8081 with MultiPolygon geometry in lon/lat (zone attributes A-E classification per dataset description; geometry verified, full property list truncated in my capture)
- **Gotchas:** Dataset metadata last modified 2025-03-05; zones are static planning polygons keyed to NTWC alerting (VI is mostly Zones A/B/C/D/E along different coasts). Use count/startIndex params to page if needed, and add a bbox filter (&bbox=48.2,-125.3,51.1,-123.1,EPSG:4326 - note axis order quirks in WFS 2.0). For landslides, the catalogue search for 'landslide susceptibility' returns 0 datasets; nearest substitutes are 'terrain-stability-mapping-tsm-detailed-polygons-with-short-attribute-table-spatial-view' and CFLB terrain mapping - patchy forestry-era coverage, not a hazard model. Treat island-wide landslide susceptibility as a data gap.

### Pelmorex NAAD (National Public Alerting System / Alert Ready) CAP feed — `pelmorex-naad-cap`

**T1 · VERIFIED · NEW** — Verified live and it directly answers the EEW question: today's archive directory contains nrcan_eew_test CAP heartbeat files, confirming NRCan EEW alerts (plus tsunami warnings and all other BC civil emergency alerts) are publicly retrievable here.

- **Endpoint:** `https://capcp1.naad-adna.pelmorex.com/2026-06-11/  (date-pattern: https://capcp1.naad-adna.pelmorex.com/YYYY-MM-DD/ , Apache index of CAP XML files; real-time: raw TCP stream on streaming1.naad-adna.pelmorex.com:8080 - port verified open; mirrors capcp2/streaming2)`
- **Auth:** none
- **Rate limits:** None published; designed for continuous consumption by last-mile distributors. Keep one TCP connection or poll the date directory at 60s.
- **License:** Public alerting feed operated by Pelmorex under CRTC mandate, intended for redistribution by last-mile distributors; review the NAAD User Agreement on alertready.ca before public redistribution. Alert content originates from issuing agencies (NRCan, ECCC, EMCR).
- **Attribution:** National Public Alerting System / Alert Ready (Pelmorex NAAD); issuing agency per alert
- **Cadence:** fast (persistent TCP stream, or 60s polling of the current date directory)
- **CORS:** No CORS headers observed; root URL 403s (no listing) - date directories work. Server-side only.
- **Response shape:** Apache directory listing of CAP 1.2 XML files named like 2026_06_11T00_00_06_00_00Inrcan_eew_test_1781136006.s_bor_vpa095007.xml; each file is an OASIS CAP alert with area/geocode blocks (SGC codes) for spatial filtering
- **Gotchas:** Firehose for all of Canada - filter by CAP geocode (VI regional districts SGC 5917 Capital, 5919 Cowichan Valley, 5921 Nanaimo, 5923 Alberni-Clayoquot, 5924 Strathcona, 5926 Comox Valley, 5943 Mount Waddington) and by event codes (earthquake, tsunami). Heartbeat/test messages dominate quiet days - filter status=Actual and msgType. EEW public alerts only fire at ~M5+/MMI IV+, so this complements rather than replaces the FDSN catalogs. NOTE: duplicate of `naad-pelmorex` in the Pulse cluster — that entry is canonical (it carries the StatCan-verified SGC geocode list) and is the one the feed module `convex/feeds/naadPelmorex.ts` implements.

### IOC/UNESCO Sea Level Station Monitoring Facility (VLIZ) — `ioc-sealevel`

**T2 · VERIFIED · NEW** — Verified with live 1-minute water level data from Victoria Harbor. Five VI tide gauges are in the network (Victoria, Tofino, Bamfield, Port Alberni, Winter Harbour) - the canonical free source for watching an actual tsunami wave arrive.

- **Endpoint:** `https://www.ioc-sealevelmonitoring.org/service.php?query=data&code=vibc&period=0.25&format=json  (VI codes: vibc=Victoria Harbor, tfbc=Tofino, bamf=Bamfield, palb=Port Alberni, whbc=Winter Harbour; station list: https://www.ioc-sealevelmonitoring.org/service.php?query=stationlist&format=json)`
- **Auth:** none
- **Rate limits:** None published; VLIZ-hosted research service - be polite, the period param keeps payloads small (period is in days, e.g. 0.25 = last 6h)
- **License:** Open access for tsunami monitoring; data are raw/non-quality-controlled and owned by the national provider (DFO/Canadian Hydrographic Service). Cite IOC SLSMF and the data owner.
- **Attribution:** IOC/UNESCO Sea Level Station Monitoring Facility (hosted by VLIZ); data: Fisheries and Oceans Canada / CHS
- **Cadence:** medium (5 min) baseline; drop to fast (60s) when an NTWC/NAAD alert is active
- **CORS:** Access-Control-Allow-Origin: * observed
- **Response shape:** JSON array of {slevel: 1.738 (metres), stime: 'YYYY-MM-DD HH:MM:SS' (UTC), sensor: 'pwl'} at 1-minute resolution; stationlist returns rich per-station records {Code, Location, country, Lat, Lon, lasttime, lastvalue, sensor, rate, ...}
- **Gotchas:** Tofino is code 'tfbc' NOT 'tofi' - 'tofi' silently returns []. Omitting the period param also returns [] (empty array, not an error). At check time tfbc and whbc had lastvalue -999 (transmitting fill values) while vibc/bamf/palb were healthy - check for -999 and per-station staleness via stationlist lasttime. Gauges transmit in ~5-min batches despite 1-min sampling. Port Alberni gauge is critical: the inlet historically amplifies tsunamis ~3x.

### NOAA NDBC DART deep-ocean tsunami buoys (realtime2 .dart files) — `ndbc-dart`

**T2 · VERIFIED · NEW** — Verified live: station 46419 (Cascadia offshore, the DART nearest Vancouver Island's west coast) returned current water-column height readings at 15-minute cadence. Detects open-ocean tsunami waves before coastal gauges.

- **Endpoint:** `https://www.ndbc.noaa.gov/data/realtime2/46419.dart  (also 46404 off Oregon/Washington for southern Cascadia; station metadata at https://www.ndbc.noaa.gov/station_page.php?station=46419)`
- **Auth:** none
- **Rate limits:** None published; NDBC asks for reasonable polling of realtime2 flat files. Files update on the buoy's reporting schedule.
- **License:** NOAA, US Government public domain
- **Attribution:** NOAA National Data Buoy Center / DART
- **Cadence:** medium (15 min matches standard reporting); switch to fast (60-120s) when T flag indicates event mode or an NTWC alert is active
- **CORS:** No Access-Control-Allow-Origin observed; server-side only
- **Response shape:** Plain text fixed-width: header '#YY MM DD hh mm ss T HEIGHT' then rows like '2026 06 11 12 00 00 1 2769.069' - UTC timestamp, T = measurement type flag (1=15-min standard, 2=1-min event mode, 3=15-sec event mode), HEIGHT = water column height in metres (~2769 m here; tsunami signal is the deviation from tide curve, typically cm-scale)
- **Gotchas:** You must detrend the tidal signal to see a tsunami - raw height alone looks flat. In event mode the buoy self-triggers to 15s/1min sampling and the T flag changes - that flag flipping is itself a strong alert signal. Buoys go adrift/offline for months at a time; always handle a stale file. 46419 sits well offshore (covers Tofino's seaward approaches, i.e. exactly where bbox-west coverage matters).

### PNSN Cascadia Episodic Tremor API (tremorapi.pnsn.org) — `pnsn-tremor`

**T2 · VERIFIED · NEW** — Verified live with real data: GET /api/v3.0/events?starttime=2026-05-28&endtime=2026-06-11 returned count=1109 tremor events (266 KB), heavily clustered under southern VI / Strait of Juan de Fuca (e.g. 48.531, -123.359 at 53.8 km depth), i.e. an ETS-style tremor episode is active right now in the bbox. This is a genuinely differentiating layer for a VI command center.

- **Endpoint:** `https://tremorapi.pnsn.org/api/v3.0/events?starttime=YYYY-MM-DD&endtime=YYYY-MM-DD (the web client at tremor.pnsn.org consumes this same API)`
- **Auth:** None
- **Rate limits:** None published; root URL and docs paths 404 so there is no self-documented policy. nginx-fronted research service: keep windows short and polls slow.
- **License:** No explicit license page found. Public research catalog from PNSN (UW/UO, USGS-supported). Personal non-commercial dashboard use with citation is the established norm.
- **Attribution:** Cite: Wech, A.G. (2010), Interactive Tremor Monitoring, Seismol. Res. Lett. 81:4, p. 664-669. The tremor catalog was created and is maintained by Aaron Wech; credit the Pacific Northwest Seismic Network. Sources: [PNSN Tremor](https://pnsn.org/tremor), [An updated tremor monitoring system](https://pnsn.org/blog/an-updated-tremor-monitoring-system).
- **Cadence:** slow (30-60 min). Catalog updates in near-real-time batches; poll only a trailing 24-48 h window incrementally instead of re-pulling 14 days (14 days was 266 KB / 1109 events during an active episode).
- **CORS:** Access-Control-Allow-Origin: * (verified). Browser-fetchable, but poll server-side anyway for caching.
- **Response shape:** JSON {count, features:[{type:'Feature', geometry:{type:'Point', coordinates:[lng,lat]}, properties:{id, time:'Thu, 28 May 2026 02:20:00 GMT', depth (km, float), duration (s), energy, magnitude, num_stas}}]} . GeoJSON-like FeatureCollection minus the top-level type field.
- **Gotchas:** 1) time is an RFC-1123 GMT string, not ISO 8601; parse accordingly. 2) Payloads balloon during ETS episodes (one is underway now); always bound the window. 3) No API docs exist (/, /api/v3.0, /api/v3.0/docs all 404); the params starttime/endtime are confirmed working, anything else is unverified. 4) Tremor magnitudes (~0.8-1.2) are not earthquakes; label the layer as slow-slip tremor, not quakes. No spatial params — the API returns the full catalog footprint incl. Northern California (lat ~40.2 seen); always bbox-filter server-side (~43% of a 14-day payload was out-of-box 2026-06-11). Future endtime values accepted (endtime=tomorrow is safe).

## Space Weather

> Cluster is in excellent shape: everything is keyless, public-domain (except INTERMAGNET's attribution + non-commercial clause, which is fine for a personal tool), CORS-open on the SWPC side, and verified with live data on 2026-06-11. Two findings that override stale training data: (1) DSCOVR is no longer the active real-time solar wind source - the rtsw feeds' 'source' field showed SOLAR1 (SWFO-L1, active) and IMAP; any UI copy or schema that hard-codes 'DSCOVR' is wrong as of 2026. Use json/rtsw/rtsw_wind_1m.json + rtsw_mag_1m.json to get the spacecraft label and QC flags, or the products/solar-wind/*.json merged series if you just want numbers. (2) The api.nasa.gov DONKI mirror was down (503 upstream connect errors) during verification while the authoritative CCMC backend at kauai.ccmc.gsfc.nasa.gov worked perfectly keyless - architect DONKI ingestion as CCMC-primary with api.nasa.gov fallback, and treat any single-source DONKI cron as flaky. Recommended build order: noaa-scales.json + alerts.json first (tiny payloads, instant top-line status), then kp 1-min + GOES X-ray sparklines (fast cadence), then rtsw solar wind with Bz southward highlighting, then the OVATION grid as a deck.gl heatmap layer (crop server-side to lon 230-240 / lat 46-54 before persisting - the full file is ~900KB per fetch and Convex document limits will bite), DONKI last as event-annotation metadata. The INTERMAGNET VIC magnetometer is the sleeper pick: it is the only source in this cluster physically located on Vancouver Island, and a simple local dB/dt computed from it is a better 'is something happening HERE' signal than planetary Kp. Gap to acknowledge: aurora visibility for VI is genuinely rare (needs G1/Kp5+ for the northern Island, more for Victoria), so this cluster is mostly context/alerting rather than a daily-action layer; cadences reflect that - only Kp/X-ray/solar-wind merit fast polling.

### NOAA SWPC real-time products (Kp, solar wind, GOES X-ray, OVATION aurora, alerts) — `noaa-swpc`

**T1 · VERIFIED** — All five sub-feeds verified live on 2026-06-11 with real data, no key, CORS *. One critical catalog correction: the real-time solar wind is NO LONGER DSCOVR - the active L1 source is 'SOLAR1' (SWFO-L1), with 'IMAP' rows also present; do not label it DSCOVR in the UI.

- **Endpoint:** `Kp 1-min: https://services.swpc.noaa.gov/json/planetary_k_index_1m.json | Solar wind plasma: https://services.swpc.noaa.gov/products/solar-wind/plasma-2-hour.json | Solar wind mag: https://services.swpc.noaa.gov/products/solar-wind/mag-2-hour.json | RTSW with spacecraft source field: https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json and https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json | GOES X-ray: https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json | OVATION aurora: https://services.swpc.noaa.gov/json/ovation_aurora_latest.json | Alerts: https://services.swpc.noaa.gov/products/alerts.json`
- **Auth:** none
- **Rate limits:** None documented. CloudFront-cached with cache-control max-age=60, so polling faster than 60s returns cached bytes anyway. Be polite; conditional GET supported (etag + last-modified present).
- **License:** US Government work, public domain. Attribution to 'NOAA SWPC' is courteous, not required.
- **Attribution:** NOAA Space Weather Prediction Center (courtesy)
- **Cadence:** fast 60-120s for Kp 1-min, rtsw solar wind, and X-ray (they update every minute; 60s CDN cache makes <60s pointless). medium 5 min for OVATION (model runs ~5 min, forecast lead 30-90 min) and alerts.json. Parse alerts incrementally by Serial Number to dedupe.
- **CORS:** access-control-allow-origin: * present on all services.swpc.noaa.gov responses (verified on alerts.json and planetary_k_index_1m.json headers)
- **Response shape:** Kp 1-min: array of {time_tag, kp_index:int, estimated_kp:float, kp:'2M'-style string}. plasma-*.json: array-of-arrays, header row ['time_tag','density','speed','temperature'], values are STRINGS. mag-*.json: header ['time_tag','bx_gsm','by_gsm','bz_gsm','lon_gsm','lat_gsm','bt']. rtsw_wind_1m: array of {time_tag, active:bool, source:'IMAP'/'SOLAR1', proton_speed, proton_density, proton_temperature, ...gse/gsm vectors, QC flags}. rtsw_mag_1m: {time_tag, active, source, bt, bx/by/bz_gse and _gsm, theta/phi, overall_quality}. X-ray: array of {time_tag, satellite:18, flux, observed_flux, electron_correction, electron_contaminaton:bool (sic, feed misspells it), energy:'0.05-0.4nm'|'0.1-0.8nm'} - two rows per minute, one per band. OVATION: {'Observation Time','Forecast Time','Data Format','coordinates':[[lon 0-359E, lat -90..90, probability 0-100] x 65160],'type'} ~919KB; VI cells are lon 234-237 / lat 48-51 (lon = 360 - |west longitude|). Alerts: array of {product_id (e.g. 'K04W','TIVA'), issue_datetime, message: raw multi-line bulletin text with Space Weather Message Code + Serial Number embedded}.
- **Gotchas:** 1) DSCOVR retired as primary: rtsw 'source' field showed SOLAR1 (active:true) and IMAP on 2026-06-11 - label generically as 'L1 solar wind' or read the source field. 2) products/solar-wind/*.json numeric values are strings - parseFloat everything; first row is the header. 3) X-ray feed has the literal misspelled field 'electron_contaminaton' - match it exactly. 4) OVATION is ~900KB per fetch; downsample/crop to the VI viewport server-side before storing in Convex. 5) Alert messages are unstructured text; product_id + the WARK/ALTK message codes are the only machine-parseable taxonomy. 6) Pick window sizes deliberately: 5-minute/2-hour/6-hour/1-day/3-day/7-day variants exist for plasma and mag.

### NASA DONKI (Space Weather Database Of Notifications, Knowledge, Information) — `nasa-donki`

**T2 · VERIFIED** — Data verified live via the authoritative CCMC backend (29 flares returned for May 1 - Jun 11 2026, latest a C6.7 on 2026-06-10). The api.nasa.gov mirror was returning 503 'upstream connect error' on both attempts on 2026-06-11 - known flakiness; build against CCMC direct with api.nasa.gov as fallback.

- **Endpoint:** `Primary (keyless, verified working): https://kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/FLR?startDate=2026-05-01&endDate=2026-06-11 | Mirror (keyed, was 503 during verification): https://api.nasa.gov/DONKI/FLR?startDate=2026-05-01&api_key=DEMO_KEY | Other event types swap FLR for: CME, CMEAnalysis, GST, SEP, IPS, RBE, MPC, HSS, notifications`
- **Auth:** CCMC direct: none. api.nasa.gov: free key, instant signup at https://api.nasa.gov/ (name + email, key arrives by email). DEMO_KEY is a sanctioned public demo key.
- **Rate limits:** api.nasa.gov DEMO_KEY: documented 30 req/hr/IP and 50/day (the 503 response carried x-ratelimit-limit: 10, suggesting a tighter live gateway limit - budget conservatively). Real key: 1000 req/hr default. CCMC direct: no published limit; it is a small research service, poll gently.
- **License:** NASA data, public domain / no restrictions. NASA requests acknowledgment of CCMC for DONKI data use.
- **Attribution:** Data from NASA CCMC DONKI (acknowledgment requested, not legally required)
- **Cadence:** slow 30-60 min. DONKI is human-curated by CCMC forecasters; entries appear hours after the event. It is event metadata/context, not real-time telemetry - SWPC feeds are the live signal.
- **CORS:** api.nasa.gov: access-control-allow-origin: * (seen even on the 503). CCMC direct: no Access-Control-Allow-Origin observed (only Vary) - assume no CORS; irrelevant for Convex server-side polling.
- **Response shape:** FLR: array of {flrID ('2026-06-10T23:30:00-FLR-001'), catalog, instruments, beginTime, peakTime, endTime, classType ('C6.7'), sourceLocation ('N09E39'), activeRegionNum (14465), note, submissionTime, versionId, link, linkedEvents, sentNotifications}
- **Gotchas:** api.nasa.gov DONKI mirror 503'd twice during verification (Envoy 'upstream connect error... connection refused') while the gateway itself was alive - this mirror has a long history of intermittent outages. Use kauai.ccmc.gsfc.nasa.gov as primary with retry, api.nasa.gov as fallback. CCMC direct requires an explicit endDate. Returns empty body (not []) for some empty ranges - handle non-JSON responses. Not VI-specific: global sun-side events; use it to annotate WHY SWPC numbers spiked.

### NOAA SWPC R/S/G scales (current + 3-day outlook) — `noaa-swpc-scales`

**T1 · VERIFIED · NEW** — Single small JSON giving current and forecast NOAA Radio blackout / Solar radiation / Geomagnetic storm scales with probabilities - the ideal top-line status chip for a dashboard. Verified live.

- **Endpoint:** `https://services.swpc.noaa.gov/products/noaa-scales.json`
- **Auth:** none
- **Rate limits:** None documented; same 60s CloudFront cache as other services.swpc.noaa.gov products.
- **License:** US Government work, public domain.
- **Attribution:** NOAA Space Weather Prediction Center (courtesy)
- **Cadence:** medium 15 min. Timestamp updates minutely but content changes only on new observations/forecasts.
- **CORS:** services.swpc.noaa.gov sends access-control-allow-origin: * domain-wide (verified on sibling endpoints).
- **Response shape:** Dict keyed '-1','0','1','2','3' (yesterday / current / today / +1d / +2d), each {DateStamp, TimeStamp, R:{Scale,Text,MinorProb,MajorProb}, S:{Scale,Text,Prob}, G:{Scale,Text}}. Forecast rows have Scale:null with probability strings instead.
- **Gotchas:** Scale values are strings ('0','1') and null for probabilistic forecast rows - handle both shapes. G-scale maps directly to aurora odds for VI: G1+ means aurora plausibly visible from northern/central Island, G2+ from Victoria.

### INTERMAGNET Victoria observatory (VIC) ground magnetometer via BGS GIN — `intermagnet-vic`

**T2 · VERIFIED · NEW** — 1-minute X/Y/Z/S magnetometer data from the NRCan Victoria geomagnetic observatory - physically ON southern Vancouver Island, so it is ground truth for local geomagnetic disturbance (local dB/dt) rather than the planetary Kp proxy. Verified live: 200 JSON, full day of minute data.

- **Endpoint:** `https://imag-data.bgs.ac.uk/GIN_V1/GINServices?Request=GetData&format=json&testObsys=0&observatoryIagaCode=VIC&samplesPerDay=1440&publicationState=adj-or-rep&dataStartDate=2026-06-11&dataDuration=1`
- **Auth:** none
- **Rate limits:** None published; BGS GIN is a research service - poll politely, one request per cycle fetching the current day.
- **License:** INTERMAGNET conditions of use: free for scientific, academic, and personal use; commercial use requires permission from the operating institute (Natural Resources Canada). Attribution required. Fine for a single-operator personal OSINT tool.
- **Attribution:** Results rely on data collected at the Victoria observatory operated by Natural Resources Canada, available through INTERMAGNET (intermagnet.org)
- **Cadence:** medium 5-15 min. Near-real-time 'adjusted' data lands with minutes-to-tens-of-minutes latency depending on observatory transmission; re-fetching the current day each cycle picks up backfill.
- **CORS:** No Access-Control-Allow-Origin observed (only Vary: Origin,...) - assume no CORS; irrelevant for Convex server-side polling.
- **Response shape:** {datetime: [ISO strings], '@info': {...}, S: [...], X: [...], Y: [...], Z: [...]} - parallel arrays of 1-minute values in nT (null for gaps).
- **Gotchas:** publicationState=adj-or-rep returns the best available (adjusted falls back); trailing minutes of the current day are null until data arrives, so compute dB/dt only over non-null pairs. Day boundary is UTC - request dataStartDate accordingly. NRCan's own spaceweather.gc.ca has regional forecasts but no clean public JSON API that I could verify; this BGS GIN route is the reliable machine interface to the same VIC instrument.

### NOAA SWPC 3-day planetary Kp forecast — `noaa-kp-forecast`

**T2 · VERIFIED · NEW** — Observed + estimated + predicted Kp in 3-hour bins covering the past week and next 3 days - the forward-looking complement to the 1-minute Kp feed, useful for an 'aurora chance tonight' panel. Verified live.

- **Endpoint:** `https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json`
- **Auth:** none
- **Rate limits:** None documented; 60s CloudFront cache.
- **License:** US Government work, public domain.
- **Attribution:** NOAA Space Weather Prediction Center (courtesy)
- **Cadence:** slow 30-60 min. Underlying forecast is issued a few times per day.
- **CORS:** services.swpc.noaa.gov sends access-control-allow-origin: * domain-wide.
- **Response shape:** Array of {time_tag, kp:float, observed:'observed'|'estimated'|'predicted', noaa_scale:string|null} in 3-hour bins.
- **Gotchas:** Mixed history + forecast in one array - split on the 'observed' field. For VI (geomagnetic latitude ~53N), predicted Kp >= 5 is the practical aurora-watch threshold for the northern Island, Kp >= 6-7 for Victoria.

## Skies (Air)

> Cluster is in better shape than the catalog assumed, with one big legal surprise. (1) OpenSky should NOT be the T1 backbone: its 2026 ToS (fetched live) requires a prior written agreement for ANY operational/automated REST API use, even non-profit and even internal - a Convex cron poller is exactly that. Either email contact@opensky-network.org for a non-profit agreement or demote it to manual cross-check. (2) The real backbone is the trio of free ADSBx-v2-compatible aggregators - adsb.fi (verified, 1 req/s, non-commercial + attribution), adsb.lol (verified, ODbL, cleanest license), airplanes.live (verified, 1 req/s, richest payload, CORS *) - all returning identical readsb-shaped JSON, so build ONE adapter with provider failover; adsb.one is Cloudflare-blocked from here and should be a spare at best. Recommended build order: aggregator adapter with 60s poll first; then mil flagging (tar1090-db CSV daily + hex-range fallback + live /v2/mil - note the CSV missed a live USCG aircraft, so OR the three signals); then on-demand enrichment (adsbdb -> hexdb.io fallback, both verified, with planespotters photos using a descriptive User-Agent - mandatory, generic UAs get 403); then NAVCAN CFPS NOTAM+METAR on a 15-30 min cron (verified keyless but undocumented/unofficial - wrap defensively). Gaps and honest caveats: YYJ's flight board is WAF-walled (derive airport activity geometrically from ADS-B instead), Helijet has no status API (watch JBA callsigns), Canada has no public TFR feed (CFPS NOTAMs are the closest thing), Tofino/offshore coverage depends on community receiver density which thins west of the island - MLAT/TISB coverage offshore will be spotty at low altitude. Paid options if ever needed: ADS-B Exchange via RapidAPI ~USD10/mo (no free tier), FlightAware AeroAPI usage-based with USD5/mo free credit on Personal tier.

### OpenSky Network REST API (/states/all) — `opensky`

**T1 · VERIFIED** — Live anonymous call over the VI bbox returned real state vectors (HTTP 200, x-rate-limit-remaining: 399 of 400 daily credits). OAuth2 token endpoint confirmed live. HOWEVER: 2026 ToS explicitly requires a written license for ANY operational/automated REST API use, even non-profit/internal - this makes it legally shaky as the T1 backbone.

- **Endpoint:** `https://opensky-network.org/api/states/all?lamin=48.2&lomin=-125.3&lamax=51.1&lomax=-123.1`
- **Auth:** Anonymous works (400 credits/day per IP, 10s time resolution). OAuth2 client-credentials: create an API client on your Account page at opensky-network.org after login to get client_id/client_secret, then POST grant_type=client_credentials to https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token (endpoint verified live - returns proper invalid_client JSON for bad creds). Access token expires after 30 minutes; on 401, re-fetch token. Pass as Authorization: Bearer. Registered = 4000 credits/day (8000 if feeding with >=30% uptime), 5s resolution.
- **Rate limits:** Credit system per UTC day. VI bbox is ~6.4 sq-deg, so each /states/all call costs 1 credit (<=25 sq-deg tier). Anonymous 400/day = one call per ~3.6 min sustainable. Registered 4000/day = one call per ~22s. Separate credit buckets for /states/*, /tracks/*, /flights/*. Verified live via x-rate-limit-remaining header.
- **License:** Restrictive. ToS (fetched 2026-06-11): data licensed solely for non-profit research and non-profit education; any for-profit use needs written license; and 'Use of the REST API in any operational capacity - including integration into a live product, service, or automated system (even if only internal) - requires a previous written agreement, even for non-profit or governmental entities.' Contact contact[at]opensky-network.org for a license.
- **Attribution:** Cite 'Bringing up OpenSky: A large-scale ADS-B sensor network for research' (Schaefer et al., IPSN 2014) in any publication; link The OpenSky Network, https://opensky-network.org
- **Cadence:** medium (5 min) on anonymous; fast (60-120s) only viable with a registered OAuth client. Given the ToS operational-use clause, recommend demoting to supplementary/cross-check source and polling slow.
- **CORS:** Access-Control-Allow-Origin pinned to https://opensky-network.org - no public CORS; server-side polling required (fits Convex).
- **Response shape:** {"time": 1781180484, "states": [[...]]} - observed 17-element arrays per aircraft: [0]icao24 hex, [1]callsign (8-char padded), [2]origin_country, [3]time_position, [4]last_contact, [5]longitude, [6]latitude, [7]baro_altitude(null for ground), [8]on_ground bool, [9]velocity m/s, [10]true_track, [11]vertical_rate, [12]sensors, [13]geo_altitude, [14]squawk, [15]spi, [16]position_source. 18th field (category) only with ?extended=true (not observed in my call).
- **Gotchas:** The big one: 2026 ToS forbids automated/operational use without written agreement - a cron-polling dashboard arguably qualifies, so either email them for a (free, non-profit) agreement or lean on the community aggregators as primary. Anonymous data is 10s-stale and time param ignored. Callsigns are space-padded. Many fields null for ground vehicles (Victoria-area feed included airport ground service vehicles, category 0).

### adsb.fi Open Data API — `adsb-fi`

**T2 · VERIFIED** — Verified live: both v2 and the preferred v3 lat/lon/dist endpoints returned rich readsb-style aircraft JSON near Victoria (caught a WestJet 737 on approach near Comox). Clear published terms: 1 req/s, non-commercial, attribution required.

- **Endpoint:** `https://opendata.adsb.fi/api/v3/lat/48.43/lon/-123.37/dist/100 (v3 is the documented replacement; deprecated-but-working v2 form: https://opendata.adsb.fi/api/v2/lat/48.43/lon/-123.37/dist/100; also /api/v2/mil, /api/v2/hex/{hex}, /api/v2/callsign/{cs}, /api/v2/sqk/{squawk}; max dist 250 NM)`
- **Auth:** none
- **Rate limits:** 1 request/second on public endpoints (documented in github.com/adsbfi/opendata README). Excessive invalid requests (400/401/403/404/429) trigger temporary IP bans. Feeder-only /v2/snapshot endpoint: 1 req/30s.
- **License:** Personal, non-commercial use only; no licensing/selling/renting the data. Provided as-is.
- **Attribution:** Must cite adsb.fi and include a link to https://adsb.fi
- **Cadence:** fast (60s). Data is essentially real-time (seen_pos < 1s observed). One 100 NM circle from a mid-island point (e.g. 49.3,-124.5) covers nearly the whole VI bbox in a single call.
- **CORS:** No Access-Control-Allow-Origin header observed - server-side only.
- **Response shape:** {"now": <epoch float>, "aircraft": [...]} on v2; {"ac": [...]} on v3. Per-aircraft readsb fields observed: hex, type (adsb_icao/mlat/tisb), flight, r (registration), t (ICAO type), desc, ownOp, year, alt_baro, alt_geom, gs, track, baro_rate/geom_rate, squawk, emergency, category, nav_qnh, nav_altitude_mcp, nav_heading, lat, lon, nic, rc, seen_pos, nic_baro, nac_p, nac_v, sil, gva, sda, mlat[], tisb[], messages, seen, rssi, dst (NM from query point), dir. /v2/mil aircraft carry dbFlags:1.
- **Gotchas:** 100 NM around Victoria misses the north island - either use dist 150 from a central point or two query points. v2 lat/lon/dist is deprecated; use v3. ownOp shows registered owner (e.g. 'BANK OF UTAH TRUSTEE' for an Amazon Prime Air 738) not operator brand.

### adsb.lol API — `adsb-lol`

**T2 · VERIFIED** — Verified live with the VI query; returned the same readsb-style {"ac":[...]} payload. Best license in the cluster: all data ODbL (same as OpenStreetMap), explicitly free to use, with a heads-up that production users should make contact.

- **Endpoint:** `https://api.adsb.lol/v2/lat/48.43/lon/-123.37/dist/100 (also /v2/point/{lat}/{lon}/{radius}, /v2/closest/{lat}/{lon}/{radius}, /v2/mil, /v2/hex/{hex}, /v2/callsign/{cs}, /v2/sqk/{sq}, /v2/reg/{reg}, /v2/type/{type}; OpenAPI spec at https://api.adsb.lol/api/openapi.json, Swagger UI at https://api.adsb.lol/docs)`
- **Auth:** none (OpenAPI ToS note: 'In the future, you will require an API key which you can get by feeding to adsb.lol' - not enforced today)
- **Rate limits:** No numeric limit published. ToS asks production users to contact the maintainer so they do not break your app. Be polite: stay around 1 req/s or slower.
- **License:** ODbL v1.0 (stated in the API's own OpenAPI info.license) for the API and all public adsb.lol data.
- **Attribution:** ODbL attribution: credit adsb.lol with a link; share-alike applies if you redistribute derived databases.
- **Cadence:** fast (60s). Real-time aggregator.
- **CORS:** No Access-Control-Allow-Origin header observed - server-side only.
- **Response shape:** {"ac": [readsb aircraft objects - same field set as adsb.fi: hex, type, flight, r, t, alt_baro, alt_geom, gs, track, squawk, emergency, category, nav_*, lat, lon, nic, rc, seen_pos, sil, mlat[], tisb[], messages, seen, rssi, dst, dir], "msg", "now", "total", "ctime", "ptime"} (ac array verified; lacks desc/ownOp enrichment that adsb.fi adds).
- **Gotchas:** Less owner/operator enrichment in responses than adsb.fi/airplanes.live (no desc/ownOp/year observed) - pair with the tar1090-db CSV or adsbdb for enrichment. API key requirement may appear in the future; watch their docs.

### ADSB.One API — `adsb-one`

**T2 · VERIFY-FAILED** — Endpoint forms are confirmed current via the official GitHub README (github.com/ADSB-One/api, ADSBx-v2-compatible), but both live attempts (default curl and browser UA) from this network were blocked by a Cloudflare 'Attention Required' 403 challenge page, so I could not see real data with my own request.

- **Endpoint:** `https://api.adsb.one/v2/point/48.43/-123.37/100 (documented; also /v2/hex/{hex}, /v2/callsign/{cs}, /v2/reg/{reg}, /v2/type/{type}, /v2/squawk/{sq}, /v2/mil/, /v2/ladd/, /v2/pia/; radius max 250 NM)`
- **Auth:** none documented
- **Rate limits:** Not published in the README; unknown.
- **License:** Not stated in the API README; community aggregator, assume personal/non-commercial courtesy terms like its peers until confirmed.
- **Attribution:** Credit ADSB.One (unconfirmed requirement)
- **Cadence:** fast (60s) if it works from your server's egress IP - test from the Convex deployment before relying on it.
- **CORS:** Unknown - could not get past Cloudflare challenge.
- **Response shape:** Per README example: {"ac": [readsb-style objects], "msg": "No error", ...} - NOT observed live by me.
- **Gotchas:** Cloudflare bot-challenge blocked plain HTTPS clients from a Vancouver (YVR PoP) residential/datacenter path; it may also block Convex's egress. With adsb.fi, adsb.lol and airplanes.live all verified working and API-compatible, treat adsb.one as a spare, not a dependency.

### Entity enrichment: adsbdb + planespotters photos (+paid options noted) — `aircraft-enrichment`

**T2 · VERIFIED** — adsbdb verified live for both aircraft and callsign-route lookups (free, CORS *, no auth). Planespotters photo API verified live once a descriptive User-Agent with contact info is sent. ADS-B Exchange API and FlightAware AeroAPI are paid - documented honestly below.

- **Endpoint:** `https://api.adsbdb.com/v0/aircraft/{modeS-hex} (e.g. .../v0/aircraft/a696d5) and https://api.adsbdb.com/v0/callsign/{callsign} (e.g. .../v0/callsign/WJA147); photos: https://api.planespotters.net/pub/photos/hex/{icao24} (e.g. .../pub/photos/hex/a696d5)`
- **Auth:** adsbdb: none. planespotters: none, BUT generic library User-Agents are rejected with 403 - send e.g. 'BlindSpot/1.0 (+mailto:you@example.com)'. ADSBx (paid): RapidAPI sub ~USD10/mo for 10k requests (rapidapi.com/adsbx/api/adsbexchange-com1/pricing), no free tier; enterprise by quote. FlightAware AeroAPI (paid): usage-based, Personal tier includes USD5/mo of free usage credit then pay-per-query (flightaware.com/commercial/aeroapi/).
- **Rate limits:** adsbdb: none published; be reasonable and cache aggressively (data is static per airframe). planespotters: not published; cache photo URLs per hex.
- **License:** adsbdb: free public API (data compiled from public registries; no formal license stated). planespotters: free photo API, photos remain photographers' copyright; terms page (planespotters.net/photo/api) is behind a Cloudflare JS challenge so I could not read full terms - known requirements are non-commercial use, link-back, and photographer credit; confirm in a browser before shipping.
- **Attribution:** planespotters: display photographer name (returned in response) and link to the returned photo page link. adsbdb: courtesy credit to adsbdb.com.
- **Cadence:** slow / on-demand only - look up a hex or callsign when the operator inspects an entity, then cache (airframe data is near-static; routes change rarely).
- **CORS:** adsbdb: Access-Control-Allow-Origin: *. planespotters: Access-Control-Allow-Origin: *.
- **Response shape:** adsbdb aircraft: {"response":{"aircraft":{type, icao_type, manufacturer, mode_s, registration, registered_owner_country_iso_name, registered_owner_country_name, registered_owner_operator_flag_code, registered_owner, url_photo, url_photo_thumbnail}}}; adsbdb callsign: {"response":{"flightroute":{callsign, callsign_icao, callsign_iata, airline{name,icao,iata,country,callsign}, origin{iata_code,icao_code,latitude,longitude,municipality,name,elevation}, destination{...}}}}; 404 body is {"response":"unknown aircraft"}. planespotters: {"photos":[{id, thumbnail{src,size}, thumbnail_large{src,size}, link, photographer}]}.
- **Gotchas:** adsbdb coverage of Canadian registrations is patchy: a live BC hex (c1e678) returned 'unknown aircraft' while a US hex resolved fully - fall back to hexdb.io or the tar1090-db CSV for CA airframes. Callsign-route lookups are schedule-derived and can be wrong for repositioning flights. Do not hotlink planespotters full-size images; use the provided thumbnails + link.

### Military flagging: tar1090-db aircraft.csv.gz (+ upstream Mictronics / ADSBx basic db) — `mil-watch`

**T2 · VERIFIED** — Verified: downloaded the 8.7 MB aircraft.csv.gz from GitHub, decompressed it, and cross-checked live military hexes against it - RCAF CC-130s (C2AF27) and USAF airframes carry flag '10'. Upstream sources (Mictronics indexedDB zip, ADSBx basic-ac-db) also verified fetchable. No explicit license on the repo - flag coverage has gaps.

- **Endpoint:** `https://github.com/wiedehopf/tar1090-db/raw/refs/heads/csv/aircraft.csv.gz (verified 200, application/octet-stream, 8,763,062 bytes). Upstreams per the repo's update.sh, both verified: https://www.mictronics.de/aircraft-database/indexedDB_old.php (zip, 4.3 MB) and https://downloads.adsbexchange.com/downloads/basic-ac-db.json.gz (15.2 MB).`
- **Auth:** none
- **Rate limits:** GitHub raw - no practical limit at daily cadence. DB updated roughly daily (repo pushed 2026-06-08 at check time).
- **License:** No LICENSE file and no license field on wiedehopf/tar1090-db (checked via GitHub API). Mictronics database is community-compiled from public registries; ADSBx basic-ac-db is published on their open downloads page. Fine for internal single-operator use; do not redistribute as your own dataset.
- **Attribution:** Credit Mictronics (mictronics.de/aircraft-database) and wiedehopf/tar1090-db.
- **Cadence:** slow - re-download daily or weekly and cache in Convex; it is a reference table, not a live feed.
- **CORS:** GitHub raw downloads typically send Access-Control-Allow-Origin: * (not captured in my size-only check); irrelevant server-side.
- **Response shape:** Semicolon-separated CSV, no header: hex;registration;icaoType;flags;description;year;ownOp; e.g. 'C2AF27;130339;C130;10;Lockheed CC-130H Hercules;;ROYAL CANADIAN AIR FORCE;'. Flags is a 2-char string: first char 1 = military, second char = 'interesting' (Mictronics convention); civil rows are '00'.
- **Gotchas:** Flag coverage is incomplete: a USCG HC-27J (AE272E) that adsb.fi /v2/mil flagged live as dbFlags:1 has '00' in the CSV. For robust mil detection, OR together: (a) CSV flag '1x', (b) ICAO hex allocation ranges (US mil ADF7C8-AFFFFF, Canadian military C20000-C3FFFF), and (c) the aggregators' live /v2/mil endpoints (verified working on adsb.fi, 321 aircraft worldwide at check time, includes dbFlags:1 per aircraft). For VI specifically: CFB Comox (19 Wing) CP-140 Auroras and CH-149 Cormorants, RCN helicopters, and USN P-8s off the coast are the interesting traffic.

### NAV CANADA CFPS alpha API (NOTAMs) — `navcan-notams`

**T3 · VERIFIED** — Verified live and keyless: plan.navcanada.ca's internal JSON API returned 13 real NOTAMs for CYYJ (including CZVR FIR-wide ones) with no auth. It is the machine-usable Canadian NOTAM source - but it is an undocumented internal endpoint with no published API terms, so treat as best-effort T3.

- **Endpoint:** `https://plan.navcanada.ca/weather/api/alpha/?site=CYYJ&alpha=notam (multiple sites: append &site=CYCD&site=CYQQ&site=CYAZ&site=CYWH for Nanaimo, Comox, Tofino, Victoria Harbour; same API serves &alpha=metar&alpha=taf&alpha=sigmet&alpha=airmet&alpha=pirep)`
- **Auth:** none (sets Radware-style __uzm* anti-bot cookies but plain curl worked)
- **Rate limits:** None published. It backs their public flight-planning site; poll gently (it is per-site, so a 5-aerodrome sweep is 1 request).
- **License:** No API terms published. NAV CANADA site terms cover the website; NOTAM content itself is factual aeronautical safety information. Unofficial/undocumented endpoint - it can change without notice. Not for navigation/operational flight use.
- **Attribution:** Credit NAV CANADA / plan.navcanada.ca
- **Cadence:** medium-slow (15-30 min). NOTAMs do not churn fast; CFR/TFR-style urgent ones are rare.
- **CORS:** No Access-Control-Allow-Origin observed - server-side only.
- **Response shape:** {"meta":{"now","count":{"notam":13},"messages":[]},"data":[{type:'notam', pk, location, startValidity, endValidity, text (JSON-string wrapping {raw: ICAO-format NOTAM text, english, french}), hasError, position:{pointReference:'CYYJ', radialDistance}}]}. The raw field contains full ICAO NOTAM format incl. Q-line with FIR, coordinates and radius - parseable for geofencing.
- **Gotchas:** Undocumented = can break silently; wrap in defensive parsing (text field is JSON-inside-JSON). Site queries return FIR-level NOTAMs duplicated across sites - dedupe on pk. Alternative checked: FAA NOTAM API (external-api.faa.gov/notamapi/v1) requires client_id/client_secret via FAA onboarding approval (no self-serve key) - my unauthenticated probe returned 404 'No context-path matches'; it does carry CA NOTAMs but is not worth the onboarding for this use. Canada has no US-style public TFR feed; CYR restricted areas are static chart data.

### Victoria International Airport (YYJ) flight board — `yyj-board`

**T2 · VERIFIED** — Cracked the Cloudflare 403: it only UA-gates. With browser headers, GET the flight-status page to scrape a WordPress nonce, then POST admin-ajax.php action=yyj_get_flights — returns live JSON-wrapped HTML flight tables (verified real WestJet departure rows for today, 133 KB). Fragile internal endpoint; keep adsb-derived YYJ movements around 48.647,-123.426 as fallback.

- **Endpoint:** two-step: (1) GET https://yyj.ca/en/flights-info/flight-status/ with browser UA -> parse inline `flightsData = {"ajaxUrl":"https://yyj.ca/wp-admin/admin-ajax.php","nonce":"..."}`; (2) POST https://yyj.ca/wp-admin/admin-ajax.php with form body action=yyj_get_flights&nonce=<NONCE>&lang=en
- **Auth:** no account, but requires: browser-like User-Agent + Accept headers (Cloudflare returns 403 to default curl UA — the round-1 failure), plus a WordPress nonce scraped from the status page; send Referer and X-Requested-With: XMLHttpRequest on the POST
- **Rate limits:** none observed; Cloudflare-fronted so keep it polite — one page fetch + one AJAX call per poll cycle
- **License:** no published API/ToS for this endpoint; public flight-information board, content © Victoria Airport Authority. Fine for personal single-operator situational use; do not redistribute.
- **Attribution:** Victoria Airport Authority (yyj.ca)
- **Cadence:** medium (5-15 min); board's own banner shows 'Flight details accurate as of HH:MM' so minute-level polling buys nothing
- **CORS:** not applicable in practice — Cloudflare UA-gating forces server-side polling from Convex regardless
- **Response shape:** HTTP 200 JSON (verified 2026-06-11, 133 KB): {success:true, data:{html:"..."}} where html is server-rendered tables (#flightsToday etc., theme 'eclipse360'). Each <tr> has classes encoding direction+status (e.g. 'departure Departed'); cells: Airline (logo img with alt e.g. 'westjet'), Flight, Location, Gate, Scheduled Time, Status. Includes today + next-day sections and an 'accurate as of' timestamp. Parse the HTML server-side (e.g. cheerio).
- **Gotchas:** Round-1 attempt superseded by retry (was: verify-failed). Fragile by nature: internal theme AJAX action, not an API. The nonce ('2230322340' at verify time) expires — when the POST returns success:false, refetch the flight-status page for a fresh one (cache it, refresh every few hours). Payload is HTML-in-JSON, so a theme redesign breaks the parser. Note final URL is yyj.ca/en/flights-info/flight-status/ (the /en/flights/ path 301s there).

### airplanes.live REST API — `airplanes-live`

**T2 · VERIFIED · NEW** — Verified live over VI with the richest free payload of the aggregators (desc, ownOp, year included) and CORS *. Documented 1 req/s limit. Strong primary-feed candidate alongside adsb.fi.

- **Endpoint:** `https://api.airplanes.live/v2/point/48.43/-123.37/100 (also /v2/hex/{hex}, /v2/callsign/{cs}, /v2/reg/{reg}, /v2/type/{type}, /v2/squawk/{sq}, /v2/mil, /v2/ladd, /v2/pia; radius max 250 NM; docs at airplanes.live/api-guide/)`
- **Auth:** none
- **Rate limits:** 1 request/second (documented on the API guide page, fetched and confirmed).
- **License:** Free community API; terms of use page on airplanes.live (CF-protected from non-browser fetch; treat as personal/non-commercial like its peers and confirm in a browser).
- **Attribution:** Credit airplanes.live
- **Cadence:** fast (60s), one centered query covering the island.
- **CORS:** Access-Control-Allow-Origin: * (observed).
- **Response shape:** {"ac":[readsb objects with hex, type, flight, r, t, desc, ownOp, year, alt_baro, alt_geom, gs, track, squawk, emergency, category, nav_*, lat, lon, nic, rc, seen_pos, sil, mlat[], tisb[], messages, seen, rssi, dst, dir]} - same family as adsb.fi/adsb.lol, enrichment-rich variant.
- **Gotchas:** Same 250 NM radius cap; same readsb caveats. Three interchangeable ADSBx-v2-compatible feeds (fi/lol/live) means you can build one adapter with provider failover.

### hexdb.io aircraft lookup API — `hexdb-io`

**T2 · VERIFIED · NEW** — Verified live, keyless, CORS *: instant hex-to-registration/type/owner JSON. Good lightweight fallback for enrichment where adsbdb draws a blank, plus route and airport lookup endpoints.

- **Endpoint:** `https://hexdb.io/api/v1/aircraft/{icao24} (e.g. https://hexdb.io/api/v1/aircraft/a696d5; also /api/v1/route/icao/{callsign} and /api/v1/airport/icao/{icao})`
- **Auth:** none
- **Rate limits:** None published; be gentle and cache (static data).
- **License:** Free public lookup service; no formal license stated on site.
- **Attribution:** Courtesy credit hexdb.io
- **Cadence:** slow / on-demand with permanent caching.
- **CORS:** Access-Control-Allow-Origin: * (observed).
- **Response shape:** {"ModeS":"A696D5","Registration":"N5233A","Manufacturer":"Boeing","ICAOTypeCode":"B738","Type":"737NG 84PBCF/W","RegisteredOwners":"Prime Air","OperatorFlagCode":"GTI"}
- **Gotchas:** Single-maintainer service - cache everything so an outage costs nothing. Field names are PascalCase unlike everything else in this cluster.

### NAV CANADA CFPS aviation weather (METAR/TAF/SIGMET) — `navcan-cfps-wx`

**T3 · VERIFIED · NEW** — Same verified keyless NAVCAN alpha API, different alpha params: returned a live CYYJ METAR and TAF in one call. Gives the air cluster wind/visibility/ceiling context (why is nothing flying?) for every VI aerodrome from one endpoint.

- **Endpoint:** `https://plan.navcanada.ca/weather/api/alpha/?site=CYYJ&alpha=metar&alpha=taf (add &site=CYQQ&site=CYCD&site=CYAZ; &alpha=sigmet&alpha=airmet&alpha=pirep also supported by the same API)`
- **Auth:** none
- **Rate limits:** None published; one request covers many sites and products - poll gently.
- **License:** Same caveat as navcan-notams: undocumented internal API, no published terms; METAR/TAF content is factual weather data. Not for operational flight use.
- **Attribution:** Credit NAV CANADA / plan.navcanada.ca
- **Cadence:** medium-slow (30 min) - METARs issue hourly, TAFs every 6h.
- **CORS:** No Access-Control-Allow-Origin observed - server-side only.
- **Response shape:** {"meta":{"now","count":{"metar":1,"taf":1}},"data":[{type:'metar'|'taf', pk, location:'CYYJ', startValidity, endValidity, text: raw METAR/TAF string (e.g. 'METAR CYYJ 111200Z 28005KT 30SM SKC 10/09 A3020 RMK SLP228='), hasError, position}]}
- **Gotchas:** Raw METAR/TAF strings need a parser (or just display raw - operators read METAR). Same fragility caveat as the NOTAM endpoint since it is the same undocumented API.

## Seas (Marine)

> Strong cluster: 9 of 13 sources fully verified with live data today, and the only T1 gap is a free signup (aisstream). Three training-data traps confirmed, all worth remembering: (1) ECCC Datamart moved to date-first paths (/YYYYMMDD/WXO-DD/...) - old swob-ml URLs 404; (2) DFO's gisp.dfo-mpo.gc.ca GIS host is NXDOMAIN, replaced by egisp.dfo-mpo.gc.ca; (3) TeleGeography deleted their GitHub repo - the live site API is the only source and carries no explicit license now. Legal caveats: OpenSanctions (CC BY-NC) and TeleGeography data are non-commercial only - fine for a single-operator tool, fatal if BlindSpot ever becomes a product; bcferriesapi.ca is an unsanctioned third-party scrape with single-maintainer risk; nothing here is navigation-grade. JRCC SAR has no feed at all - derive SAR events from AIS (CCG/RCM-SAR vessel clustering) plus the aircraft cluster's ADS-B (RESCUE 9xx out of Comox), which honestly will out-perform anything JRCC publishes. Recommended build order: 1) DFO IWLS + NDBC/SWOB pollers (zero-auth, verified, instant map value); 2) bcferriesapi (5-min cron, trivial); 3) get the aisstream key - it is the backbone layer (all vessel positions incl. ferries) and everything else enriches it; 4) static layers in one sitting (GEBCO raster, cable GeoJSON pinned in repo, TC/ECHO zone polygons hand-digitized from the 2026 Interim Order - redo each June); 5) DFO closures hourly poller; 6) OpenSanctions daily bulk join on MMSI/IMO; 7) optional: ONC token + CIOOS for oceanographic depth. Coverage honesty: terrestrial AIS and most buoys thin out west of Tofino (offshore edge of bbox); 46132 South Brooks and La Perouse Bank are your only sentinels out there, and ECHO Swiftsure zones sit right at the coverage margin.

### AISStream.io live AIS websocket — `aisstream`

**T1 · NEEDS-KEY** — Free websocket firehose of global AIS. Docs verified live 2026-06-11; protocol confirmed (APIKey + BoundingBoxes subscribe message). Cannot test stream without a key. Beta service, no SLA; GitHub issues show real but survivable reliability wobbles.

- **Endpoint:** `wss://stream.aisstream.io/v0/stream  (subscribe within 3s of connect with: {"APIKey":"<key>","BoundingBoxes":[[[48.20,-125.30],[51.10,-123.10]]],"FilterMessageTypes":["PositionReport","ShipStaticData"]})`
- **Auth:** free key; sign in at https://aisstream.io via GitHub OAuth, then generate at https://aisstream.io/apikeys. Keys only usable over wss/https.
- **Rate limits:** max 1 subscription update per second; client must keep up with ~300 msg/s average or be disconnected; FiltersShipMMSI max 50 MMSIs
- **License:** free for non-commercial use; commercial use requires asking (people request permission via their GitHub issues). BETA: explicitly no uptime guarantee/SLA.
- **Attribution:** none formally documented; courteous to credit aisstream.io
- **Cadence:** n/a - persistent websocket, not polled; reconnect on drop with backoff
- **CORS:** n/a (websocket; docs say direct browser connections unsupported, use a backend proxy - fits the Convex server-side model)
- **Response shape:** From official docs: subscribe fields APIKey (req), BoundingBoxes (req, [[lat,lon],[lat,lon]] pairs), FiltersShipMMSI (opt), FilterMessageTypes (opt). Message types: PositionReport (position, heading, SOG, nav status), ShipStaticData (name, dims, call sign, IMO, destination), plus BaseStationReport, AidsToNavigationReport, SafetyBroadcastMessage and ~20 others. Did not see a live message myself (no key).
- **Gotchas:** Reliability reputation (github.com/aisstream/issues, 131 open, active through Jun 2026): recent issues include 'AIS traffic messages not being sent' (2026-06-09), an expired SSL cert incident (2026-05-26), regional coverage gaps, and FiltersShipMMSI returning nothing. Build auto-reconnect with backoff and treat gaps as expected. Terrestrial receiver network: offshore coverage west of Tofino will be patchy. This is also your BC Ferries vessel-position layer (ferries broadcast AIS).

### BC Ferries sailing status (community bcferriesapi.ca) — `bc-ferries`

**T1 · VERIFIED** — No official BC Ferries public API exists. Community API bcferriesapi.ca verified live with real sailing/capacity data; official Conditions Center (cc.bcferries.com) is WAF-blocked to non-browser clients. Vessel positions: use AIS (aisstream), not this.

- **Endpoint:** `https://www.bcferriesapi.ca/v2/  (also /v2/capacity/ and /v2/noncapacity/; legacy v1: /api/<departure-terminal>/<destination-terminal>)`
- **Auth:** none
- **Rate limits:** none documented; be polite (it is one person's free service)
- **License:** API code is MIT (github.com/samuel-pratt/bc-ferries-api); underlying data is scraped from bcferries.com, which BC Ferries has not formally sanctioned - acceptable risk for a single-operator personal tool, do not redistribute
- **Attribution:** credit bcferriesapi.ca / Samuel Pratt; data originates from BC Ferries
- **Cadence:** medium (5 min) - conditions on bcferries.com refresh every few minutes
- **CORS:** Access-Control-Allow-Origin: * (observed)
- **Response shape:** Top level: {capacityRoutes: [12 routes], nonCapacityRoutes: [...]}. capacityRoutes[]: routeCode (e.g. NANHSB), fromTerminalCode, toTerminalCode, sailingDuration, sailings[]: {time, arrivalTime, sailingStatus ('future'/etc), fill, carFill, oversizeFill (percent ints), vesselName, vesselStatus}. nonCapacityRoutes[] same minus fill fields.
- **Gotchas:** Tried official sources: https://cc.bcferries.com/app/ferry-tracking returns a 730-byte WAF error page to curl even with browser UA - their internal JSON is not reachable server-side without browser emulation, and scraping it is grey-zone. The community API is therefore the only workable machine-readable sailing-status source. For real-time positions, BC Ferries vessels all broadcast AIS - join vesselName from here to AIS ShipStaticData. Single-maintainer dependency risk: pin expectations, handle outages.

### DFO CHS IWLS water levels (tides) — `dfo-chs-tides`

**T1 · VERIFIED** — Fully verified with live requests: station catalog (369 Pacific stations) and both observed (wlo) and predicted (wlp) 1-minute water-level series for Victoria Harbour returned real data.

- **Endpoint:** `https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/5cebf1df3d0f4a073c4bbd1e/data?time-series-code=wlo&from=2026-06-11T10:00:00Z&to=2026-06-11T12:00:00Z  (station catalog: https://api-iwls.dfo-mpo.gc.ca/api/v1/stations?chs-region-code=PAC). Verified station IDs - Victoria Harbour 07120: 5cebf1df3d0f4a073c4bbd1e; Nanaimo Harbour 07917: 5cebf1de3d0f4a073c4bb96d; Campbell River 08074: 5cebf1de3d0f4a073c4bb996; Tofino 08615: 5cebf1e23d0f4a073c4bc07c (all operating:true with wlo+wlp+wlp-hilo; bonus: Port Hardy 08408 5cebf1de3d0f4a073c4bb9c7, Port Alberni 08575 5cebf1e23d0f4a073c4bc06f for tsunami-relevant Alberni Inlet)`
- **Auth:** none
- **Rate limits:** none documented; query windows are capped (request small from/to ranges, e.g. hours not months)
- **License:** Government of Canada - Open Government Licence Canada (data via DFO/CHS)
- **Attribution:** Canadian Hydrographic Service / Fisheries and Oceans Canada
- **Cadence:** medium (5-15 min) for wlo; wlp/wlp-hilo can be fetched daily and cached
- **CORS:** no Access-Control-Allow-Origin observed on plain GET (only Vary: Access-Control-Request-Method) - server-side polling unaffected
- **Response shape:** stations: [{code,id,latitude,longitude,officialName,operating,type,timeSeries:[{code:'wlo'|'wlp'|'wlp-hilo'|'ap1',id,nameEn,owner}]}]. data: [{eventDate:'2026-06-11T10:00:00Z',qcFlagCode:'1',reviewed:false,timeSeriesId,value:2.009}] - value in metres chart datum, 1-minute resolution for both wlo and wlp.
- **Gotchas:** Use the Mongo-style station id (not the 5-digit code) in data URLs. wlo has ingestion lag of a few minutes. wlp-hilo gives high/low tide events if you want tide tables rather than curves.

### NOAA NDBC buoys + ECCC MSC Datamart SWOB-ML marine buoys — `noaa-ndbc-buoys`

**T1 · VERIFIED** — Both halves verified live. NDBC realtime2 text format confirmed for 46088 (data 10 min old at fetch); all six listed stations return 200. ECCC Datamart verified, but note the datamart moved to a date-first directory layout - old /observations/... paths now 404.

- **Endpoint:** `https://www.ndbc.noaa.gov/data/realtime2/46088.txt  (same pattern for 46087, 46131, 46132, 46146, 46206 - all verified 200). ECCC SWOB-ML (verified): https://dd.weather.gc.ca/20260611/WXO-DD/observations/swob-ml/marine/moored-buoys/20260611/4600146/2026-06-11-1205-4600146-AUTO-swob.xml (substitute current UTC date twice; list the station dir to find latest file)`
- **Auth:** none
- **Rate limits:** NDBC: none hard, cache-control max-age=600; ECCC Datamart: be reasonable, AMQP push (Sarracenia) offered for heavy users
- **License:** NDBC: US Government public domain. ECCC: Environment and Climate Change Canada Data Servers End-use Licence (free use with attribution).
- **Attribution:** NOAA/NDBC courtesy credit; 'Data Source: Environment and Climate Change Canada' for datamart
- **Cadence:** medium (10-15 min) for US 10-min stations; slow (30-60 min) for hourly Canadian buoys
- **CORS:** NDBC: no ACAO header observed. dd.weather.gc.ca: not observed.
- **Response shape:** NDBC realtime2: fixed-width text, header '#YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE', newest row first, 'MM' = missing, 10-min rows for 46088. SWOB-ML: om:ObservationCollection XML with identification-elements (msc_id, wmo_id_extnd=4600146, lat 49.34, lon, date_tm) plus met/wave elements; hourly files (...-1005-, -1105-, -1205-AUTO-swob.xml).
- **Gotchas:** Island-relevant stations confirmed on ECCC datamart today: 4600131 Sentry Shoal, 4600132 South Brooks, 4600146 Halibut Bank, 4600204 West Sea Otter, 4600206 La Perouse Bank, 4600207 East Dellwood, plus new Salish Sea buoys 4600303/4600304; offshore 4600004/4600036/4600184. US side: 46087 Neah Bay, 46088 New Dungeness (10-min cadence, best for Haro/Juan de Fuca). Canadian buoys report hourly. IMPORTANT: dd.weather.gc.ca restructured to /YYYYMMDD/WXO-DD/... - any pre-2025 path in training data 404s. Canadian buoys also mirror on NDBC as 46131/46132/46146/46206 (simpler text parsing, slight extra latency).

### OpenSanctions (maritime collection) — `opensanctions`

**T2 · VERIFIED** — Bulk dataset files verified live and openly downloadable without a key (HEAD 200, CDN, daily refresh). Dedicated maritime collection exists: 303,848 entities incl. 16,372 vessels with IMO/MMSI - ideal for enriching AIS tracks. API requires a key; bulk files do not.

- **Endpoint:** `https://data.opensanctions.org/datasets/latest/maritime/entities.ftm.json  (index: https://data.opensanctions.org/datasets/latest/maritime/index.json - verified, entity_count 303848, updated 2026-06-10; also maritime.csv tabular ~4 MB; full sanctions set: https://data.opensanctions.org/datasets/latest/sanctions/entities.ftm.json)`
- **Auth:** none for bulk files (verified). API at api.opensanctions.org needs key: free keys issued to journalists/activists/academics via signup at opensanctions.org; otherwise pay-as-you-go.
- **Rate limits:** bulk: CDN-served, cache-control max-age=86400 - fetch at most daily. API: metered per request.
- **License:** CC BY 4.0 Attribution-NonCommercial for the dataset; commercial use requires a paid data license from OpenSanctions. A personal single-operator OSINT tool is comfortably non-commercial, but you cannot productize or resell.
- **Attribution:** OpenSanctions.org (required by CC BY-NC)
- **Cadence:** slow (daily) - dataset rebuilds daily
- **CORS:** access-control-allow-origin: * on data.opensanctions.org (observed)
- **Response shape:** entities.ftm.json: newline-delimited FollowTheMoney entities (content-type application/json+ftm). index.json: {name:'maritime', title:'Maritime-related sanctions', entity_count, updated_at, resources...}. Maritime collection per site: vessels + operators/owners with IMO, MMSI, flag, risk classification, from 23 sources (OFAC SDN, EU, UN, SECO, Ukraine war lists).
- **Gotchas:** Join key for BlindSpot: MMSI/IMO from AIS ShipStaticData against maritime.csv. Sanctioned-vessel hits in Salish Sea waters will be rare - this is an enrichment layer, not a feed. Honest licensing note: stay non-commercial or budget for a license.

### DFO CSSP shellfish closures + ECCC harvest classification (ArcGIS REST) — `dfo-closures`

**T2 · VERIFIED** — Verified with live spatial queries: DFO egisp 'Active Prohibition Orders' layer returned real biotoxin/sanitary closure features in the VI bbox (Qualicum Beach, Elma Bay), and ECCC classification layer returned Approved/Prohibited polygons near Nanaimo.

- **Endpoint:** `https://egisp.dfo-mpo.gc.ca/arcgis/rest/services/CSSP/Data_Public/MapServer/3/query?where=1%3D1&geometry=-125.3,48.2,-123.1,51.1&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&f=geojson  (layers: 0 Harvest Areas, 1 Conservation Measures, 2 Revoked Orders, 3 Active Prohibition Orders. Static classification: https://maps-cartes.ec.gc.ca/arcgis/rest/services/STB_DGST/Shellfish_Classification_Mollusques/MapServer/0/query)`
- **Auth:** none
- **Rate limits:** none documented; standard ArcGIS REST paging (use resultRecordCount/resultOffset)
- **License:** Open Government Licence - Canada (DFO / ECCC)
- **Attribution:** Fisheries and Oceans Canada; Environment and Climate Change Canada (classification layer)
- **Cadence:** slow (60 min or daily) - closures change on regulatory timescales
- **CORS:** not observed/checked on either server - server-side polling unaffected
- **Response shape:** Prohibition order attributes seen: OBJECTID, REASON (coded), DFO_REGION (4=Pacific), PO_NUM ('PSN-2017-446'), REVOKE_PO_NUM, PUBLIC_NOTICE_URL, SPECIES_DESCRIPTION_EN/FR, PLACE_NAME_EN (subarea like '14.31'), GEO_DESCRIPTION_EN (verbose legal text with lat/long), GEO_SHORT_DESCRIPTION_EN. Classification attributes: province, class_code (A/P), class_en ('Approved'/'Prohibited'), risc_date, Shape_Area.
- **Gotchas:** Training-data trap confirmed: old host gisp.dfo-mpo.gc.ca is NXDOMAIN (decommissioned); the live host is egisp.dfo-mpo.gc.ca (found by reading BCCDC's shellfish webmap config, which itself still references the dead host for base layers). REASON is a coded int - fetch the layer's field domain for labels. Fishery notices (openings/closures for fin-fish) are separate at notices.dfo-mpo.gc.ca - HTML/email only, no API found.

### ECHO/Transport Canada whale slowdown + restricted zones — `echo-slowdown`

**T3 · VERIFIED** — Official 2026 coordinates verified on Transport Canada's Interim Order page (dated 2026-05-22, effective Jun 1 - Nov 30 2026): two mandatory 10-kn Speed Restricted Zones (Swiftsure Bank, Mouth of Nitinat) and two Vessel Restricted Zones (Pender, Saturna). The ECHO voluntary Haro/Boundary polygon itself only lives in Port of Vancouver notices that are bot-blocked.

- **Endpoint:** `https://tc.canada.ca/en/interim-order-protection-killer-whale-orcinus-orca-waters-southern-british-columbia  (coordinates in-page, e.g. Swiftsure SRZ from 48°34.000'N 125°06.000'W, Nitinat SRZ from 48°42.377'N 125°00.000'W to Carmanah Point 48°36.683'N 124°45.083'W; Pender VRZ 48°45.817'N 123°19.300'W / 48°46.217'N 123°18.867'W / 48°44.167'N 123°13.917'W / 48°44.153'N 123°15.517'W; Saturna VRZ six points around 48°47.150'N 123°02.733'W)`
- **Auth:** none
- **Rate limits:** n/a (static page, refreshed annually)
- **License:** Government of Canada publication; reproducing coordinates for an info layer is fine (non-commercial reproduction permitted)
- **Attribution:** Transport Canada, Interim Order for the Protection of the Killer Whale 2026
- **Cadence:** slow (static; re-check each June when the annual order/notices publish)
- **CORS:** n/a (one-time manual extraction into static GeoJSON)
- **Response shape:** HTML legal text with schedules of lat/long point lists per zone (degrees decimal-minutes). No GIS file published by TC.
- **Gotchas:** Two distinct things: (1) TC mandatory zones - coordinates verified above, redrawn annually (a 2026 order superseded 2025; re-extract every June); (2) ECHO voluntary Haro Strait/Boundary Pass + Swiftsure slowdowns - polygons are in Port of Vancouver 'Notice to Industry' PDFs; portvancouver.com serves 403 to curl and WebFetch (verified), so grab the PDF once in a real browser and digitize manually. 2025 ECHO season ran Jun 1-Nov 30 covering ~86 nm of lanes. Static layer: hand-build the GeoJSON once per season.

### JRCC Victoria SAR incidents — `jrcc-sar`

**T3 · VERIFY-FAILED** — Honest verdict: no machine-readable public feed of JRCC Victoria incidents exists. Incident data lives in the internal SISAR database; historical extracts surface only via ATIP requests and academic papers. Nothing real-time is published.

- **Endpoint:** `n/a (closest things: https://www.ccg-gcc.gc.ca/search-rescue-recherche-sauvetage/index-eng.html program pages; e-navigation.canada.ca SAR topic page has no data links - fetched and grepped, no API/GeoJSON/ArcGIS references in the HTML)`
- **Response shape:** n/a - what I tried: web searches for JRCC/SISAR open data and API (nothing on open.canada.ca); fetched e-navigation.canada.ca/topics/sar/index-en (200, 30 KB, zero api/json/arcgis URLs in source); confirmed SISAR exists but is internal.
- **Gotchas:** Workable proxies inside BlindSpot: (1) watch AIS for CCG vessel MMSIs and RCM-SAR fast-response craft clustering at a point (SAR signature); (2) aircraft cluster's ADS-B for 442 Sqn Cormorant/Buffalo (callsigns RESCUE 9xx) out of Comox is the strongest real-time SAR signal; (3) some RCM-SAR stations post incident recaps on social media (slow, unstructured). Recommend dropping this as a polled source and deriving SAR events from AIS+ADS-B instead.

### GEBCO bathymetry WMS — `bathymetry`

**T3 · VERIFIED** — Verified GetMap: returned a real 428 KB PNG for the exact VI bbox. Good static base/overlay for the map.

- **Endpoint:** `https://wms.gebco.net/mapserv?request=getmap&service=wms&BBOX=48.2,-125.3,51.1,-123.1&crs=EPSG:4326&format=image/png&layers=GEBCO_LATEST&width=600&height=400&version=1.3.0  (HTTP 200, image/png, 428107 bytes; note WMS 1.3.0 EPSG:4326 axis order = lat,lon in BBOX)`
- **Auth:** none
- **Rate limits:** none documented; cache tiles - bathymetry doesn't change
- **License:** GEBCO Grid is placed in the public domain / free of charge; attribution requested
- **Attribution:** Imagery reproduced from the GEBCO_2025 Grid, GEBCO Compilation Group (2025)
- **Cadence:** slow (static - fetch once, cache; GEBCO grid updates annually)
- **CORS:** not observed in response headers; irrelevant if you cache server-side or pre-render tiles
- **Response shape:** binary PNG (GetMap). Layers include GEBCO_LATEST (shaded relief w/ depth colours); GetCapabilities at https://wms.gebco.net/mapserv?request=getcapabilities&service=wms&version=1.3.0
- **Gotchas:** For MapLibre, better long-term: download the GEBCO grid once and render your own raster/contour tiles instead of hot-linking WMS per pan/zoom. CHS NONS (non-navigational survey bathymetry, much higher resolution for BC waters) is published under Open Government Licence - Canada on open.canada.ca ('CHS NONNA-10/NONNA-100') - not re-verified here, but it is the upgrade path for nearshore detail. Never use either for navigation.

### TeleGeography submarine cable map GeoJSON — `submarine-cables`

**T3 · VERIFIED** — Training-data trap confirmed: the GitHub repo (telegeography/www.submarinecablemap.com) is gone (404). The live site API still serves the GeoJSON and I verified it: 714 cable features, 7 in/near the VI bbox including Connected Coast and AmeriCan-1.

- **Endpoint:** `https://www.submarinecablemap.com/api/v3/cable/cable-geo.json  (verified 200, application/json, 728 KB, Last-Modified 2026-06-10; landing points: https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json; metadata: /api/v3/cable/all.json)`
- **Auth:** none
- **Rate limits:** none documented; cache-control max-age=7200 - this is a static-ish file, fetch monthly
- **License:** No license published on the current API. The retired GitHub repo historically carried CC BY-NC-SA 3.0 for the data. Treat as TeleGeography-copyrighted: non-commercial use with attribution, do not redistribute; fine for a personal map layer.
- **Attribution:** TeleGeography Submarine Cable Map (submarinecablemap.com)
- **Cadence:** slow (static; refresh monthly at most)
- **CORS:** no Access-Control-Allow-Origin observed
- **Response shape:** GeoJSON FeatureCollection name 'submarine_cables', 714 features; properties: {id, name, color, feature_id, coordinates}. VI-area cables found by coordinate scan: Connected Coast, Vancouver-Bowen Island-Vancouver Island, AmeriCan-1, Alaska United East, Pacific Crossing-1, Topaz, Whidbey Island-Camano Island.
- **Gotchas:** Since the official repo vanished, there is no versioned/licensed mirror - pin a cached copy in your repo rather than hot-fetching. Cable routes on the map are stylized/approximate, not engineering-accurate seabed positions.

### NOAA CO-OPS Tides & Currents API (US side of Salish Sea) — `noaa-coops-tides-currents`

**T2 · VERIFIED · NEW** — Verified live: Neah Bay returned a 6-minute water-level observation from 12:24Z at 12:31Z. Complements DFO IWLS with the US shore of Juan de Fuca/Haro (Neah Bay, Port Angeles, Friday Harbor) plus currents predictions - useful since your AOI boundary runs mid-strait.

- **Endpoint:** `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=latest&station=9443090&product=water_level&datum=MLLW&time_zone=gmt&units=metric&format=json  (stations: 9443090 Neah Bay, 9444090 Port Angeles, 9449880 Friday Harbor; products: water_level, predictions, wind, air_pressure, currents_predictions)`
- **Auth:** none
- **Rate limits:** published fair-use limits on data retrieval (date-range caps per product); latest-obs polling is unrestricted in practice
- **License:** US Government public domain (NOAA)
- **Attribution:** NOAA CO-OPS (courtesy)
- **Cadence:** medium (6-12 min)
- **CORS:** Access-Control-Allow-Origin: * (observed)
- **Response shape:** {metadata:{id:'9443090',name:'Neah Bay',lat:'48.3707',lon:'-124.6016'},data:[{t:'2026-06-11 12:24',v:'0.096',s:'0.007',f:'0,0,0,0',q:'p'}]} - v in metres (units=metric), q=p preliminary.
- **Gotchas:** 6-minute observation cadence. Use datum=MLLW to be comparable with CHS chart datum conventions (they differ slightly - do not mix datums on one gauge plot without labeling).

### CIOOS Pacific ERDDAP (incl. BC Lightstation SST) — `cioos-pacific-erddap`

**T2 · VERIFIED · NEW** — Verified live: 117 datasets including 'BC Lightstation data' (daily sea-surface temp/salinity from VI lighthouses - a dataset that goes back decades). Machine-queryable JSON/CSV via standard ERDDAP. Note the national host data.cioos.org returned Cloudflare 523; the Pacific host works.

- **Endpoint:** `https://data.cioospacific.ca/erddap/tabledap/allDatasets.json?datasetID,title&distinct()  (verified; e.g. BC lightstations: https://data.cioospacific.ca/erddap/tabledap/BCSOP_daily.json - ERDDAP supports time/lat/lon constraints in the query string)`
- **Auth:** none
- **Rate limits:** none documented; ERDDAP servers throttle heavy concurrent queries - sequential polite queries fine
- **License:** datasets individually licensed, predominantly CC BY 4.0; check per-dataset metadata in ERDDAP info pages
- **Attribution:** CIOOS Pacific + originating data provider (e.g. DFO for lightstation data)
- **Cadence:** slow (daily)
- **CORS:** not checked (server-side polling intended)
- **Response shape:** ERDDAP table JSON: {table:{columnNames:[...],rows:[[...]]}}. allDatasets returned 117 rows; saw BCSOP_daily / BCSOP_monthly 'BC Lightstation data' and DFO CTD glider/cast datasets.
- **Gotchas:** Lightstation data is daily (semi-live, often a day or two behind) - treat as context, not real-time. Dataset IDs change occasionally; discover via allDatasets rather than hardcoding. data.cioos.org (national) was down (523) when tested - use the Pacific regional host.

### Ocean Networks Canada Oceans 3.0 API — `onc-oceans3`

**T2 · NEEDS-KEY · NEW** — API confirmed live and well-formed: unauthenticated request returns a clean structured 401 ('Either token or appToken must be specified'). Free token with registration. ONC runs the VENUS (Saanich Inlet/Strait of Georgia) and NEPTUNE (offshore VI) cabled observatories - real-time hydrophones, ADCP, CTD, seismometers right in your AOI.

- **Endpoint:** `https://data.oceannetworks.ca/api/locations?method=get&token=<TOKEN>  (verified 401 without token; with token also /api/devices, /api/scalardata, /api/rawdata - REST+JSON)`
- **Auth:** free key: register at https://data.oceannetworks.ca (Oceans 3.0), token shown under your profile's Web Services API tab. No payment for research/personal use.
- **Rate limits:** fair-use; large data requests are queued asynchronously via dataProductDelivery endpoints
- **License:** ONC data policy: free and open with attribution (CC BY 4.0)
- **Attribution:** Ocean Networks Canada required in any use/display
- **Cadence:** medium (5-15 min) for scalar data once keyed
- **CORS:** not checked
- **Response shape:** Error shape seen unauthenticated: {errors:[{errorCode:128,errorMessage:'Either token or appToken must be specified',parameter:'token, appToken'}]} - documented success shapes are JSON arrays of locations/devices/scalar samples.
- **Gotchas:** Deep API - start with locations -> deviceCategories -> scalardata for, e.g., Folger Passage (Barkley Sound) or Saanich Inlet nodes. Hydrophone audio is heavyweight; scalar sensors (temp, O2, pressure) are cheap. Offshore NEPTUNE nodes sit just west of your bbox near Tofino - decide whether to extend the AOI for them.

### MSC Datamart Marine Text Forecasts (Pacific) — `msc-marine-text`

**T1 · VERIFIED · NEW** — Verified live. Full marine text forecast (warnings + synopsis-style regular/extended forecasts with wind/vis text) per VI water area as XML on MSC Datamart's new day-rooted tree. Requires directory listing to find latest file; no JSON, no CORS.

- **Endpoint:** `https://dd.weather.gc.ca/{YYYYMMDD}/WXO-DD/marine_weather/pacific/{HH}/{ISO-timestamp}_MSC_MarineWeather_{areaCode}_en.xml (region map: https://dd.weather.gc.ca/{YYYYMMDD}/WXO-DD/marine_weather/regionList.xml)`
- **Auth:** None. Anonymous HTTPS. AMQP push (Sarracenia, dd.weather.gc.ca exchange) available as an alternative to polling.
- **Rate limits:** None published; MSC asks for courteous polling. Responses carry Cache-Control: max-age=300, so polling under 5 min is pointless.
- **License:** Environment and Climate Change Canada Data Server End-use Licence. Attribution required: 'Data Source: Environment and Climate Change Canada'.
- **Attribution:** Data Source: Environment and Climate Change Canada
- **Cadence:** medium (10-15 min). Forecasts issued ~4x/day (saw hour folders 00/04/10 UTC) plus amendments/warnings between issuances.
- **CORS:** No Access-Control-Allow-Origin header (tested with Origin: header, none returned). Must fetch server-side (Convex) — fine for BlindSpot.
- **Response shape:** XML <marineData>: dateTime[name=xmlCreation] in UTC + local PDT; <area countryCode region subRegion>; <warnings> > location[@name] > event[@type=warning @name='Strong wind warning' @status='IN EFFECT'] with Issued dateTimes; <regularForecast> (Issued dateTime, location > weatherCondition > periodOfCoverage/wind/weatherVisibility/airTemperature/freezingSpray, statusStatement); <extendedForecast> same pattern. Wind text is plain English ('Wind west 10 to 15 knots increasing to west 20 to 30 late this afternoon'). Schema XSD linked in file.
- **Gotchas:** Old path /marine_weather/ at root is 404 — Datamart moved to day-rooted tree /{YYYYMMDD}/WXO-DD/ that rolls at UTC midnight (~30 days retained). No stable 'latest' URL: list pacific/ for newest hour folder (00/04/10...), then take the lexicographically last file per area code. Multiple timestamped re-publications per area per hour; En and Fr files interleaved (_en/_fr). VI area codes from regionList.xml: m0000009 Juan de Fuca Strait, m0000028 Strait of Georgia, m0000043 WCVI North, m0000065 WCVI South, m0000064 Haro Strait, m0000010 Johnstone Strait, m0000112 Queen Charlotte Strait. Verified live: fetched Juan de Fuca XML 2026-06-11 with a real Strong wind warning IN EFFECT for all three sub-locations.

### BC Lightstation Observations (ECCC live reports + DFO historical dataset) — `dfo-lightstations`

**T2 · VERIFIED · NEW** — Verified live. Human-observed sky/vis/wind/sea-state from staffed BC lightstations, ~3-4x daily, all VI stations on a single parseable weather.gc.ca HTML page (no API/CSV for the live obs — the named open.canada.ca dataset doesn't exist; the real DFO dataset is SST/salinity history under OGL).

- **Endpoint:** `Live obs: https://weather.gc.ca/marine/weatherConditions-lightstation_e.html?mapID=02&siteID=16200 (one page = all South Coast lightstations). Historical SST/salinity: https://open.canada.ca/data/api/action/package_show?id=719955f2-bf8e-44f7-bc26-6bd623e82884`
- **Auth:** None for either.
- **Rate limits:** None published. Obs only update ~3-4x daily, so polling pressure is naturally low.
- **License:** Live ECCC page: ECCC terms, attribute Environment and Climate Change Canada. DFO historical dataset: Open Government Licence - Canada (ca-ogl-lgo), Fisheries and Oceans Canada (verified via CKAN package_show).
- **Attribution:** Environment and Climate Change Canada (live reports); Fisheries and Oceans Canada, Open Government Licence - Canada (historical SST/salinity)
- **Cadence:** slow (30-60 min). Observations are human-made roughly 3-4x daily (saw issuances 11:30/11:40 UTC).
- **CORS:** No Access-Control-Allow-Origin on weather.gc.ca (tested). Server-side fetch required.
- **Response shape:** Live page: server-rendered HTML grouped by forecast area with one coded line per station, e.g. 'NOOTKA CLDY 15 CLM 1FT CHP LO SW' = sky, visibility (mi), wind dir+speed (E=estimated), sea height, character (CHP=choppy, RPLD=rippled), swell. Decode guide: canada.ca 'Decode information for lighthouse reports'. Historical dataset 'CSV' resources are actually ZIPs of per-station .7z CSV archives (verified 200, 1.07MB, application/zip), monthly snapshots (Data_Active_Sites_20260505), daily SST/salinity only.
- **Gotchas:** Honest finding: a dataset literally titled 'Coastal weather conditions from BC lightstations' does NOT exist on open.canada.ca (CKAN searches for lightstation/lighthouse weather returned 0-3 results, none matching). The live 3x-daily sea-state observations are published only as the ECCC weather.gc.ca HTML page — parse it. VI-relevant stations verified ON the live page: Nootka, Estevan Point, Lennard Island, Cape Beale (WCVI South); Chatham Point, Scarlett Point, Pine Island, Egg Island, Cape Scott, Quatsino (Johnstone/WCVI North); Chrome Island, Merry Island, Entrance Island, Trial Island (Georgia/Juan de Fuca). Stations are often 'NOT AVAILABLE' (Trial Island, Entrance, Pine Island, Egg Island, Estevan were N/A at verify time) — handle gracefully. The OGL DFO dataset covers SST/salinity history for Amphitrite Point, Chrome Island, Departure Bay PBS, Entrance Island, Kains Island, Nootka Point, Race Rocks (zip contents listed) — useful context layer, not live weather.

### CCG NAVWARN (Notices to Shipping) Information System — `ccg-notship`

**T2 · VERIFIED · NEW** — Verified live. Official CCG NAVWARN system has a queryable public endpoint with area/status/date params (50 Pacific notices in force at verify time), but responses are server-rendered HTML only — JSON explicitly refused (406). Plan on HTML parsing keyed by message id; per-notice map PNGs available.

- **Endpoint:** `https://nis.ccg-gcc.gc.ca/public/rest/messages/en/search?areas=250&status=PUBLISHED&sortBy=DATE&maxHits=500 (detail: /public/rest/messages/en/message/{id}; area polygon image: /public/message-map-image/{id}.png)`
- **Auth:** None for search/detail. reCAPTCHA only guards the email-subscription flow, not reads.
- **Rate limits:** None published. Pages are heavy (~1.2MB HTML for Pacific) — poll gently.
- **License:** Government of Canada Crown copyright (Canadian Coast Guard). Display with attribution; include a 'not to be used for navigation' style disclaimer since this is safety-of-navigation info.
- **Attribution:** Canadian Coast Guard / Government of Canada
- **Cadence:** slow (30-60 min).
- **CORS:** No Access-Control headers returned. Server-side fetch only.
- **Response shape:** Server-rendered HTML (GC WET theme), no JSON: Accept: application/json on detail returns HTTP 406 (verified). Search GET params: q, status (PUBLISHED), from, to (dates), areas (repeatable area ids), ignoreParentAreas, charts, categories, sortBy=DATE, maxHits. Results are gridViewBlock divs with title + affected area + link to message id; Pacific query returned 50 in-force NAVWARNs (Military Zone WG Strait of Georgia, aids to navigation outages, pile driving, uncrewed survey ops, etc.). POST export endpoints /public/rest/messages/en/{gridfile,tablefile,simplefile,detailsfile} accept messageIds (';,;'-delimited) and an export type for file output.
- **Gotchas:** NOTSHIPs were replaced by NAVWARNs; old vtos.pac.dfo-mpo.gc.ca NOTSHIP pages just redirect ('NAVWARN moved'). nis.ccg-gcc.gc.ca is the official national system but it is HTML-scrape territory: parse the search page DOM (stable WET markup). Key VI-relevant area ids extracted from the page's area selector: 250=Pacific Coast (parent, covers all), 47=Pacific South Coast, 45=Juan de Fuca Strait, 46=Strait of Georgia, 48=WCVI North, 49=WCVI South, 64 (Haro Strait listed too), 107=Vancouver Harbour, 229=Victoria Harbour. Querying parent area 250 with ignoreParentAreas left default returns the full Pacific set. Per-message PNG map images exist but no machine-readable geometry endpoint was found. Message ids are global and incrementing — good for change detection.

## Ground (Mobility)

> Strong cluster: 4 of 5 briefed sources fully verified with live data on 2026-06-11, zero keys needed for everything except the optional congestion layer. Recommended build order: (1) Open511 events with area_id=drivebc.ca/2 - cleanest contract, OGL-BC licensed, CORS-open; (2) webcams via the NEW www.drivebc.ca/api/webcams/ (canonical: it has staleness flags and per-cam refresh periods; the BCDC CSV is fine as a static seed but still points at legacy image URLs and lacks refresh metadata); (3) BC Transit GTFS-RT - one combined protobuf call covers all seven Island systems at 60s cadence, plus daily static zips; (4) BC Hydro outages - works great but is the legally softest T1: undocumented endpoint, no open license, poll at 10 min and expect schema drift; (5) ferries via the community bcferriesapi.ca (gray-area scrape of (c) BC Ferries data, volunteer SLA - acceptable for a single-operator console, have a fallback plan). Legal caveats in one line: OGL-BC covers Open511 + webcams; BC Transit requires source attribution under its own revocable license; BC Hydro, drivebc.ca/api/* and bcferriesapi.ca are all unsanctioned-but-public endpoints - keep cadences gentle and degrade gracefully. Gaps: no structured feed for intercity buses (Tofino Bus/IslandLink), Hullo, or the Coho ferry (CBP border-wait API has no Port Angeles entry; checked); no bike/scooter share GBFS exists on the Island (checked MobilityData catalog); congestion data requires a TomTom key - free tier suffices for raster flow tiles but the intel value beyond Victoria's three choke points is marginal. Webcams are ~15-minute stills, not video - set expectations accordingly. Offshore note: webcam/event coverage ends at the highway network; Tofino (just inside Hwy 4 terminus) is covered, but anything past the shoreline belongs to the marine cluster.

### DriveBC Open511 Events API — `drivebc-open511`

**T1 · VERIFIED** — Live and healthy. Vancouver Island District is area_id drivebc.ca/2 (confirmed via /areas); both area_id and bbox filtering returned real VI events (Salt Spring washout, Ladysmith closure) with my own requests on 2026-06-11.

- **Endpoint:** `https://api.open511.gov.bc.ca/events?format=json&area_id=drivebc.ca/2&status=ACTIVE  (bbox alternative: https://api.open511.gov.bc.ca/events?format=json&bbox=-125.30,48.20,-123.10,51.10)`
- **Auth:** none
- **Rate limits:** None documented. No key, no throttle headers observed. Be polite anyway.
- **License:** Open Government Licence - British Columbia v2.0 (license_url returned by https://api.open511.gov.bc.ca/jurisdiction: http://www.data.gov.bc.ca/local/dbc/docs/license/OGL-vbc2.0.pdf)
- **Attribution:** Contains information licensed under the Open Government Licence - British Columbia (DriveBC / Province of British Columbia)
- **Cadence:** medium (5 min). Events are operator-updated, not telemetry; 5 min loses nothing.
- **CORS:** Access-Control-Allow-Origin: * present (browser-callable)
- **Response shape:** {events:[{id, url, jurisdiction_url, headline, status:ACTIVE, created, updated, description, +ivr_message, +linear_reference_km, schedule:{intervals:[ISO ranges]}, event_type (saw CONSTRUCTION|INCIDENT|SPECIAL_EVENT), event_subtypes, severity (saw MINOR|MAJOR), geography: GeoJSON Point or LineString, roads:[{name,from,to,direction}], areas:[{id:'drivebc.ca/2',name:'Vancouver Island District'}]}], pagination:{offset, previous_url/next_url}, meta:{version:'v1'}}
- **Gotchas:** Pagination is offset/limit but responses include only previous_url — next_url is never returned (verified paging 133 results at limit=50); increment offset until a page returns fewer than limit. Schedule interval times are UTC without zone suffix; ACTIVE events can carry an updated timestamp months old. area_id=drivebc.ca/2 includes the Gulf Islands. severity values beyond MINOR/MAJOR exist in the Open511 spec but I only observed those two. Always pass format=json.

### DriveBC Highway Webcams (BCDC CSV + legacy API + new site API) — `drivebc-highwaycams`

**T1 · VERIFIED** — All three layers verified live. 180 Vancouver Island cams (consistent across legacy and new APIs). CANONICAL TO BUILD ON: the new site API at www.drivebc.ca/api/webcams/ - it alone exposes update_period_mean, last_update_modified and marked_stale/marked_delayed flags, and its image URLs are the www.drivebc.ca/images/{id}.jpg pattern.

- **Endpoint:** `Canonical metadata: https://www.drivebc.ca/api/webcams/?format=json (1060 cams, 1.16 MB). Images: https://www.drivebc.ca/images/432.jpg (verified 200 image/jpeg 68,248 bytes; append ?t= cache-buster from links.imageDisplay). BCDC CSV: https://catalogue.data.gov.bc.ca/dataset/6b39a910-6c77-476f-ac96-7b4f18849b1c/resource/a9d52d85-8402-4ce7-b2ac-a2779837c48a/download/webcams.csv (200 text/csv, 1034 rows). Legacy API: https://images.drivebc.ca/webcam/api/v1/webcams`
- **Auth:** none
- **Rate limits:** None documented on any of the three. Per-cam frames only change every ~15 min, so heavy polling is pointless anyway.
- **License:** BCDC dataset 'DriveBC HighwayCams' (package bc-highwaycams) is Open Government Licence - British Columbia. The new site API is undocumented but serves the same MOTI data.
- **Attribution:** DriveBC.ca / Province of British Columbia (cam records carry a dbcMark/dbc_mark field 'DriveBC.ca'; some cams have a 'credit' field for third-party owners - render it when non-empty)
- **Cadence:** medium: metadata every 10-15 min; fetch each cam image on its own update_period_mean (~15 min). Do not poll images faster - frames simply do not change.
- **CORS:** images.drivebc.ca/webcam/api/v1: Access-Control-Allow-Origin: * present. www.drivebc.ca/api and /images: no ACAO header observed. Irrelevant for Convex server-side polling.
- **Response shape:** New API per cam: {id, name, caption, links:{imageDisplay:'/images/{id}.jpg?t=...', replayTheDay}, region_name (e.g. 'Vancouver Island'), highway, highway_description, location: GeoJSON Point, orientation, elevation, is_on, should_appear, is_on_demand, marked_stale, marked_delayed, last_update_attempt, last_update_modified, update_period_mean (~900s), update_period_stddev, nearby_objs, https_cam, group}. CSV fields: links_bchighwaycam, links_imageDisplay, links_imageThumbnail, links_replayTheDay, id, highway_number, highway_locationDescription, camName, caption, credit, orientation, latitude, longitude - NOTE: no refresh-seconds column.
- **Gotchas:** The brief's claim is HALF right: the CSV today still points at the LEGACY https://images.drivebc.ca/bchighwaycam/pub/cameras/{id}.jpg URLs (verified), while the www.drivebc.ca/images/{id}.jpg pattern belongs to the NEW site API - both resolve. Trap: stale cams serve a PNG placeholder with 200 status at the legacy URL (cam 8 Malahat: 200 image/png) - always check marked_stale/last_update_modified before trusting a frame. beta.drivebc.ca is now the live www site; its XHRs are the /api/webcams/ endpoint reported here. 179/180 VI cams were fresh at verification time.

### BC Transit Open Data (GTFS static + GTFS-Realtime) — `bc-transit`

**T1 · VERIFIED** — Verified end-to-end. Static zip for Victoria downloaded (4.57 MB application/zip) and the RT protobuf contains live Victoria trips dated 2026-06-11. Island operator IDs confirmed from the open-data page: Victoria 48, Nanaimo (RDN) 41, Comox Valley 45, Cowichan Valley 10, Campbell River 12, Port Alberni 11, Mount Waddington 17.

- **Endpoint:** `GTFS-RT (one combined call for all Island systems, verified 200 application/x-protobuf 9,132 bytes): https://bct.tmix.se/gtfs-realtime/vehicleupdates.pb?operatorIds=10,11,12,17,41,45,48  | also https://bct.tmix.se/gtfs-realtime/tripupdates.pb?operatorIds=... and https://bct.tmix.se/gtfs-realtime/alerts.pb?operatorIds=...  | Static zips: https://bct.tmix.se/Tmix.Cap.TdExport.WebApi/gtfs/?operatorIds=48 (swap operator ID per system)`
- **Auth:** none (no key, no registration)
- **Rate limits:** None documented. Feed is vendor-hosted (Tmix/Consat). 60s polling is community-standard for these feeds.
- **License:** BC Transit Open Data Terms of Use: https://www.bctransit.com/open-data/terms-of-use/ - limited, revocable, non-exclusive license to use, reproduce and redistribute; must identify BC Transit as the source; no use of BC Transit trademarks/domain.
- **Attribution:** Indicate that BC Transit is the source of the data (required by their terms).
- **Cadence:** fast (60s) for vehicleupdates/tripupdates; medium (5-15 min) for alerts.pb; slow (daily) re-download of static zips, checking for service-change weeks.
- **CORS:** No Access-Control-Allow-Origin header on bct.tmix.se (verified) - server-side polling required for browsers; fine for Convex.
- **Response shape:** Standard GTFS-RT FeedMessage protobuf: confirmed real entities via strings - trip ids, start_date 20260611, start times, route ids like '61-VIC0'/'24-VIC0', vehicle ids. Static zip is a normal GTFS bundle. HEAD requests return 405; use GET.
- **Gotchas:** Open-data page does not state the upstream refresh rate; observed feeds were fresh to the minute. vehiclepositions.pb also resolves (the page officially links vehicleupdates.pb - sizes were near-identical; vehicleupdates appears to be the documented name). Multi-system requests via comma-separated operatorIds verified working. Mount Waddington (17) gives you the Port Hardy/Port McNeill end of the island. Note: intercity carriers (Tofino Bus, IslandLink, Hullo) are NOT in these feeds.

### BC Hydro Public Outage Map JSON — `bchydro-outages`

**T1 · VERIFIED** — The exact URL from the brief is live and returned real province-wide outage data (200, application/json, 2,903 bytes at a quiet moment). It is an undocumented internal endpoint behind the public outage map - works today, no contract stability.

- **Endpoint:** `https://www.bchydro.com/power-outages/app/outages-map-data.json (no params; filter client-side to VI bbox lat 48.20-51.10, lng -125.30 to -123.10)`
- **Auth:** none
- **Rate limits:** None documented. Served via Akamai CDN (saw cdn-cache HIT), so polite polling mostly hits cache anyway.
- **License:** NONE - this is not an open-data product. BC Hydro's general website Terms of Use apply (the terms page is JS-rendered; I could not extract explicit automated-access clauses). Honest posture: widely polled by community outage trackers for years, government-owned utility publishing public-safety info, but it can change shape or disappear without notice and grants no redistribution rights.
- **Attribution:** Credit BC Hydro as the source if displayed (no formal requirement published).
- **Cadence:** medium (10 min). The map UI itself refreshes on the order of minutes and the CDN caches responses; faster polling buys nothing and raises profile on an unsanctioned endpoint.
- **CORS:** No Access-Control-Allow-Origin header (verified) - must be polled server-side.
- **Response shape:** Top-level JSON ARRAY of outage objects: {id, gisId, regionId, municipality, area (street-block text), cause (e.g. 'Under investigation', 'Planned work being done on our equipment'), numCustomersOut, crewStatus (NEW|ONSITE|...), crewStatusDescription, crewStatusNote, crewEta, crewEtr, dateOff, dateOn, lastUpdated (all epoch ms), regionName, showEta, showEtr, showDateOn, latitude, longitude, polygon: flat [lng,lat,lng,lat,...] ring}
- **Gotchas:** polygon is a FLAT alternating lng/lat array, not GeoJSON - convert before deck.gl. Timestamps are epoch milliseconds. crewEta vs crewEtr are distinct (arrival vs estimated restore) - respect showEta/showEtr flags. Filter VI by bbox rather than regionName (I only observed 'Northern' and 'Okanagan/Kootenay' values, did not see the VI region string). There is also a planned-outages JSON in the same app directory I did not probe (stayed within request budget).

### TomTom Traffic Flow + HERE Traffic v7 (congestion layer) — `traffic-flow`

**T2 · NEEDS-KEY** — Both endpoints confirmed live (clean 401 'missing credentials' JSON without keys, hit 2026-06-11). TomTom Freemium verified from official pricing page: 50,000 tile + 2,500 non-tile requests/day, no credit card, QPS 5-50. HERE's exact 2026 free allowance could not be verified (pricing page is JS-rendered, login-gated specifics). Verdict: one free TomTom key is worth it for a raster flow-tile layer; skip HERE.

- **Endpoint:** `TomTom flow segment (non-tile, JSON): https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=48.4284,-123.3656&key=YOUR_KEY  | TomTom raster flow tiles (tile bucket, for the map layer): https://api.tomtom.com/traffic/map/4/tile/flow/absolute/{z}/{x}/{y}.png?key=YOUR_KEY  | HERE flow: https://data.traffic.hereapi.com/v7/flow?locationReferencing=shape&in=circle:48.4284,-123.3656;r=10000&apiKey=YOUR_KEY`
- **Auth:** TomTom: free key, no credit card - https://developer.tomtom.com (register, create API key). HERE: free key via https://platform.here.com signup (Base Plan); exact free transaction count unverifiable without an account.
- **Rate limits:** TomTom: 50,000 tile + 2,500 non-tile requests/day shared across products, QPS 5-50 by API (verified at https://developer.tomtom.com/pricing). HERE: 'free monthly transaction allowance' confirmed to exist, number unverified for 2026.
- **License:** Proprietary commercial ToS both. TomTom requires TomTom attribution/logo on rendered traffic data per developer terms; HERE similar. Display-only in your own UI is the intended free-tier use; no redistribution.
- **Attribution:** TomTom logo/copyright notice on the traffic layer; HERE copyright if used.
- **Cadence:** If adopted: raster flow tiles every 2-5 min for the Victoria/Malahat viewport (a z10-12 VI viewport is ~dozens of tiles per refresh - comfortably inside 50k/day). Flow-segment JSON polling of ~10 corridor points fits 2,500/day only at >=10 min intervals.
- **CORS:** Not tested without key (401 before CORS evaluation matters); both are designed for browser SDK use, but BlindSpot polls server-side regardless.
- **Response shape:** Without a key both return clean JSON errors: TomTom {detailedError:{code:'Unauthorized',message:'You are missing valid authentication credentials'}}; HERE {error:'Unauthorized',error_description:'No credentials found'}. Documented keyed shapes: TomTom flowSegmentData {currentSpeed, freeFlowSpeed, currentTravelTime, confidence, coordinates}; HERE v7 {results:[{location,currentFlow:{speed,jamFactor}}]} - not seen first-hand.
- **Gotchas:** Honest verdict: VI congestion is really three choke points (Colwood Crawl Hwy 1, McKenzie interchange, the Malahat) plus Nanaimo Parkway. Open511 + webcams already cover incidents; flow adds color but little intel. Probe-data quality outside Victoria/Nanaimo is unverified and likely thin on Hwy 4/19/28. If you want the layer, TomTom raster tiles are the cheap path; HERE adds nothing unique here and its free-tier docs are opaque.

### BC Ferries Capacity API (community, bcferriesapi.ca) — `bc-ferries-api`

**T2 · VERIFIED · NEW** — Verified live with real sailing-by-sailing capacity for Island routes (Swartz Bay, Duke Point, Departure Bay etc.) - vessel names, deck-space fill percentages, sailing status. For an island, ferry capacity/cancellation is core ground mobility; BC Ferries itself publishes no open API, so this community scraper is the only structured feed.

- **Endpoint:** `https://www.bcferriesapi.ca/v2/capacity/`
- **Auth:** none
- **Rate limits:** None documented; it is a volunteer-run service (github.com/samuel-pratt/bc-ferries-api) - poll gently.
- **License:** Unstated for the API; underlying data is (c) BC Ferries, scraped from bcferries.com. Gray area: fine posture for a single-operator personal dashboard, not for redistribution. No SLA - can break whenever bcferries.com changes.
- **Attribution:** Credit BC Ferries for the data and bcferriesapi.ca as the feed if displayed.
- **Cadence:** medium (10-15 min). Fill percentages move on tens-of-minutes timescales; respect the volunteer host.
- **CORS:** Access-Control-Allow-Origin: * present (verified)
- **Response shape:** {routes:[{routeCode:'TSASWB', fromTerminalCode, toTerminalCode, sailingDuration, sailings:[{time, arrivalTime, sailingStatus ('future'|...), fill, carFill, oversizeFill (percent full), vesselName, vesselStatus}]}]}
- **Gotchas:** Terminal codes to care about: SWB (Swartz Bay), DUK (Duke Point), NAN (Departure Bay), TSA (Tsawwassen), HSB (Horseshoe Bay), plus minor routes. v2 also exposes other paths on the same host (see GitHub repo). Treat as best-effort: if it dies, the fallback is scraping bcferries.com Current Conditions yourself, with the same ToS posture. Hullo (Nanaimo fast ferry) and the Coho (Victoria-Port Angeles) are NOT covered - neither publishes an API (CBP border-wait API checked: no Port Angeles entry).

### DriveBC new-site Events API (www.drivebc.ca/api/events/) — `drivebc-site-events`

**T2 · VERIFIED · NEW** — The XHR API behind the rebuilt drivebc.ca SPA, verified live: 313 province-wide events with fields Open511 lacks - polygon geometry, a boolean closed flag, display_category, next_update, optimized_description. Useful companion to Open511 for map rendering, not a replacement.

- **Endpoint:** `https://www.drivebc.ca/api/events/?format=json (no server-side bbox filter observed; filter client-side. Same host also serves /api/webcams/ and /api/ferries/ - the ferries list is inland-only, none on Vancouver Island)`
- **Auth:** none
- **Rate limits:** None documented; undocumented internal endpoint - one fetch per cycle is the whole cost since it returns everything (1.3 MB).
- **License:** Same MOTI/DriveBC data as the OGL-BC-licensed Open511 feed, but this specific endpoint is undocumented and carries no published license. Low legal risk (same publisher, same data), medium stability risk.
- **Attribution:** DriveBC / Province of British Columbia
- **Cadence:** medium (5 min), aligned with the Open511 poll. Build Open511 first (stable, licensed contract); pull this only if you want closure polygons and the closed flag on the map.
- **CORS:** No Access-Control-Allow-Origin header observed - server-side polling.
- **Response shape:** JSON array; per event: {id, event_type, event_sub_type, display_category, severity, status, closed (bool), description, optimized_description, location (GeoJSON), polygon, route_at, route_display, route_from, route_to, direction, direction_display, closest_landmark, highway_segment_names, area, start, end, schedule, first_created, last_updated, next_update, start_point_linear_reference, timezone}
- **Gotchas:** 1.3 MB full-province payload every call - cache and diff. Being the SPA's private API, fields can change without notice when the site updates; pin a schema validator on ingest.

## RF / Signals

> Honest cluster assessment. The two headline audio sources (LiveATC, Broadcastify) are both ToS-excluded for embedding - LiveATC says verbatim 'Audio streams may not be used in any third-party products' and Broadcastify's only programmatic door is a gated commercial API - so this cluster's audio story is link-out buttons, period. Also: CYQQ (Comox) has no LiveATC feed at all, no Victoria-area Broadcastify feeds surfaced, and BC police (E-Comm/RCMP island-wide) are AES256 P25 encrypted, so there is no lawful police-radio layer for anyone. What IS genuinely buildable and verified with live data: (1) APRS-IS direct feed - free, real-time, read-only login confirmed streaming VI packets; this is the cluster's anchor, but it needs one tiny always-on TCP worker outside Convex's cron model (Convex can't hold sockets; worker pushes to Convex via HTTP mutations) - OGN rides the same worker for near-free; (2) SondeHub - verified live RS41 over the Olympic Peninsula; remember distance is in METERS (the catalog's distance=500 example returns empty - that bug would have shipped); coverage gap north of mid-island since no community receiver hears Port Hardy launches; (3) GPSJAM - daily gzip CSV of H3 res-4 cells verified, 1-day lag, no formal license (courtesy attribution to Wiseman + ADS-B Exchange; site repo is private); (4) SatNOGS - UVic station online in Victoria; (5) wspr.live (new) - keyless SQL endpoint, instant VI-grid results, best effort-to-value of the new finds. aprs.fi keeps its key but its ToS prohibits exactly this product shape (background polling, area harvesting) - restrict to on-demand single-station lookups or skip. RepeaterBook (new) moved to mandatory token auth in March 2026 - training data about free UA-only access is stale; apply once, cache weekly. Recommended build order: APRS-IS worker -> SondeHub -> GPSJAM daily layer -> wspr.live band-conditions tile -> SatNOGS station card -> KiwiSDR status badge + link-outs (never iframe a Kiwi; it eats one of ~7 channels on volunteer hardware) -> LiveATC/Broadcastify link-out buttons -> RepeaterBook static overlay after token approval. Legal caveats to carry into Phase 1: honor OGN noTrack opt-outs (hard rule), CC BY-SA share-alike on SondeHub/SatNOGS-derived layers, CC BY 4.0 attribution for wspr.live, and visible credits for aprs.fi if ever used. CORS was absent on nearly everything (sondehub/satnogs/gpsjam/wspr.live) - server-side polling architecture is the right call.

### LiveATC.net (CYYJ Victoria / CYQQ Comox ATC audio) — `liveatc`

**T2 · EXCLUDED** — Streams are real and technically reachable (CYYJ mount confirmed via 302 redirect chain), but LiveATC ToS flatly prohibits use of audio streams in any third-party product, for profit or not. CYQQ has no feed at all. Link-out only.

- **Endpoint:** `https://www.liveatc.net/play/cyyj.pls (playlist) -> mount https://d.liveatc.net/cyyj (302 -> https://s1-bos.liveatc.net/cyyj?nocache=...)`
- **Auth:** none for listening via their site/app/media player; written permission from LiveATC required for any third-party product use
- **Rate limits:** n/a (continuous audio stream); www.liveatc.net and d.liveatc.net are behind Cloudflare managed challenge for non-browser/non-player clients
- **License:** ToS (liveatc.net/legal, read via Wayback): 'Audio streams may not be used in any third-party products.' Also prohibits making LiveATC services 'directly available via any other dedicated desktop or mobile commercial application, for profit or not' and automated/robot retrieval without permission. Personal non-commercial use only. General-purpose media players are explicitly authorized agents.
- **Attribution:** n/a (embedding not permitted)
- **CORS:** Access-Control-Allow-Origin: * observed on d.liveatc.net redirect responses (irrelevant given ToS)
- **Response shape:** d.liveatc.net/cyyj with media-player UA: HTTP 302, Location: https://s1-fmt2.liveatc.net/cyyj?nocache=<timestamp> (second try s1-bos). Final stream GET returned 404 at test time (05:34 PT), likely feed momentarily down; redirect infrastructure and mount name confirmed. Browser/plain-curl requests get Cloudflare cf-mitigated: challenge 403.
- **Gotchas:** CYYJ feed exists as 'CYYJ Gnd/Twr' (mount cyyj). CYQQ verified NOT covered: airport page says 'Sorry, CYQQ is not currently covered by LiveATC.net' (CFB Comox, no volunteer feed). Honest verdict: the only sanctioned integration is a link-out button to https://www.liveatc.net/search/?icao=CYYJ; the operator personally opening cyyj.pls in VLC is within ToS, but baking the stream into BlindSpot is not. LiveATC invites licensing contact for permission if you want more.

### aprs.fi API — `aprs-fi`

**T2 · NEEDS-KEY** — API is live and well documented, free key with account signup, but the ToS explicitly bans exactly BlindSpot's polling model: data may only be requested when actively needed by an end-user, no background polling or archival collection, and no wildcard/area search at all. Use APRS-IS directly instead (aprs.fi itself recommends this).

- **Endpoint:** `https://api.aprs.fi/api/get?name=VE7CC-1&what=loc&apikey=YOURKEY&format=json`
- **Auth:** free key: create account at https://aprs.fi/ (signup link on page), key shown under My account settings
- **Rate limits:** rate limited per user account/API key; exact numbers unpublished, adjustable by emailing the operator; exponential backoff required on failures; plain-HTTP URLs die 2026-05-01 (https only, already in effect)
- **License:** ToS on https://aprs.fi/page/api: must credit aprs.fi with visible link back; free-to-use public apps only; each distributed user needs own key; custom User-Agent with app name/version/homepage mandatory; 'The application may only request data when it is actively needed by the end-user. Do not preload, pre-cache, or collect data using the API for archival purposes'; 'It may not be used to simply copy all of the data to another site... If you wish to set up a clone site, please collect your data directly from the APRS-IS'
- **Attribution:** credit 'aprs.fi' as data source with a visible link back to https://aprs.fi/
- **Cadence:** n/a for background polling (ToS-prohibited); only on-demand per-station lookups triggered by the operator are compliant
- **CORS:** not tested (key required); irrelevant for sanctioned use
- **Response shape:** documented (seen in docs page): {command:'get', result:'ok', what:'loc', found:N, entries:[{name, type, time, lasttime, lat, lng, symbol, srccall, dstcall, ...}]}; Unix timestamps, metric units; queries specific station names only, no wildcard
- **Gotchas:** Honest verdict: structurally wrong tool for a cron-polled map. Keep it only as an optional operator-initiated 'look up this callsign' action with attribution. The map layer should come from aprs-is (see separate entry, documented per brief).

### APRS-IS direct feed (rotate.aprs2.net:14580, area filter) — `aprs-is`

**T2 · VERIFIED** — Verified live with my own connection: read-only unverified login (passcode -1) with filter r/49.5/-124.5/200 immediately streamed real VI-area APRS packets (VA7GFZ weather station, CWOP stations). This is the sanctioned, free, real-time replacement for polling aprs.fi.

- **Endpoint:** `TCP rotate.aprs2.net:14580, send login line: user YOURCALL pass -1 vers blindspot 0.1 filter r/49.5/-124.5/200`
- **Auth:** none for receive-only (passcode -1, server answers '# logresp ... unverified'); transmitting requires a real amateur callsign + passcode (licensed ham only) - not needed for BlindSpot
- **Rate limits:** none formal; one persistent connection with a sane filter radius is the expected usage pattern; server sends keepalive comment lines
- **License:** APRS packets are publicly broadcast amateur transmissions relayed by a volunteer server network; no formal license. Etiquette: identify your software in the vers string, keep one connection, honor the network's purpose
- **Attribution:** courteous to credit APRS-IS / Tier2 network; not formally required
- **Cadence:** persistent stream (effectively real-time); NOT pollable - APRS-IS does not replay history on connect, so periodic connect/drain loses everything in between
- **CORS:** n/a (raw TCP, not HTTP)
- **Response shape:** line-oriented: '# aprsc 2.1.20-gdaa359f' banner, '# logresp N0CALL unverified, server T2CAEAST', then raw APRS packets e.g. 'VA7GFZ>APMI04,TCPIP*,qAC,T2VAN:@111225z4912.23N/12245.95W-WX3in1Mini U=12.3V'; parse with aprs-parser libs (js: aprs-parser; the FAP format)
- **Gotchas:** Architecture caveat: Convex crons cannot hold a long-lived TCP socket. You need one tiny always-on worker (Fly.io/cheap VPS) that keeps the socket open, parses packets, and pushes into Convex via HTTP mutation. Filter r/49.5/-124.5/200 covers the whole island plus Salish Sea and offshore Tofino approaches. Expect mostly weather stations, digipeaters, vehicle trackers, some marine.

### SondeHub v2 (radiosonde tracking) — `sondehub`

**T2 · VERIFIED** — Verified with real data: live Vaisala RS41 at 29.5 km altitude over the Olympic Peninsula (Quillayute launch) plus two landed sondes. Critical gotcha: distance parameter is METERS, not km - the catalog's example URL (distance=500) silently returns {} because it means 500 m.

- **Endpoint:** `https://api.v2.sondehub.org/sondes?lat=49.5&lon=-124.5&distance=500000&last=86400`
- **Auth:** none
- **Rate limits:** none published; CloudFront-fronted; their wiki steers live consumers to the MQTT websocket (GET /sondes/websocket returns a presigned WSS URL) rather than tight polling
- **License:** CC BY-SA 2.0 ('Radiosonde and Amateur balloon telemetry data captured in the SondeHub database is licensed under Creative Commons BY-SA v2.0', sondehub-infra wiki)
- **Attribution:** credit SondeHub; share-alike applies to derived published layers
- **Cadence:** medium (5 min poll fits launch dynamics; or websocket for live chase view)
- **CORS:** no Access-Control-Allow-Origin observed on plain GET (server-side polling unaffected)
- **Response shape:** JSON object keyed by serial: {X3552886: {software_name:'radiosonde_auto_rx', uploader_callsign:'N3UUO', uploader_position, time_received, datetime, manufacturer:'Vaisala', type:'RS41', subtype:'RS41-SG', serial, frame, lat, lon, alt, temp, humidity, vel_v, vel_h, heading, sats, batt, frequency (404.6 MHz), snr, burst_timer, position, uploader_alt}}; empty result is {} not []
- **Gotchas:** Coverage reality check: the only uploader seen for this region is N3UUO (Seattle). Quillayute WA sondes are tracked; Port Hardy (CYZT) launches at the island's north end showed nothing - no community receiver up-island. /sondes default last=24h; amateur balloons live on a parallel /amateur endpoint. last param in seconds, distance in meters.

### GPSJAM daily GPS interference (John Wiseman) — `gpsjam`

**T2 · VERIFIED** — Verified: underlying daily data files are gzip CSVs (not GeoJSON) at gpsjam.org/data/YYYY-MM-DD-h3_4.csv - H3 resolution-4 hex cells with good/bad aircraft counts. Yesterday's file (2026-06-10) already exists, confirming the ~1-day lag.

- **Endpoint:** `https://gpsjam.org/data/2026-06-10-h3_4.csv (pattern: https://gpsjam.org/data/YYYY-MM-DD-h3_4.csv, gzip-encoded, use Accept-Encoding: gzip)`
- **Auth:** none
- **Rate limits:** none stated; it's one ~185 KB file per day; cache-control max-age=3600. Poll once daily
- **License:** no explicit license published on site or FAQ. Personal project of John Wiseman (jjwiseman@gmail.com, @lemonodor); site source repo is private (wiseman/gpsjam.org returns 404 unauth; CSV path confirmed via public mirror guofengji/gpsjam.org). Underlying data derived from ADS-B Exchange API - site displays 'Data provided by adsbexchange.com' credit
- **Attribution:** credit GPSJAM / John Wiseman and ADS-B Exchange (mirror the site's own adsbx credit)
- **Cadence:** slow (daily; site updates 'soon after midnight UTC' per FAQ - fetch once around 01:30-02:00 UTC)
- **CORS:** no Access-Control-Allow-Origin observed
- **Response shape:** gzip CSV, header 'hex,count_good_aircraft,count_bad_aircraft'; ~45,900 rows global; hex = H3 res-4 cell id (e.g. 8400531ffffffff). Map FAQ thresholds: bad% = 100*(bad-1)/(good+bad); yellow 2-10%, red >10%
- **Gotchas:** Filter to VI client-side with h3-js (cellToBoundary, filter by bbox). 24-hour aggregate with 1-day lag - this is a situational-awareness layer, not an alerting source. The .geojson guess 404s; only -h3_4.csv exists. Given no published license, a courtesy email to Wiseman before shipping a public product would be the decent move; for a single-operator dashboard, attribution suffices in practice.

### SatNOGS Network API — `satnogs`

**T3 · VERIFIED** — Verified: open API, no key for reads, full station list returned. Vancouver Island has real presence: UVSD-SatNOGS (#3166, UVic Victoria, Online, VHF+UHF), VE7PTN1-UHF (#4461, Nanaimo area, Testing), and two View Royal stations (#1775, #1961, Testing).

- **Endpoint:** `https://network.satnogs.org/api/stations/?format=json (observations: https://network.satnogs.org/api/observations/?ground_station=3166&format=json)`
- **Auth:** none for GET; API token only for posting
- **Rate limits:** none published; stations response served with cache-control max-age=3600 - hourly is the natural ceiling. Full list is 2.7 MB with no geo filter, so cache and diff
- **License:** CC BY-SA (all SatNOGS network/DB API data freely distributed under Creative Commons Attribution-ShareAlike, per docs.satnogs.org / wiki)
- **Attribution:** credit SatNOGS / Libre Space Foundation; share-alike on derived published data
- **Cadence:** slow (30-60 min for station status; observations on demand)
- **CORS:** no Access-Control-Allow-Origin observed; strict CSP/X-Frame-Options DENY on their end
- **Response shape:** JSON array of stations: {id, name, altitude, min_horizon, lat, lng, qthlocator, antenna:[{frequency, frequency_max, band, antenna_type, antenna_type_name}], created, last_seen, status:'Online'|'Testing'|'Offline', observations, future_observations, description, client_version, target_utilization, image, success_rate, owner}
- **Gotchas:** No server-side geo filtering on /stations - fetch full list, filter to bbox locally (I did: 4 island-area stations, ~20 in wider Salish Sea region, most offline). Interesting tile: what UVic's station is currently observing via /observations?ground_station=3166. Niche but free and unambiguous legally.

### KiwiSDR public receivers (Salish Sea) — `websdr-kiwisdr`

**T3 · VERIFIED** — Verified: public list (rx.linkfanel.net/kiwisdr_com.js, 878 KB) includes a KiwiSDR on Salt Spring Island (KJ6EI/VE7, grid CN88fu) which I confirmed reachable via its /status endpoint - currently 6 of 7 channels in use, which is exactly why iframe-embedding is bad citizenship.

- **Endpoint:** `list: http://rx.linkfanel.net/kiwisdr_com.js | receiver: http://kj6ei.ddns.net:8073/ | status probe: http://kj6ei.ddns.net:8073/status`
- **Auth:** none
- **Rate limits:** kiwisdr.com/public is bot-gated (click-through + x-kiwi-auth, my header replay returned 0 bytes - use the linkfanel JS list instead, which is the data source behind map.kiwisdr.com); /status is the lightweight sanctioned probe (the Kiwi network itself polls it)
- **License:** receivers are volunteer-owned; dyatlov map maker is GPLv3; no license on the listing data itself
- **Attribution:** credit receiver owner if surfacing their SDR; KiwiSDR/linkfanel for the directory
- **Cadence:** slow (status poll every 15-60 min; refresh directory daily)
- **CORS:** not checked on /status (plain text over :8073); list JS is a static file - n/a for server-side fetch
- **Response shape:** /status: key=value lines (status=active, offline=no, name=..., users=6, users_max=7, gps=(48.866264, -123.546132), grid=CN88fu, bands=0-30000000, snr fields). kiwisdr_com.js: JS array of receiver objects {name, url, loc, gps, users, users_max, antenna, ...}
- **Gotchas:** Etiquette verdict: do NOT iframe a Kiwi into BlindSpot - each open UI session consumes one of very few rx channels on a volunteer's hardware (Salt Spring unit was at 6/7 during my check, op_email empty so no easy permission path). Sanctioned pattern: show status/occupancy badge from /status + link out. Other regional units: Burnaby (21264.proxy.kiwisdr.com), Logan Lake BC. No Kiwi on VI proper currently listed.

### Broadcastify (VI scanner feeds) — `broadcastify`

**T3 · EXCLUDED** — Directory verified: VI feeds exist (Nanaimo marine VHF 11/12/16, Mid-Island East Fire/EHS, BC Wildfire repeaters South VI, Comox marine CH16/83A, Comox Valley Fire) - but no sanctioned free programmatic/embed access exists, their official API is a gated commercial program, and BC police are AES256-encrypted P25 anyway. Link-out only.

- **Endpoint:** `https://www.broadcastify.com/listen/ctid/5559 (Nanaimo) | https://www.broadcastify.com/listen/ctid/4331 (Comox Valley) | feed pages e.g. https://www.broadcastify.com/listen/feed/47189`
- **Auth:** none to browse directory pages; official Broadcastify API requires application/commercial approval (the /api/ page itself sits behind a Cloudflare challenge)
- **Rate limits:** n/a (no sanctioned programmatic access)
- **License:** broadcastify.com/terms (fetched, 73 KB): standard restrictive ToS, no grant of stream reuse; no embed permission found anywhere; 'Premium APIs' referenced in nav are partner products. Listening is via their site/apps only
- **Cadence:** n/a (directory could be re-checked monthly for new VI feeds, manually)
- **Response shape:** HTML directory pages. BC = stid 102; island ctids seen: Comox Valley 4331, Mount Waddington 4332, Cowichan Valley 5551, Nanaimo 5559. Feeds found: 47189 'Marine VHF Channels 11, 12, and 16', 37828 'Mid Vancouver Island East Fire/EHS', 47303 'BC Wildfire Repeaters - South Vancouver Island District', 32393 'Comox B.C. VHF CH16, CH83a', 31760 'Comox Valley Fire Departments'
- **Gotchas:** E-Comm / Vancouver Island RCMP run P25 with AES256 encryption (confirmed via CBC + RadioReference) - police audio is cryptographically unavailable regardless of platform, only fire/EHS/marine/wildfire remain in clear. No Capital RD (Victoria) feeds surfaced on the BC page at all. Verdict: a 'Listen on Broadcastify' link-out per feed is the ceiling; embedding the MP3 mounts without their commercial API would violate ToS.

### wspr.live (WSPR HF propagation database) — `wspr-live`

**T3 · VERIFIED · NEW** — Verified with real VI data: public ClickHouse SQL-over-HTTP endpoint returned live WSPR spots involving island-region grids within seconds (VE7HUN/VA7AEL in CN89, receiver in CN88bd), 275k spots ingested in the last hour globally. Free, keyless, CC BY 4.0. Great HF-propagation health tile.

- **Endpoint:** `https://db1.wspr.live/?query=SELECT%20time,%20tx_sign,%20tx_loc,%20rx_sign,%20rx_loc,%20frequency,%20snr%20FROM%20wspr.rx%20WHERE%20time%20%3E%20now()%20-%20INTERVAL%203%20HOUR%20AND%20(substring(rx_loc,1,4)%20IN%20('CN78','CN79','CN88','CN89','CO70','CO80')%20OR%20substring(tx_loc,1,4)%20IN%20('CN78','CN79','CN88','CN89','CO70','CO80'))%20ORDER%20BY%20time%20DESC%20LIMIT%20100%20FORMAT%20JSON`
- **Auth:** none
- **Rate limits:** no formal limit published; read-only SELECTs on wspr.rx only; keep queries narrow (my 3-hour grid-filtered query read 962k rows in 23 ms - the server is beefy but be polite)
- **License:** CC BY 4.0 (stated on wspr.live; data mirrored from wsprnet.org)
- **Attribution:** credit wspr.live and wsprnet.org (CC BY 4.0 attribution required)
- **Cadence:** medium (10-15 min; WSPR cycles are 2 min but a propagation tile doesn't need faster)
- **CORS:** no Access-Control-Allow-Origin observed without Origin header (ClickHouse expose-headers present); server-side polling unaffected
- **Response shape:** ClickHouse JSON: {meta:[{name,type}...], data:[{time:'2026-06-11 12:24:00', tx_sign:'VE7HUN', tx_loc:'CN89', rx_sign:'W6IJL', rx_loc:'DM34uq', frequency:10140201, snr:-20}...], rows, rows_before_limit_at_least, statistics:{elapsed, rows_read, bytes_read}}
- **Gotchas:** VI grid squares: CN78/CN79/CN88/CN89 plus CO70/CO80 north of 50N. Many spotters report 4-char grids only - position resolution is ~1x2 degrees for those. Use it as an HF band-conditions widget (which bands are open from the island right now), not a precise map layer.

### RepeaterBook export API (VI amateur repeaters) — `repeaterbook`

**T3 · NEEDS-KEY · NEW** — Endpoint live but the API changed in 2026: my unauthenticated request returned 401 {'error_code':'auth_missing'}. Token-based auth became mandatory 2026-03-31 with an approval workflow. Worth one application for a static VI repeater reference layer.

- **Endpoint:** `https://www.repeaterbook.com/api/export.php?country=Canada&state=British%20Columbia (with header X-RB-App-Token: rbuapp_... once approved)`
- **Auth:** free key via approval: public request form linked from https://www.repeaterbook.com/wiki/doku.php?id=api ; choose app/script access; token sent as X-RB-App-Token (preferred) or Authorization: Bearer; descriptive User-Agent also still mandatory
- **Rate limits:** set per-approval (policy mentions scope limits, User-Agent binding, IP controls, endpoint limits); directory data is static - cache aggressively, refresh weekly
- **License:** proprietary database, free for approved non-commercial use; commercial terms possible per their policy
- **Attribution:** required: public-facing apps must clearly credit RepeaterBook and link to it ('Data courtesy of RepeaterBook')
- **Cadence:** slow (weekly refresh is plenty; their policy effectively requires caching)
- **CORS:** not observed (401 before content)
- **Response shape:** unauth: {"ok":false,"error_code":"auth_missing","message":"Authorization required."}; keyed responses documented as JSON repeater records (frequency, offset, tone, callsign, location, status)
- **Gotchas:** Training-data trap confirmed: the old 'just send a custom User-Agent' free access is gone as of the March 2026 token transition. Static reference layer only - shows which VHF/UHF repeaters the operator could monitor with actual radio hardware; pairs naturally with the APRS-IS layer.

### Open Glider Network APRS feed — `ogn-aprs`

**T3 · VERIFIED · NEW** — Protocol verified: aprs.glidernet.org:14580 accepted the same read-only APRS-IS login (server GLIDERN3, unverified logresp) with an island filter. No traffic during my 6 s pre-dawn window - expected; FLARM/OGN tracker density on VI is low but nonzero (gliding, some GA). Cheap add-on to the APRS-IS worker.

- **Endpoint:** `TCP aprs.glidernet.org:14580, login line: user YOURCALL pass -1 vers blindspot 0.1 filter r/49.5/-124.5/200`
- **Auth:** none for receive-only (passcode -1)
- **Rate limits:** none formal; one persistent filtered connection
- **License:** OGN data usage rules: free for non-commercial use with attribution; CRITICAL: must honor the OGN Devices Database privacy flags (noTrack/stealth opt-outs) - dropping opted-out devices is mandatory, this is the ethical line for tracking private aircraft
- **Attribution:** credit Open Glider Network
- **Cadence:** persistent stream (share the APRS-IS worker process)
- **CORS:** n/a (raw TCP)
- **Response shape:** line-oriented: '# aprsc 2.1.20-gf.5-g0178a1b' banner, '# logresp N0CALL unverified, server GLIDERN3', then OGN-flavoured APRS position packets (FLARM/OGN tracker beacons with id, climb rate, turn rate in comment field) when aircraft are airborne
- **Gotchas:** Same persistent-TCP architecture caveat as APRS-IS - piggyback on the same worker. Filter the OGN DDB opt-out list before display (devices with noTrack must never be shown; this targets privacy of private individuals, so it is a hard rule, not etiquette). Expect activity mainly daytime VFR hours.

## Infrastructure / Network / Cyber

> Honest cluster assessment. STRONG: this cluster verified better than expected - 7 of 9 catalog sources are buildable today without any signup, and every verified claim above came from a live request made during this recon (real records quoted: Victoria permit EP084736 issued 2026-06-08; Comox Lake LEVEL 133.748 m at 2026-06-11T11:45Z; snow CSV row 2026-06-11 11:00; 757 transmission lines and 159 OSM substations in the VI bbox; IODA BC=region 576 with 300s-step BGP series). GAPS: (1) No truly live BC Hydro grid data exists publicly - load is a next-business-day Excel, reservoir elevations are PNG graphs; label these panels honestly as lagged. (2) Nanaimo has no open permits dataset at all (their hub's 98 datasets enumerated; only Victoria delivers). (3) Substation geometry has no open government source - BC Hydro Electrical Utility Data is under the restricted ICI Society licence; OSM is the legal substitute but is best-effort. (4) NetBlocks is a dead end (RSS abandoned Aug 2023, no API) - IODA replaces it. (5) The two needs-key sources (Cloudflare Radar, OpenChargeMap, plus OpenCelliD) all have free keys but signups were out of scope for this recon. LEGAL CAVEATS: OpenCelliD is CC BY-SA (share-alike contaminates derivatives); Cloudflare Radar is CC BY-NC (fine for a personal dashboard, not for commercialization); Victoria permit records contain contractor contact details - ingest but never display personal-looking contact fields; OCM requires visible per-record DataProvider attribution; IODA responses carry a Georgia Tech copyright string - attribute clearly and confirm terms before republishing raw series. RECOMMENDED BUILD ORDER: 1) eccc-hydrometric + bc-snow (no-key, CORS-open, current-hour data, immediate map value); 2) bchydro-grid WFS + osm-overpass-power (one-time geometry layers, instant infrastructure basemap); 3) permits (Victoria, daily cron); 4) ripestat + ioda (cyber-weather panel, no key); 5) BC Hydro load XLS (needs an xls parser in the Convex action, lagged data); 6) after keys are obtained: cloudflare-radar, openchargemap, opencellid (opencellid last - bulk download pattern, least operational value). Polling fits Convex crons cleanly: nothing in this cluster needs faster than 5-minute cadence, and four sources are daily-or-slower.

### Cloudflare Radar API — `cloudflare-radar`

**T2 · NEEDS-KEY** — Endpoint confirmed live: unauthenticated GET to /radar/annotations/outages?location=CA returned the API's own auth error (code 9106), not a 404. Free Cloudflare account + custom API token with Account > Radar > Read unlocks country- and ASN-level traffic, outage, and attack data. No BC/province granularity; use location=CA plus asn=852 (Telus) and asn=6327 (Shaw) for a regional proxy.

- **Endpoint:** `https://api.cloudflare.com/client/v4/radar/annotations/outages?location=CA&limit=10&format=json  (with header: Authorization: Bearer <TOKEN>; docs example also verified in docs: https://api.cloudflare.com/client/v4/radar/http/summary/device_type?dateRange=7d&format=json)`
- **Auth:** free key. Create a free Cloudflare account, then dash.cloudflare.com > My Profile > API Tokens > Create Custom Token with Permissions: Account > Radar > Read. Send as Authorization: Bearer header. Docs: https://developers.cloudflare.com/radar/get-started/first-request/
- **Rate limits:** Radar docs page states no Radar-specific limits; Cloudflare's global API limit of 1200 requests per 5 minutes per user applies.
- **License:** Radar datasets are published by Cloudflare under CC BY-NC 4.0 (per radar.cloudflare.com); fine for a personal non-commercial dashboard. Confirm current terms when creating the token.
- **Attribution:** Cloudflare Radar (https://radar.cloudflare.com)
- **Cadence:** medium (5-15 min). Radar aggregates lag by minutes-to-hours; outage annotations are event-driven, 5-15 min polling is plenty.
- **CORS:** Not observed on the unauthenticated error response; irrelevant for Convex server-side polling.
- **Response shape:** Unauthenticated: {success:false, errors:[{code:9106, message:"Missing X-Auth-Key, X-Auth-Email or Authorization headers"}], messages:[], result:null}. Docs show result wrapped in {success, errors, messages, result} with timeseries/summary objects plus confidence metadata.
- **Gotchas:** No province-level granularity - country (location=CA) and per-ASN only. Other useful documented endpoints per docs (not individually probed): /radar/netflows/timeseries and /radar/attacks/layer7/*. Token creation requires an account, which the no-signup rule blocked here.

### RIPEstat Data API — `ripestat`

**T3 · VERIFIED** — Verified live with my own request against Telus AS852: HTTP 200, status ok, full routing visibility data. No key required. Note the data window lags real time by up to ~8h (RIS dump cadence) - this is BGP weather, not a live outage detector.

- **Endpoint:** `https://stat.ripe.net/data/routing-status/data.json?resource=AS852&sourceapp=blindspot-osint  (swap resource=AS6327 for Shaw/Rogers; other data calls: bgp-updates, announced-prefixes at https://stat.ripe.net/data/<call>/data.json)`
- **Auth:** none. For sustained >1000 requests/day, email stat@ripe.net and always pass a sourceapp= identifier.
- **Rate limits:** Max 8 concurrent requests per IP; no stated volume cap. First request timed out at 20s - the API can be slow; use a 30-45s timeout.
- **License:** RIPEstat Service Terms and Conditions (https://www.ripe.net/about-us/legal/ripestat-service-terms-and-conditions); free to use with attribution.
- **Attribution:** RIPE NCC RIPEstat
- **Cadence:** medium (15 min) for routing-status; data behind by up to 8h so slow (30-60 min) loses nothing. For genuinely live BGP, RIS Live websocket (wss://ris-live.ripe.net) exists but is firehose-grade.
- **CORS:** access-control-allow-origin: * (observed)
- **Response shape:** {messages[], version, data_call_name, data_call_status, cached, status:"ok", status_code:200, time, data:{first_seen{prefix,origin,time}, last_seen{...}, visibility{v4{ris_peers_seeing:327,total_ris_peers:327},v6{...}}, announced_space{v4{prefixes:672,ips:4803072},v6{prefixes:30}}, observed_neighbours:409, resource:"852", query_time}}. Response noted query_time was shifted back to last available data (08:00 UTC for a 12:22 UTC request).
- **Gotchas:** Responses are cached server-side (cached:true); cache=ignore param exists but use sparingly. Slow responses are common - budget timeouts.

### NetBlocks — `netblocks`

**T3 · VERIFY-FAILED** — Honest verdict: there is no usable public API or feed. /api returns 404. A WordPress RSS feed exists at netblocks.org/feed (HTTP 200, valid RSS) but it is abandoned - lastBuildDate Nov 2023, newest item Aug 2023. Their current reporting is X/Twitter posts and site articles only, and Canada coverage is rare anyway.

- **Endpoint:** `https://netblocks.org/feed  (live but stale since Aug 2023; do not build on it)`
- **License:** Site content copyright NetBlocks; no data license offered because no data product is offered.
- **Cadence:** n/a - exclude from polling. Keep as a manual reference link at most.
- **Response shape:** RSS 2.0 channel, 10 <item>s, newest pubDate Sat, 26 Aug 2023.
- **Gotchas:** Scraping their X account would violate X ToS and the no-unsanctioned-sources rule. IODA (added below) covers the same outage-detection niche with a real public API.

### OpenCelliD — `opencellid`

**T3 · NEEDS-KEY** — API documented and alive; all useful calls require a free API key. Bbox query is capped at 50 cells/request with a 1000 req/day key limit, so for VI-wide tower coverage the right pattern is the keyed full-database CSV download (Canada MCC=302) refreshed occasionally, not live polling. Mozilla Location Services is confirmed dead: POST /v1/geolocate returns 404 (service retired mid-2024; only a static root page answers 200).

- **Endpoint:** `https://opencellid.org/cell/getInArea?key=YOUR_KEY&BBOX=48.2,-125.3,51.1,-123.1&format=json&limit=50  (bulk alternative: keyed full-DB download per MCC from https://opencellid.org/downloads.php, filter mcc=302)`
- **Auth:** free key + signup at https://opencellid.org (register account, key issued in profile). Docs: https://wiki.opencellid.org/wiki/API
- **Rate limits:** 1000 requests/day per key; max 50 cells per getInArea call; server sheds load with 'Too many requests' responses.
- **License:** CC BY-SA 4.0. ShareAlike matters: if BlindSpot republishes derived tower data, that derivative must also be CC BY-SA. Display with attribution is fine.
- **Attribution:** OpenCelliD Project, CC BY-SA 4.0
- **Cadence:** slow (towers are near-static; refresh the bulk CSV monthly, never poll live).
- **CORS:** Not checked (key required to elicit a real response); server-side polling makes it moot.
- **Response shape:** Per docs: cells with lat, lon, mcc, mnc, lac, cellid, radio (GSM/UMTS/LTE/NR), range, samples, updated. Not seen live (key required).
- **Gotchas:** MLS shutdown verified with my own request - do not reference it anywhere. Tower positions are crowd-estimated centroids, not surveyed locations; treat range/samples as confidence hints.

### BC Hydro grid: BA load + transmission geometry (BC WFS) — `bchydro-grid`

**T2 · VERIFIED** — Both halves verified. (a) Load: BC Hydro publishes hourly Balancing Authority load only as Excel files updated once per business day with a one-business-day lag - no public real-time API exists (OASIS via oasis.oati.com/BCTC is for market participants, not a clean public feed). (b) Geometry: BC openmaps WFS GetFeature works no-key; 757 transmission line features inside the VI bbox with voltage/circuit/owner attributes. There is NO open substation layer - BC Hydro Electrical Utility Data sits under the restricted ICI Society licence (gap filled by the new OSM Overpass source).

- **Endpoint:** `https://openmaps.gov.bc.ca/geo/pub/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=pub:WHSE_BASEMAPPING.GBA_TRANSMISSION_LINES_SP&outputFormat=application/json&count=1000&srsName=EPSG:4326&bbox=48.2,-125.3,51.1,-123.1,urn:ogc:def:crs:EPSG::4326  |  Load XLS: https://www.bchydro.com/content/dam/BCHydro/customer-portal/documents/corporate/suppliers/transmission-system/balancing_authority_load_data/CurrentHourlyBALoad.xls (verified 200, application/vnd.ms-excel, 40960 bytes)`
- **Auth:** none (both)
- **Rate limits:** None published for openmaps WFS; be polite. XLS is a static file - poll 1-2x/day.
- **License:** Transmission lines: Open Government Licence - British Columbia (confirmed via catalogue.data.gov.bc.ca, dataset bc-transmission-lines). BC Hydro XLS: BC Hydro website terms, informational data.
- **Attribution:** Contains information licensed under the Open Government Licence - British Columbia; load data: BC Hydro
- **Cadence:** Geometry: fetch once, refresh monthly. Load XLS: slow (every 6-12h; it only changes once per business day, Monday catches Fri-Sun).
- **CORS:** openmaps WFS: no Access-Control-Allow-Origin header observed. Moot server-side.
- **Response shape:** WFS: GeoJSON FeatureCollection, numberMatched:757 in VI bbox; properties: TRANSMISSION_LINE_ID, CIRCUIT_NAME, CIRCUIT_DESCRIPTION, VOLTAGE, OWNER, SOURCE_DATE, FEATURE_LENGTH_M, OBJECTID. XLS: hourly BA load workbook (binary, needs xls parsing in the Convex action).
- **Gotchas:** Load is yesterday's data - label the panel 'previous day', not live. WFS bbox needs lat,lon order with the urn:ogc:def:crs:EPSG::4326 suffix as used above. I grepped full GetCapabilities: no substation/power-station layer exists in the public WFS.

### Open Charge Map POI API — `openchargemap`

**T2 · NEEDS-KEY** — Endpoint live and key requirement confirmed with my own request: 403 'You must specify an API key using the key query parameter or x-api-key header.' Free key after account signup. Data license moved from CC BY-SA to CC BY 4.0 for user-contributed records; imported provider records carry per-record attribution that must be shown.

- **Endpoint:** `https://api.openchargemap.io/v3/poi?output=json&boundingbox=(48.2,-125.3),(51.1,-123.1)&maxresults=500&compact=true&verbose=false&key=YOUR_KEY`
- **Auth:** free key + signup: create an account at https://openchargemap.org (My Profile > my apps / API keys; the dev page openchargemap.org/site/develop links 'Register an application'). Key goes in key= param or x-api-key header. Note: their website 403s automated fetchers, but signup is normal in a browser.
- **Rate limits:** No formal published limits; fair-use with server-side throttling. POI data changes slowly - cache aggressively.
- **License:** User-contributed data: CC BY 4.0 (ShareAlike clause removed per official announcement at community.openchargemap.org/t/565). Imported DataProvider records: provider-specific license attached per-record in the API response; their terms require visible provider attribution to end users.
- **Attribution:** Open Charge Map (openchargemap.org) plus per-record DataProvider attribution from the response
- **Cadence:** slow (daily; station registry, not live availability - OCM does not provide real-time charger status).
- **CORS:** access-control-allow-origin: * (observed on the 403 response)
- **Response shape:** 403 body seen: plain-text key error. Documented POI shape (github.com/openchargemap/ocm-docs Model/): array of POIs with AddressInfo{Latitude,Longitude,Title}, Connections[], OperatorInfo, StatusType, DataProvider, UsageType.
- **Gotchas:** boundingbox param is (lat,lng),(lat,lng) corner pairs, unusual format. Do not expect live in-use/free status; that is not in OCM data.

### BC Automated Snow Weather Stations (ASWS) — `bc-snow`

**T2 · VERIFIED** — Verified live: hourly snow-water-equivalent CSV for all BC stations, current to within ~1-2 hours (latest row 2026-06-11 11:00 UTC fetched same day). Vancouver Island stations confirmed present in the header: 3B17P Wolf River Upper, 3B23P Jump Creek, 3B24P Heather Mountain Upper.

- **Endpoint:** `https://www.env.gov.bc.ca/wsd/data_searches/snow/asws/data/SW.csv  (SW = snow water equivalent, mm; sibling files for other parameters are linked from https://www.env.gov.bc.ca/wsd/data_searches/snow/asws/ but were not individually verified)`
- **Auth:** none
- **Rate limits:** None published; it is a ~2.6 MB static CSV covering the water year to date - use conditional GET / If-Modified-Since and poll gently.
- **License:** Open Government Licence - British Columbia (confirmed via catalogue.data.gov.bc.ca for the ASWS station-locations and archive datasets).
- **Attribution:** Contains information licensed under the Open Government Licence - British Columbia (BC Ministry of Environment / River Forecast Centre)
- **Cadence:** slow (30-60 min; underlying data is hourly).
- **CORS:** No Access-Control-Allow-Origin header observed; moot server-side.
- **Response shape:** Wide CSV: first column DATE(UTC) (yyyy-mm-dd hh:mm), then one column per station named '<ID> <Station Name>' (e.g. '3B23P Jump Creek'); hourly rows, many blanks for stations not reporting; SWE in mm.
- **Gotchas:** File grows through the water year (2.6 MB in June) - parse incrementally or diff on last timestamp. Station columns appear/disappear between water years.

### VI reservoir levels (BC Hydro pages + ECCC hydrometric route) — `reservoirs`

**T3 · VERIFIED** — Honest verdict: BC Hydro itself publishes NO machine-readable reservoir elevations - the VI station pages (ASH Forebay, Comox CMX, John Hart JHT, Puntledge PUN, Ladore LDR, Elliott Dam/Jordan River JOR, Strathcona SCA) render PNG graphs, and the res_hydromet TXT files I verified (cmx.txt, jht.txt) carry only 15-min precipitation/air-temp, lagging ~2 days. The machine-readable path is ECCC: BC Hydro's own page links Comox Lake to WSC station 08HB082, which I verified live - LEVEL 133.748 m at 2026-06-11T11:45Z, 5-minute readings.

- **Endpoint:** `https://api.weather.gc.ca/collections/hydrometric-realtime/items?STATION_NUMBER=08HB082&limit=24&sortby=-DATETIME&f=json  (Comox Lake near Courtenay, verified; discover Campbell River system stations via the VI bbox query: https://api.weather.gc.ca/collections/hydrometric-realtime/items?bbox=-125.3,48.2,-123.1,51.1&limit=500&f=json. Reference-only BC Hydro graphs: https://www.bchydro.com/energy-in-bc/operations/transmission-reservoir-data/previous-reservoir-elevations/vancouver_island.html, e.g. image https://www.bchydro.com/info/res_hydromet/images/res_comox.png; TXT hydromet: https://www.bchydro.com/info/res_hydromet/data/cmx.txt)`
- **Auth:** none
- **Rate limits:** api.weather.gc.ca: none published, standard fair use. BC Hydro TXT/PNG: static files, poll sparingly.
- **License:** ECCC: Environment and Climate Change Canada data servers terms - free reuse with attribution. BC Hydro pages: informational only, accuracy explicitly not guaranteed.
- **Attribution:** Water level data: Environment and Climate Change Canada (Water Survey of Canada); graphs: BC Hydro
- **Cadence:** medium (5-15 min via ECCC; readings are 5-min). BC Hydro graph/TXT refs: slow or skip.
- **CORS:** api.weather.gc.ca: Access-Control-Allow-Origin: * (observed). env/bchydro: not present.
- **Response shape:** ECCC: GeoJSON features, properties: IDENTIFIER, STATION_NUMBER, STATION_NAME ('COMOX LAKE NEAR COURTENAY'), PROV_TERR_STATE_LOC, DATETIME, DATETIME_LST, LEVEL (m), DISCHARGE, symbols. 8686 records for 08HB082 in the 30-day rolling window. BC Hydro cmx.txt: header + fixed-width rows Date/Time(PST)/Precipitation(mm)/Air Temp(C), 15-min, observed ~2 days stale.
- **Gotchas:** hydrometric-realtime keeps only ~30 days of history - archive into Convex if you want trends. Jordan River (Elliott Dam) has no verified machine-readable level; only the BC Hydro PNG. Do not invent Campbell system station numbers - enumerate them from the bbox query response.

### Building permits: City of Victoria (ArcGIS) + City of Nanaimo — `permits`

**T3 · VERIFIED** — Victoria fully verified: open ArcGIS layers for permits issued in the last 365 days (layer 3) and last 60 days (layer 4); I pulled a real record (EP084736, issued 2026-06-08, with lat/lng) - the feed is near-current. Nanaimo verdict: their open data hub (gisdata.nanaimo.ca, ArcGIS Hub, 98 datasets - enumerated all titles) has NO building permits dataset; permits exist only in the NanaimoMap web app and monthly statistics pages, and the old DataBrowser portal is dead (404).

- **Endpoint:** `https://maps.victoria.ca/server/rest/services/OpenData/OpenData_PermitsAndLicences/MapServer/3/query?where=1%3D1&outFields=*&f=json  (layer 4 = last 60 days; bulk GeoJSON: https://opendata.victoria.ca/api/download/v1/items/b4db2c27a1d14d59a7d7901ba77f16ce/geojson?layers=3)`
- **Auth:** none
- **Rate limits:** None published (standard ArcGIS Server); maxRecordCount applies - page with resultOffset.
- **License:** Open Data Licence - City of Victoria (https://opendata.victoria.ca/pages/open-data-licence, cited in the dataset DCAT records). Nanaimo datasets: Open Data Catalogue Licence - Nanaimo.
- **Attribution:** City of Victoria Open Data
- **Cadence:** slow (daily; data is updated by city staff via automated scripts, observed current to within ~3 days).
- **CORS:** maps.victoria.ca reflects the request Origin in Access-Control-Allow-Origin (effectively permissive).
- **Response shape:** esriGeometryPoint features (wkid 3157 - reproject!), attributes: PermitNo, CATEGORY, type, SUBJECT, Status, Purpose, IssuedDate (string yyyymmdd), BldgValue, Unit/House/Street, completed_date, CREATED_DATE, Neighbourhood, X_LONG, Y_LAT (string lat/lng - use these instead of reprojecting), ContactType, Name, mailing_address, phone, cell, email, PermitType.
- **Gotchas:** Records include applicant/contractor business contact details (name, phone, email) - ingest but do not surface contact fields in the UI; treat as business data only. IssuedDate is a string, not an epoch. Nanaimo gap: nearest substitutes are gisdata.nanaimo.ca Building Footprints (verified present) and the monthly permit statistics pages; an open-data request to foi@nanaimo.ca is the path to a real feed.

### ECCC MSC GeoMet hydrometric-realtime (Water Survey of Canada) — `eccc-hydrometric`

**T2 · VERIFIED · NEW** — Verified live with VI bbox: 486,412 records in the rolling window, 5-minute water level/discharge for every WSC station on the island - rivers, lakes, and the reservoir-adjacent gauges BC Hydro itself links to. The single best hydro-infrastructure feed in this cluster: no key, CORS open, OGC API Features standard.

- **Endpoint:** `https://api.weather.gc.ca/collections/hydrometric-realtime/items?bbox=-125.3,48.2,-123.1,51.1&limit=500&f=json`
- **Auth:** none
- **Rate limits:** None published; fair use of api.weather.gc.ca. Use station filters + sortby=-DATETIME rather than slurping the whole bbox window.
- **License:** Environment and Climate Change Canada data servers terms of use - free reuse with attribution.
- **Attribution:** Data source: Environment and Climate Change Canada / Water Survey of Canada
- **Cadence:** medium (5-15 min; native readings are 5-min).
- **CORS:** Access-Control-Allow-Origin: * (observed)
- **Response shape:** GeoJSON FeatureCollection; properties: IDENTIFIER ('08GC006.2026-05-12T08:00:00Z'), STATION_NUMBER, STATION_NAME, PROV_TERR_STATE_LOC, DATETIME, DATETIME_LST, LEVEL, DISCHARGE, LEVEL_SYMBOL_EN/FR; one feature per station per timestamp.
- **Gotchas:** Rolling ~30-day window only - persist history in Convex. One feature per timestamp means bbox queries return huge counts; always filter by STATION_NUMBER + sortby + small limit for polling.

### IODA (Internet Outage Detection & Analysis, Georgia Tech) — `ioda`

**T3 · VERIFIED · NEW** — Verified live: British Columbia is region code 576 (entity lookup confirmed), and the raw signals endpoint returned a 289-point, 5-minute-step BGP visibility series for the last 24h. This is the working replacement for the NetBlocks niche: actual region-level internet outage signals for BC, no key.

- **Endpoint:** `https://api.ioda.inetintel.cc.gatech.edu/v2/signals/raw/region/576?from=<unix_ts>&until=<unix_ts>&datasource=bgp  (entity lookup: https://api.ioda.inetintel.cc.gatech.edu/v2/entities/query?entityType=region&search=British+Columbia; datasources include bgp, ping-slash24, merit-nt; ASN entities also exist for AS852/AS6327)`
- **Auth:** none
- **Rate limits:** None published; public API backing ioda.live - be polite, one signals call per datasource per poll.
- **License:** API responses carry 'Copyright (c) Georgia Tech Research Corporation. All Rights Reserved.' Public dashboard use with clear IODA attribution is the norm; confirm redistribution terms at ioda.inetintel.cc.gatech.edu before republishing raw series.
- **Attribution:** IODA, Internet Intelligence Lab, Georgia Tech
- **Cadence:** medium (5-15 min; signal step is 300s and the tail lags anyway).
- **CORS:** Access-Control-Allow-Origin echoes the request Origin (permissive).
- **Response shape:** {type, metadata{requestTime,responseTime}, requestParameters, error:null, data:[[{entityType:'region', entityCode:'576', entityName:'British Columbia', entityFqid:'geo.netacuity.NA.CA.576', datasource:'bgp', from, until, step:300, nativeStep, values:[...]}]]}. Trailing values were null - publication lags ~15-30 min.
- **Gotchas:** Region granularity is BC-wide, not VI-specific; pair with ASN-level signals for Telus/Shaw to localize. Treat trailing nulls as 'not yet published', not as an outage.

### OSM Overpass: power infrastructure (substations fill) — `osm-overpass-power`

**T3 · VERIFIED · NEW** — Verified live: 159 power=substation features (7 nodes, 152 ways) inside the VI bbox via overpass-api.de. This fills the substation-geometry gap left by BC's restricted ICI-licensed utility data, and the same query pattern yields power lines, plants, and generators.

- **Endpoint:** `POST https://overpass-api.de/api/interpreter with body: data=[out:json][timeout:25];(node["power"="substation"](48.2,-125.3,51.1,-123.1);way["power"="substation"](48.2,-125.3,51.1,-123.1););out center tags;  (MUST send a descriptive User-Agent header)`
- **Auth:** none
- **Rate limits:** Shared community instance: fair-use, roughly a few thousand queries/day max, avoid parallel queries. This is a fetch-and-cache source, not a polling target.
- **License:** ODbL 1.0 (OpenStreetMap). Share-alike applies to derivative databases; display with attribution is fine.
- **Attribution:** © OpenStreetMap contributors, ODbL
- **Cadence:** slow (fetch once, refresh weekly or monthly; substations do not move).
- **CORS:** Not captured on the successful response; irrelevant server-side.
- **Response shape:** {version:0.6, generator:'Overpass API 0.7.62.11', osm3s{timestamp_osm_base, copyright}, elements:[...]} - with 'out count' I saw {type:'count', tags:{nodes:'7', ways:'152', relations:'0', total:'159'}}; with 'out center tags' you get per-element id, center lat/lon, and tags (name, operator, voltage where mapped).
- **Gotchas:** Requests with curl's default User-Agent get HTTP 406 - I hit this twice before adding a UA; set something like 'BlindSpot/0.1 (contact email)'. Completeness is community-dependent: 159 substations includes small distribution kiosks and may miss or mislabel some BC Hydro sites - treat as best-effort geometry, not authoritative.

## Wildfire

> Strong cluster: every T1 endpoint verified with live data, no logins, no legal blockers. Key 2025-2026 drift found and corrected by live probing: (1) GeoMet renamed FireWork smoke - the old RAQDPS-FW.SFC_PM2.5 forecast layer is gone, operational smoke now lives at RAQDPS.Sfc_PM2.5-WildfireSmokePlume etc.; (2) CWFIS datamart killed the static hotspots.csv and the activefires/ path (now yyyymmdd.csv + reportedfires/ on a new cwfif geoserver); (3) FireSmoke run IDs rotate suffixes (BSC00CA12-01 serves a year-stale file - only the /forecasts/current/ alias is safe). Interface verdict for BCWS: prefer the GeoBC ArcGIS FeatureServers (GeoJSON out, 4326 envelope queries, CORS *, dataLastEditDate observed <1 min old) with openmaps WFS as authoritative fallback - schemas match. Legal caveats: CWFIS requires its exact citation string; FireSmoke.ca has no explicit licence (experimental UBC research product - attribute and show its disclaimer, or lean on GeoMet which has a proper ECCC end-use licence); FIRMS wants an acknowledgment blurb; everything else is OGL-BC/OGL-Canada/US public domain. Gaps to be honest about: June 2026 VI fire activity is minimal so perimeter/evac layers were verified mostly on out-of-bbox features; FIRMS area API remains needs-key (5 min signup) though the keyless Canada 24h CSVs fully cover VI today; smoke forecasts are semi-live (2-4 model runs/day, not real-time). Recommended build order: 1) BCWS ArcGIS active fires + perimeters, 2) FIRMS keyless Canada CSVs filtered to bbox (instant win, add MAP_KEY area API later), 3) bans + evacuation orders (low volume, high stakes), 4) GeoMet RAQDPS smoke WMS overlay with TIME animation, 5) CWFIS hotspots CSV as enrichment join (fwi/hfi/ros per detection) + fdr_current daily raster, 6) HMS observed-smoke polygons and FireSmoke KMZ as secondary/comparison layers.

### BC Wildfire Service - Current Fire Points, Perimeters, Bans (WFS + ArcGIS) — `bcws-fires`

**T1 · VERIFIED** — All three layers live-verified on openmaps.gov.bc.ca WFS and on the GeoBC ArcGIS Online org (services6.arcgis.com/ubm4tcTYICKBpist). Recommendation: use the ArcGIS FeatureServer as primary (f=geojson, simple 4326 envelope queries, CORS *, dataLastEditDate was minutes old at poll time) and openmaps WFS as the canonical fallback.

- **Endpoint:** `ArcGIS (recommended): https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/BCWS_ActiveFires_PublicView/FeatureServer/0/query?where=1%3D1&geometry=-125.30,48.20,-123.10,51.10&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&f=geojson | Perimeters: same host /BCWS_FirePerimeters_PublicView/FeatureServer/0/query | Bans: /British_Columbia_Bans_and_Prohibition_Areas_-_View/FeatureServer/0/query | WFS points: https://openmaps.gov.bc.ca/geo/pub/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_PNTS_SP&outputFormat=application/json&srsName=EPSG:4326&bbox=48.20,-125.30,51.10,-123.10,urn:ogc:def:crs:EPSG:4326 | WFS perimeters: typeName=WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_POLYS_SP | WFS bans: typeName=WHSE_LAND_AND_NATURAL_RESOURCE.PROT_BANS_AND_PROHIBITIONS_SP`
- **Auth:** none
- **Rate limits:** openmaps Kong gateway advertises x-ratelimit-limit-second: 60000 (effectively unlimited for polling). ArcGIS Online public FeatureServer: no published per-user limit, maxRecordCount 1000 per query.
- **License:** Open Government Licence - British Columbia (OGL-BC)
- **Attribution:** Contains information licensed under the Open Government Licence - British Columbia (BC Wildfire Service).
- **Cadence:** fast-medium: 2-5 min for active fire points during fire season (ArcGIS dataLastEditDate was <1 min old when polled), 15 min for perimeters, 30-60 min for bans/prohibitions.
- **CORS:** openmaps: NO Access-Control-Allow-Origin observed on GET (only access-control-allow-credentials:true + Vary:Origin) - assume not browser-fetchable. ArcGIS Online: CORS * (standard AGO behavior). Server-side polling unaffected.
- **Response shape:** WFS points GeoJSON properties: FIRE_NUMBER, FIRE_YEAR, RESPONSE_TYPE_DESC, IGNITION_DATE, FIRE_OUT_DATE, FIRE_STATUS (Out/Under Control/...), FIRE_CAUSE, FIRE_CENTRE, ZONE, FIRE_ID, FIRE_TYPE, INCIDENT_NAME, GEOGRAPHIC_DESCRIPTION, LATITUDE, LONGITUDE, CURRENT_SIZE (ha), FIRE_URL (wildfiresituation.nrs.gov.bc.ca incident link), FIRE_OF_NOTE_IND, WAS_FIRE_OF_NOTE_IND, OBJECTID; totalFeatures 285 province-wide; 2 non-Out fires inside VI bbox at verify time (V60498 Banon Creek, V50401). Bans layer: PROT_BAP_SYSID, TYPE (e.g. 'Partial Prohibition'), ACCESS_PROHIBITION_DESCRIPTION ('Category 2, Category 3'), ACCESS_STATUS_EFFECTIVE_DATE, FIRE_CENTRE_NAME (Coastal = VI), FIRE_ZONE_NAME, BULLETIN_URL; 6 features. ArcGIS layer mirrors the same schema plus GlobalID; supports f=geojson and outSR=4326.
- **Gotchas:** WFS 2.0 bbox with EPSG:4326 urn CRS uses lat,lng axis order (bbox=48.20,-125.30,51.10,-123.10,urn:ogc:def:crs:EPSG:4326). HEAD requests to openmaps return 404 (Kong) - use GET. Bans polygons are huge multi-vertex features; use propertyName/outFields to skip geometry when you only need status. FIRE_STATUS includes already-out fires - filter FIRE_STATUS <> 'Out'. Coastal Fire Centre = Vancouver Island; FIRE_ZONE_NAME often null on bans, match on FIRE_CENTRE_NAME='Coastal'. Perimeter-layer fields differ from points (FIRE_NUMBER, FIRE_STATUS, FIRE_SIZE_HECTARES, TRACK_DATE — no CURRENT_SIZE/GEOGRAPHIC_DESCRIPTION); f=geojson date fields are epoch ms, not ISO; where=FIRE_STATUS <> 'Out' is honored server-side on both layers.

### CWFIS Datamart - Daily Hotspots CSV + GeoServer WMS (FDR/FWI/M3) — `cwfis`

**T1 · VERIFIED** — Hotspots CSV verified at the yyyymmdd.csv pattern (no static hotspots.csv - that 404s); GeoServer WMS GetMap verified for fdr_current and hotspots_last24hrs over the VI bbox, both 200 image/png. Licence file pins OGL-Canada plus a specific required citation.

- **Endpoint:** `Hotspots CSV (today): https://cwfis.cfs.nrcan.gc.ca/downloads/hotspots/20260611.csv (pattern yyyymmdd.csv, archive/ subdir for history, dir listing at https://cwfis.cfs.nrcan.gc.ca/downloads/hotspots/) | WMS FDR: https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wms?service=WMS&version=1.3.0&request=GetMap&layers=public:fdr_current&styles=&crs=EPSG:4326&bbox=48.20,-125.30,51.10,-123.10&width=550&height=725&format=image/png&transparent=true | swap layers= for public:fwi_current, public:hotspots_last24hrs, public:m3_polygons_current, or forecast layers fdrYYYYMMDDxf`
- **Auth:** none
- **Rate limits:** none published; be polite, daily files are static once written
- **License:** Open Government Licence - Canada (per https://cwfis.cfs.nrcan.gc.ca/downloads/licence.txt)
- **Attribution:** Required citation: 'Canadian Forest Service. Canadian Wildland Fire Information System (CWFIS), Natural Resources Canada, Canadian Forest Service, Northern Forestry Centre, Edmonton, Alberta. https://cwfis.cfs.nrcan.gc.ca.'
- **Cadence:** medium for hotspots CSV (file regenerates several times daily; poll 15-30 min and diff), slow/daily for fdr_current and fwi_current (one model run per day, plus fdrYYYYMMDDxf forecast layers out ~12 days).
- **CORS:** access-control-allow-origin: * observed on both the downloads host and the geoserver WMS
- **Response shape:** Hotspots CSV columns (seen): lat, lon, rep_date, source (e.g. NASA_z), sensor (MODIS/VIIRS), fwi, fuel, ros, sfc, tfc, bfc, hfi, estarea. Coverage is continental North America incl. US points - filter to VI bbox client-side. WMS returns PNG overlays (FDR VI render was 22.7 KB with real data).
- **Gotchas:** The old /downloads/hotspots/hotspots.csv URL 404s - you must build today's yyyymmdd.csv filename (UTC date) and fall back to yesterday if today's file is not yet present early in the day. WMS 1.3.0 EPSG:4326 bbox is lat,lng axis order. The datamart page itself is a JS SPA - scrape the nginx directory indexes instead. Hotspot rows carry modeled fire-behavior fields (fwi/hfi/ros) you cannot get from FIRMS - good enrichment join.

### NASA FIRMS - Area API (MAP_KEY) + keyless Canada 24h CSVs — `nasa-firms`

**T1 · NEEDS-KEY** — Area API URL pattern confirmed live (returns 'Invalid MAP_KEY.' without a key; NASA DEMO_KEY does NOT work on FIRMS - it is an api.nasa.gov key). Meanwhile the keyless per-country active-fire CSVs are fully verified with real VIIRS rows for Canada, so you can ship hotspots before getting a key.

- **Endpoint:** `Keyed area API (VI bbox, w,s,e,n order): https://firms.modaps.eosdis.nasa.gov/api/area/csv/YOUR_MAP_KEY/VIIRS_SNPP_NRT/-125.30,48.20,-123.10,51.10/1 | Verified keyless fallback (Canada-wide, filter client-side): https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Canada_24h.csv and https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Canada_24h.csv`
- **Auth:** free MAP_KEY, instant email signup at https://firms.modaps.eosdis.nasa.gov/api/map_key/ (page verified 200). Keyless CSVs: none.
- **Rate limits:** MAP_KEY limit is 5000 transactions / 10-minute interval (verbatim from docs); multi-day requests count as multiple transactions. Keyless CSVs: no published limit, file regenerates roughly hourly (last-modified 11:46Z on a 12:34Z poll).
- **License:** NASA data - no restrictions on use (US Government / NASA Earthdata open data policy); FIRMS requests acknowledgment
- **Attribution:** 'We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Earth Science Data and Information System (ESDIS).'
- **Cadence:** medium: 10-15 min polls on the 24h CSVs is plenty (new detections only land after satellite passes; VIIRS overpasses VI a handful of times/day). With a MAP_KEY, same cadence on the area API, well inside the 5000/10min budget.
- **CORS:** No Access-Control-Allow-Origin header observed on the keyless CSV host - server-side fetch only
- **Response shape:** Keyless CSV columns (seen): latitude, longitude, bright_ti4, scan, track, acq_date, acq_time, satellite (N = Suomi NPP, N20 = NOAA-20), confidence (nominal/low/high), version (2.0NRT), bright_ti5, frp, daynight. Area API returns the same CSV schema scoped to your bbox/days.
- **Gotchas:** Area API bbox order is west,south,east,north (lng first) - opposite of the BC WFS axis order. Sensors to query separately: VIIRS_SNPP_NRT, VIIRS_NOAA20_NRT, VIIRS_NOAA21_NRT, MODIS_NRT. Tofino-offshore detections ARE included (FIRMS is global) - widen the bbox west past -125.30 if you care about marine smoke plumes' source fires. Confidence 'low' has frequent false positives over warm urban/industrial pixels.

### FireSmoke.ca (UBC BlueSky Canada) + ECCC FireWork/RAQDPS smoke via MSC GeoMet WMS — `firesmoke`

**T2 · VERIFIED** — Both consumables verified. FireSmoke serves a stable 'current' alias for KMZ (hourly PM2.5 ground-overlay PNGs) and a raw NetCDF. In GeoMet the FireWork branding changed: wildfire smoke is now in the operational RAQDPS as *-WildfireSmokePlume layers (RAQDPS-FW.* layers are legacy/cumulative-effects only). Build on GeoMet; keep FireSmoke as a comparison layer.

- **Endpoint:** `FireSmoke KMZ (stable alias, verified 200, ~764 KB): https://firesmoke.ca/forecasts/current/dispersion.kmz | Raw NetCDF (84 MB, hourly PM2.5 grid): https://firesmoke.ca/forecasts/current/dispersion.nc | GeoMet smoke WMS (verified 200 over VI): https://geo.weather.gc.ca/geomet?service=WMS&version=1.3.0&request=GetMap&layers=RAQDPS.Sfc_PM2.5-WildfireSmokePlume&styles=&crs=EPSG:4326&bbox=48.20,-125.30,51.10,-123.10&width=550&height=725&format=image/png&transparent=true | sibling layers: RAQDPS.Sfc_PM10-WildfireSmokePlume, RAQDPS.EAtm_PM2.5-WildfireSmokePlume, RAQDPS.EAtm_PM10-WildfireSmokePlume, RAQDPS.SFC_PM2.5 (total PM2.5)`
- **Auth:** none
- **Rate limits:** FireSmoke: none published (UBC research server - poll gently, file only changes 4x/day). GeoMet: no hard published per-user limit; ECCC fair-use policy, designed for tiled WMS consumption.
- **License:** GeoMet/RAQDPS: Environment and Climate Change Canada Data Servers End-use Licence (free use with attribution). FireSmoke.ca: experimental UBC Weather Forecast Research Team product, no explicit licence published - treat as research/visualization use with credit.
- **Attribution:** GeoMet: 'Data Source: Environment and Climate Change Canada'. FireSmoke: credit 'BlueSky Canada smoke forecast, UBC Weather Forecast Research Team / firesmoke.ca' and surface its experimental disclaimer.
- **Cadence:** slow: FireSmoke runs 4x/day (BSC00/06/12/18 run IDs) - poll the alias hourly and diff Last-Modified. GeoMet RAQDPS runs 2x/day (00/12 UTC) with hourly timesteps to 72 h - re-fetch tiles on each model run, fetch-on-demand for map panning.
- **CORS:** GeoMet: Access-Control-Allow-Origin: * (verified). FireSmoke: no ACAO header observed.
- **Response shape:** KMZ contains doc.kml + hourly ground-overlay PNGs named 10m_hourly_YYYYMMDDHHMM.png plus 10m_colorbar_hourly.png and fire_location.png icons; forecast page metadata: run BSC00CA12-07, 2026-06-11 08:00 UTC, WRF 12 km, ~48 h horizon, PM2.5 ug/m3. GeoMet GetMap returns PNG (1.6 KB transparent over VI = no smoke at verify time); WMS supports TIME= dimension for animation.
- **Gotchas:** Do NOT hardcode a FireSmoke run ID: BSC00CA12-01 still serves a stale March 2025 file; the live run today is BSC00CA12-07. Always use the /forecasts/current/ alias. The expected RAQDPS-FW.SFC_PM2.5 layer name from older docs no longer exists in capabilities - the 2025-2026 rename moved smoke products to RAQDPS.*-WildfireSmokePlume. FireSmoke ingests fire detections with ~1-2 day lag (page showed fires & emissions from 2026-06-09 on a 06-11 run). dispersion.nc is 84 MB per fetch - prefer the KMZ or GeoMet WMS server-side.

### NBFireMap (github.com/jtgis/nbfiremap) - architecture reference — `nbfiremap-ref`

**T3 · VERIFIED** — README read from the live repo. It fuses: GeoNB active fire points, CWFIS national perimeters (M3) + Fire Danger Rating + FWI + FBP layers, NASA FIRMS MODIS/VIIRS hotspots, NOAA surface smoke concentration forecast, ECCC weather stations/lightning density/radar/AQHI, Sentinel-2 imagery via Esri Living Atlas, OpenSky Network ADS-B aircraft (water bombers), burn restrictions links, and community proximity tooling ('Near Fires' distances). Reference intel only - validates BlindSpot's BCWS+CWFIS+FIRMS+smoke stack and suggests three borrowable ideas: OpenSky aircraft overlay during incidents, Sentinel-2 recent imagery, and a settlement-proximity ranking.

- **Endpoint:** `https://raw.githubusercontent.com/jtgis/nbfiremap/main/README.md (app: https://www.nbfiremap.ca)`
- **Auth:** none
- **License:** n/a (reference intel; their data remains property of cited owners)
- **Cadence:** n/a (one-time reference)
- **Response shape:** n/a (README markdown)
- **Gotchas:** Their smoke layer is NOAA (US NWS) surface smoke, which does cover BC's south coast - an alternative if GeoMet ever degrades. OpenSky is non-commercial-use licensed; fine for a single-operator OSINT tool but check before any commercial pivot.

### BC Evacuation Orders and Alerts (EmergencyInfoBC layer via openmaps WFS / GeoBC ArcGIS) — `bc-evac-orders`

**T1 · VERIFIED · NEW** — Live-verified WFS layer of evacuation orders/alerts polygons for all hazard types (wildfire, flood). The natural companion to fire points - this is the 'does anyone need to leave' layer. Also available as Evacuation_Orders_and_Alerts FeatureServer on the same GeoBC ArcGIS org as BCWS layers.

- **Endpoint:** `https://openmaps.gov.bc.ca/geo/pub/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=WHSE_HUMAN_CULTURAL_ECONOMIC.EMRG_ORDER_AND_ALERT_AREAS_SP&outputFormat=application/json&srsName=EPSG:4326&bbox=48.20,-125.30,51.10,-123.10,urn:ogc:def:crs:EPSG:4326 | ArcGIS alt: https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/Evacuation_Orders_and_Alerts/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson`
- **Auth:** none
- **Rate limits:** same as openmaps (x-ratelimit-limit-second: 60000) / ArcGIS Online public
- **License:** Open Government Licence - British Columbia
- **Attribution:** Contains information licensed under the Open Government Licence - British Columbia.
- **Cadence:** medium: 5-15 min during active incidents; status changes are high-stakes and low-volume.
- **CORS:** openmaps: no ACAO observed; ArcGIS Online: *
- **Response shape:** Fields seen: EMRG_OAA_SYSID, EVENT_NAME, EVENT_TYPE (Fire/Flood/...), ORDER_ALERT_STATUS (Order/Alert), ISSUING_AGENCY, DATE_MODIFIED, OBJECTID, polygon geometry; 9 features province-wide at verify time (quiet period).
- **Gotchas:** Layer includes ALL hazard types - filter EVENT_TYPE='Fire' for the wildfire view but consider showing all for an OSINT console. Some stale historical entries persist (saw a 2023 flood order) - filter or badge by DATE_MODIFIED recency. ORDER_ALERT_STATUS domain is exactly {Order, Alert} — rescinded entries are DELETED from the layer, so disappearance must be treated as cancellation; envelope geometry filtering + outSR=4326 + geometryPrecision verified working; useful extra fields: ORDER_ALERT_NAME, EVENT_START_DATE (epoch ms), MULTI_SOURCED_POPULATION/HOMES; a stale 2023 landslide Alert persists province-wide.

### CWFIF National Reported Fires (next-gen NRCan geoserver WFS) — `cwfif-reported-fires`

**T2 · VERIFIED · NEW** — Live-verified WFS on NRCan's newer geoserver.cwfif.nrcan.gc.ca: every agency-reported fire in Canada (1769 current-record features) with stage of control, size, response type and situation-report timestamps. Cross-agency view that catches Parks Canada / other-agency fires BCWS layers may lag on, discovered via the datamart's own .url pointer files.

- **Endpoint:** `https://geoserver.cwfif.nrcan.gc.ca/geoserver/wfs?service=WFS&version=2.0.1&request=GetFeature&outputFormat=application/json&typeName=public:cwfif_national_reportedfires&srsName=EPSG:4326&CQL_FILTER=now()%3E=record_start%20AND%20now()%3C=record_end%20AND%20agency_code='BC' (drop the agency filter for national; CSV via outputFormat=csv)`
- **Auth:** none
- **Rate limits:** none published
- **License:** Open Government Licence - Canada (CWFIS family licence)
- **Attribution:** Same CWFIS citation: 'Canadian Forest Service. Canadian Wildland Fire Information System (CWFIS), Natural Resources Canada...'
- **Cadence:** medium-slow: 30 min; rows update as agencies file situation reports (status_date was 45 min old at verify).
- **CORS:** not separately tested on this host; assume server-side fetch
- **Response shape:** Fields seen: id, agency_code (e.g. BC/NL/PC), national_fire_id (2026_NL_133), agency_fire_id, national_fire_cause (H/L/U), fire_type_ics, percent_contained, fire_size (ha), response_type (FUL/MOD/MON), stage_of_control_status (UC/OC/BH/OUT), situation_report_date, status_date, latitude, longitude, fire_year, record_start, record_end. Default geometry CRS is EPSG:3978 - request srsName=EPSG:4326 or use the lat/lng properties.
- **Gotchas:** Temporal-versioned table: WITHOUT the record_start/record_end CQL filter you get historical duplicates of each fire. The 'activefires' datamart path is dead; the /downloads/reportedfires/ dir holds .url pointer files that define the canonical queries (verified pattern above).

### NOAA HMS Smoke Polygons (analyst-drawn daily smoke extents) — `noaa-hms-smoke`

**T2 · VERIFIED · NEW** — Live-verified daily KML and shapefile of human-analyst-drawn smoke plume polygons from GOES/VIIRS imagery, covering all of North America INCLUDING the Pacific offshore west of Tofino where the model grids and BC layers stop. Observational complement to the forecast smoke layers.

- **Endpoint:** `https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/2026/06/hms_smoke20260610.kml (pattern .../KML/YYYY/MM/hms_smokeYYYYMMDD.kml; shapefile: .../Shapefile/YYYY/MM/hms_smokeYYYYMMDD.zip - both verified 200)`
- **Auth:** none
- **Rate limits:** none published (US gov public server)
- **License:** US Government public domain (NOAA/NESDIS)
- **Attribution:** Courtesy NOAA/NESDIS Hazard Mapping System (HMS).
- **Cadence:** slow: 60 min; the daily file is updated a few times during the US daytime analyst shift, finalized end of day UTC. Fetch today + yesterday and merge.
- **CORS:** not tested; server-side fetch
- **Response shape:** KML (106 KB on 2026-06-10) of smoke polygons with Density attribute (Light/Medium/Heavy); shapefile zip 31 KB same day. Same-day file appears mid-day and is appended through the analyst shift.
- **Gotchas:** Analyst product, daytime-only and weather-dependent (cloud blocks detection); same-day file may 404 early UTC morning - fall back to previous day. Density classes are qualitative, not ug/m3 - do not mix scales with RAQDPS PM2.5.

## Environment & Conditions

> Strong cluster: 7 of 9 assigned sources fully verified with live data today, plus 3 new verified no-key sources. ECCC GeoMet (api.weather.gc.ca) is the backbone - AQHI, hydrometric, citypage UV, and SWOB all share one API family, one licence (DSEUL v2.1, attribution 'Data Source: Environment and Climate Change Canada'), pygeoapi paging semantics, and ACAO:* - build one typed OGC-API client in Convex and get four sources nearly free. Recommended build order: (1) bc-aqhi + hydrometric + citypage-UV on the shared client, (2) bc-drought (trivial weekly ArcGIS poll), (3) eccc-swob + ndbc-46206 for live conditions, (4) astronomy computed locally via suncalc/satellite.js with sunrise-sunset.org and wheretheiss.at as garnish, (5) sst-chlorophyll + nasa-gibs daily layers, (6) open-meteo as the UV/model fallback, (7) keyed sources last - openaq is largely redundant with bc-aqhi for VI, and purpleair is worthwhile only once you accept the points economy (one-time 1M free points, not monthly). Legal caveats: BC drought layer is 'Access Only' Crown copyright - display in this single-operator dashboard is fine, redistribution is not; sunrise-sunset.org requires a visible attribution link; open-meteo free tier is non-commercial only; GIBS/NDBC/ERDDAP want courtesy credits. Known gaps and honest limitations: no AQHI community for Port Alberni (nearest are Duncan and Comox Valley - consider PurpleAir there); pollen has no free legal source in Canada (Aerobiology's network is commercial; Ambee/Google Pollen are paid) - drop it or budget for it; Open Notify pass-times is dead (404) - compute passes locally; BC River Forecast Centre advisories are HTML-only scraping with a misconfigured TLS chain (no RSS) - treat as best-effort; CIOOS lightstation SST was investigated as a candidate and rejected (archive ends 2019-11-30). Cadence discipline: nothing in this cluster except live ISS tracking and SWOB justifies sub-5-minute polling - most of it is hourly-to-daily data.

### ECCC AQHI Observations + Forecasts (GeoMet OGC API) — `bc-aqhi`

**T1 · VERIFIED** — Both collections live and returning real VI data. Latest observations for 5 VI communities seen (Victoria/Saanich, WestShore, Duncan, Nanaimo/Parksville, Comox Valley); Port Alberni was NOT among latest observations in the bbox. Forecasts collection verified separately (different fields, no latest=true support).

- **Endpoint:** `https://api.weather.gc.ca/collections/aqhi-observations-realtime/items?f=json&bbox=-125.3,48.2,-123.1,51.1&latest=true&limit=50  (forecasts: https://api.weather.gc.ca/collections/aqhi-forecasts-realtime/items?f=json&bbox=-125.3,48.2,-123.1,51.1&limit=100&sortby=-publication_datetime)`
- **Auth:** none
- **Rate limits:** none published; fair use per ECCC Data Servers End-use Licence
- **License:** ECCC Data Servers End-use Licence v2.1 (royalty-free, perpetual, commercial use OK)
- **Attribution:** Data Source: Environment and Climate Change Canada
- **Cadence:** medium (10-15 min); AQHI values update hourly so faster polling is wasted
- **CORS:** Access-Control-Allow-Origin: * (observed)
- **Response shape:** GeoJSON FeatureCollection; obs properties: location_id, location_name_en/fr, observation_datetime, aqhi (float, e.g. 1.68 Victoria/Saanich), latest (bool), special_notes_en; geometry Point. Forecast properties: location_id, publication_datetime, forecast_datetime, aqhi (int), forecast_type. Station coords seen: Victoria/Saanich JBOBQ [-123.3667,48.4333], Duncan JBBWA [-123.7,48.7833], WestShore JCLMX [-123.4933,48.4236], Nanaimo/Parksville JAQAL [-123.9333,49.1667], Comox Valley JAHJY [-124.9833,49.6833]
- **Gotchas:** latest=true works on observations but returns 0 on forecasts (no 'latest' property there) - use sortby=-publication_datetime and dedupe per location_id/forecast_datetime instead. VI bbox also captures mainland stations (Metro Vancouver NW/SW, Squamish) since bbox east edge is -123.1; filter to VI location_ids: JBOBQ, JCLMX, JBBWA, JAQAL, JAHJY. No Port Alberni AQHI community currently reporting - that is a real coverage gap, not a query error.

### PurpleAir API v1 /sensors — `purpleair`

**T2 · NEEDS-KEY** — Endpoint live, confirmed 403 ApiKeyMissingError without key. Pricing is one-time 1,000,000 free points for new accounts (NOT a monthly grant, per the official API Pricing community post), then paid top-ups.

- **Endpoint:** `https://api.purpleair.com/v1/sensors?fields=name,latitude,longitude,pm2.5_10minute&nwlng=-125.3&nwlat=51.1&selng=-123.1&selat=48.2  (send header X-API-Key: <READ_KEY>)`
- **Auth:** free key with account: sign in at https://develop.purpleair.com/ (Developer Dashboard), create a Read key. New accounts get 1,000,000 points one-time. Top-ups: $10-$49 tier buys 100,000 points/USD, scaling to 1,000,000 points/USD at $5,000+. Sensor owners read their own sensors free.
- **Rate limits:** points-based metering rather than req/sec: /sensors costs 5 points base + per-row field cost (e.g. temperature field = 2 pts/sensor, so 100 sensors with one 2-pt field = 205 points). Keep fields minimal.
- **License:** PurpleAir ToS/Data License (api.purpleair.com terms); data is PurpleAir's, display permitted with attribution per their data license
- **Attribution:** PurpleAir (per PurpleAir Data License / ToS)
- **Cadence:** medium (5-15 min) for a VI bbox poll; sensors report ~2 min but each poll burns points - at ~205 pts per 100-sensor minimal query, the 1M free points sustain a 10-min cadence for months
- **CORS:** not checked (keyed endpoint); irrelevant server-side
- **Response shape:** without key: {api_version: 'V1.2.0-1.1.45', time_stamp, error: 'ApiKeyMissingError', description}. Documented keyed shape: {fields: [...], data: [[...]]} columnar arrays - not personally observed.
- **Gotchas:** Pricing moved to paid credits; the 'free monthly grant' framing is wrong - it is a one-time 1M point allocation for new accounts as of the API Pricing post (community.purpleair.com/t/api-pricing/4523). VI sensor density not verifiable without a key (the public map at map.purpleair.com suggests coverage in Victoria/Nanaimo/Comox but I could not query it). Use fields= aggressively; every extra field multiplies per-row cost.

### OpenAQ API v3 — `openaq`

**T2 · NEEDS-KEY** — Live, confirmed 401 with explicit message naming the X-API-Key header. Free key via explore.openaq.org/register (page confirmed 200). Docs confirm 60/min, 2000/hr free-tier limits.

- **Endpoint:** `https://api.openaq.org/v3/locations?coordinates=48.4284,-123.3656&radius=25000&limit=100  (send header X-API-Key: <key>)`
- **Auth:** free key: register at https://explore.openaq.org/register, key passed in X-API-Key header (header name confirmed from live 401 response body)
- **Rate limits:** 60 requests/minute, 2,000/hour (docs.openaq.org/using-the-api/rate-limits), scoped per key
- **License:** OpenAQ platform; underlying data from government monitors (CC BY 4.0 per OpenAQ docs)
- **Attribution:** OpenAQ and the underlying provider (for VI that is ECCC/BC ENV)
- **Cadence:** slow (30-60 min); VI stations it aggregates are hourly government monitors
- **CORS:** not checked (keyed endpoint)
- **Response shape:** without key: {message: 'Unauthorized. A valid API key must be provided in the X-API-Key header.'} - documented v3 shape is {meta, results: [{id, name, coordinates, sensors,...}]} but not personally observed
- **Gotchas:** For VI specifically, OpenAQ is largely a re-serving of the same ECCC/BC ENV monitors as bc-aqhi - useful as a normalized PM2.5/O3/NO2 layer and fallback, redundant for AQHI itself. Build bc-aqhi first.

### BC Drought Levels (ArcGIS FeatureServer, BC Drought Information Portal) — `bc-drought`

**T2 · VERIFIED** — Authoritative layer found and queried: layer 27 'BC_Current_Drought_Levels' on the EM.Drought-owned view service. Live VI values returned: East Vancouver Island = Level 4, West Vancouver Island = Level 3.

- **Endpoint:** `https://services1.arcgis.com/xeMpV7tU1t4KD3Ei/arcgis/rest/services/British_Columbia_Drought_Levels_(Edit)_view/FeatureServer/27/query?where=1%3D1&outFields=*&geometry=-125.3,48.2,-123.1,51.1&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=false&f=json`
- **Auth:** none
- **Rate limits:** none published (standard ArcGIS Online public service)
- **License:** CAUTION: item licenseInfo says 'Access Only' - Copyright Province of British Columbia, all rights reserved, 'provided for informational purposes only'. Fine to poll/display in a personal dashboard; do NOT redistribute or rehost the data.
- **Attribution:** Province of British Columbia, BC Drought Information Portal
- **Cadence:** slow (1-2x daily); Date_Modified showed updates roughly weekly (last ~Jun 4)
- **CORS:** not checked; ArcGIS Online typically sends ACAO:* but I did not observe it
- **Response shape:** Esri JSON: fields [OBJECTID, BasinName, DroughtLevel (int 0-5), Date_Modified (epoch ms), Comments, Shape__Area]; 9 basins intersect VI bbox incl. 'East Vancouver Island' (DroughtLevel 4), 'West Vancouver Island' (3), plus mainland basins (Sunshine Coast, Lower Mainland, etc.) from the envelope intersect - filter to the two VI BasinNames
- **Gotchas:** The drought layer is id 27, not 0 - querying /0 returns 400 Invalid URL. Service URL contains parentheses; keep them or URL-encode consistently. Discovered via ArcGIS item f1842161d9c2454a98f9fc3b45d5d92e ('British Columbia Drought Levels'). Returned set includes non-VI basins; match BasinName in ('East Vancouver Island','West Vancouver Island').

### ECCC Real-time Hydrometric (GeoMet OGC API) + BC River Forecast Centre advisories — `hydrometric`

**T2 · VERIFIED** — Hydrometric realtime verified with live 5-minute Cowichan data (LEVEL 0.268 m, DISCHARGE 7.25 m3/s). All four target station IDs confirmed Active via the stations collection: 08HA011 Cowichan, 08HB002 Englishman, 08HB006 Puntledge, 08HB017 Somass; 57 active stations total in the VI bbox. BC RFC advisories are HTML-only (no RSS found) with a broken cert chain for naive curl.

- **Endpoint:** `https://api.weather.gc.ca/collections/hydrometric-realtime/items?STATION_NUMBER=08HA011&f=json&limit=12&sortby=-DATETIME  (station discovery: https://api.weather.gc.ca/collections/hydrometric-stations/items?f=json&bbox=-125.3,48.2,-123.1,51.1&STATUS_EN=Active&limit=200 ; RFC advisories: https://bcrfc.env.gov.bc.ca/warnings/index.htm)`
- **Auth:** none
- **Rate limits:** none published; fair use
- **License:** ECCC Data Servers End-use Licence v2.1
- **Attribution:** Data Source: Environment and Climate Change Canada (Water Survey of Canada)
- **Cadence:** medium (10-15 min); timestamps are 5-min but DataMart ingestion arrives in batches roughly hourly - do not promise 5-min freshness
- **CORS:** Access-Control-Allow-Origin: * on api.weather.gc.ca (observed)
- **Response shape:** GeoJSON; properties: STATION_NUMBER, STATION_NAME, PROV_TERR_STATE_LOC, DATETIME (UTC), DATETIME_LST, LEVEL (m), DISCHARGE (m3/s), LEVEL_SYMBOL_EN/FR, DISCHARGE_SYMBOL_EN/FR. Confirmed VI stations + coords: 08HA011 [-123.7145,48.7731], 08HB002 [-124.2853,49.3161], 08HB006 [-125.0342,49.6880], 08HB017 [-124.8550,49.2764]; also useful: 08HA002 Cowichan at Lake Cowichan, 08HA003 Koksilah, 08HD011 Oyster, 08HB011 Tsolum, 08HB084 Puntledge below diversion
- **Gotchas:** realtime collection only holds a rolling ~30-day window. DISCHARGE can be null for lake-level stations (08HA009). BC RFC (bcrfc.env.gov.bc.ca) serves an incomplete TLS chain - plain curl fails cert verification (needed -k locally); a Convex server-side fetch may also fail depending on runtime CA handling, and there is no RSS - flood advisories require scraping the HTML table on /warnings/index.htm. The only XML link on that page points at a legacy BC air-quality table, not floods.

### NOAA CoastWatch ERDDAP - MUR SST + VIIRS Chlorophyll — `sst-chlorophyll`

**T2 · VERIFIED** — MUR SST griddap subset over VI waters returned real values (11.9-12.4 C on 2026-06-10). Chlorophyll dataset IDs confirmed present on the same ERDDAP via live search: nesdisVHNSQchlaDaily (science quality) and nesdisVHNnoaa20chlaDaily (NRT).

- **Endpoint:** `https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.json?analysed_sst%5B(last)%5D%5B(48.2):20:(51.1)%5D%5B(-125.3):20:(-123.1)%5D`
- **Auth:** none
- **Rate limits:** none published; ERDDAP asks for considerate use - keep subsets small/strided
- **License:** NOAA CoastWatch open data; MUR SST is NASA JPL MEaSUREs (open, citation requested)
- **Attribution:** NOAA CoastWatch West Coast Node; JPL MUR MEaSUREs Project (SST); NOAA STAR (VIIRS chlorophyll)
- **Cadence:** slow (daily); both products are daily composites - poll once or twice a day
- **CORS:** no Access-Control-Allow-Origin header observed on coastwatch.pfeg.noaa.gov - browser-direct would fail, fine server-side
- **Response shape:** ERDDAP .json table: columnNames [time, latitude, longitude, analysed_sst], columnUnits [UTC, degrees_north, degrees_east, degree_C], rows of [iso-time, lat, lon, value-or-null]; nulls over land and inner inlets. (last) resolved to 2026-06-10T09:00Z, i.e. ~1 day latency. Stride syntax [(start):N:(stop)] works on lat/lon
- **Gotchas:** URL-encode the brackets. MUR is 0.01-degree - an unstrided VI bbox is ~85k points; always stride (e.g. :20:). Tofino reference point sits just west of the bbox; extend the lon range to -126.2 if you want proper offshore coverage. For chlorophyll, hit https://coastwatch.pfeg.noaa.gov/erddap/info/nesdisVHNSQchlaDaily/index.json first to confirm the variable name before templating the griddap URL (I confirmed the dataset exists but did not pull its variable list). Persistent cloud gaps in chlorophyll on the west coast - consider the gap-filled DINEOF variant (nesdisVHNnoaaSNPPnoaa20NRTchlaGapfilledDaily).

### Sunrise-Sunset.org + Where The ISS At + (dead) Open Notify pass-times — `astronomy`

**T2 · VERIFIED** — sunrise-sunset.org and wheretheiss.at both verified live with real data. Open Notify iss-pass.json confirmed dead (404 from nginx). Compute sun/moon locally with suncalc; for ISS pass predictions use satellite.js + CelesTrak TLEs instead of any pass-times API.

- **Endpoint:** `https://api.sunrise-sunset.org/json?lat=48.43&lng=-123.36&formatted=0  and  https://api.wheretheiss.at/v1/satellites/25544`
- **Auth:** none for both
- **Rate limits:** sunrise-sunset: no hard number, 'reasonable request volume' only; wheretheiss: ~1 request/second, watch X-Rate-Limit response headers
- **License:** sunrise-sunset: free with mandatory attribution; wheretheiss: free, no formal terms published
- **Attribution:** sunrise-sunset.org requires a visible link ('We require that you show attribution to us with a link to our site'); wheretheiss.at courtesy credit
- **Cadence:** sunrise-sunset: slow (once daily per location, values change once a day). wheretheiss: fast (60s catalog cadence; can go to ~5-10s within the 1/sec limit if animating a live track)
- **CORS:** Access-Control-Allow-Origin: * observed on both
- **Response shape:** sunrise-sunset: {results: {sunrise, sunset, solar_noon, day_length (sec), civil/nautical/astronomical_twilight_begin/end - ISO8601 UTC with formatted=0}, status, tzid}. wheretheiss: {name, id, latitude, longitude, altitude (km), velocity (km/h), visibility ('daylight'/'eclipsed'), footprint, timestamp, daynum, solar_lat, solar_lon, units}
- **Gotchas:** Open Notify http://api.open-notify.org/iss-pass.json is gone (404) - do not build on it. sunrise-sunset without formatted=0 returns 12-hour strings in UTC, a classic bug source. Strong recommendation: suncalc (npm) gives sunrise/sunset/twilights/moon phase/moonrise offline with no rate limits or attribution burden - use the API only as a cross-check; same for ISS passes via satellite.js + https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle

### NASA GIBS WMTS true-color imagery — `nasa-gibs`

**T3 · VERIFIED** — Live tile fetched over VI: VIIRS SNPP true color for 2026-06-10 returned 200 image/jpeg (18,764 bytes) with no auth. Standard REST template confirmed against current docs.

- **Endpoint:** `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/2026-06-10/GoogleMapsCompatible_Level9/6/21/9.jpg  (template: .../wmts/epsg3857/best/{Layer}/default/{YYYY-MM-DD}/{TileMatrixSet}/{z}/{y}/{x}.jpg ; z6/y21/x9 covers VI)`
- **Auth:** none (no Earthdata login needed for WMTS tiles)
- **Rate limits:** none published
- **License:** NASA open imagery; freely usable
- **Attribution:** Acknowledge NASA Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS) - exact boilerplate not on the docs page I fetched, but attribution to 'NASA GIBS / Worldview' is the documented expectation
- **Cadence:** slow (1-2x daily); imagery is daily - today's VI overpass appears mid-late afternoon local, so default to yesterday's date for guaranteed coverage
- **CORS:** Access-Control-Allow-Origin: * observed - tiles can load directly in MapLibre as a raster source
- **Response shape:** JPEG tile bytes (image/jpeg). Note WMTS path order is TileMatrix/TileRow/TileCol = z/y/x, not z/x/y
- **Gotchas:** Requesting a date before the overpass yields black/empty tiles, not an error. MODIS_Terra_CorrectedReflectance_TrueColor is the alternate layer (earlier overpass ~10:30 local). GoogleMapsCompatible_Level9 caps at z9 for these layers - plenty for an island-scale view.

### UV index (ECCC citypage) + pollen (commercial-only verdict) — `uv-pollen`

**T3 · VERIFIED** — UV: solved and verified - ECCC citypageweather-realtime carries a structured numeric UV index, both daily (forecastGroup.forecasts[].uv.index) and hourly (hourlyForecastGroup.hourlyForecasts[].uv.index.value); saw UV 8 'very high' for Victoria Harbour. Pollen: honest verdict is commercial-only for Canada - no free legal feed exists.

- **Endpoint:** `https://api.weather.gc.ca/collections/citypageweather-realtime/items?f=json&bbox=-123.5,48.3,-123.2,48.5&limit=1`
- **Auth:** none
- **Rate limits:** none published; fair use
- **License:** ECCC Data Servers End-use Licence v2.1
- **Attribution:** Data Source: Environment and Climate Change Canada
- **Cadence:** slow (30-60 min); citypage refreshes with each forecast issuance, a few times daily
- **CORS:** Access-Control-Allow-Origin: * (api.weather.gc.ca, observed)
- **Response shape:** citypage feature properties: lastUpdated, identifier, name{en,fr}, region, currentConditions, forecastGroup, hourlyForecastGroup, warnings, riseSet. UV paths confirmed: forecastGroup.forecasts[i].uv = {index:{en:'8'}, category:{en:'very high'}, textSummary} (daytime periods only) and hourlyForecastGroup.hourlyForecasts[i].uv.index.value.en (numeric int per hour). riseSet has sunrise/sunset too
- **Gotchas:** UV object is absent on nighttime forecast periods (forecasts[1] had none) - guard for missing key. Open-Meteo hourly uv_index (verified, see open-meteo entry) is a good numeric cross-check. POLLEN: Aerobiology Research Laboratories runs the only Canadian monitoring network (~30 stations) and licenses it commercially (The Weather Network etc.); API options are paid only (Ambee, Google Pollen API). Scraping The Weather Network's pollen pages would violate their ToS. Recommendation: drop pollen from Phase 0 or budget for a paid API; do not fake it with model data.

### Open-Meteo Forecast + Air Quality API — `open-meteo`

**T2 · VERIFIED · NEW** — No-key API verified live for Victoria: hourly uv_index/daily uv_index_max on the forecast endpoint, and pm2_5/us_aqi on the air-quality endpoint. Cleanly fills the UV gap and provides a smoke-plume model layer (CAMS) during fire season.

- **Endpoint:** `https://api.open-meteo.com/v1/forecast?latitude=48.4284&longitude=-123.3656&hourly=uv_index&daily=uv_index_max&forecast_days=2&timezone=America%2FVancouver  (air quality: https://air-quality-api.open-meteo.com/v1/air-quality?latitude=48.4284&longitude=-123.3656&hourly=pm2_5,us_aqi&forecast_days=1)`
- **Auth:** none for non-commercial use
- **Rate limits:** free tier: 10,000 calls/day, non-commercial use only (per open-meteo.com terms)
- **License:** Open data under CC BY 4.0; free API for non-commercial projects
- **Attribution:** Weather data by Open-Meteo.com (CC BY 4.0)
- **Cadence:** slow (30-60 min); model output updates hourly at best
- **CORS:** no ACAO header observed on my curl (no Origin sent); Open-Meteo documents browser CORS support - irrelevant for Convex server-side anyway
- **Response shape:** {latitude, longitude, generationtime_ms, utc_offset_seconds, timezone, elevation, hourly_units:{uv_index:''} / {pm2_5:'ug/m3', us_aqi:'USAQI'}, hourly:{time:[ISO8601...], uv_index:[...]} } - parallel arrays keyed by time
- **Gotchas:** This is MODEL data (ECMWF/GFS blend; CAMS for air quality), not observations - label it as forecast/model in the UI and never present its PM2.5 as a measured reading next to PurpleAir/ECCC monitors. Snapped grid point returned (48.419,-123.374), ~1 km off the requested coords - normal.

### NDBC realtime2 - La Perouse Bank buoy 46206 (ECCC buoy via NOAA) — `ndbc-46206`

**T2 · VERIFIED · NEW** — Live fixed-width text feed verified: hourly wind, wave height/period, pressure, air temp, and water temp (WTMP 12.5 C) at La Perouse Bank, offshore Tofino - exactly the just-west-of-bbox marine coverage the brief flags. Sister buoy 46204 (West Sea Otter) covers the north end.

- **Endpoint:** `https://www.ndbc.noaa.gov/data/realtime2/46206.txt`
- **Auth:** none
- **Rate limits:** none published; NDBC asks no more than ~once every few minutes per file - hourly data anyway
- **License:** US Government public domain (NOAA), underlying buoy operated by ECCC
- **Attribution:** NOAA NDBC / Environment and Climate Change Canada
- **Cadence:** slow (30-60 min); buoy reports hourly
- **CORS:** no Access-Control-Allow-Origin header observed; server-side fetch fine
- **Response shape:** fixed-width text, 2 header lines (#YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE / units line), then newest-first hourly rows; 'MM' = missing value. Saw real rows: 2026-06-11 12:00 WSPD 2.0 m/s, WVHT 1.5 m, PRES 1023.4 hPa, ATMP 11.9 C, WTMP 12.5 C
- **Gotchas:** Parse fixed-width carefully and treat MM as null; several columns (MWD, DEWP, VIS, TIDE) are permanently MM on this buoy. WTMP here is a real measured SST point to validate the MUR satellite layer. Buoy position ~48.84,-126.0 - just outside the formal bbox, include it deliberately.

### ECCC SWOB Realtime surface observations (GeoMet OGC API) — `eccc-swob`

**T2 · VERIFIED · NEW** — Minute-resolution official surface weather observations verified for VI: SAANICHTON CFIA reporting air_temp 9.3 C at 12:35Z, fetched at 12:39Z (~4 min latency). Gives the dashboard true current conditions (temp/RH/wind/precip) from sanctioned stations, with QA flags, on the same API family as AQHI/hydrometric.

- **Endpoint:** `https://api.weather.gc.ca/collections/swob-realtime/items?f=json&bbox=-125.3,48.2,-123.1,51.1&limit=20&sortby=-date_tm-value`
- **Auth:** none
- **Rate limits:** none published; fair use
- **License:** ECCC Data Servers End-use Licence v2.1
- **Attribution:** Data Source: Environment and Climate Change Canada
- **Cadence:** fast-medium (2-5 min) if showing live conditions; the data itself is 1-minute resolution
- **CORS:** Access-Control-Allow-Origin: * (api.weather.gc.ca, observed)
- **Response shape:** GeoJSON; ~230 flat properties per feature in <element>-value/-uom/-qa triplets: stn_nam-value, date_tm-value, air_temp (9.3) + air_temp-uom ('degC') + air_temp-qa (100), rel_hum, max/min_rel_hum_pst1mt, wind/precip fields vary by station type; geometry Point [lon,lat,elev]. 583,703 items matched the bare VI bbox query - a rolling multi-day archive, not just latest
- **Gotchas:** Huge collection - NEVER query bbox alone for 'current' state; constrain with datetime (e.g. &datetime=2026-06-11T12:30:00Z/..) or stn_nam/wmo_synop_id per station and small limit, else you page through hundreds of thousands of rows. Property names are SWOB element names, not friendly keys; the -qa companion (100 = good) should gate display. Discover VI stations via the swob-stations collection.

### Avalanche Canada Forecast API (api.avalanche.ca) — `avalanche-canada`

**T3 · VERIFIED · NEW** — Verified live in off-season: GET /forecasts/en/products/point?lat=49.7&long=-125.4 returned 200 with an avalancheforecast product whose title explicitly includes North Island, South Island, East Island and West Island (VI regions folded into a BC-wide spring statement). June behavior confirmed: it does NOT 404 off-season, it returns a 'Spring Conditions' product (dateIssued 2026-04-27, validUntil 2026-06-30) with dangerRatings valued 'spring'/'Spring Conditions' and confidence 'noRating', plus a pointer to the Spring Conditions page. In season (roughly late Nov to late Apr) the same shape carries real daily alp/tln/btl danger ratings.

- **Endpoint:** `https://api.avalanche.ca/forecasts/en/products/point?lat={lat}&long={lng} (point lookup). Also verified: /forecasts/en/products (all current products) and /forecasts/en/areas (GeoJSON MultiPolygons with bbox per area).`
- **Auth:** None
- **Rate limits:** None published. CloudFront-cached (x-cache: Hit, age header observed), so polite polling costs them almost nothing.
- **License:** No license/terms page verified (https://www.avalanche.ca/pages/static-page/terms-of-use 404s). API is open and unauthenticated. Treat as attribution-required, non-commercial-safe; contact Avalanche Canada if this ever goes beyond personal use.
- **Attribution:** Display 'Avalanche Canada' (the report.forecaster field) and link the report.url forecast page.
- **Cadence:** slow (30-60 min+). In season forecasts are issued once daily (~afternoon PT); off-season the product is static until validUntil. Even 2-4 h polling would be honest.
- **CORS:** Access-Control-Allow-Origin: * (verified with an Origin header request).
- **Response shape:** JSON product: {id, slug, url, type:'avalancheforecast', area:{id,name,bbox}, report:{forecaster, dateIssued, validUntil, timezone, title, highlights (HTML), confidence:{rating}, summaries:[{type:{value,display}, content (HTML)}] (snowpack-summary, weather-summary), dangerRatings:[{date, ratings:{alp,tln,btl each {display, rating:{value,display}}}}]}}. An avalanche problems list was not present in the off-season payload inspected; expect it in-season but unverified.
- **Gotchas:** 1) Query param is long, not lon/lng. 2) Area ids/names are opaque sha256-looking hashes off-season; the human-readable region names live in report.title. 3) highlights/summaries contain HTML, sanitize before render. 4) Seasonality: from ~May to Nov this layer is essentially a static spring/off-season notice; consider hiding or badging it off-season instead of showing stale 'spring' ratings. 5) For VI-specific polygons in season, /forecasts/en/areas gives geometry to clip to the bbox.

### BC River Forecast Centre Flood Advisories/Warnings — `bc-rfc-advisories`

**T1 · VERIFIED · NEW** — Verified live. The warnings web page is HTML+PDF only (and has a broken TLS chain), but the province publishes the same advisory state as a public ArcGIS FeatureServer with coded basin-level advisory levels and CORS *. Query Major_Basin LIKE '%Vancouver Island%' for the 5 VI basins.

- **Endpoint:** `https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/BC_Flood_Advisory_and_Warning_Notifications_(Public_View)/FeatureServer/0/query?where=Major_Basin+LIKE+'%25Vancouver+Island%25'&outFields=*&f=json (human page: https://bcrfc.env.gov.bc.ca/warnings/)`
- **Auth:** None for the ArcGIS public-view FeatureServer.
- **Rate limits:** Standard ArcGIS Online public service limits (unpublished, generous). maxRecordCount 2000; full layer is only 264 basin rows.
- **License:** BC Crown copyright via the BC government ArcGIS Online org (ubm4tcTYICKBpist); no explicit OGL-BC statement on the service (copyrightText empty). Attribute BC River Forecast Centre / Province of British Columbia.
- **Attribution:** BC River Forecast Centre, Province of British Columbia
- **Cadence:** medium (15 min). Advisory state changes are infrequent but time-critical during atmospheric rivers/freshet.
- **CORS:** access-control-allow-origin: * on the ArcGIS endpoint (verified in response headers).
- **Response shape:** ArcGIS FeatureServer layer 0 'Flood_Advisory_and_Warning_Notifications_S', esriGeometryPolygon (Web Mercator 102100). Attributes: Major_Basin, Sub_Basin, Basin_Type (N=Major Basin, Y=Sub-Basin), Advisory coded-value domain {1: No Advisory, 2: High Streamflow Advisory, 3: Flood Watch, 4: Flood Warning}, Date_Modified (epoch ms), Comments. f=json or f=geojson; returnGeometry=false for cheap status polls.
- **Gotchas:** The bcrfc.env.gov.bc.ca/warnings/ HTML page itself has NO machine-readable feed — only a DataTables HTML page linking PDF advisories (FWT_/HSA_*.pdf naming). Worse, the server has a broken TLS chain (missing Entrust intermediate; curl fails without -k even though the cert is valid to Sep 2026) — avoid it for ingestion. The ArcGIS layer is the real feed the public flood map uses. VI basins verified present: Northern/Central/Eastern/Southern/Western Vancouver Island plus named sub-basins (Cowichan River Near Duncan, Englishman River Near Parksville, San Juan River Near Port Renfrew, etc.); all Advisory=1 at verify time. Polygons are large; pull geometry once and poll attributes only.

## Space (Objects)

> Cluster is in good shape: 8 of 9 entries verified with live requests today; only n2yo needs a key, and it is honestly optional because CelesTrak GP + satellite.js 7.0.1 (MIT, confirmed) computes positions and passes locally with zero rate-limit exposure - that combo should be the core. Recommended build order: (1) celestrak + satellite.js ground tracks/overhead-now over the VI bbox (filter the 4.5 MB / 10,545-object Starlink group server-side in Convex before shipping to the browser; this is the main perf trap), (2) wheretheiss-at as the ISS quick win, (3) launch-library upcoming-launches widget (Vandenberg launches are occasionally visible from south VI), (4) nasa-neo or jpl-ssd-cad daily digest - prefer jpl-ssd-cad since it needs no key; if using NeoWs, register a real api.nasa.gov key because DEMO_KEY's observed limit header was 10, not the 30/hr older docs claim, (5) Lorenz 2024 light-pollution overlay (static, CORS *, but custom 1024px/zoom-offset tile scheme needs MapLibre adaptation; the catalog's lp2022 URL is deprecated - new path is /astronomy/lp/ and a 2024 atlas now exists), (6) aurora-cam panel, seasonal-gated. Legal caveats to settle early: CelesTrak has no formal license but now actively enforces polling etiquette (warning responses for premature same-GROUP re-downloads since Mar 2026, firewall blocks for error spam) - build the 2h-minimum cron and timestamp check from day one; Lorenz atlas has no formal license (attribute, never label it Bortle, email author if redistribution ever matters); lightpollutionmap.info tiles are NOT usable without a personal arrangement with the owner - excluded for scraping, Lorenz covers the need; SatNOGS is CC-BY-SA (share-alike if re-exported). Gaps: no sanctioned all-sky cam exists on Vancouver Island itself - nearest institutional cams are Yellowknife/Fairbanks/Churchill sentinels, all seasonal Aug-Apr and useless in June; and authoritative conjunction/reentry data (Space-Track.org TIP messages) requires a free account with redistribution-restricted ToS, which I did not create per rules - worth a deliberate decision later if reentry tracking matters.

### CelesTrak GP Elements (TLE/OMM) — `celestrak`

**T2 · VERIFIED** — Live and healthy. Stations group returned 200 with full GP JSON (ISS epoch 2026-06-11). Starlink group is large: 10,545 objects, 4,457,335 bytes (~4.5 MB), ~3.1s download. satellite.js 7.0.1 (MIT) confirmed on npm as the propagation lib.

- **Endpoint:** `https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json (Starlink: https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=json)`
- **Auth:** none
- **Rate limits:** Etiquette-enforced, now with active 2026 enforcement: data refreshes only once every 2h, so never poll faster. As of Feb 2026, 50 HTTP errors (301/403/404) within 2h triggers a firewall block; as of Mar 26 2026, re-downloading the same GROUP before it updates returns a warning response instead of data; >100 MB/day can get you firewalled.
- **License:** No explicit license; 'freely available to all users' per CelesTrak docs. No stated redistribution restriction. Courteous attribution: CelesTrak / Dr. T.S. Kelso.
- **Attribution:** CelesTrak (celestrak.org), Dr. T.S. Kelso
- **Cadence:** slow: poll each GROUP at most every 2h; 2x daily is plenty since propagation is done locally with satellite.js. Convex cron every 6h recommended, check before re-fetching.
- **CORS:** Access-Control-Allow-Origin: * observed when an Origin header is sent (verified on starlink request). Header absent without Origin. Irrelevant for Convex server-side polling.
- **Response shape:** JSON array of GP objects: OBJECT_NAME, OBJECT_ID, EPOCH, MEAN_MOTION, ECCENTRICITY, INCLINATION, RA_OF_ASC_NODE, ARG_OF_PERICENTER, MEAN_ANOMALY, EPHEMERIS_TYPE, CLASSIFICATION_TYPE, NORAD_CAT_ID, ELEMENT_SET_NO, REV_AT_EPOCH, BSTAR, MEAN_MOTION_DOT, MEAN_MOTION_DDOT
- **Gotchas:** Starlink JSON is 4.5 MB / 10.5k objects; propagating all of them client-side in deck.gl every frame is the real perf risk; use a web worker and/or filter to objects whose ground track intersects the VI bbox. Stations group response had duplicate-looking element values across ISS modules (same epoch/elements for attached modules; normal). CelesTrak runs on IIS/PHP and is a one-man operation; cache aggressively and respect the 2h rule or get blocked.

### N2YO REST API v1 (passes/above/positions) — `n2yo`

**T3 · NEEDS-KEY** — API gateway confirmed live: unauthenticated request to /tle/25544 returned HTTP 200 {"error":"No API Key provided"}. Cannot verify data without a key (no signups allowed). Note: the docs page currently carries a banner 'API is currently down for maintenance and upgrade' yet the endpoint responds, so the banner may be stale; re-check after getting a key.

- **Endpoint:** `https://api.n2yo.com/rest/v1/satellite/visualpasses/25544/48.4284/-123.3656/20/7/300/&apiKey=YOUR_KEY (others: /tle/{id}, /positions/{id}/{lat}/{lng}/{alt}/{seconds}, /radiopasses/{id}/{lat}/{lng}/{alt}/{days}/{min_elevation}, /above/48.4284/-123.3656/20/70/0/&apiKey=YOUR_KEY). Note the odd '/&apiKey=' appending convention from their docs.`
- **Auth:** free key: register at https://www.n2yo.com/login/register/ (page verified 200), then profile page has a button to generate the API key. Key is fixed once generated.
- **Rate limits:** Per docs page (hourly transaction limits per key): tle 1000, positions 1000, visualpasses 100, radiopasses 100, above 100. Explicitly forbids multiple keys to evade limits; traffic monitored, abusers blocked.
- **License:** Free for building tracking/prediction apps per API page; site has Terms of Use page. No explicit redistribution grant; treat as display-only.
- **Attribution:** n2yo.com (courteous; not formally mandated on API page)
- **Cadence:** slow: visualpasses/radiopasses change only when TLEs do; 1-2 calls per day per tracked satellite, or on-demand. 'above' for the VI sky could run medium (10-15 min) within the 100/hr budget.
- **CORS:** Not testable meaningfully without key; server-side polling anyway.
- **Response shape:** Only saw {"error":"No API Key provided"} live. Documented (not seen): info{satname,satid,transactionscount} plus passes[]/positions[] arrays.
- **Gotchas:** Largely redundant once CelesTrak + satellite.js are in place (you can compute passes locally for free with no rate limits). Treat n2yo as optional convenience. 'Maintenance' banner on docs is a yellow flag for reliability.

### Launch Library 2 (The Space Devs) — `launch-library`

**T3 · VERIFIED** — Live at version 2.3.0 (current path confirmed). Returned 200 with 369 upcoming launches; first result was a Rocket Lab HASTE launch with full status/window/provider/mission detail.

- **Endpoint:** `https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=3`
- **Auth:** none for free tier; optional API key via Patreon supporter tiers for higher rates
- **Rate limits:** 15 requests/hour unauthenticated (confirmed on https://thespacedevs.com/llapi). Cloudflare-fronted; throttle responses are HTTP 429.
- **License:** Copyright TheSpaceDevs; free tier explicitly offered at no cost. No formal attribution mandate found, but they request credit; images carry their own per-image license objects in the response.
- **Attribution:** Data: The Space Devs / Launch Library 2 (courteous, recommended)
- **Cadence:** slow: 30-60 min. At 15 req/hr you cannot poll faster than 4 min anyway; launch schedules rarely move minute-to-minute except on launch day.
- **CORS:** No ACAO observed without Origin; 'Vary: origin' header present so CORS is negotiated dynamically. Server-side polling makes this moot.
- **Response shape:** {count, next, previous, results:[{id, url, name, response_mode, slug, status{id,name,abbrev,description}, last_updated, net, net_precision, window_start, window_end, image{image_url,thumbnail_url,license}, probability, weather_concerns, launch_service_provider{name,abbrev,type}, rocket{configuration{name,full_name}}, mission{name,type,description,orbit}}]}
- **Gotchas:** Filter to relevant launches (e.g. Vandenberg polar launches sometimes visible from VI at dusk; pad coordinates are in the full launch object). 15/hr is shared per IP; if other BlindSpot clusters also hit TSD APIs, budget centrally. 'net' is the canonical time field, with net_precision telling you how much to trust it.

### NASA NeoWs (Near Earth Object Web Service) — `nasa-neo`

**T3 · VERIFIED** — Live with DEMO_KEY: 200 response, element_count 9 for a 1-day window, full NEO detail per date. Observed x-ratelimit-limit: 10 on DEMO_KEY (lower than the historically documented 30/hr, so DEMO_KEY budget is tighter than older docs claim).

- **Endpoint:** `https://api.nasa.gov/neo/rest/v1/feed?start_date=2026-06-10&end_date=2026-06-11&api_key=DEMO_KEY`
- **Auth:** DEMO_KEY works for testing (observed limit header: 10, remaining decremented per request). Free registered key: signup form at https://api.nasa.gov (name + email, instant); registered keys documented at 1000 req/hr (not verified, no key).
- **Rate limits:** Observed with DEMO_KEY: x-ratelimit-limit: 10, x-ratelimit-remaining: 7 after 1 request (window not stated in headers; docs say hourly). Registered key documented 1000/hr.
- **License:** US Government / NASA data, effectively public domain. No restrictions.
- **Attribution:** NASA/JPL NeoWs (courteous)
- **Cadence:** slow: data is daily-granular; one fetch per day (or every 6h) is correct. Never poll fast: you would burn the key budget for zero new data.
- **CORS:** Access-Control-Allow-Origin: * (verified in response headers)
- **Response shape:** {links{next,previous,self}, element_count, near_earth_objects:{"YYYY-MM-DD":[{id, neo_reference_id, name, nasa_jpl_url, absolute_magnitude_h, estimated_diameter{kilometers,meters,miles,feet}, is_potentially_hazardous_asteroid, close_approach_data[...]}]}}
- **Gotchas:** Max 7-day date range per feed request. links.next/previous use http:// not https:// in the payload (rewrite before following). Get a real key before launch; DEMO_KEY's observed limit of 10 is shared per-IP and will exhaust instantly in production.

### David Lorenz Light Pollution Atlas tiles (2016/2020/2022/2023/2024) — `light-pollution`

**T3 · VERIFIED** — Usable and verified, with a catch: the lp2022 URLs in the catalog are DEPRECATED (meta-refresh to new path). Canonical viewer is now https://djlorenz.github.io/astronomy/lp/overlay/dark.html and there is a newer 2024 atlas. Fetched a real 2024 tile covering Victoria: 200 image/png, 45,312 bytes, ACAO *.

- **Endpoint:** `https://djlorenz.github.io/astronomy/image_tiles/tiles2024/tile_{z}_{x}_{y}.png (verified sample over Victoria/south VI: https://djlorenz.github.io/astronomy/image_tiles/tiles2024/tile_6_10_22.png; transparent-black fallback tile: .../tiles2024/black.png)`
- **Auth:** none (static GitHub Pages)
- **Rate limits:** None published; GitHub Pages soft limits apply (100 GB/mo bandwidth per site). Tiles are static; cache-control max-age=600 observed. Cache locally/proxy through Convex storage to be polite.
- **License:** No formal license stated anywhere on the atlas pages. Author makes it freely viewable, explicitly references sites that 'copied my data', and his one stated request is: do NOT label the maps as the Bortle Scale (they model zenith artificial brightness, not Bortle). Input data: VIIRS via Earth Observation Group, Colorado School of Mines. Honest verdict: fine for a personal/single-operator tool with attribution; for anything redistributed commercially, email the author. By contrast, lightpollutionmap.info tiles are NOT freely embeddable: attribution to 'Jurij Stare, www.lightpollutionmap.info' is required, tile/WMTS reuse needs a personal arrangement with the owner ('contact me and we'll work something out'), so treat that site as off-limits for tile scraping and use Lorenz instead.
- **Attribution:** "Light pollution atlas (2024) by David Lorenz, djlorenz.github.io/astronomy/lp/" and do not call it Bortle
- **Cadence:** n/a (static; atlas updates roughly annually). Fetch tiles on demand, cache hard.
- **CORS:** Access-Control-Allow-Origin: * (verified on tile fetch)
- **Response shape:** 1024x1024 PNG overlay tiles, semi-transparent color ramp. NOT standard 256px slippy scheme: Leaflet config on the official page uses tileSize:1024, zoomOffset:-2, maxNativeZoom:8, i.e. URL z runs 0-6 where url_z = standard_slippy_z at 1024px. tile_6_10_22 covers the Victoria area. minZoom 2 on the viewer.
- **Gotchas:** MapLibre integration needs the custom scheme: declare the raster source with tileSize:1024 and remap zoom (equivalent of Leaflet's zoomOffset:-2), or pre-slice to 256px tiles in a one-off script. Missing-ocean tiles 404 (use black.png as error tile). Old lp2022 paths still resolve via meta-refresh but will rot; use /astronomy/image_tiles/ paths directly.

### Sanctioned aurora / all-sky cameras (upstream sentinels) — `aurora-cams`

**T3 · VERIFIED** — No sanctioned all-sky cam exists on Vancouver Island itself (searched; nothing university/observatory-run found). Best legal play is upstream sentinel cams in the auroral oval that light up hours before a storm reaches VI latitudes. AuroraMAX direct image endpoint verified live: 200 image/jpeg ~86 KB with Last-Modified current to the minute, ACAO *.

- **Endpoint:** `https://auroramax.phys.ucalgary.ca/recent/recent_480p.jpg (verified; official viewer https://auroramax.com/live). Candidates list: (1) AuroraMAX, Yellowknife NWT - owner: Canadian Space Agency + University of Calgary + Astronomy North + City of Yellowknife; direct JPEG above, updates ~6 s at night, season Aug-Apr, embed: image hotlink works with CORS *, official site encourages public viewing. (2) UAF Geophysical Institute Allsky Camera, Poker Flat AK - owner: University of Alaska Fairbanks; viewer https://allsky.gi.alaska.edu/ (verified 200), latest-image URL is JS-driven (my latest.jpg guesses 404ed; scrape the page or embed it), winter-season only. (3) explore.org Northern Lights Cam, Churchill MB - owner: explore.org with Polar Bears International/Churchill Northern Studies Centre; delivered as official YouTube live, embeddable via standard YouTube iframe, seasonal.`
- **Auth:** none
- **Rate limits:** None published for AuroraMAX image; it regenerates ~6 s at night. Be polite: this is a public-outreach server.
- **License:** AuroraMAX is a public CSA/UCalgary outreach project intended for live public viewing; hotlinking the recent image for personal dashboard use is in keeping with the project's purpose, but images are copyright the project (credit 'AuroraMAX / Canadian Space Agency / University of Calgary'); contact UCalgary for redistribution. explore.org embeds are sanctioned via YouTube embed. UAF: embed/landing-page link, do not rehost.
- **Attribution:** AuroraMAX / Canadian Space Agency / University of Calgary; UAF Geophysical Institute; explore.org
- **Cadence:** medium (5-15 min thumbnail refresh) normally; burst to fast (60-120 s) only during an active geomagnetic alert. Honest limitation: ALL of these are seasonal (roughly Aug/Sep-Apr) and dark-hours-only; in June (now) AuroraMAX still serves a fresh image but it is daylight/no-aurora content. Gate the panel on season + solar elevation.
- **CORS:** AuroraMAX image: Access-Control-Allow-Origin: * (verified). Cache-Control: no-store.
- **Response shape:** JPEG all-sky frame (480p variant verified, 86,468 bytes); Last-Modified header reflects frame time.
- **Gotchas:** These cams are 1,500-2,400 km north of VI; they are early-warning sentinels, not local truth. Aurora is visible from VI only during strong (Kp 6+) storms. Do not use unsanctioned hobbyist cams or random RTSP streams; the three above are institutionally owned.

### Where The ISS At? (live ISS position) — `wheretheiss-at`

**T3 · VERIFIED · NEW** — Clean, free, live ISS position JSON with generous explicit rate limits in headers. Verified 200 with real-time lat/lon/alt/velocity/visibility.

- **Endpoint:** `https://api.wheretheiss.at/v1/satellites/25544 (TLE variant: https://api.wheretheiss.at/v1/satellites/25544/tles)`
- **Auth:** none
- **Rate limits:** Explicit headers observed: X-Rate-Limit-Limit: 350, X-Rate-Limit-Interval: 5 minutes (~1.16 req/s allowed).
- **License:** Free API; site requests attribution/link per its developer page. No formal license text.
- **Attribution:** wheretheiss.at
- **Cadence:** fast (60-120 s) is fine and well within limits; honestly you only need it as a cross-check since you'll propagate ISS locally from CelesTrak GP anyway.
- **CORS:** Access-Control-Allow-Origin: * (verified)
- **Response shape:** {name, id, latitude, longitude, altitude, velocity, visibility('daylight'/'eclipsed'), footprint, timestamp, daynum, solar_lat, solar_lon, units}
- **Gotchas:** Single-satellite scope (ISS + a few others by NORAD id). Server runs old Apache/PHP 5.3 stack: works, but don't build anything critical on it; treat as a quick-win demo layer for ISS-over-VI.

### NASA/JPL SBDB Close-Approach Data API — `jpl-ssd-cad`

**T3 · VERIFIED · NEW** — Key-free, rate-limit-friendly alternative/complement to NeoWs for asteroid close approaches. Verified 200: 11 close approaches within 0.05 au over the next month, API version 1.5.

- **Endpoint:** `https://ssd-api.jpl.nasa.gov/cad.api?dist-max=0.05&date-min=2026-06-11&date-max=2026-07-11&sort=date`
- **Auth:** none
- **Rate limits:** None published; JPL asks for reasonable use. One fetch/day needs nothing more.
- **License:** NASA/JPL, US Government work, public domain. Cite 'NASA/JPL SBDB Close Approach Data API'.
- **Attribution:** NASA/JPL SBDB Close Approach Data API
- **Cadence:** slow: daily cron.
- **CORS:** No Access-Control-Allow-Origin header observed (sent Origin; none returned). Server-side polling required for browser use - which BlindSpot does anyway.
- **Response shape:** {signature{source,version:'1.5'}, count, fields:['des','orbit_id','jd','cd','dist','dist_min','dist_max','v_rel','v_inf','t_sigma_f','h'], data:[[...row arrays...]]} - columnar format, rows are string arrays aligned to 'fields'.
- **Gotchas:** Columnar response (fields + array-of-arrays), not keyed objects; map by index. Distances in au, velocities km/s, h is absolute magnitude. Use date-min='now' style params via real dates; relative tokens like 'now' are supported per docs but I verified explicit dates.

### SatNOGS DB API (satellite metadata) — `satnogs-db`

**T3 · VERIFIED · NEW** — Open-licensed satellite metadata (status alive/decayed, operator, countries, launch date, names/aliases, telemetry decoders) to enrich CelesTrak NORAD IDs. Verified 200 for ISS lookup.

- **Endpoint:** `https://db.satnogs.org/api/satellites/?format=json&norad_cat_id=25544`
- **Auth:** none for read (anonymous access is throttled); optional free token raises limits - not needed at slow cadence
- **Rate limits:** Anonymous requests throttled by DRF (exact anonymous quota not published on the response; be conservative, batch lookups).
- **License:** SatNOGS DB data is CC-BY-SA 4.0 - share-alike applies if you republish derived datasets.
- **Attribution:** SatNOGS DB (Libre Space Foundation), CC-BY-SA 4.0
- **Cadence:** slow: on-demand enrichment with local caching, or daily batch; metadata changes rarely.
- **CORS:** No Access-Control-Allow-Origin header observed.
- **Response shape:** [{sat_id, norad_cat_id, norad_follow_id, name, names, image, status('alive'), decayed, launched, deployed, website, operator, countries, telemetries:[{decoder}], updated, citation, is_frequency_violator, associated_satellites}]
- **Gotchas:** CC-BY-SA share-alike is the only legal wrinkle: fine for displaying in your own tool, matters if you ever export/redistribute merged datasets. Amateur-radio-centric coverage is deepest for smallsats/cubesats.

## Pulse (News / Civic / Events)

> Honest cluster assessment. STRONG: the news backbone is in excellent shape — 8 verified outlet feeds (Times Colonist /rss, CHEK, CTV-VI via the rediscovered Arc XP section feed, Capital Daily /news/rss.xml, five Black Press weeklies) plus three credible new additions (Victoria Buzz, NanaimoNewsNOW, BC Gov News). NAAD/Alert Ready fully verified end-to-end (live heartbeat captured on the TCP stream, archive fetched, CAP-CP geocode structure inspected, and the seven VI SGC codes confirmed against StatCan: 5917/5919/5921/5923/5924/5926/5943). The sleeper find is EmergencyInfoBC: its advertised RSS is dead since March 2024, but the WP REST 'event' endpoint carries current evacuation alerts with an active/expired status field. GAPS: CBC BC returned structurally valid but item-less RSS from this network (probable bot filtering — retest from Convex before declaring it dead); Reddit unauthenticated JSON is 403-blocked (OAuth app required, free); WildSafeBC WARP is defunct (map host has no DNS); BCCDC wastewater has no usable VI series (Victoria lapsed Aug 2025 in the PHAC CSV); real-time crime is essentially unavailable by design — Saanich PD RSS is the only machine-readable police source, VicPD's CityProtect embed is ToS-excluded, and RCMP dropped RSS in its 2025 rcmp.ca migration. LEGAL CAVEATS: Google News RSS is personal/non-commercial-only per its own copyright string (acceptable for a single-operator personal tool, fatal if BlindSpot ever commercializes — keep it demoted to gap-filler); all news feeds should be rendered headline+link+attribution, never full text; Ticketmaster requires branding compliance. RECOMMENDED BUILD ORDER: (1) NAAD TCP listener + archive recovery with SGC prefix filter — highest signal, zero auth; (2) RSS ingestion worker over the 11 verified outlet feeds with per-feed dedupe; (3) EmergencyInfoBC WP REST poller with keyword geo-filter; (4) Bluesky searchPosts (works today, no key); (5) UVic LiveWhale + Ticketmaster once keyed; (6) Reddit after OAuth app creation; (7) Wikipedia revisions as ambient signal. Re-probe from Convex: CBC feeds, and the Vista/Pattison sister-site feeds for north-island coverage.

### Times Colonist (Victoria) RSS — `times-colonist-rss`

**T1 · VERIFIED** — Live RSS 2.0 feed confirmed at /rss (HTTP 200, text/xml, current items dated today). Note: /feed returns 403 — use /rss only.

- **Endpoint:** `https://www.timescolonist.com/rss`
- **Auth:** none
- **Rate limits:** none published; be polite (single request per poll). Feed is paginated via atom:link rel=next (?page=2 ... ?page=15260)
- **License:** Copyright Glacier Media. RSS provided for syndication readers; display headline+link+excerpt with attribution, do not republish full text
- **Attribution:** Times Colonist
- **Cadence:** medium (10-15 min)
- **CORS:** not observed in response headers (server-side polling, irrelevant)
- **Response shape:** RSS 2.0 with atom/media/dc/content namespaces; channel title 'Times Colonist: victoriatimescolonist', lastBuildDate current; items with <title> (more fields declared via namespaces); paginated via atom:link rel=first/next/last
- **Gotchas:** https://www.timescolonist.com/feed returns 403 — only /rss works. Very deep pagination available for backfill.

### CHEK News RSS — `chek-news-rss`

**T1 · VERIFIED** — Standard WordPress RSS 2.0, HTTP 200, 134KB, lastBuildDate current day. Best single VI-wide TV news feed; employee-owned independent station.

- **Endpoint:** `https://cheknews.ca/feed/`
- **Auth:** none
- **Rate limits:** none published; sy:updatePeriod=hourly declared
- **License:** Copyright CHEK Media Group; headline+link aggregation with attribution is normal RSS use
- **Attribution:** CHEK News
- **Cadence:** medium (5-15 min)
- **CORS:** not observed (server-side polling)
- **Response shape:** WordPress RSS 2.0; channel title/description/lastBuildDate/sy:updatePeriod hourly; items follow WP pattern (title, link, dc:creator, pubDate, category, guid, description, content:encoded)
- **Gotchas:** Large feed body (~134KB); use conditional GET (If-Modified-Since/ETag) if supported to be polite

### CTV News Vancouver Island (Arc XP feed) — `ctv-vancouver-island-rss`

**T1 · VERIFIED** — Old vancouverisland.ctvnews.ca/rss URLs are dead (404) after the 2025 Arc XP migration. Working replacement found: Arc outbound feed scoped to the vancouver/vancouver-island section, returning current VI stories (Nanaimo shots-fired, Langford World Cup, Victoria concert).

- **Endpoint:** `https://www.ctvnews.ca/arc/outboundfeeds/rss/category/vancouver/vancouver-island/?outputType=xml`
- **Auth:** none
- **Rate limits:** none published; channel declares ttl=1 (minute) but poll politely
- **License:** Copyright Bell Media; headline+link with attribution
- **Attribution:** CTV News Vancouver Island
- **Cadence:** medium (5-15 min)
- **CORS:** not checked (server-side polling)
- **Response shape:** RSS 2.0 (atom/content/dc/sy/media namespaces); channel ttl 1, sy:updatePeriod hourly; items with title (CDATA), link to /vancouver/vancouver-island/article/... URLs
- **Gotchas:** Undocumented Arc XP endpoint — could change without notice. National all-news variant: https://www.ctvnews.ca/arc/outboundfeeds/rss/?outputType=xml (verified live). Regional site moved from vancouverisland.ctvnews.ca to ctvnews.ca/vancouver/vancouver-island/.

### Capital Daily RSS — `capital-daily-rss`

**T1 · VERIFIED** — Webflow-generated RSS 2.0 at /news/rss.xml, HTTP 200, items dated current day. /feed and /rss both 404.

- **Endpoint:** `https://www.capitaldaily.ca/news/rss.xml`
- **Auth:** none
- **Rate limits:** none published; channel declares ttl=15 (minutes)
- **License:** Copyright Capital Daily; headline+link with attribution
- **Attribution:** Capital Daily
- **Cadence:** medium (15 min, matching declared ttl)
- **CORS:** no Access-Control-Allow-Origin header observed
- **Response shape:** RSS 2.0 (atom + media namespaces, generator Webflow); channel title/link/description/pubDate/ttl 15; items with pubDate (current day)
- **Gotchas:** Only /news/rss.xml works — /feed and /rss return 404

### Black Press VI weeklies (Victoria News, Saanich News, Oak Bay News, Nanaimo News Bulletin, Comox Valley Record) — `black-press-island-weeklies`

**T1 · VERIFIED** — All five WordPress /feed/ endpoints verified live (HTTP 200, application/rss+xml, items dated current day). www hosts 301-redirect to apex domains.

- **Endpoint:** `https://vicnews.com/feed/ | https://saanichnews.com/feed/ | https://oakbaynews.com/feed/ | https://nanaimobulletin.com/feed/ | https://comoxvalleyrecord.com/feed/`
- **Auth:** none
- **Rate limits:** none published; sy:updatePeriod=hourly declared on each
- **License:** Black Press Media terms: content for personal, non-commercial use; headline+link aggregation with attribution
- **Attribution:** Per outlet (Victoria News / Saanich News / Oak Bay News / Nanaimo News Bulletin / Comox Valley Record), Black Press Media
- **Cadence:** medium (10-15 min each; stagger the five polls)
- **CORS:** not observed (server-side polling)
- **Response shape:** WordPress RSS 2.0; items contain title, link, dc:creator (CDATA), pubDate, multiple category (CDATA, includes region tags like 'BC North'), guid, description, full content:encoded — all observed in live vicnews.com response
- **Gotchas:** Black Press syndicates some province-wide copy across all its sites — dedupe by guid/title across the five feeds. Other VI Black Press titles (Goldstream Gazette, Peninsula News Review, Campbell River Mirror, Alberni Valley News, etc.) almost certainly follow the same /feed/ pattern if you want north/west island coverage.

### CBC British Columbia News RSS — `cbc-bc-rss`

**T1 · VERIFIED** — CBC BC news as RSS 2.0; round-1 failure was a User-Agent trap (default curl UA gets an empty channel skeleton, browser UA gets the full feed with ~15 items). Verified live items 2026-06-11; poll server-side every 5-15 min and keyword-filter for Vancouver Island.

- **Endpoint:** `https://www.cbc.ca/webfeed/rss/rss-canada-britishcolumbia`
- **Auth:** none
- **Rate limits:** none observed; edge-cached with cache-control public max-age=23, so sub-minute polling is pointless
- **License:** Feed self-describes as 'FOR PERSONAL USE ONLY'; copyright (C) Canadian Broadcasting Corporation, terms at cbc.ca/aboutcbc/discover/termsofuse.html#Rss. Acceptable for a single-operator personal dashboard; do not republish commercially.
- **Attribution:** © CBC / Radio-Canada (link items back to cbc.ca)
- **Cadence:** medium (5-15 min); lastBuildDate ticks on the hour but stories land throughout the day
- **CORS:** no Access-Control-Allow-Origin header (tested with Origin set) — must be polled server-side (Convex), not from browser
- **Response shape:** RSS 2.0 XML, xmlns:cbc namespace. Per <item>: title (CDATA), link (story URL with ?cmp=rss), description (CDATA HTML: leading <img> + <p> summary), pubDate (RFC-822, EDT/EST), category (often empty), guid isPermaLink=false (e.g. '9.7228633'), plus item attributes cbc:type='story', cbc:deptid, cbc:syndicate. ~15 items, 24 KB. Feed is BC-wide: filter for Vancouver Island server-side by keyword (Victoria, Nanaimo, Island, Saanich, Tofino, etc.).
- **Gotchas:** Round-1 attempt superseded by retry (was: verify-failed). CRITICAL: with curl's default User-Agent the edge returns HTTP 200 with an EMPTY channel skeleton (671 bytes, no items) — this is exactly what killed round 1. Send a real browser-like User-Agent and you get the full feed (verified 2026-06-11, 24,079 bytes with items). Old rss.cbc.ca lineup host is dead; use the www.cbc.ca/webfeed path.

### Google News RSS search (Vancouver Island) — `google-news-rss`

**T1 · VERIFIED** — Works: HTTP 200, valid RSS with current VI items from Global News, CHEK etc. But the feed's own copyright string expressly limits use to 'rendering Google News results within a personal feed reader for personal, non-commercial use' — fine for a single-operator personal dashboard, prohibited for anything commercial.

- **Endpoint:** `https://news.google.com/rss/search?q=%22Vancouver+Island%22&hl=en-CA&gl=CA&ceid=CA:en`
- **Auth:** none
- **Rate limits:** none published; aggressive polling risks IP throttling/captcha
- **License:** Per in-feed copyright: personal, non-commercial feed-reader use only; any other use 'expressly prohibited'
- **Attribution:** Google News + original publisher (source name is appended to item titles)
- **Cadence:** medium-slow (15 min; this is a search index, not a wire)
- **CORS:** no Access-Control-Allow-Origin observed
- **Response shape:** RSS 2.0 (NFE/5.0 generator); items with title (publisher appended after ' - '), link (news.google.com/rss/articles/... redirect URLs, NOT direct publisher links), guid, pubDate, description containing anchor markup
- **Gotchas:** Links are opaque Google redirect URLs — resolving to the real article URL requires following the redirect. Item set overlaps heavily with the direct outlet feeds; treat as gap-filler. Additional useful queries: Victoria BC, Nanaimo, per-town names.

### Canada NAAD / Alert Ready (Pelmorex) — `naad-pelmorex`

**T1 · VERIFIED** — Both layers verified live: TCP stream on streaming2.naad-adna.pelmorex.com:8080 delivered a real NAADS-Heartbeat CAP 1.2 XML within ~1 minute, and the HTTPS archive directory for today listed 138 alert XMLs; fetched one full CAP-CP alert (sender cap-pac@canada.ca, status Actual) containing SGC geocodes.

- **Endpoint:** `TCP: streaming1.naad-adna.pelmorex.com:8080 and streaming2.naad-adna.pelmorex.com:8080 (raw XML stream). Archive: https://capcp1.naad-adna.pelmorex.com/2026-06-11/ (and capcp2 mirror) — note plain http:// 301s to https://. File pattern: {sent with : - replaced by _}I{identifier with : - replaced by _}.xml, e.g. https://capcp1.naad-adna.pelmorex.com/2026-06-11/2026_06_11T10_52_23_00_00Iurn_oid_2.49.0.1.124.1178925050.2026.xml`
- **Auth:** none (open public distribution system)
- **Rate limits:** n/a for the stream (persistent socket); archive is plain HTTPS, poll politely
- **License:** Public emergency alerts intended for mass redistribution via the National Public Alerting System; no signup or licence gate. Follow Alert Ready presentation guidance for Broadcast Immediate alerts.
- **Attribution:** Issuing agency from <sender> (e.g. Environment and Climate Change Canada via cap-pac@canada.ca, provincial EMOs); 'via Pelmorex NAAD' is courteous
- **Cadence:** fast — hold a persistent TCP connection (heartbeat every ~1 min is your liveness check); reconnect on silence >2 min; on reconnect, diff heartbeat references against seen-set and fetch missed alerts from the archive
- **CORS:** n/a (TCP) / not relevant — must be server-side anyway
- **Response shape:** CAP 1.2 <alert> (urn:oasis:names:tc:emergency:cap:1.2). Heartbeat: sender=NAADS-Heartbeat, status=System, source=NAADS-1, <references> listing sender,identifier,sent triples of recent alerts (your missed-alert recovery mechanism). Real alert: identifier urn:oid:..., sender, sent, status Actual, msgType, scope Public, info blocks with <geocode> pairs — valueName 'profile:CAP-CP:Location:0.3' carries SGC codes (2/4/7-digit), valueName 'layer:EC-MSC-SMC:1.0:CLC' carries ECCC forecast-region codes
- **Gotchas:** VI filtering: match CAP-CP:Location values by prefix against the SGC census-division codes, VERIFIED against StatCan's census geography listing: Capital=5917, Cowichan Valley=5919, Nanaimo=5921, Alberni-Clayoquot=5923, Strathcona=5924, Comox Valley=5926, Mount Waddington=5943 (7-digit values are census subdivisions whose first 4 digits are the CD; also accept bare '59' province-wide alerts). Archive filenames replace ':' and '-' in sent-timestamp and identifier with '_'. Stream emits alerts as concatenated XML docs — split on the XML declaration.

### EmergencyInfoBC active events (WP REST) — `emergencyinfobc`

**T2 · VERIFIED** — The advertised RSS (/feed/) is STALE — newest item March 2024. But the live data is in a WordPress custom post type: /wp-json/wp/v2/event returns 308 events with current June-2026 evacuation alerts/rescinds, including ACF status (active/expired/referred). Verified with real response.

- **Endpoint:** `https://www.emergencyinfobc.gov.bc.ca/wp-json/wp/v2/event?per_page=20&orderby=modified&order=desc`
- **Auth:** none
- **Rate limits:** none published; standard WP REST pagination (X-WP-Total: 308, X-WP-TotalPages headers)
- **License:** B.C. Crown copyright; public-safety information intended for public distribution; cite EmergencyInfoBC
- **Attribution:** EmergencyInfoBC (Province of British Columbia)
- **Cadence:** medium (5 min during flood/fire season, 15 min otherwise)
- **CORS:** no Access-Control-Allow-Origin observed (only Access-Control-Expose-Headers) — server-side only
- **Response shape:** JSON array of WP posts: id, date/date_gmt, modified/modified_gmt, slug, status, type='event', link, title.rendered, content, excerpt, hazard_type (term IDs), region/region_groups (EMPTY in practice), acf.status.value (active/expired/referred)
- **Gotchas:** The region taxonomy is unused (only 2 junk terms 'a'/'B') — geographic filtering must be keyword matching on title/content against VI place and regional-district names. The /feed/ and /rss RSS endpoints are dead weight (stale 2024 + template placeholder items) — do not build on them. CRD: no machine-readable alerts feed found (crd.bc.ca/rss and /about/news/rss both 404; CRD relies on the Alertable app and web pages).

### Ticketmaster Discovery API — `ticketmaster-discovery`

**T2 · NEEDS-KEY** — Endpoint confirmed live: keyless request returns the expected oauth FailedToResolveAPIKey fault (proving routing works). Free key, instant signup; official docs confirm 5000 calls/day, 5 req/s default quota.

- **Endpoint:** `https://app.ticketmaster.com/discovery/v2/events.json?apikey=YOUR_KEY&latlong=48.4284,-123.3656&radius=120&unit=km&sort=date,asc&size=50`
- **Auth:** free key — register at https://developer-acct.ticketmaster.com/user/register (instant, no review for default quota)
- **Rate limits:** 5000 API calls/day, 5 requests/second (documented defaults; increases require branding-guide compliance review)
- **License:** Ticketmaster API Terms; must comply with branding guide (design.ticketmaster.com) and represent data properly
- **Attribution:** Ticketmaster (branding guide compliance)
- **Cadence:** slow (30-60 min — events don't churn fast and the daily quota is finite)
- **CORS:** not checked (keyless fault response); server-side anyway
- **Response shape:** without key: {fault:{faultstring,detail.errorcode='steps.oauth.v2.FailedToResolveAPIKey'}} — documented keyed shape is _embedded.events[] with name/dates/venues/classifications (not independently verified here)
- **Gotchas:** Docs prefer geoPoint (geohash) over latlong (marked deprecated but still functional). VI venue coverage is mostly Victoria (Save-On-Foods Memorial Centre, Royal Theatre) and Nanaimo; radius=120km from Victoria misses the north island — consider a second query centred on Comox 49.6735,-124.9283.

### Eventbrite public event search — `eventbrite`

**T2 · VERIFY-FAILED** — Honest verdict confirmed by live test: GET https://www.eventbriteapi.com/v3/events/search/ returns 404 {error:'NOT_FOUND','The path you requested does not exist.'} — the public search API was removed (in 2020) and is still gone in 2026. The remaining v3 API is OAuth-only and can only list events owned by YOUR organizations — useless for area discovery.

- **Endpoint:** `https://www.eventbriteapi.com/v3/events/search/ (CONFIRMED DEAD — 404)`
- **Auth:** n/a (capability removed)
- **Response shape:** {"status_code":404,"error_description":"The path you requested does not exist.","error":"NOT_FOUND"} — seen live
- **Gotchas:** Do not budget any time here. Scraping eventbrite.ca HTML violates their ToS. For VI event discovery use Ticketmaster + UVic LiveWhale + venue/news feeds instead.

### Municipal/institutional event calendars (UVic, City of Victoria, Nanaimo, Tourism Victoria) — `municipal-event-calendars`

**T2 · VERIFIED** — UVic is the only verified machine-readable win: LiveWhale Calendar with open JSON (CORS *) and a full iCal export. City of Victoria (Drupal 10), Nanaimo (custom CMS), and Tourism Victoria (Simpleview) expose no RSS/iCal/JSON in their static HTML — HTML-only for now.

- **Endpoint:** `UVic JSON: https://events.uvic.ca/live/json/events/max/50 | UVic iCal: https://events.uvic.ca/live/ical/events (884KB full calendar, verified text/calendar)`
- **Auth:** none
- **Rate limits:** none published
- **License:** UVic event listings are public information; courtesy attribution
- **Attribution:** University of Victoria events
- **Cadence:** slow (1-2x daily)
- **CORS:** UVic LiveWhale: Access-Control-Allow-Origin: * (verified)
- **Response shape:** LiveWhale JSON: array of events with id, gid, group_title, title, url, date, date_time, date_utc, date_iso, date_ts, tz_offset, timezone, date2_* (end-time) fields — seen live
- **Gotchas:** City of Victoria: victoria.ca was rebuilt on Drupal 10 — old /EN/main/... URLs 404; current events page https://www.victoria.ca/community-culture/events has no feed links (CityVibe finder is JS, would need browser XHR inspection). Nanaimo: https://www.nanaimo.ca/calendar/ live but no export endpoints found; /calendar/rss 404. Tourism Victoria (tourismvictoria.com/events-calendar): Simpleview CMS — their internal rest_v2 events API wasn't discoverable from static HTML; needs browser DevTools session to capture, and their ToS should be read before using it.

### WildSafeBC WARP (Wildlife Alert Reporting Program) — `wildsafebc-warp`

**T3 · VERIFY-FAILED** — Permanently discontinued, not just broken: official notice on wildsafebc.com says the WARP Public Beta site 'has been permanently disabled', warp.wildsafebc.com DNS no longer resolves, and ArcGIS Online public search (3 query variants) returns zero WildSafeBC items — no surviving FeatureServer. Recommend dropping this source.

- **Endpoint:** `none — warp.wildsafebc.com no longer resolves (DNS NXDOMAIN, verified 2026-06-11)`
- **Gotchas:** Round-1 attempt superseded by retry (was: verify-failed). Official notice on https://wildsafebc.com/programs/what-is-warp/: 'IMPORTANT NOTICE — The Wildlife Awareness Reporting Program (WARP) Public Beta site (https://warp.wildsafebc.com/) has been permanently disabled and is no longer accessible.' Page now describes WARP entirely in past tense. ArcGIS Online search returned total:0 for q=wildsafebc, q=WildSafeBC WARP, q=WARP wildlife alert. Underlying reports go to the BC Conservation Officer Service RAPP line (1-877-952-7277), which has no public georeferenced feed. Nearest substitutes are local news (CHEK/CBC via Pulse) for wildlife-conflict stories.

### BCCDC / PHAC wastewater surveillance — `bccdc-wastewater`

**T3 · VERIFIED** — Honest verdict: weak for VI. BCCDC's own dashboard is a Shiny app (bccdc.shinyapps.io/respiratory_wastewater) with no stable public data endpoint. The federal PHAC NWMP CSV is real and was verified (7.8MB, sites/weeks/measures), and it DOES contain a 'Victoria' BC site — but Victoria's series stops at epi-week 2025-W34 (~Aug 2025) while the dataset overall runs to 2026-W9. The only other BC sites are the five Metro Vancouver plants. Effectively no current VI wastewater signal.

- **Endpoint:** `https://health-infobase.canada.ca/src/data/wastewater/wastewater_aggregate.csv (companion: wastewater_trend.csv; dashboard page: https://health-infobase.canada.ca/wastewater/)`
- **Auth:** none
- **Rate limits:** none; it is a static CSV
- **License:** Open Government Licence – Canada
- **Attribution:** Public Health Agency of Canada, National Wastewater Monitoring Program
- **Cadence:** slow (daily check is plenty; underlying sampling is weekly)
- **CORS:** not checked (static file, server-side fetch)
- **Response shape:** CSV header seen live: Location,site,city,province,country,EpiYear,EpiWeek,weekstart,measureid,w_avg,min,max,populationcoverage,pruid — measureid values observed: covN2, fluA, fluB (RSV also in program scope)
- **Gotchas:** Old CSV path /src/data/wastewater/wastewater.csv now 302s to a 404 — use wastewater_aggregate.csv. Treat the Victoria series as lapsed unless new rows appear; consider dropping this source from MVP and re-evaluating quarterly.

### Reddit r/VancouverIsland (+ r/VictoriaBC, r/nanaimo) — `reddit-vi`

**T3 · NEEDS-KEY** — Unauthenticated JSON is effectively dead from non-residential IPs: both www.reddit.com and old.reddit.com /r/VancouverIsland/new.json returned HTTP 403 (text/html block page) with a descriptive UA and with a full browser UA. The free OAuth path is the only reliable route.

- **Endpoint:** `https://oauth.reddit.com/r/VancouverIsland/new?limit=25 (with Bearer token + descriptive User-Agent). Unauthenticated form that 403'd here: https://www.reddit.com/r/VancouverIsland/new.json`
- **Auth:** free OAuth script app: create at https://www.reddit.com/prefs/apps (type 'script'), then POST https://www.reddit.com/api/v1/access_token with grant_type=client_credentials and HTTP basic auth (client_id:secret); send User-Agent like 'server:blindspot-osint:v0.1 (by /u/YOURUSER)'
- **Rate limits:** free tier: 100 queries/min per OAuth client (10 QPM unauthenticated, and in practice 403-blocked anyway); honor X-Ratelimit-* headers
- **License:** Reddit Data API Terms — free tier is for non-commercial use; do not redistribute user content wholesale; display with attribution and link back
- **Attribution:** Reddit, u/<author>, linked permalink
- **Cadence:** medium (3-5 min across the three subs combined, well inside 100 QPM)
- **CORS:** n/a (blocked before headers mattered); server-side only
- **Response shape:** documented Listing shape {kind:'Listing',data:{children:[{data:{title,author,created_utc,permalink,subreddit,num_comments,...}}],after}} — NOT independently verified here due to 403
- **Gotchas:** The 403 will very likely also hit Convex's datacenter IPs — budget the OAuth setup from day one. Cover r/VancouverIsland, r/VictoriaBC, r/nanaimo; r/comoxvalley exists but is low-traffic.

### Bluesky public search (AppView) — `bluesky-search`

**T3 · VERIFIED** — Works with NO auth: HTTP 200, JSON with current-day posts mentioning Vancouver Island, and Access-Control-Allow-Origin: *. Best free social-pulse source in this cluster right now.

- **Endpoint:** `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=%22Vancouver%20Island%22&limit=25 (also useful: &sort=latest, and separate queries for Victoria BC, Nanaimo, Comox)`
- **Auth:** none (public AppView; verified live without credentials)
- **Rate limits:** no rate-limit headers observed on this response; Bluesky documents IP-based xrpc limits — keep to a few requests/min and you will never hit them
- **License:** Public posts via AT Protocol; respect deletions (re-query rather than caching forever) and display with author handle + link
- **Attribution:** Bluesky, @handle of author
- **Cadence:** fast-medium (2-5 min; cursor-paginate with sort=latest and dedupe by uri)
- **CORS:** Access-Control-Allow-Origin: * (verified — browser-direct calls possible)
- **Response shape:** {posts:[{uri,cid,author:{handle,displayName,...},record:{$type,text,createdAt,...},...}],cursor} — verified live (saw author.handle, record.text, record.createdAt)
- **Gotchas:** Unauthenticated AppView access has been tightened before — wrap in graceful 4xx handling and be ready to add an app-password session. Mastodon feasibility note: there is no global Mastodon search; per-instance public hashtag timelines (e.g. GET https://mastodon.social/api/v1/timelines/tag/vancouverisland) work unauthenticated on most large instances, but VI volume is thin — low priority.

### Saanich Police media releases RSS — `saanich-pd-news`

**T3 · VERIFIED** — Working WordPress RSS with real, recent police media releases (latest May 28 2026: stolen-vehicle arson arrest, drug-trafficking seizure). The only verified machine-readable police feed on the island.

- **Endpoint:** `https://www.saanichpolice.ca/feed/`
- **Auth:** none
- **Rate limits:** none published
- **License:** Police media releases — public information intended for distribution
- **Attribution:** Saanich Police Department
- **Cadence:** slow (30-60 min — a few releases per week)
- **CORS:** not observed (server-side polling)
- **Response shape:** WordPress RSS 2.0; items with title and pubDate verified (standard WP item fields)
- **Gotchas:** Volume is low; don't alert on feed silence

### VicPD crime maps / open data — `vicpd-crime`

**T3 · EXCLUDED** — VicPD rebuilt on Zoho Sites: /feed/ is 404 and wp-json is dead (connection dropped). Their crime map page embeds Motorola CityProtect (cityprotect.com iframe with VicPD lat/lng filters, seen in page source). CityProtect's backing API is an undocumented vendor service whose ToS prohibits automated scraping — excluded for automated ingestion; human use of the map is fine.

- **Endpoint:** `human-only map embed observed: https://www.cityprotect.com/map/filters?...latitude=48.4288...longitude=-123.3511... (via https://www.vicpd.ca/Open%20VicPD/crime-maps)`
- **License:** CityProtect/Motorola ToS prohibit automated access; VicPD publishes the map for community awareness only and explicitly cautions against decision-making use
- **Response shape:** n/a (did not probe the vendor API — out of bounds)
- **Gotchas:** VicPD news releases exist as HTML at vicpd.ca/news (Zoho Sites, no feed). Honest reality: Canadian real-time crime data is thin by design; StatCan incident-based stats (table 35-10-0184) are annual. Best proxy for VI crime pulse is the news feeds + Saanich PD RSS + scanner-adjacent reporting from CHEK.

### BC RCMP newsroom (Island District detachments) — `bc-rcmp-newsroom`

**T3 · VERIFY-FAILED** — The old bc-cb.rcmp-grc.gc.ca newsroom and its documented RSS-feeds page now 301 to the rebuilt rcmp.ca/en/bc — and the new platform exposes no RSS (page has zero feed links; Drupal-style rss.xml guesses all 404; legacy www.rcmp-grc.gc.ca fails TLS). RCMP appears to have dropped public RSS in the 2025 migration.

- **Endpoint:** `https://rcmp.ca/en/bc/news (HTML only — no machine-readable feed found)`
- **License:** Crown copyright; news releases intended for public distribution
- **Attribution:** BC RCMP
- **Cadence:** slow (30-60 min) if scraping is implemented
- **Response shape:** HTML news listing (984KB page); no JSON API discoverable in static source
- **Gotchas:** What was tried: bc-cb.rcmp-grc.gc.ca/ViewPage.action?siteNodeId=171 (the historical 'RSS Feeds' page — now redirects to rcmp.ca/en/bc), rcmp.ca/en/bc/news/rss.xml, rcmp.ca/en/rss.xml, rcmp.ca/rss/en/news (all 404), www.rcmp-grc.gc.ca/en/stay-connected (TLS cert chain failure from this client). Fallback options: polite HTML scrape of rcmp.ca/en/bc/news filtered to Island District detachments, or rely on local outlets which republish every RCMP release within minutes (CHEK, Nanaimo News Bulletin, NanaimoNewsNOW).

### Wikipedia revisions API (VI page watchlist) — `wikipedia-watchlist`

**T3 · VERIFIED** — MediaWiki API verified live: latest-revision query for Victoria BC / Nanaimo / Vancouver Island returned HTTP 200 JSON with timestamps, users, and edit comments (most recent edit June 1 2026).

- **Endpoint:** `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=revisions&rvprop=timestamp%7Cuser%7Ccomment&titles=Vancouver%20Island%7CVictoria%2C%20British%20Columbia%7CNanaimo (batch up to 50 titles per request)`
- **Auth:** none
- **Rate limits:** no hard limit for low-volume read queries; etiquette: descriptive User-Agent with contact info, serial (non-parallel) requests
- **License:** Content CC BY-SA 4.0; metadata facts not restricted
- **Attribution:** Wikipedia (CC BY-SA 4.0) when displaying content
- **Cadence:** medium-slow (15-30 min; this is ambient signal, not breaking news)
- **CORS:** supported via origin=* query parameter (MediaWiki anonymous CORS); header not sent without it
- **Response shape:** {query:{pages:[{title,revisions:[{timestamp,user,comment}]}]}} — verified live with formatversion=2
- **Gotchas:** Google Trends companion verdict (honest): there is still NO official Google Trends API for this use; the widget endpoints behind trends.google.com are unofficial, fingerprinted, and break regularly — pytrends-style scraping is fragile and ToS-gray. Skip Trends for MVP; Wikipedia edit velocity + news-feed term frequency gives a similar attention signal legitimately. Alternative for real-time edits: EventStreams SSE at https://stream.wikimedia.org/v2/stream/recentchange (firehose, filter client-side by title).

### Victoria Buzz RSS — `victoria-buzz-rss`

**T2 · VERIFIED · NEW** — NEW: high-volume Victoria digital outlet (breaking local incidents, events). WordPress RSS verified live, items from the prior evening at check time.

- **Endpoint:** `https://victoriabuzz.com/feed/`
- **Auth:** none
- **Rate limits:** none published
- **License:** Copyright Victoria Buzz; headline+link with attribution
- **Attribution:** Victoria Buzz
- **Cadence:** medium (10-15 min)
- **CORS:** not checked (server-side polling)
- **Response shape:** WordPress RSS 2.0 (application/rss+xml); items with pubDate verified current
- **Gotchas:** www host redirects to apex victoriabuzz.com; clickbait-adjacent headlines — useful for incident pulse, weigh lower for analysis

### NanaimoNewsNOW RSS — `nanaimo-news-now-rss`

**T2 · VERIFIED · NEW** — NEW: dedicated Nanaimo digital newsroom (Jim Pattison Broadcast Group). RSS verified live with items timestamped minutes before the check. Fills the mid-island gap between Victoria-centric and Comox feeds.

- **Endpoint:** `https://nanaimonewsnow.com/feed/`
- **Auth:** none
- **Rate limits:** none published
- **License:** Copyright NanaimoNewsNOW / Jim Pattison Broadcast Group; headline+link with attribution
- **Attribution:** NanaimoNewsNOW
- **Cadence:** medium (10-15 min)
- **CORS:** not checked (server-side polling)
- **Response shape:** RSS 2.0 (text/xml), items with current-day pubDate verified
- **Gotchas:** Sister Vista/Pattison sites likely cover other VI towns with the same /feed/ pattern (e.g. mycomoxvalleynow.com, mycampbellrivernow.com) — unverified but worth a follow-up probe for north-island coverage

### BC Government News RSS — `bc-gov-news-rss`

**T2 · VERIFIED · NEW** — NEW: official provincial news-release feed, verified live (application/rss+xml, items June 2026). Catches ferry, highway, health-authority, and emergency-management announcements that hit VI before local media rewrite them.

- **Endpoint:** `https://news.gov.bc.ca/feed (ministry- and region-scoped feeds are listed at https://news.gov.bc.ca/rss-feeds)`
- **Auth:** none
- **Rate limits:** none published
- **License:** B.C. Crown copyright; government news releases intended for redistribution with attribution
- **Attribution:** Province of British Columbia / BC Gov News
- **Cadence:** slow (30-60 min)
- **CORS:** not checked (server-side polling)
- **Response shape:** RSS 2.0 (application/rss+xml), items with pubDate verified (latest Jun 5 2026 on the all-news feed at check time)
- **Gotchas:** All-province firehose — filter by VI keywords or use the per-ministry/regional feeds from the rss-feeds directory (directory contents not individually verified)

### BC Parks Public Advisories (Strapi CMS API) — `bc-parks-advisories`

**T2 · VERIFIED · NEW** — Verified live. Clean Strapi JSON API with urgency/eventType/accessStatus taxonomies and park relations. Filter to VI by protectedAreas lat/lng bbox (130 advisories) or curated ORCS list; region relation is unreliable (empty on advisories).

- **Endpoint:** `https://cms.bcparks.ca/api/public-advisories?filters[protectedAreas][latitude][$between][0]=48.2&filters[protectedAreas][latitude][$between][1]=51.1&filters[protectedAreas][longitude][$between][0]=-125.3&filters[protectedAreas][longitude][$between][1]=-123.1&populate[protectedAreas][fields][0]=protectedAreaName&populate[eventType][fields][0]=eventType&sort=advisoryDate:desc&pagination[pageSize]=25`
- **Auth:** None. Public unauthenticated Strapi v5 API (the same backend bcparks.ca consumes).
- **Rate limits:** None observed or documented; behave courteously.
- **License:** No explicit open-data license published for the content; treat as BC Crown copyright (the CMS codebase bcgov/bcparks.ca is Apache-2.0, which covers code, not content). Attribute BC Parks.
- **Attribution:** BC Parks
- **Cadence:** slow (30-60 min). Advisories are editorial, low churn.
- **CORS:** Reflects request Origin (tested Origin: https://example.com -> access-control-allow-origin: https://example.com). Effectively open; server-side polling fine regardless.
- **Response shape:** Strapi v5 envelope {data:[...], meta:{pagination:{page,pageSize,pageCount,total}}}. Advisory fields: title, description (HTML), advisoryNumber, isSafetyRelated, advisoryDate/effectiveDate/endDate/expiryDate, listingRank. Relations: protectedAreas (orcs id, protectedAreaName, latitude/longitude, url, hasCampfireBan), eventType (e.g. Wildlife, Landslide, Facility closure, Flood), urgency (Low/Medium/High + color), accessStatus (Open/Closed etc + color), advisoryStatus (code PUB), links, fireCentres, sites. Standard Strapi filters/sort/pagination/populate all work.
- **Gotchas:** The regions relation on advisories is mostly EMPTY — filtering filters[regions][id][$eq]=5 (West Coast region) returned 0 rows. Filter via protectedAreas coordinates instead: VI bbox $between filter verified, returned total=130 advisories (live examples: landslide closure at Carmanah Walbran, falcon nest closures, Tribune Bay reopening). Caveat: the bbox also catches Howe Sound/Sunshine Coast mainland parks (Porteau Cove, Stawamus Chief) — either tighten longitude or maintain a curated ORCS allowlist of VI parks. API returns published entries only (Strapi default). protectedAreas list endpoint (/api/protected-areas) can build the ORCS list.

## World Mode (Global)

> Build order recommendation (keyless + verified first): START with USGS quakes (verified, CORS-open, public domain, fast, genuinely VI/Cascadia-relevant including offshore), GDACS (verified global disaster GeoJSON, keyless), GAC travel advisories (verified, Open Gov Licence, clean country-level JSON, conditional-GET friendly), WHO Disease Outbreak News API (verified, ACAO:*, the live replacement for the dead WHO rss.xml). These four give a working World page on day one with zero credentials. SECOND TIER (free key, do the signup yourself before relying on them): abuse.ch URLhaus/ThreatFox - confirmed the Auth-Key requirement is now ENFORCED (401 without key); one free key from auth.abuse.ch covers both, header 'Auth-Key' for v1 POST / in-URL for v2 exports, poll no faster than 5 min. IODA is keyless and verified (api.ioda.inetintel.cc.gatech.edu, country/AS-level connectivity signals for CA) - good as a 'is Canada going dark' indicator. VERIFY-FAILED / FLAGS: - GDELT: live but I could not retrieve a 200 from this shared sandbox IP - DOC persistently 429'd (IP-level rate-limit contention, not an API fault) and GEO 2.0 returned a hard 404 even on GDELT's own documented example URL. Two actionable findings: (1) re-confirm the GEO 2.0 path from your Convex IP before depending on it - it may have moved; (2) build the client to handle GDELT's non-JSON error bodies (errors come back as text/plain or HTML, so check status + Content-Type before JSON.parse, and use a lenient parser for the DOC body's occasional unescaped control chars). At >=5s spacing from a clean IP, DOC should work. - ProMED-mail: effectively EXCLUDED - RSS permanently closed in 2023, /feed now returns a Next.js error page; no free programmatic feed. WHO DON covers the official-outbreak need. LEGAL CAVEATS: - ACLED (needs-key, OAuth now, not the old static key): the EULA is the real blocker, not the auth. Non-commercial only, no redistribution of raw events, outputs must be transformative, and a broad clause PROHIBITS using ACLED data to train/test/develop ML/LLM/AI. For an OSINT tool that may surface an LLM layer, this is a genuine compliance risk; combined with near-zero VI event coverage, recommend deferring ACLED unless a clearly compliant, non-commercial, transformative use is scoped. - HealthMap: verified working (real current markers via getAlerts.php) but it's an UNDOCUMENTED internal endpoint with unclear reuse ToS - fine for personal/research use, don't make it load-bearing, sanitize its embedded HTML, and expect it to change without notice. - ReliefWeb (new): stale-doc trap confirmed - v1 is 410-decommissioned, v2 needs an approved appname (403 otherwise). Free but requires registration; GDACS+USGS already cover the disaster globe keylessly if you'd rather skip it. CORS summary (informational; all sources are fine server-side via Convex): ACAO:* present on WHO DON, USGS, ReliefWeb; absent on GAC, IODA, GDACS, and (under error) abuse.ch. None of this matters given the server-side polling architecture, but USGS and WHO could additionally be hit directly from the browser if ever useful. Geographic reality check: most World Mode sources are GLOBAL, not VI-filtered. USGS (Cascadia/offshore quakes) and GAC (Canada advisories) are the most directly VI/BC-relevant; the rest are world-context layers you'll filter by bbox (-125.30..-123.10 / 48.20..51.10) or just display as global signals.

### GDELT DOC 2.0 API + GDELT v2 raw 15-min files — `gdelt`

**T2 · VERIFIED** — Global news firehose queried for 'Vancouver Island'; verified real JSON (BC Ferries, CHEK, CBC articles) after respecting the strict 1-req/5s per-IP limit that caused round-1's 429. Results server-cached 15 min, CORS open; raw 15-min CSV files confirmed as fallback.

- **Endpoint:** `https://api.gdeltproject.org/api/v2/doc/doc?query=%22Vancouver%20Island%22&mode=artlist&format=json&maxrecords=10 (fallback raw files: http://data.gdeltproject.org/gdeltv2/lastupdate.txt)`
- **Auth:** none
- **Rate limits:** HARD limit 1 request per 5 seconds per IP, enforced globally across query types. 429 body says: 'Please limit requests to one every 5 seconds or contact kalev.leetaru5@gmail.com for larger queries.' Shared egress IP trips this easily — serialize ALL GDELT calls through one queue with >=6s spacing. Verified: first call today 429'd, retry after 6s sleep returned 200 with data.
- **License:** GDELT data is open for unlimited use with attribution (gdeltproject.org/about.html)
- **Attribution:** Data from the GDELT Project (gdeltproject.org)
- **Cadence:** slow (15 min). Responses carry Cache-Control: public max-age=900, i.e. results are server-cached 15 minutes — polling faster returns identical data. Raw v2 files also update on a strict 15-min cycle (verified lastupdate.txt listing 20260611130000.export/mentions/gkg CSV.zip with sizes+MD5).
- **CORS:** Access-Control-Allow-Origin: * on the DOC API (browser-callable, but poll server-side anyway to respect the IP rate limit centrally)
- **Response shape:** JSON {articles:[{url, url_mobile (often empty string), title, seendate, socialimage (often empty), domain, language, sourcecountry}]}. Quirks: seendate is 'YYYYMMDDTHHMMSSZ' (no dashes/colons — custom parser needed); titles have stray spaces around punctuation ('B . C . Ferries'); artlist default sort is relevance not recency (add &sort=datedesc); malformed/too-short queries return HTTP 200 with a plain-text error instead of JSON — check Content-Type before JSON.parse.
- **Gotchas:** Round-1 attempt superseded by retry (was: verify-failed). Send a descriptive User-Agent. Query must be non-empty and reasonably specific. lastupdate.txt is plain text '<size> <md5> <url>' lines, one per file type (export/mentions/gkg) — zip URLs are http:// and large (gkg ~6 MB zipped); only use as fallback if the DOC API is rate-blocked.

### ACLED (Armed Conflict Location & Event Data) — `acled`

**T3 · NEEDS-KEY** — Live and documented, but auth model CHANGED: the old static API key + email is gone. ACLED now uses myACLED accounts with OAuth token-based auth (or cookie auth). License is restrictive enough that it is a real flag for this project.

- **Endpoint:** `https://acleddata.com/api-documentation/getting-started (register at https://acleddata.com/register/, accept Terms of Use, then request an OAuth access token with myACLED credentials before calling the data endpoints)`
- **Auth:** Free key + signup. Register a myACLED account (institutional email recommended for higher access). Two auth modes: cookie-based, or OAuth token (POST credentials -> bearer token) for programmatic calls. Cannot generate a key until Terms of Use are accepted in-account.
- **Rate limits:** Not publicly numeric; tiered by account type. ACLED data refreshes weekly (Tuesdays), so high-frequency polling is pointless.
- **License:** Royalty-free, non-exclusive, NON-COMMERCIAL license. Raw/original data may NOT be redistributed or exposed to other users; external outputs must be 'transformative' and not allow reverse-engineering of the dataset. Local storage for replicable analysis is permitted. AI/ML restriction: ACLED explicitly prohibits using its data to train/test/develop ML models, LLMs, or AI systems that substitute for or expose ACLED data.
- **Attribution:** Mandatory prominent acknowledgement with full citation + link to acleddata.com on any visual or text using the data.
- **Cadence:** slow
- **CORS:** n/a (token-gated; server-side only)
- **Response shape:** Not retrieved (no key, per hard rules - never sign up). Documented: JSON {success, count, data:[{event_id_cnty, event_date, event_type, sub_event_type, actor1, country, latitude, longitude, fatalities, notes, source, ...}]}.
- **Gotchas:** LEGAL FLAG for BlindSpot: (a) non-commercial only, (b) you cannot redistribute raw events to other users / expose them via a public map without a transformative layer, (c) the AI/ML clause is broad - if any LLM feature touches ACLED data it likely breaches the EULA. Vancouver Island/BC also has near-zero ACLED events, so value-for-risk is low. Recommend deferring unless a clearly compliant, non-commercial, transformative use is defined.

### WHO Disease Outbreak News (DON) API + ProMED-mail — `who-promed`

**T3 · VERIFIED** — Verified the WHO DON JSON API live with real current data. The old WHO rss.xml is dead (404). ProMED-mail has NO usable public feed - its RSS was permanently closed in 2023 to stop scraping and promedmail.org/feed now returns a Next.js error page; ProMED is effectively excluded.

- **Endpoint:** `https://www.who.int/api/news/diseaseoutbreaknews?sf_provider=dynamicProvider372&sf_culture=en&%24orderby=PublicationDateAndTime%20desc&%24top=20&%24format=json`
- **Auth:** none
- **Rate limits:** None published. OData-style endpoint behind Cloudflare; be polite.
- **License:** WHO content is generally CC BY-NC-SA 3.0 IGO. Attribution to WHO required; non-commercial.
- **Attribution:** Cite 'World Health Organization, Disease Outbreak News' with link to the per-item URL (https://www.who.int + ItemDefaultUrl).
- **Cadence:** slow
- **CORS:** access-control-allow-origin: * (confirmed). Could be hit client-side, but server-side polling recommended.
- **Response shape:** Verified 200: {'@odata.context':..., value:[{Id, LastModified, PublicationDate, DateCreated, UrlName (e.g. '2026-DON606'), ItemDefaultUrl, Response(HTML), FurtherInformation(HTML), Summary, PublicationDateAndTime, Title, Epidemiology, Advice, Assessment, Overview, DonId, Provider}]}. Saw a real current item dated 2026-06-08 (Ebola Bundibugyo, DRC/Uganda).
- **Gotchas:** 1) Old feed https://www.who.int/feeds/entity/csr/don/en/rss.xml is 404 - do not use. 2) Fields Response/FurtherInformation/Advice contain HTML that must be sanitized before render. 3) DON is GLOBAL, not VI-specific - useful as a world-layer signal only. 4) ProMED: RSS permanently discontinued (2023); no free API; subscription-gated. Treat ProMED as excluded for an automated feed.

### Global Affairs Canada Travel Advisories (open data) — `gac-travel`

**T3 · VERIFIED** — Verified live. The official open-data JSON feed returns every country's current advisory state, advisory text, publish dates, and recent-update notes, in English and French. Clean, stable, no key.

- **Endpoint:** `https://data.international.gc.ca/travel-voyage/index-alpha-eng.json`
- **Auth:** none
- **Rate limits:** None published. Static-ish file served from Microsoft-IIS with ETag/Last-Modified - supports conditional GET (use If-Modified-Since to avoid refetching).
- **License:** Open Government Licence - Canada (https://open.canada.ca/en/open-government-licence-canada). Free reuse with attribution.
- **Attribution:** 'Contains information licensed under the Open Government Licence - Canada' / credit Global Affairs Canada.
- **Cadence:** slow
- **CORS:** No access-control-allow-origin header present (server-side polling recommended; or proxy via Convex).
- **Response shape:** Verified 200: {metadata:{generated:{timestamp,date}}, data:{<ISO2>:{country-id, country-iso, country-eng, advisory-state(0-3), date-published:{timestamp,date,asp}, has-advisory-warning, has-regional-advisory, has-content, recent-updates-type, eng:{name,url-slug,friendly-date,advisory-text,recent-updates}, fra:{...}}}}. advisory-state 0=normal, up to 3=avoid all travel. Saw current data generated 2026-06-11 07:20 EDT (e.g. AF=state 3 'Avoid all travel').
- **Gotchas:** Country-level only (this index has no sub-national geometry). For regional warnings there are separate per-country detail pages/JSON; the index just flags has-regional-advisory. Honor Last-Modified to poll cheaply.

### abuse.ch URLhaus + ThreatFox APIs — `abusech`

**T3 · NEEDS-KEY** — Confirmed the Auth-Key requirement is now enforced: both URLhaus (/v1/urls/recent) and ThreatFox (/api/v1/ get_iocs) returned HTTP 401 {'error':'Unauthorized'} with no key. A free Auth-Key from auth.abuse.ch is now mandatory for all abuse.ch APIs.

- **Endpoint:** `ThreatFox: curl -H 'Auth-Key: YOUR-KEY' -X POST https://threatfox-api.abuse.ch/api/v1/ -d '{"query":"get_iocs","days":1}'  |  URLhaus v1: curl -H 'Auth-Key: YOUR-KEY' -X POST https://urlhaus-api.abuse.ch/v1/urls/recent/limit/50/  |  URLhaus v2 export: curl 'https://urlhaus-api.abuse.ch/v2/files/exports/YOUR-KEY/recent.csv'`
- **Auth:** Free key + signup. Get a single Auth-Key at https://auth.abuse.ch/ (works across all abuse.ch APIs). Sent in HTTP header 'Auth-Key:' for ThreatFox and URLhaus v1 POST endpoints; embedded in the URL path for URLhaus v2 file exports.
- **Rate limits:** Dumps/exports regenerate every 5 minutes - docs explicitly say do not fetch more often than every 5 minutes.
- **License:** abuse.ch data is CC0 for the community / fair-use; commercial/for-profit use may require a paid Spamhaus subscription. Non-commercial OSINT use is fine.
- **Attribution:** Credit abuse.ch (URLhaus / ThreatFox).
- **Cadence:** medium
- **CORS:** 401 responses carried no ACAO; APIs are intended for server-side use. Convex server-side polling is the right model.
- **Response shape:** Not retrieved with data (401 without key - did not sign up per hard rules). Documented JSON: ThreatFox {query_status:'ok', data:[{id, ioc, ioc_type, threat_type, malware, confidence_level, first_seen, last_seen, tags, reference}]}. URLhaus recent {query_status, urls:[{id, urlhaus_reference, url, url_status, host, date_added, threat, tags, payloads}]}.
- **Gotchas:** Global threat intel, not VI-geo-filtered - you'd post-filter by host/TLD/.ca or by ASN if you want Canada relevance, but most value is as a global feed layer. The Auth-Key change is the key 2024/2025 update vs stale docs that show keyless POSTs.

### IODA (Internet Outage Detection & Analysis) - Georgia Tech — `netblocks-ioda`

**T3 · VERIFIED** — Confirmed NetBlocks has no public API; verified IODA as the usable alternative. The current host api.ioda.inetintel.cc.gatech.edu (Georgia Tech, since the 2021 move off CAIDA) is live - entity lookup and raw signal timeseries both returned 200 with real data for Canada.

- **Endpoint:** `Entities: https://api.ioda.inetintel.cc.gatech.edu/v2/entities/query?entityType=country&entityCode=CA  |  Signals: https://api.ioda.inetintel.cc.gatech.edu/v2/signals/raw/country/CA?from=<unixSec>&until=<unixSec>  |  Outage events: https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?from=<unixSec>&until=<unixSec>&entityType=country&entityCode=CA`
- **Auth:** none
- **Rate limits:** None published; lightweight nginx backend. Be polite (signal queries hit several InfluxDB backends per call).
- **License:** Data 'Copyright (c) 2021-2025 Georgia Tech Research Corporation. All Rights Reserved.' (embedded in every response). Free to query; credit IODA / Georgia Tech Internet Intelligence Lab; verify reuse terms for any redistribution.
- **Attribution:** Credit IODA, Georgia Tech (per the copyright string returned with data).
- **Cadence:** medium
- **CORS:** No access-control-allow-origin header present (server-side polling recommended).
- **Response shape:** Verified 200. entities/query -> {type:'entities.lookup', data:[{code:'CA', name:'Canada', type:'country', attrs:{fqid:'geo.netacuity.NA.CA'}}], copyright}. signals/raw -> {type:'signals', metadata, perf:[per-datasource timings], data:[[ timeseries per datasource ]]}. Datasources seen: bgp, ping-slash24, ping-slash24-loss/-latency, merit-nt, gtr/gtr-sarima/gtr-norm, mozilla, upstream-delay-*.
- **Gotchas:** Granularity is country (CA) and AS/region level, not Vancouver Island specifically - usable as a 'is Canada/BC connectivity dropping' world-layer signal. The host is api.ioda.inetintel.cc.gatech.edu (confirmed); older ioda.caida.org / ioda.inetintel.cc.gatech.edu/ioda/api paths are legacy. Swagger/OpenAPI docs exist for full param set.

### HealthMap (Boston Children's Hospital) — `healthmap`

**T3 · VERIFIED** — Still alive and actively updating. The site loads and the map's backing JSON endpoint returns current, real alerts (lat/lon, disease label, place, source, dated 2026-06-11). It works, but it is an UNDOCUMENTED internal endpoint - use with that caveat.

- **Endpoint:** `https://www.healthmap.org/getAlerts.php?type=11&from=2026-06-08&to=2026-06-11`
- **Auth:** none (for the public getAlerts endpoint). The historical 'official' HealthMap API required a key obtained by emailing the team; the getAlerts endpoint that powers the public map needs none.
- **Rate limits:** None published. Responses are large (~2.6 MB for a few days) - cache and poll infrequently.
- **License:** ToS for programmatic reuse is unclear/undocumented for this endpoint. Aggregates third-party news (Google News, ProMED, WHO/EuroSurveillance). Treat as personal/research OSINT use; do not redistribute raw aggregated content; honor underlying publisher rights.
- **Attribution:** Credit HealthMap (healthmap.org), Boston Children's Hospital; underlying alerts credit their original sources.
- **Cadence:** slow
- **CORS:** Sets a PHPSESSID cookie and no-cache headers; ACAO not present. Server-side polling recommended.
- **Response shape:** Verified 200: {markers:[{pin, label(disease(s)), place_id, place_name, lat, lon, alertids:[...], html(rendered list with source icon + headline link)}]}. Real current markers (e.g. Shigellosis Wayanad India; Nipah alert Kerala) dated 11 Jun 2026.
- **Gotchas:** Undocumented/internal endpoint - it could change without notice. Global, not VI-filtered (you'd filter markers by lat/lon to the VI bbox, but VI hits will be rare). 'html' field is pre-rendered markup that needs sanitizing. Good as a low-priority world disease layer; do not make it load-bearing.

### USGS Earthquake GeoJSON feeds — `usgs-quakes`

**T2 · VERIFIED · NEW** — New proposal and a strong fit for a globe. Verified live: global real-time earthquake GeoJSON, CORS-open, public domain, no key. Covers the Cascadia/VI region and offshore (e.g. west of Tofino) which the GAC/news sources do not.

- **Endpoint:** `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson  (also all_day, 2.5_day, significant_week, all_week). For VI you post-filter features by lon/lat to bbox -125.30..-123.10 / 48.20..51.10, or use the FDSN query API: https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minlatitude=48.2&maxlatitude=51.1&minlongitude=-125.3&maxlongitude=-123.1&starttime=2026-06-04`
- **Auth:** none
- **Rate limits:** Generous; summary feeds update roughly every 1-5 min. FDSN query API: avoid huge unbounded queries.
- **License:** Public domain (US Government work). Credit USGS appreciated.
- **Attribution:** Credit USGS Earthquake Hazards Program.
- **Cadence:** fast
- **CORS:** access-control-allow-origin: * (confirmed) - safe to fetch directly in-browser if desired.
- **Response shape:** Verified 200: GeoJSON FeatureCollection {metadata:{generated,url,title,status,api,count}, features:[{properties:{mag, place, time, updated, url, detail, felt, cdi, mmi, alert, status, tsunami, sig, net, code, ids, sources, types, type}, geometry:{type:'Point', coordinates:[lon,lat,depth]}, id}]}. Saw 8 live quakes incl. CA events.
- **Gotchas:** FDSN bbox params are minlatitude/maxlatitude/minlongitude/maxlongitude (not a single bbox arg). geometry coordinates are [lon, lat, depth_km]. Cascadia subduction + offshore Explorer/Juan de Fuca activity makes this highly VI-relevant.

### GDACS - Global Disaster Alert and Coordination System — `gdacs`

**T2 · VERIFIED · NEW** — New proposal. Verified live: global multi-hazard alert GeoJSON (floods, earthquakes, cyclones, volcanoes, droughts) with severity color coding. Good world-globe disaster layer; UN/EC-backed and free.

- **Endpoint:** `https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP  (also /SEARCH with date filters; RSS at https://www.gdacs.org/xml/rss.xml)`
- **Auth:** none
- **Rate limits:** None published; events update on the order of every ~15-60 min depending on hazard.
- **License:** GDACS data is freely available for use; attribution to GDACS (a joint UN OCHA / European Commission initiative) expected.
- **Attribution:** Credit GDACS (UN OCHA / European Commission).
- **Cadence:** medium
- **CORS:** No ACAO header observed; server-side polling recommended.
- **Response shape:** Verified 200: GeoJSON FeatureCollection {features:[{bbox, geometry:{type:'Point', coordinates:[lon,lat]}, properties:{eventtype(FL/EQ/TC/VO/DR), eventid, episodeid, eventname, glide, name, description, htmldescription, icon(severity-colored URL), ...}}]}. Saw a current 'Flood in United States' green-level event.
- **Gotchas:** Global, not VI-filtered - filter by geometry/bbox; most events are far from VI but cyclone/quake/tsunami alerts can be Pacific-relevant. eventtype codes: FL flood, EQ quake, TC tropical cyclone, VO volcano, DR drought, WF wildfire. Severity encoded in the icon color (Green/Orange/Red).

### ReliefWeb API (UN OCHA) — `reliefweb`

**T3 · NEEDS-KEY · NEW** — New proposal, and a stale-API catch: v1 is decommissioned (HTTP 410, 'use v2 instead') and v2 now REQUIRES an approved appname (HTTP 403 with a string appname). Free to obtain but you must request an appname. Good global humanitarian/disaster context layer once registered.

- **Endpoint:** `https://api.reliefweb.int/v2/disasters?appname=APPROVED-APPNAME&limit=20&sort[]=date:desc  (request an appname at https://apidoc.reliefweb.int/parameters#appname)`
- **Auth:** Free 'key' = an approved appname registered via the ReliefWeb API docs (no account/credentials, just an approved identifier string). Unapproved appnames return 403.
- **Rate limits:** 1000 calls/day per appname per the docs; data updates continuously but disaster records change slowly.
- **License:** ReliefWeb content (OCHA) is largely freely reusable with attribution; individual reports retain their source org's rights.
- **Attribution:** Credit ReliefWeb / UN OCHA and link back to the source report.
- **Cadence:** slow
- **CORS:** access-control-allow-origin: * (confirmed on both the 410 and 403 responses).
- **Response shape:** Not retrieved with data (403 - unapproved appname; did not register per hard rules). Documented v2: {data:[{id, fields:{name, status, date:{created}, primary_country, type:[{name}], glide}}], totalCount, links}.
- **Gotchas:** Two stale-doc traps confirmed: (1) v1 base URL is dead (410), use v2; (2) v2 rejects arbitrary appnames (403) - the appname must be approved. Global, not VI-relevant directly; useful as world context. If you don't want the appname dance, GDACS + USGS already cover the disaster globe layer keylessly.

## Cameras & Live Media (flagship)

> HONEST ASSESSMENT. The flagship is in great shape but training-data assumptions would have shipped a broken product twice over. (1) The single most important finding: DriveBC's legacy image host - which the v1 API and the BC Data Catalogue CSV both still advertise - serves a 'no longer available' placeholder PNG for every camera while returning HTTP 200, so nothing would error, you'd just render 207 identical apology cards. Build exclusively on www.drivebc.ca/api/webcams/ + www.drivebc.ca/images/{id}.jpg (both verified with live, timestamped JPEGs). (2) The provided VI bbox is wrong for this island: it cuts off everything west of -125.30, losing 19 DriveBC cams including Tofino/Ucluelet, Gold River, Port McNeill and Port Hardy (-127.47). Filter DriveBC by region_name=='Vancouver Island' and widen the project bbox to roughly lng -128.5 for all clusters, or the North Island doesn't exist in BlindSpot. BUILD ORDER: 1. DriveBC (180 cams, clean license, rich freshness metadata - the map layer practically designs itself off update_period_mean/marked_stale); 2. YouTube live tier (6 verified org cams: CHEK x2, Pacific Sands x2, Wickaninnish, OrcaLab - store CHANNEL ids not video ids, live IDs rotate); 3. BC Ferries terminal cams (instant value, trivial code); 4. LiveATC CYYJ audio (one-line <audio> element, mount cyyj2_twr_inner verified); 5. Mount Washington Ozolio posters; 6. Windy only after keying up and auditing overlap - its main value is non-DriveBC tourism cams and its free tier's 10-min token expiry plus heavyweight attribution makes it a second-class citizen. LEGAL CAVEATS: DriveBC is OGL-BC (clean, attribute DriveBC.ca). BC Ferries and Ozolio endpoints are production-public but ToS-unreviewed - cache server-side, attribute, low volume, removable. Windy has strict mandatory linkback terms. YouTube must stay in the iframe player. LiveATC ToS deferred to RF cluster as scoped. GAPS: no official cams at YYJ or YQQ airports (patbaywebcam.com is a personal weather station - excluded by the no-personal-cams rule), UVic campus cam is retired (404), GVHA's own webcam page is gone (CHEK covers the Inner Harbour), NAV CANADA metcam was checked and has NO VI aerodrome coverage (CYAZ/CYZT/CYBL/CYQQ/CYCD/CYYJ all 404 across 8 view patterns; pattern itself verified working via CYAY St. Anthony - don't re-litigate this). Open HLS is near-nonexistent on the island (one rtsp.me feed with IP-pinned tokens); accept that video = YouTube embeds here. Race Rocks is the one loose thread worth a follow-up - sanctioned, spectacular, just needs a browser network-tab session or a permission email. Also note LiveATC/CHEK HTML pages are Cloudflare-403 to server-side fetchers; their media endpoints are not - keep any liveness checks pointed at the streams, not the pages.

### DriveBC Highway Webcams (new drivebc.ca API) — `drivebc-cams-vi`

**T1 · VERIFIED** — DEFINITIVE VERDICT: build on the new https://www.drivebc.ca/api/webcams/ API + https://www.drivebc.ca/images/{id}.jpg. The legacy image host is DEAD: images.drivebc.ca/bchighwaycam/pub/cameras/{id}.jpg now serves a 420x315 'Images from this service are no longer available' placeholder PNG for every cam, and the v1 imageDisplay API endpoint returns 403. I fetched live JPEGs from the new path for cams 427 (Malahat Summit, 800x468, 93.9KB, on-image timestamp matching fetch time), 9 (Nanaimo Parkway, 640x498) and 622 (800x468). 1060 cams total; 207 inside the given VI bbox (206 is_on+should_appear), of which 161 are region 'Vancouver Island' and 46 are 'Lower Mainland' bleed-through at the eastern bbox edge. CRITICAL: 19 additional Vancouver Island region cams fall OUTSIDE the bbox to the west (Tofino/Ucluelet Hwy 4, Gold River, Port McNeill, Port Hardy at lng -127.47) - filter by region_name=='Vancouver Island' (180 cams) instead of bbox.

- **Endpoint:** `https://www.drivebc.ca/api/webcams/ (full inventory JSON, ~1.1MB; no bbox param - filter server-side). Images: https://www.drivebc.ca/images/{id}.jpg (cache-bust with ?t=epoch). Day archive frame list: https://www.drivebc.ca/api/webcams/{id}/replayTheDay/`
- **Auth:** none
- **Rate limits:** None documented. Single 1.1MB inventory call covers everything; be polite on image fetches (per-cam update_period_mean means most cams only change every 3-20 min).
- **License:** BC Data Catalogue record 'DriveBC HighwayCams' is Open Government Licence - British Columbia (license_id 2, confirmed via CKAN API). New site/API is the open-source bcgov/drivebc.ca project. Webcam images carry DriveBC.ca watermark.
- **Attribution:** dbc_mark field is 'DriveBC.ca'; per-cam credit field names partner cam owners (often empty). Attribute 'DriveBC.ca' per OGL-BC attribution requirement.
- **Cadence:** medium: poll inventory JSON every 5 min (last_update_modified tells you exactly which cams have fresh frames); fetch each cam image only when last_update_modified advances, or per-cam at update_period_mean. Do not poll images faster than ~2-3 min - median cam refresh is ~15 min.
- **CORS:** New API and image host send NO Access-Control-Allow-Origin header (browser fetch would fail; irrelevant for Convex server-side polling). Legacy images.drivebc.ca sent ACAO:* but its images are dead.
- **Response shape:** Array of cam objects: id, name, caption, links.imageDisplay (relative /images/{id}.jpg?t=...), links.replayTheDay, region/region_name, highway fields, location {type:'Point', coordinates:[lng,lat]}, orientation (N/S/E/W/NE/...), elevation, is_on, should_appear, is_new, is_on_demand, marked_stale, marked_delayed, last_update_attempt, last_update_modified (ISO8601), update_period_mean (seconds; VI cams: min 174, median ~906, max 1199), update_period_stddev, https_cam, credit, dbc_mark, nearby_objs counts. Image responses: image/jpeg, cache-control: no-cache, etag present. replayTheDay returns JSON array of YYYYMMDDHHMMSS frame timestamps.
- **Gotchas:** 1) Legacy v1 API (images.drivebc.ca/webcam/api/v1/webcams) still serves plausible-looking metadata with ACAO:* - a trap, since every image link it returns is the placeholder PNG. 2) BC Data Catalogue CSV is also stale (points at dead image paths, lost its refresh-seconds column) - use only as a static backup. 3) Honor marked_stale/marked_delayed in the UI (e.g. cam 8 Malahat Drive N was 8 days stale while still listed). 4) Image dimensions vary per cam (640x498 vs 800x468).

### Windy Webcams API v3 — `windy-webcams`

**T2 · NEEDS-KEY** — Endpoint confirmed live: unauthenticated GET returns 403 {"message":"Missing Header 'x-windy-api-key' with API key"}, proving the v3 API is up. Everything else documented from official docs/pricing/terms pages. VI coverage could not be enumerated without a key (did not sign up per rules).

- **Endpoint:** `https://api.windy.com/webcams/api/v3/webcams with header 'x-windy-api-key: KEY' (single cam: /webcams/api/v3/webcams/{webcamId}). Docs state filters for country/category/location exist; exact bbox param syntax not verifiable without a key - confirm in the authenticated docs playground at https://api.windy.com/webcams/docs.`
- **Auth:** free key + signup at https://api.windy.com/keys (docs warn new keys take a few minutes to propagate worldwide)
- **Rate limits:** Free tier: listing offset capped at 1000; image URLs are tokenized and expire ~10 minutes (API docs say 10 min, pricing page says 15 min - assume 10); expired URLs return 401; reduced image resolution. Professional tier (EUR 9,990/yr): 24h URL validity, full-size images, offset 10,000. No documented requests/day cap; ToS forbids 'inappropriate load'.
- **License:** Proprietary - Windyty S.E. terms at https://api.windy.com/webcams/terms. Images usable 'as is' only, no upscaling/modification, only URLs provided by the API. No uptime guarantee; access terminable.
- **Attribution:** Mandatory: 'Webcams provided by Windy.com' courtesy text in a corner, linking to windy.com AND their add-a-webcam page; every displayed image must hyperlink to the webcam's page (webcam.urls) or its timelapse player (webcam.player).
- **Cadence:** medium (5-15 min) for metadata; image URLs must be re-minted within 10 min of display
- **CORS:** unknown (cannot test without key); irrelevant server-side
- **Response shape:** Not observed (403 without key). Docs describe webcam objects with location, preview images, timelapse player URLs.
- **Gotchas:** 10-min image token expiry makes naive caching impossible on free tier - the official guidance is to re-call the API on every page load. For BlindSpot, proxy pattern: Convex re-fetches metadata to mint fresh image URLs just-in-time. Value-add over DriveBC is private/tourism cams (harbours, beaches); much of its BC inventory likely re-aggregates DriveBC anyway - audit overlap once keyed.

### YouTube live cams - Vancouver Island (sanctioned orgs) — `youtube-live-vi`

**T2 · VERIFIED** — 6 solid organization-run live cams verified via YouTube oEmbed (oEmbed 200 + iframe HTML = embeddable): CHEK Media's two 24/7 harbour cams (Victoria Ships Point, Nanaimo Port Theatre), Pacific Sands Beach Resort's two Cox Bay/Tofino surf cams, Wickaninnish Inn's Chesterman Beach cam (channel-based live embed), and explore.org's OrcaLab Main Cams on Hanson Island (just NW of bbox, covers Johnstone Strait orca corridor).

- **Endpoint:** `CHEK Victoria Harbour: https://www.youtube.com/watch?v=ZvqDwjNoN7Y | CHEK Nanaimo Harbour: https://www.youtube.com/watch?v=qU7gQ5Aj2gY | Pacific Sands Cox Bay: https://www.youtube.com/watch?v=LqaP8m2OIqM | Pacific Sands HD Beach Cam: https://www.youtube.com/watch?v=g2HGBY2v-wo | Wickaninnish Chesterman Beach (stable channel embed): https://www.youtube.com/embed/live_stream?channel=UCW1DIPA5POQZ1Jh1x_vl_uQ | explore.org OrcaLab: https://www.youtube.com/watch?v=hTOmWcmr2Tc (channel @orcalab2398). Verify embeddability programmatically via https://www.youtube.com/oembed?url={watchUrl}&format=json`
- **Auth:** none for iframe embed/oEmbed; YouTube Data API v3 key (free, console.cloud.google.com) only if you want programmatic live-stream discovery
- **Rate limits:** oEmbed: undocumented but lenient; Data API v3: 10,000 units/day free quota (search costs 100 units)
- **License:** YouTube ToS: playback must go through the YouTube iframe player (no HLS extraction). Owners control embeddability - all six currently allow it.
- **Attribution:** Player shows channel branding automatically. Owners: CHEK Media (Victoria TV station, sponsor Helijet), Pacific Sands Beach Resort, Wickaninnish Inn, explore.org/OrcaLab (Pearson partnership).
- **Cadence:** slow (30-60 min) for re-resolving live video IDs; the streams themselves are continuous
- **CORS:** n/a - iframe embed, not fetched cross-origin
- **Response shape:** oEmbed JSON: title, author_name, author_url, thumbnail_url, html (iframe snippet). E.g. 'CHEK News | Victoria Harbour Cam 24/7 Livestream' by 'CHEK Media'.
- **Gotchas:** Live video IDs ROTATE when a stream restarts (found two coexisting Nanaimo IDs: qU7gQ5Aj2gY and S3AUkHAabJA, plus a defunct older Victoria ID t1rS2I6zLa4). Store channel IDs, not video IDs; use the /embed/live_stream?channel= pattern (verified working for Wickaninnish) or re-resolve via oEmbed/Data API. Excluded: Hancock Wildlife eagle cams (all current nests are Lower Mainland - Delta/West Vancouver, not VI); Mount Washington's YouTube is timelapse VODs only, not live. Tofino cams sit just west of the stated bbox at ~-125.9 - they ARE Vancouver Island, widen your bbox.

### Institutional snapshot cams (Mount Washington, BC Ferries, airports, UVic) — `public-jpeg-cams`

**T2 · VERIFIED** — Mixed bag, two strong wins verified live: Mount Washington Alpine Resort via Ozolio poster API (1280x720 AXIS JPEG timestamped to the minute, ACAO:*) and BC Ferries' official terminal-conditions image API (Swartz Bay/Departure Bay/Duke Point all 200 image/jpeg with fresh Last-Modified). Losses: Victoria International Airport has no official public cam (patbaywebcam.com is a personal weather station - excluded under no-personal-cams rule), Comox Valley Airport has no official cam (nearby Courtenay Airpark Assoc. covers it - see new source), UVic campus cam pages 404 (retired), GVHA webcams page 404 (CHEK's YouTube cam now covers the Inner Harbour).

- **Endpoint:** `Mount Washington (Nordic Lodge): https://relay.ozolio.com/pub.api?cmd=poster&oid=EMB_ONTI0000039F | second cam: https://relay.ozolio.com/pub.api?cmd=poster&oid=EMB_SKAO00000241 (live player uses relay.ozolio.com jwebcam with camera_doc CID_VOOW000008F9; source page https://mountwashington.ca/webcams.html) | BC Ferries: https://apigateway.bcferries.com/api/currentconditions/1.0/images/terminals/cam1_SWB.jpg (Swartz Bay; also cam2_SWB, cam1_NAN Departure Bay, cam2_NAN, cam1_duk Duke Point - lowercase 'duk' - cam2_duk; mainland: HSB/TSA/LNG)`
- **Auth:** none for either
- **Rate limits:** Ozolio poster: cache-control max-age=900 (15 min) - do not poll faster. BC Ferries: undocumented; images refresh roughly every minute (Last-Modified was seconds old at fetch).
- **License:** Neither is formally licensed for reuse. Ozolio poster is the same endpoint the resort's own embed loads, served with permissive CORS - moderate hotlink sanction, attribute Mount Washington Alpine Resort. BC Ferries apigateway is the production API behind bcferries.com Current Conditions - functionally public but ToS-unreviewed; attribute BC Ferries and keep volume trivial.
- **Attribution:** Mount Washington Alpine Resort (cam labels burned into image, e.g. 'Nordic'); BC Ferries for terminal cams
- **Cadence:** Ozolio: slow (15 min, matches max-age). BC Ferries: medium (2-5 min is plenty; near-real-time but be conservative without a documented ToS).
- **CORS:** Ozolio: Access-Control-Allow-Origin:* (verified). BC Ferries: Access-Control-Allow-Origin:* (verified).
- **Response shape:** Ozolio: image/jpeg 1280x720, EXIF intact (AXIS P5624-E-MkII, datetime matching fetch: 2026:06:11 05:42:00), cache-control max-age=900. BC Ferries: image/jpeg 320x180 (cam1_SWB 10.3KB), Last-Modified header current, full CORS header set.
- **Gotchas:** Ozolio full live video needs their session API (guessed HLS path 404s) - treat as 15-min stills unless you reverse the jwebcam session handshake (not recommended). BC Ferries images are small 320x180 thumbs at this path; check for larger variants once a formal ToS read happens. Hotlink risk on both: cache server-side via Convex rather than hotlinking from the client, and be ready to drop either source on request.

### LiveATC CYYJ tower audio — `audio-streams`

**T2 · VERIFIED** — Playable in a plain HTML5 audio element - verified end-to-end. CYYJ has exactly one feed right now: 'CYYJ Tower (Inner)', status UP, mount cyyj2_twr_inner. Direct fetch: https://d.liveatc.net/cyyj2_twr_inner 302s to a shard (s1-fmt2.liveatc.net) and returns 200 content-type audio/mpeg with icy-name 'CYYJ Tower (Inner)' and Access-Control-Allow-Origin:* on both hops. <audio src="https://d.liveatc.net/cyyj2_twr_inner"> will just work.

- **Endpoint:** `https://d.liveatc.net/cyyj2_twr_inner (Icecast MP3; playlist form https://www.liveatc.net/play/cyyj2_twr_inner.pls; archive at /archive.php?m=cyyj2_twr_inner)`
- **Auth:** none for stream playback
- **Rate limits:** n/a - continuous single connection; listener count is public (1 listener at check time)
- **License:** Deferred to RF cluster per scope. Coordinate-level verdict only: technically playable, CORS-open.
- **Attribution:** LiveATC.net (their embed/branding conventions - RF cluster to confirm)
- **Cadence:** n/a (continuous stream); re-check feed status/mount name slow (daily)
- **CORS:** Access-Control-Allow-Origin:* on both the d.liveatc.net redirector and the shard stream host (verified)
- **Response shape:** 302 redirect with single-use ?nocache= URL, then 200 audio/mpeg with Icecast headers (icy-name 'CYYJ Tower (Inner)')
- **Gotchas:** 1) liveatc.net HTML pages (search/feedindex) are Cloudflare-403 to curl AND WebFetch - needed a real browser (Playwright) to enumerate feeds; the stream endpoints themselves are NOT blocked. 2) All intuitive mount guesses (cyyj, cyyj_twr, cyyj1, cyyj_app, cyyj_gnd) 404 - the real mount is cyyj2_twr_inner; verify mount names from the airport page, never guess. 3) Always enter via d.liveatc.net/{mount} - shard hosts and nocache tokens change per request. 4) Sanity baseline: kjfk_twr returned 200 audio/mpeg through the same path.

### Open HLS cams on Vancouver Island — `hls-cams`

**T3 · VERIFIED** — Exactly one open HLS feed found and verified: Courtenay Airpark's cam served via rtsp.me. The embed page yields a tokenized manifest that fetched 200 application/vnd.apple.mpegurl with a valid #EXTM3U body and ACAO:*. Everything else on the island that streams video does it through YouTube (CHEK, Pacific Sands, Wickaninnish, explore.org) or session-gated players (Ozolio) - open HLS is genuinely scarce here.

- **Endpoint:** `Embed (stable): https://rtsp.me/embed/rZZTZdsN/ - scrape it to extract the short-lived manifest URL of form https://tor.rtsp.me/{signed-token}/{expiry-epoch}/hls/rZZTZdsN.m3u8?ip={viewer-ip}`
- **Auth:** none, but manifest URLs are signed per-IP with an expiry timestamp - must be re-minted from the embed page per session
- **Rate limits:** undocumented (rtsp.me free hosting tier)
- **License:** Cam owner: Courtenay Airpark Association (volunteer org) - they publicly embed it on courtenayairpark.com/Webcams. rtsp.me ToS unreviewed; lowest-friction sanctioned use is iframing their embed URL rather than re-serving the HLS.
- **Attribution:** Courtenay Airpark Association
- **Cadence:** continuous stream; re-mint token on session start; verify cam alive slow (hourly)
- **CORS:** Access-Control-Allow-Origin:* on the manifest (verified); segments assumed same
- **Response shape:** #EXTM3U, #EXT-X-VERSION:3, ~3.7s segments (rZZTZdsN-1-403.ts style names), live windowed playlist
- **Gotchas:** The ip= query param pins the token to the requesting IP - a manifest minted by Convex servers will NOT play in the user's browser. Either iframe the rtsp.me embed client-side (recommended, also more clearly sanctioned) or proxy segments. Token expiry means no static catalog URL.

### BC Ferries current-conditions terminal cams (split-out) — `bc-ferries-terminal-cams`

**T2 · VERIFIED · NEW** — Worth its own catalog entry separate from the misc JPEG bucket: BC Ferries' production current-conditions API serves per-terminal cam JPEGs for the three main VI terminals (Swartz Bay, Departure Bay, Duke Point) plus mainland counterparts, refreshed near-real-time, with full CORS. Verified all three VI terminals 200 image/jpeg with Last-Modified seconds old. Pairs perfectly with sailing-status data for a ferry ops panel.

- **Endpoint:** `https://apigateway.bcferries.com/api/currentconditions/1.0/images/terminals/cam1_SWB.jpg | cam2_SWB | cam1_NAN | cam2_NAN | cam1_duk | cam2_duk (note lowercase 'duk'; mainland: cam1_HSB..cam4_HSB, cam1_TSA..cam4_TSA, cam1_LNG, cam2_LNG)`
- **Auth:** none
- **Rate limits:** undocumented - unofficial-but-public production API; poll gently
- **License:** No published API ToS; this is the image path behind bcferries.com Current Conditions pages. Treat as tolerated hotlink: cache server-side, attribute BC Ferries, low volume, be prepared to remove.
- **Attribution:** BC Ferries
- **Cadence:** medium (2-5 min)
- **CORS:** Access-Control-Allow-Origin:*, Access-Control-Allow-Methods: GET (verified)
- **Response shape:** image/jpeg, 320x180, ~10-16KB, current Last-Modified header
- **Gotchas:** Endpoint discovered via aggregator hotlinks plus direct verification - not from official docs, so the path could change without notice. There is also a legacy orca.bcferries.com/cc/data/cam1_TSA.jpg host still floating around; prefer apigateway. Terminal codes are not all uppercase (duk).

### Courtenay Airpark Association webcam (Comox Valley) — `courtenay-airpark-cam`

**T3 · VERIFIED · NEW** — Org-run cam looking east over the Courtenay Airpark runway, float-plane ramp and windsock - the best available substitute for the nonexistent official Comox Valley Airport cam, and the island's only verified open HLS source. Manifest fetched live (see hls-cams entry for full details).

- **Endpoint:** `https://courtenayairpark.com/Webcams (page) embedding https://rtsp.me/embed/rZZTZdsN/ (iframe this)`
- **Auth:** none
- **Rate limits:** undocumented (rtsp.me hosted)
- **License:** Publicly embedded by the association on their own site; iframe their embed for cleanest sanction. rtsp.me ToS unreviewed.
- **Attribution:** Courtenay Airpark Association
- **Cadence:** continuous; liveness check hourly
- **CORS:** manifest has Access-Control-Allow-Origin:* but tokens are viewer-IP-bound - iframe instead of fetching
- **Response shape:** rtsp.me embed page -> tokenized HLS manifest (application/vnd.apple.mpegurl, 3.7s TS segments)
- **Gotchas:** Same IP-pinned token caveat as hls-cams. Cam location is Courtenay Airpark (49.67, -124.98 area), not CFB Comox/YQQ itself.

### Race Rocks Ecological Reserve live cams (Pearson College) — `race-rocks-cams`

**T3 · VERIFY-FAILED** — No live stream exists anywhere today: racerocks.ca camera pages contain zero embeds (legacy WordPress nav pages only), YouTube live-filtered search has no Race Rocks streams, and the correct Pearson College channel (@PearsonUWC, UCYKD8fNdEb3-61s8E5xWuZw) shows isLiveNow:0 with only archived past broadcasts. Optionally tripwire-poll the channel /live URL in case the cams return.

- **Endpoint:** `candidate watch path: https://www.youtube.com/channel/UCYKD8fNdEb3-61s8E5xWuZw/live (Pearson College UWC, handle @PearsonUWC) — nothing live there now`
- **Auth:** none
- **Rate limits:** n/a (YouTube embed/oEmbed if it ever comes back)
- **License:** Pearson College UWC content; YouTube embeds permitted via standard embed/oEmbed
- **Attribution:** Pearson College UWC / racerocks.ca
- **Cadence:** if re-checking for revival: slow (30-60 min) probe of the channel /live endpoint
- **Response shape:** n/a — no live stream exists today
- **Gotchas:** Round-1 attempt superseded by retry (was: verify-failed). Verified dead end 2026-06-11: (1) racerocks.ca/video-cameras/ plus camera-1 and camera-5 subpages have ONLY navigation links and still images — no iframes, no YouTube/ipcamlive/m3u8 anywhere in the HTML. (2) YouTube live-filtered search for 'race rocks live' returned unrelated cams (Revelstoke trains, Soo Locks...). (3) Correct channel is @PearsonUWC (note: @PearsonCollegeUWC 404s); its Streams tab has only archives — the sole Race Rocks item is 'Live Seagull Nest | Race Rocks, Pearson College UWC' (videoId cRp-nlsHX_c, ~11h50m archive, confirmed embeddable via oEmbed). Cams appear offline/retired, not merely hard to find.

### Orcasound live Salish Sea hydrophones (live.orcasound.net) — `orcasound`

**T1 · VERIFIED · NEW** — Live hydrophone network, verified end to end: feeds API -> S3 latest.txt -> live HLS playlist with fresh 10s segments. 9 feed nodes returned. IN BBOX (both on the Haro Strait shore of San Juan Island, directly facing VI / Victoria approaches): orcasound-lab (rpi_orcasound_lab, 48.5583, -123.1736) and andrews-bay (rpi_andrews_bay, 48.5467, -123.1664). Just outside bbox but adjacent VI waters: north-sjc (48.5913, -123.0588), port-townsend (48.1357, -122.7606), bush-point (48.0337, -122.6040). Puget Sound (out of scope): sunset-bay, mast-center, plus hidden nodes point-robinson and das-haro (visible=false).

- **Endpoint:** `Feeds list: https://live.orcasound.net/api/json/feeds (JSON:API). Audio: https://audio-orcasound-net.s3.amazonaws.com/{node_name}/latest.txt returns a unix timestamp naming the current folder, then https://audio-orcasound-net.s3.amazonaws.com/{node_name}/hls/{timestamp}/live.m3u8 (verified: 200, growing live playlist, #EXTINF ~10.0s MPEG-TS segments live000.ts..., EXT-X-PROGRAM-DATE-TIME present).`
- **Auth:** None for feeds API or S3 audio.
- **Rate limits:** None published. Heroku-hosted API; S3 audio scales fine. Normal HLS player polling (~every 10 s while playing) is the intended pattern.
- **License:** Code: orcasite repo is AGPL-3.0 (verified via GitHub API), open-source project confirmed. Audio data license is NOT explicitly stated anywhere I verified; treat as 'free to listen, attribute Orcasound'. Each feed's intro_html credits the host org (e.g. MaST Center / Highline College), so surface those credits too.
- **Attribution:** Attribute Orcasound (live.orcasound.net) and the individual hydrophone host named in the feed's intro_html.
- **Cadence:** slow (30-60 min) for the feeds list (it changes rarely). latest.txt only on user play / stream stall recovery. live.m3u8 polling is the HLS player's job, not the Convex poller's.
- **CORS:** S3 audio: Access-Control-Allow-Origin: * with GET/HEAD allowed (verified with Origin header), so hls.js playback in the browser works directly against S3. Feeds API: no ACAO header observed, fetch it server-side.
- **Response shape:** Feeds: JSON:API {data:[{attributes:{name, slug, node_name, visible, bucket, bucket_region, location_point:{coordinates:[lng,lat]}, intro_html, orcahello_id, ...}}]} (Content-Type application/vnd.api+json, ~22 KB). Audio: standard HLS v3 playlist + .ts segments (audio-only MPEG-TS).
- **Gotchas:** 1) The hls/{timestamp} folder rolls over (the verified playlist started at 2026-06-11T00:00:14-0700 and latest.txt was last modified 07:00 UTC), so a player must re-read latest.txt when the stream stalls or on start, not cache the folder forever. hls.js handles the in-playlist live edge; the folder rollover is on you. 2) m3u8/segments served as binary/octet-stream content-type; hls.js does not care, but do not content-type sniff. 3) Native HTML5 <audio src=m3u8> only works in Safari; ship hls.js for everything else. 4) Filter visible=true. 5) There is also a GraphQL API at live.orcasound.net/graphql (orcasite backend) if JSON:API ever lacks something; not exercised in this recon.
