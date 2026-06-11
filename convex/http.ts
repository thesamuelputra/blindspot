import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { auth } from './auth';

const http = httpRouter();

auth.addHttpRoutes(http);

// Liveness probe (used by the AIS worker and RUNBOOK checks).
http.route({
  path: '/health',
  method: 'GET',
  handler: httpAction(async () => {
    return new Response(JSON.stringify({ ok: true, at: Date.now() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }),
});

// AIS worker ingest (ARCHITECTURE §6): bearer-guarded, size-capped, bbox-filtered.
http.route({
  path: '/ingest/ais',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.INGEST_SECRET;
    const auth = req.headers.get('Authorization') ?? '';
    if (!secret || !timingSafeEqual(auth, `Bearer ${secret}`)) {
      return new Response('unauthorized', { status: 401 });
    }
    const text = await req.text();
    if (text.length > 1_000_000) return new Response('payload too large', { status: 413 });
    let vessels: Array<{ lat: number; lng: number }>;
    try {
      vessels = (JSON.parse(text) as { vessels: Array<{ lat: number; lng: number }> }).vessels;
      if (!Array.isArray(vessels)) throw new Error('vessels not an array');
    } catch {
      return new Response('bad payload', { status: 400 });
    }
    const inBox = vessels.filter(
      (v) => v.lat >= 48.2 && v.lat <= 51.1 && v.lng >= -125.3 && v.lng <= -123.1,
    );
    await ctx.runMutation(internal.feeds.aisVessels.ingest, { vessels: inBox });
    return new Response(JSON.stringify({ ok: true, accepted: inBox.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }),
});

// Constant-time-ish comparison (avoid trivially timeable bearer checks).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default http;
