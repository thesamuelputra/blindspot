/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as alerts from "../alerts.js";
import type * as auth from "../auth.js";
import type * as cameras from "../cameras.js";
import type * as crons from "../crons.js";
import type * as feeds_adsbAircraft from "../feeds/adsbAircraft.js";
import type * as feeds_aisVessels from "../feeds/aisVessels.js";
import type * as feeds_avalancheCanada from "../feeds/avalancheCanada.js";
import type * as feeds_bcDrought from "../feeds/bcDrought.js";
import type * as feeds_bcEvacOrders from "../feeds/bcEvacOrders.js";
import type * as feeds_bcFerries from "../feeds/bcFerries.js";
import type * as feeds_bcRfcAdvisories from "../feeds/bcRfcAdvisories.js";
import type * as feeds_bcSnow from "../feeds/bcSnow.js";
import type * as feeds_bcTransit from "../feeds/bcTransit.js";
import type * as feeds_bcTransitIngest from "../feeds/bcTransitIngest.js";
import type * as feeds_bchydroOutages from "../feeds/bchydroOutages.js";
import type * as feeds_bcwsFires from "../feeds/bcwsFires.js";
import type * as feeds_celestrak from "../feeds/celestrak.js";
import type * as feeds_cloudflareRadar from "../feeds/cloudflareRadar.js";
import type * as feeds_cwfisHotspots from "../feeds/cwfisHotspots.js";
import type * as feeds_dfoClosures from "../feeds/dfoClosures.js";
import type * as feeds_dfoTides from "../feeds/dfoTides.js";
import type * as feeds_drivebcCams from "../feeds/drivebcCams.js";
import type * as feeds_drivebcEvents from "../feeds/drivebcEvents.js";
import type * as feeds_ecccAlerts from "../feeds/ecccAlerts.js";
import type * as feeds_ecccAqhi from "../feeds/ecccAqhi.js";
import type * as feeds_ecccConditions from "../feeds/ecccConditions.js";
import type * as feeds_ecccHydrometric from "../feeds/ecccHydrometric.js";
import type * as feeds_gpsjam from "../feeds/gpsjam.js";
import type * as feeds_ioda from "../feeds/ioda.js";
import type * as feeds_launchLibrary from "../feeds/launchLibrary.js";
import type * as feeds_naadPelmorex from "../feeds/naadPelmorex.js";
import type * as feeds_nasaFirms from "../feeds/nasaFirms.js";
import type * as feeds_nasaNeo from "../feeds/nasaNeo.js";
import type * as feeds_ndbcBuoys from "../feeds/ndbcBuoys.js";
import type * as feeds_newsRss from "../feeds/newsRss.js";
import type * as feeds_noaaSwpc from "../feeds/noaaSwpc.js";
import type * as feeds_nrcanQuakes from "../feeds/nrcanQuakes.js";
import type * as feeds_ntwcTsunami from "../feeds/ntwcTsunami.js";
import type * as feeds_oncOceans from "../feeds/oncOceans.js";
import type * as feeds_openChargeMap from "../feeds/openChargeMap.js";
import type * as feeds_openMeteo from "../feeds/openMeteo.js";
import type * as feeds_permits from "../feeds/permits.js";
import type * as feeds_pnsnTremor from "../feeds/pnsnTremor.js";
import type * as feeds_ripestat from "../feeds/ripestat.js";
import type * as feeds_sondehub from "../feeds/sondehub.js";
import type * as feeds_sstErddap from "../feeds/sstErddap.js";
import type * as feeds_usgsQuakes from "../feeds/usgsQuakes.js";
import type * as feeds_uvicMesh from "../feeds/uvicMesh.js";
import type * as http from "../http.js";
import type * as lib_fetchSource from "../lib/fetchSource.js";
import type * as lib_geo from "../lib/geo.js";
import type * as lib_ingest from "../lib/ingest.js";
import type * as lib_movers from "../lib/movers.js";
import type * as lib_xml from "../lib/xml.js";
import type * as signals from "../signals.js";
import type * as snapshots from "../snapshots.js";
import type * as sources from "../sources.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  alerts: typeof alerts;
  auth: typeof auth;
  cameras: typeof cameras;
  crons: typeof crons;
  "feeds/adsbAircraft": typeof feeds_adsbAircraft;
  "feeds/aisVessels": typeof feeds_aisVessels;
  "feeds/avalancheCanada": typeof feeds_avalancheCanada;
  "feeds/bcDrought": typeof feeds_bcDrought;
  "feeds/bcEvacOrders": typeof feeds_bcEvacOrders;
  "feeds/bcFerries": typeof feeds_bcFerries;
  "feeds/bcRfcAdvisories": typeof feeds_bcRfcAdvisories;
  "feeds/bcSnow": typeof feeds_bcSnow;
  "feeds/bcTransit": typeof feeds_bcTransit;
  "feeds/bcTransitIngest": typeof feeds_bcTransitIngest;
  "feeds/bchydroOutages": typeof feeds_bchydroOutages;
  "feeds/bcwsFires": typeof feeds_bcwsFires;
  "feeds/celestrak": typeof feeds_celestrak;
  "feeds/cloudflareRadar": typeof feeds_cloudflareRadar;
  "feeds/cwfisHotspots": typeof feeds_cwfisHotspots;
  "feeds/dfoClosures": typeof feeds_dfoClosures;
  "feeds/dfoTides": typeof feeds_dfoTides;
  "feeds/drivebcCams": typeof feeds_drivebcCams;
  "feeds/drivebcEvents": typeof feeds_drivebcEvents;
  "feeds/ecccAlerts": typeof feeds_ecccAlerts;
  "feeds/ecccAqhi": typeof feeds_ecccAqhi;
  "feeds/ecccConditions": typeof feeds_ecccConditions;
  "feeds/ecccHydrometric": typeof feeds_ecccHydrometric;
  "feeds/gpsjam": typeof feeds_gpsjam;
  "feeds/ioda": typeof feeds_ioda;
  "feeds/launchLibrary": typeof feeds_launchLibrary;
  "feeds/naadPelmorex": typeof feeds_naadPelmorex;
  "feeds/nasaFirms": typeof feeds_nasaFirms;
  "feeds/nasaNeo": typeof feeds_nasaNeo;
  "feeds/ndbcBuoys": typeof feeds_ndbcBuoys;
  "feeds/newsRss": typeof feeds_newsRss;
  "feeds/noaaSwpc": typeof feeds_noaaSwpc;
  "feeds/nrcanQuakes": typeof feeds_nrcanQuakes;
  "feeds/ntwcTsunami": typeof feeds_ntwcTsunami;
  "feeds/oncOceans": typeof feeds_oncOceans;
  "feeds/openChargeMap": typeof feeds_openChargeMap;
  "feeds/openMeteo": typeof feeds_openMeteo;
  "feeds/permits": typeof feeds_permits;
  "feeds/pnsnTremor": typeof feeds_pnsnTremor;
  "feeds/ripestat": typeof feeds_ripestat;
  "feeds/sondehub": typeof feeds_sondehub;
  "feeds/sstErddap": typeof feeds_sstErddap;
  "feeds/usgsQuakes": typeof feeds_usgsQuakes;
  "feeds/uvicMesh": typeof feeds_uvicMesh;
  http: typeof http;
  "lib/fetchSource": typeof lib_fetchSource;
  "lib/geo": typeof lib_geo;
  "lib/ingest": typeof lib_ingest;
  "lib/movers": typeof lib_movers;
  "lib/xml": typeof lib_xml;
  signals: typeof signals;
  snapshots: typeof snapshots;
  sources: typeof sources;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
