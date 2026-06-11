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
import type * as crons from "../crons.js";
import type * as feeds_bcEvacOrders from "../feeds/bcEvacOrders.js";
import type * as feeds_bchydroOutages from "../feeds/bchydroOutages.js";
import type * as feeds_bcwsFires from "../feeds/bcwsFires.js";
import type * as feeds_cwfisHotspots from "../feeds/cwfisHotspots.js";
import type * as feeds_drivebcEvents from "../feeds/drivebcEvents.js";
import type * as feeds_ecccAlerts from "../feeds/ecccAlerts.js";
import type * as feeds_naadPelmorex from "../feeds/naadPelmorex.js";
import type * as feeds_nasaFirms from "../feeds/nasaFirms.js";
import type * as feeds_nrcanQuakes from "../feeds/nrcanQuakes.js";
import type * as feeds_ntwcTsunami from "../feeds/ntwcTsunami.js";
import type * as feeds_pnsnTremor from "../feeds/pnsnTremor.js";
import type * as feeds_usgsQuakes from "../feeds/usgsQuakes.js";
import type * as http from "../http.js";
import type * as lib_fetchSource from "../lib/fetchSource.js";
import type * as lib_geo from "../lib/geo.js";
import type * as lib_ingest from "../lib/ingest.js";
import type * as lib_xml from "../lib/xml.js";
import type * as signals from "../signals.js";
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
  crons: typeof crons;
  "feeds/bcEvacOrders": typeof feeds_bcEvacOrders;
  "feeds/bchydroOutages": typeof feeds_bchydroOutages;
  "feeds/bcwsFires": typeof feeds_bcwsFires;
  "feeds/cwfisHotspots": typeof feeds_cwfisHotspots;
  "feeds/drivebcEvents": typeof feeds_drivebcEvents;
  "feeds/ecccAlerts": typeof feeds_ecccAlerts;
  "feeds/naadPelmorex": typeof feeds_naadPelmorex;
  "feeds/nasaFirms": typeof feeds_nasaFirms;
  "feeds/nrcanQuakes": typeof feeds_nrcanQuakes;
  "feeds/ntwcTsunami": typeof feeds_ntwcTsunami;
  "feeds/pnsnTremor": typeof feeds_pnsnTremor;
  "feeds/usgsQuakes": typeof feeds_usgsQuakes;
  http: typeof http;
  "lib/fetchSource": typeof lib_fetchSource;
  "lib/geo": typeof lib_geo;
  "lib/ingest": typeof lib_ingest;
  "lib/xml": typeof lib_xml;
  signals: typeof signals;
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
