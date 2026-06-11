import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { cellOf } from '../lib/geo';
import {
  upsertSignals,
  reportSuccess,
  reportFailure,
  type SignalInput,
  type SourceMeta,
} from '../lib/ingest';

// bc-parks-advisories — SOURCES.md: Pulse (News / Civic / Events). Public,
// unauthenticated Strapi v5 API (cms.bcparks.ca) — the same backend bcparks.ca
// consumes. VI filtering is done server-side by the upstream query, which
// $between-filters on the protectedAreas lat/lng using the VI bbox (verified
// total=130 advisories). The bbox also catches a few Howe Sound / Sunshine
// Coast mainland parks (Porteau Cove, Stawamus Chief, Tetrahedron) — those are
// north/east of the VI mainland strip; we keep them since they sit inside the
// declared bbox, but each carries its park's true coordinates so the map places
// them correctly rather than on the island.
//
// signals kind 'civic'. title '<advisory type> — <park>'. Severity by
// urgency/eventType: closures (accessStatus other than Open, or an eventType /
// title mentioning closure) and wildlife events → watch; everything else → info.
// lat/lng come from the related park when present (advisory-level lat/lng is
// almost always null). expiresAt = upstream expiryDate/endDate when given, else
// observedAt + 30d. confidence 1.0 (agency). dedupeKey
// 'bc-parks-advisories:<advisory id>'. cap 50 (one upstream page).
//
// License: no explicit open-data licence; treat as BC Crown copyright, attribute
// BC Parks. Cadence: slow (advisories are editorial, low churn) — 21600s.
const META: SourceMeta = {
  slug: 'bc-parks-advisories',
  name: 'BC Parks Public Advisories',
  cluster: 'Pulse (News / Civic / Events)',
  cadenceSec: 21600,
  attribution: 'BC Parks (Province of British Columbia)',
  licenseNote: 'No explicit open-data licence; treat as BC Crown copyright, attribute BC Parks',
};

// Strapi query: VI bbox $between on the related protectedAreas coordinates,
// populate the park name + coords, eventType, urgency and accessStatus labels,
// newest first, one page of 50. Brackets are literal in the Strapi filter
// syntax — fetchSource passes the URL through to fetch() unmodified (no shell
// globbing concerns server-side).
const PAGE_SIZE = 50;
const URL =
  'https://cms.bcparks.ca/api/public-advisories' +
  '?filters[protectedAreas][latitude][$between][0]=48.2' +
  '&filters[protectedAreas][latitude][$between][1]=51.1' +
  '&filters[protectedAreas][longitude][$between][0]=-125.3' +
  '&filters[protectedAreas][longitude][$between][1]=-123.1' +
  '&populate[protectedAreas][fields][0]=protectedAreaName' +
  '&populate[protectedAreas][fields][1]=latitude' +
  '&populate[protectedAreas][fields][2]=longitude' +
  '&populate[eventType][fields][0]=eventType' +
  '&populate[urgency][fields][0]=urgency' +
  '&populate[accessStatus][fields][0]=accessStatus' +
  '&sort=advisoryDate:desc' +
  `&pagination[pageSize]=${PAGE_SIZE}`;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

interface ProtectedArea {
  id: number;
  protectedAreaName: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface Advisory {
  id: number;
  title: string | null;
  description: string | null; // HTML
  advisoryNumber: number | null;
  advisoryDate: string | null;
  effectiveDate: string | null;
  endDate: string | null;
  expiryDate: string | null;
  isSafetyRelated: boolean | null;
  protectedAreas: ProtectedArea[] | null;
  eventType: { eventType: string | null } | null;
  urgency: { urgency: string | null } | null;
  accessStatus: { accessStatus: string | null } | null;
}

interface StrapiEnvelope {
  data?: Advisory[];
  meta?: { pagination?: { total?: number } };
  error?: { status?: number; name?: string; message?: string };
}

// Minimal HTML → text for summaries (descriptions are small HTML fragments).
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Severity: closures and wildlife events warrant a watch; everything else is
// ambient info. "Closure" is inferred from the accessStatus label (anything
// that is not plainly Open) or the eventType / title text. Wildlife is the
// eventType family ('Wildlife', 'Wildlife protection'). isSafetyRelated also
// promotes to watch — it is BC Parks' own safety flag.
function severityOf(a: Advisory): SignalInput['severity'] {
  const access = (a.accessStatus?.accessStatus ?? '').toLowerCase();
  const event = (a.eventType?.eventType ?? '').toLowerCase();
  const title = (a.title ?? '').toLowerCase();
  const closed = (access !== '' && access !== 'open') || /clos/.test(event) || /clos/.test(title);
  const wildlife = event.includes('wildlife');
  if (closed || wildlife || a.isSafetyRelated === true) return 'watch';
  return 'info';
}

function toSignal(a: Advisory, fetchedAt: number): SignalInput | null {
  const title = (a.title ?? '').trim();
  if (!title) return null;
  // Pick the first park that actually carries coordinates (advisories can list
  // several parks; the advisory itself rarely has its own lat/lng).
  const parks = a.protectedAreas ?? [];
  const placedPark = parks.find(
    (p) => typeof p.latitude === 'number' && typeof p.longitude === 'number',
  );
  const parkName = parks[0]?.protectedAreaName ?? placedPark?.protectedAreaName ?? null;
  const advisoryType = a.eventType?.eventType?.trim() || 'Advisory';
  const headline = parkName ? `${advisoryType} — ${parkName}` : advisoryType;

  const observedMs = a.advisoryDate ? Date.parse(a.advisoryDate) : NaN;
  const observedAt = Number.isFinite(observedMs) ? observedMs : fetchedAt;

  // Upstream expiry wins when present (expiryDate, then endDate); otherwise
  // observedAt + 30d per spec.
  const upstreamExpiry = [a.expiryDate, a.endDate]
    .map((d) => (d ? Date.parse(d) : NaN))
    .find((ms) => Number.isFinite(ms));
  const expiresAt = upstreamExpiry ?? observedAt + THIRTY_DAYS_MS;

  const summary = a.description ? stripHtml(a.description).slice(0, 300) : undefined;
  const hasGeo = placedPark !== undefined;

  return {
    sourceSlug: META.slug,
    kind: 'civic',
    title: headline.slice(0, 200),
    summary: summary || undefined,
    severity: severityOf(a),
    lat: hasGeo ? (placedPark!.latitude as number) : undefined,
    lng: hasGeo ? (placedPark!.longitude as number) : undefined,
    cell: hasGeo
      ? cellOf(placedPark!.latitude as number, placedPark!.longitude as number)
      : undefined,
    observedAt,
    expiresAt,
    dedupeKey: `${META.slug}:${a.id}`,
    confidence: 1.0,
    provenance: JSON.stringify({
      method: 'poll',
      fetchedAt,
      upstreamId: String(a.id),
      url: 'https://bcparks.ca/active-advisories/',
    }),
    raw: JSON.stringify({
      advisoryNumber: a.advisoryNumber,
      eventType: a.eventType?.eventType,
      urgency: a.urgency?.urgency,
      accessStatus: a.accessStatus?.accessStatus,
      parks: parks.map((p) => p.protectedAreaName),
    }).slice(0, 2048),
  };
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as StrapiEnvelope;
      // Strapi surfaces application errors as a JSON {error} body.
      if (data.error) {
        throw new Error(`Strapi ${data.error.status ?? '?'}: ${data.error.message ?? data.error.name}`);
      }
      const fetchedAt = Date.now();
      const advisories = (data.data ?? []).slice(0, PAGE_SIZE);
      const signals = advisories
        .map((a) => toSignal(a, fetchedAt))
        .filter((s): s is SignalInput => s !== null);
      await ctx.runMutation(internal.feeds.bcParks.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.bcParks.fail, { error: String(e) });
    }
  },
});

export const ingest = internalMutation({
  args: { signals: v.array(v.any()) },
  handler: async (ctx, { signals }) => {
    const { inserted, updated } = await upsertSignals(ctx, signals as SignalInput[]);
    await reportSuccess(ctx, META, signals.length);
    return { inserted, updated };
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  handler: async (ctx, { error }) => {
    await reportFailure(ctx, META, error);
  },
});
