import { v } from 'convex/values';
import { internalAction, internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import { fetchSource } from '../lib/fetchSource';
import { cellOf, inBbox } from '../lib/geo';
import {
  upsertSignals,
  reportSuccess,
  reportFailure,
  type SignalInput,
  type SourceMeta,
} from '../lib/ingest';

// permits — SOURCES.md: Infrastructure / Network / Cyber. City of Victoria
// building permits, open ArcGIS layer 3 = permits issued in the last 365
// days (verified live 2026-06-11: real record EP084736 issued 2026-06-08).
// NANAIMO GAP (catalog-verified): their open data hub has NO permits
// dataset — all 98 hub datasets enumerated during recon; this module is
// Victoria-only until Nanaimo publishes one.
// Signals kind 'civic'. Severity: building/electrical/plumbing permits are
// routine municipal records with no operational urgency → constant 'info'.
// PRIVACY (catalog gotcha): records carry applicant/contractor contact
// details (Name, phone, cell, email, mailing_address) — those fields are
// excluded from outFields entirely so they are never ingested.
// Live-verified gotcha NOT in the catalog: the layer emits one feature per
// permit CONTACT (displayFieldName 'Name'), so PermitNo repeats — a 100-row
// page held only 80 unique permits. Rows are collapsed by PermitNo before
// upserting (first occurrence wins; rows differ only in contact fields).
// Geometry gotcha: native geometry is wkid 3157 — the string X_LONG/Y_LAT
// attributes are used instead of reprojecting (returnGeometry=false).
// Worst case: 100 signals/sync (resultRecordCount cap, most recent first).
// Cadence: slow lane (86400s — city scripts update roughly daily).
const META: SourceMeta = {
  slug: 'permits',
  name: 'Building Permits (City of Victoria)',
  cluster: 'Infrastructure / Network / Cyber',
  cadenceSec: 86400,
  attribution: 'City of Victoria Open Data',
  licenseNote: 'Open Data Licence - City of Victoria',
};

const MAX_RECORDS = 100;
const EXPIRES_MS = 60 * 24 * 3600 * 1000; // weekly-ish civic data: +60d

// orderByFields=IssuedDate DESC is safe on the yyyymmdd string — lexical
// order equals chronological order for that format.
const QUERY_URL =
  'https://maps.victoria.ca/server/rest/services/OpenData/OpenData_PermitsAndLicences/MapServer/3/query' +
  '?where=1%3D1&f=json&returnGeometry=false' +
  `&resultRecordCount=${MAX_RECORDS}&orderByFields=IssuedDate%20DESC` +
  '&outFields=PermitNo,CATEGORY,type,SUBJECT,Status,Purpose,IssuedDate,BldgValue,Unit,House,Street,Neighbourhood,X_LONG,Y_LAT,PermitType';

// Verified attribute shape (all strings or null; IssuedDate 'yyyymmdd',
// X_LONG/Y_LAT stringified WGS84 degrees).
interface PermitAttrs {
  PermitNo: string | null;
  CATEGORY: string | null;
  type: string | null;
  SUBJECT: string | null;
  Status: string | null;
  Purpose: string | null;
  IssuedDate: string | null;
  BldgValue: string | null;
  Unit: string | null;
  House: string | null;
  Street: string | null;
  Neighbourhood: string | null;
  X_LONG: string | null;
  Y_LAT: string | null;
  PermitType: string | null;
}

function parseIssued(s: string | null): number | undefined {
  if (!s || !/^\d{8}$/.test(s)) return undefined;
  const t = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  return Number.isFinite(t) ? t : undefined;
}

function addressOf(a: PermitAttrs): string {
  const street = [a.House, a.Street].filter(Boolean).join(' ').trim();
  const withUnit = a.Unit && street ? `${a.Unit}-${street}` : street;
  return withUnit || a.Neighbourhood?.trim() || 'City of Victoria';
}

export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const res = await fetchSource(QUERY_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        error?: { code: number; message: string };
        features?: Array<{ attributes: PermitAttrs }>;
      };
      // ArcGIS reports errors inside an HTTP 200 body.
      if (data.error) throw new Error(`ArcGIS ${data.error.code}: ${data.error.message}`);
      const fetchedAt = Date.now();

      // Collapse one-row-per-contact duplication: keyed by PermitNo.
      const byPermit = new Map<string, SignalInput>();
      for (const f of data.features ?? []) {
        const a = f.attributes;
        if (!a.PermitNo || byPermit.has(a.PermitNo)) continue;
        const observedAt = parseIssued(a.IssuedDate);
        if (observedAt === undefined) continue; // not yet issued / malformed
        const lat = parseFloat(a.Y_LAT ?? '');
        const lng = parseFloat(a.X_LONG ?? '');
        const located = Number.isFinite(lat) && Number.isFinite(lng) && inBbox(lat, lng);
        const permitType = a.type?.trim() || a.PermitType?.trim() || 'Permit';
        byPermit.set(a.PermitNo, {
          sourceSlug: META.slug,
          kind: 'civic',
          title: `${permitType} — ${addressOf(a)}`.slice(0, 140),
          summary: a.Purpose?.trim().slice(0, 300) || undefined,
          severity: 'info', // routine civic records, always info
          ...(located ? { lat, lng, cell: cellOf(lat, lng) } : {}),
          observedAt,
          expiresAt: observedAt + EXPIRES_MS,
          dedupeKey: `${META.slug}:${a.PermitNo}`,
          confidence: 1.0, // agency open data
          provenance: JSON.stringify({
            method: 'poll',
            fetchedAt,
            upstreamId: a.PermitNo,
            url: 'https://maps.victoria.ca/server/rest/services/OpenData/OpenData_PermitsAndLicences/MapServer/3',
          }),
          raw: JSON.stringify({
            category: a.CATEGORY,
            permitType: a.PermitType,
            status: a.Status,
            bldgValue: a.BldgValue,
            neighbourhood: a.Neighbourhood,
          }).slice(0, 2000),
        });
        if (byPermit.size >= MAX_RECORDS) break;
      }
      const signals = [...byPermit.values()];
      await ctx.runMutation(internal.feeds.permits.ingest, { signals });
    } catch (e) {
      await ctx.runMutation(internal.feeds.permits.fail, { error: String(e) });
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
