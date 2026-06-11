import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
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

// /ingest/ais lands here in Phase 3 Wave D (bearer-secret guarded, 1MB cap, bbox-filtered).

export default http;
