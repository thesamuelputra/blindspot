// NL analyst console backend (ARCHITECTURE §7.4, DECISIONS D4).
// PUBLIC action `ask` runs a Claude tool-use loop (direct fetch to the Anthropic
// Messages API, default Convex runtime, no SDK) over the read-only internalQueries
// in brain/analystTools.ts. The action never calls a mutation; read-only by
// construction. Model: claude-sonnet-4-6 with prompt caching (cache_control on the
// last tool definition + the system block, both ahead of the volatile messages).
//
// Env: ANTHROPIC_API_KEY (Convex deployment env). Missing key is a clean no-op
// response, never a crash. Auth: refuses unauthenticated callers.
import { v } from 'convex/values';
import { action } from '../_generated/server';
import type { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1200;
const MAX_ITERATIONS = 8; // total API calls; the last one forces a text answer
const TOOL_RESULT_CHAR_CAP = 24_000;
const HISTORY_TURN_CAP = 12;

// ---------------------------------------------------------------------------
// Response contract
// ---------------------------------------------------------------------------

export interface AnalystHighlights {
  signalIds: string[];
  entityIds: string[];
  bbox?: [number, number, number, number]; // [west, south, east, north]
}

export interface AnalystResponse {
  prose: string;
  highlights?: AnalystHighlights;
}

// ---------------------------------------------------------------------------
// System prompt + tool definitions. Both are frozen constants so the cached
// prefix is byte-stable across requests (no timestamps here; current time is
// injected into the user turn, after the last cache breakpoint).
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the BlindSpot analyst, the AI assistant inside a private OSINT console covering Vancouver Island, British Columbia. The console fuses public feeds into a normalized picture: seismic activity, tsunamis, wildfires and hotspots, weather and public alerts, marine and air traffic, ferries and transit, infrastructure outages, environmental sensor readings, space weather, news, and derived intelligence produced by the console's own fusion rules.

Region context:
- Core bounding box: west -125.30, south 48.20, east -123.10, north 51.10 (lng/lat).
- Population centers: Victoria (48.43, -123.37), Nanaimo (49.17, -123.94), Comox (49.67, -124.93), Port Alberni (49.23, -124.81), Campbell River (50.02, -125.24).
- Timestamps in tool results are Unix epoch milliseconds.

Data model you query through tools:
- Signals are point-in-time events. Kinds include: earthquake, tremor, tsunami, weather-alert, public-alert, wildfire, hotspot, evac-order, smoke, road-event, outage, transit-alert, marine-notice, closure-fishery, vessel-event, aircraft-event, space-weather, launch, news, civic, event, sighting, anomaly, derived, world-event. Kind "derived" means the console's fusion rules produced it; its rationale field explains why.
- Entities are tracked objects with positions. Kinds: aircraft, vessel, bus, ferry, station, camera, fire, satellite, balloon, aprs. An entity marked watch=true is on the operator's watchlist; stale=true means it has not reported recently.
- Readings are sensor time series addressed by metric and stationId. Conventions: "count:aircraft", "count:vessel", "count:bus" under stationId "brain:counts" are the console's own activity counters; other metrics follow patterns like "reading:aqhi:<station>" for air quality and "reading:water_level:<station>" for tides and rivers.
- Alerts are CAP-grade official alerts (Environment Canada, emergency management) with urgency and certainty fields.
- Severity scale everywhere: info, watch, warning, critical.
- Confidence is 0 to 1: 1.0 authoritative agency or instrument, 0.8 community instrument, 0.6 aggregated or modeled, 0.4 scraped or unofficial. Derived signals multiply contributor confidences. Label anything at or below 0.6 as modeled or unofficial when you cite it.

How to work:
- Always read live data through the tools before answering. Start with query_signals for event questions, query_entities for "what is moving where", get_threat for overall posture, get_source_health when asked about feed freshness or gaps. Use count_by_kind to gauge activity volume, query_readings for trends in a specific metric, query_alerts for active official alerts.
- Prefer narrow windows first (60 to 360 minutes) and widen only if empty. Use the near filter for proximity questions.
- Never invent data. If the tools return nothing relevant, say exactly that.
- Quote concrete numbers, distances, and times. Convert epoch milliseconds to human-readable times relative to the current time given in the user message.
- Write for an operator: plain language, short sentences, no hedging filler, no markdown headers. Do not use em-dashes. State uncertainty explicitly when data is stale, low-confidence, or a source is down.

Response format, mandatory:
End every final answer with exactly one fenced JSON block in this shape:
\`\`\`json
{"prose": "<your complete answer as plain text>", "highlights": {"signalIds": ["..."], "entityIds": ["..."], "bbox": [west, south, east, north]}}
\`\`\`
Rules for the block:
- "prose" must carry the complete answer. The console renders only this field; any text outside the block is discarded.
- "highlights" is optional. Include it only when the operator should see specific items on the map. Copy ids verbatim from the "id" field of query_signals or query_entities results; never fabricate ids and never put alert or reading data in it.
- "bbox" is optional inside highlights: [west, south, east, north] in degrees, only when the answer has one clear geographic focus.
- If nothing should be highlighted, emit {"prose": "..."} with no highlights key.`;

// JSON schema tool definitions per the Anthropic Messages API. Order is fixed;
// the LAST tool carries cache_control so the whole tools array is cached, and the
// system block below carries the second breakpoint (tools render before system).
const TOOLS: Array<Record<string, unknown>> = [
  {
    name: 'query_signals',
    description:
      'Read recent normalized signals (earthquakes, wildfires, weather alerts, marine notices, news, anomalies, derived fusion results). Call this first for almost any question about events or conditions. Filter by kind when the question names a category; use near for proximity questions.',
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description:
            'Optional SignalKind filter, e.g. earthquake, wildfire, weather-alert, marine-notice, anomaly, derived. Omit to search all kinds.',
        },
        sinceMinutes: {
          type: 'number',
          description: 'Look-back window in minutes. 360 covers the last 6 hours. Max 20160 (14 days).',
        },
        near: {
          type: 'object',
          description: 'Optional proximity filter: only signals within km kilometers of (lat, lng).',
          properties: {
            lat: { type: 'number' },
            lng: { type: 'number' },
            km: { type: 'number' },
          },
          required: ['lat', 'lng', 'km'],
        },
        limit: { type: 'number', description: 'Max rows to return, up to 200. Default 50.' },
      },
      required: ['sinceMinutes'],
    },
  },
  {
    name: 'query_entities',
    description:
      'Read tracked entities with last known positions: aircraft, vessel, ferry, bus, balloon, plus fixed kinds like station, camera, fire. Call this for questions about what is moving or present where. Set watchOnly to true for watchlisted entities only.',
    input_schema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description: 'Optional entity kind: aircraft, vessel, ferry, bus, balloon, station, camera, fire, satellite, aprs.',
        },
        watchOnly: { type: 'boolean', description: 'Only entities on the operator watchlist.' },
        limit: { type: 'number', description: 'Max rows, up to 300. Default 100.' },
      },
      required: [],
    },
  },
  {
    name: 'query_readings',
    description:
      'Read a sensor time series for one metric, newest first. Call this for trends: activity counters (metric "count:vessel" with stationId "brain:counts"), air quality, water levels, and other station readings.',
    input_schema: {
      type: 'object',
      properties: {
        metric: { type: 'string', description: 'Metric name, e.g. count:aircraft, count:vessel, reading:aqhi:<station>.' },
        stationId: { type: 'string', description: 'Optional station filter, e.g. brain:counts.' },
        sinceMinutes: { type: 'number', description: 'Look-back window in minutes.' },
        limit: { type: 'number', description: 'Max rows, up to 200. Default 100.' },
      },
      required: ['metric', 'sinceMinutes'],
    },
  },
  {
    name: 'query_alerts',
    description:
      'List currently active CAP-grade official alerts (weather, public safety) with severity, urgency, and certainty. Call this when asked about official warnings in effect.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_threat',
    description:
      'Get the console-computed regional threat level (NOMINAL, ELEVATED, HIGH) with its score and contributing factors. Call this for overall-posture questions. The level is a heuristic; say so when you cite it.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_source_health',
    description:
      'Get the health table for every ingest source: status (live, stale, down, disabled), last success time, consecutive failures, last error. Call this when asked about data freshness, feed outages, or why something might be missing.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'count_by_kind',
    description:
      'Count recent signals grouped by kind over a window. Call this to gauge activity volume before drilling in, or to compare categories.',
    input_schema: {
      type: 'object',
      properties: {
        sinceMinutes: { type: 'number', description: 'Look-back window in minutes.' },
      },
      required: ['sinceMinutes'],
    },
    cache_control: { type: 'ephemeral' },
  },
];

// ---------------------------------------------------------------------------
// Pure helpers (fixture-tested)
// ---------------------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

// Clamp a model-supplied numeric arg into [min, max], falling back when absent.
export function numOr(x: unknown, fallback: number, min: number, max: number): number {
  const n = typeof x === 'number' && Number.isFinite(x) ? x : fallback;
  return Math.max(min, Math.min(n, max));
}

function strOr(x: unknown): string | undefined {
  return typeof x === 'string' && x.length > 0 ? x : undefined;
}

function nearOr(x: unknown): { lat: number; lng: number; km: number } | undefined {
  if (!isRecord(x)) return undefined;
  const { lat, lng, km } = x;
  if (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    typeof km === 'number' &&
    [lat, lng, km].every(Number.isFinite)
  ) {
    return { lat, lng, km: Math.max(0.1, Math.min(km, 500)) };
  }
  return undefined;
}

export function validateHighlights(h: unknown): AnalystHighlights | undefined {
  if (!isRecord(h)) return undefined;
  const strings = (x: unknown): string[] =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
  const signalIds = strings(h.signalIds);
  const entityIds = strings(h.entityIds);
  let bbox: [number, number, number, number] | undefined;
  if (
    Array.isArray(h.bbox) &&
    h.bbox.length === 4 &&
    h.bbox.every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    bbox = [h.bbox[0], h.bbox[1], h.bbox[2], h.bbox[3]];
  }
  if (signalIds.length === 0 && entityIds.length === 0 && bbox === undefined) return undefined;
  return bbox ? { signalIds, entityIds, bbox } : { signalIds, entityIds };
}

// Defensive parse of the model's final text: prefer the last fenced JSON block
// with a string `prose`, fall back to the whole text as prose.
export function parseAnalystResponse(text: string): AnalystResponse {
  const trimmed = text.trim();
  const candidates: string[] = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) candidates.unshift(m[1].trim()); // last fence first
  if (trimmed.startsWith('{')) candidates.push(trimmed);
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!isRecord(parsed) || typeof parsed.prose !== 'string' || parsed.prose.trim().length === 0)
      continue;
    const highlights = validateHighlights(parsed.highlights);
    return highlights ? { prose: parsed.prose.trim(), highlights } : { prose: parsed.prose.trim() };
  }
  return { prose: trimmed };
}

// ---------------------------------------------------------------------------
// Anthropic API plumbing
// ---------------------------------------------------------------------------

type ApiBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
};

type AnthropicMessage = {
  stop_reason?: string;
  content?: ApiBlock[];
};

type MessageParam = { role: 'user' | 'assistant'; content: string | unknown[] };

function buildRequestBody(messages: MessageParam[], forceFinal: boolean): string {
  return JSON.stringify({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: TOOLS,
    messages,
    ...(forceFinal ? { tool_choice: { type: 'none' } } : {}),
  });
}

async function callClaude(apiKey: string, body: string): Promise<Response> {
  const doFetch = () =>
    fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body,
    });
  let res = await doFetch();
  if (res.status === 429 || res.status >= 500) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    res = await doFetch();
  }
  return res;
}

// Dispatch one tool_use block to its internalQuery. Inputs are model-supplied and
// untrusted: sanitize every field before it reaches a validator. Results are
// JSON-stringified and capped so one fat result cannot blow the context.
async function runTool(
  ctx: ActionCtx,
  name: string,
  rawInput: unknown,
): Promise<{ json: string; isError: boolean }> {
  const input = isRecord(rawInput) ? rawInput : {};
  try {
    let result: unknown;
    switch (name) {
      case 'query_signals':
        result = await ctx.runQuery(internal.brain.analystTools.query_signals, {
          kind: strOr(input.kind),
          sinceMinutes: numOr(input.sinceMinutes, 360, 1, 20_160),
          near: nearOr(input.near),
          limit: numOr(input.limit, 50, 1, 200),
        });
        break;
      case 'query_entities':
        result = await ctx.runQuery(internal.brain.analystTools.query_entities, {
          kind: strOr(input.kind),
          watchOnly: input.watchOnly === true ? true : undefined,
          limit: numOr(input.limit, 100, 1, 300),
        });
        break;
      case 'query_readings': {
        const metric = strOr(input.metric);
        if (!metric) return { json: JSON.stringify({ error: 'metric is required' }), isError: true };
        result = await ctx.runQuery(internal.brain.analystTools.query_readings, {
          metric,
          stationId: strOr(input.stationId),
          sinceMinutes: numOr(input.sinceMinutes, 1440, 1, 20_160),
          limit: numOr(input.limit, 100, 1, 200),
        });
        break;
      }
      case 'query_alerts':
        result = await ctx.runQuery(internal.brain.analystTools.query_alerts, {});
        break;
      case 'get_threat':
        result = await ctx.runQuery(internal.brain.analystTools.get_threat, {});
        break;
      case 'get_source_health':
        result = await ctx.runQuery(internal.brain.analystTools.get_source_health, {});
        break;
      case 'count_by_kind':
        result = await ctx.runQuery(internal.brain.analystTools.count_by_kind, {
          sinceMinutes: numOr(input.sinceMinutes, 1440, 1, 20_160),
        });
        break;
      default:
        return { json: JSON.stringify({ error: `Unknown tool: ${name}` }), isError: true };
    }
    let json = JSON.stringify(result);
    if (json.length > TOOL_RESULT_CHAR_CAP) {
      json = json.slice(0, TOOL_RESULT_CHAR_CAP) + ' ...[truncated, narrow the query]';
    }
    return { json, isError: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`analyst tool ${name} failed:`, message);
    return { json: JSON.stringify({ error: `Tool ${name} failed: ${message}` }), isError: true };
  }
}

// ---------------------------------------------------------------------------
// PUBLIC action
// ---------------------------------------------------------------------------

export const ask = action({
  args: {
    question: v.string(),
    history: v.optional(
      v.array(
        v.object({
          role: v.union(v.literal('user'), v.literal('assistant')),
          content: v.string(),
        }),
      ),
    ),
  },
  handler: async (ctx, { question, history }): Promise<AnalystResponse> => {
    if ((await ctx.auth.getUserIdentity()) === null) {
      throw new Error('Not authenticated');
    }
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { prose: 'Analyst offline: ANTHROPIC_API_KEY not configured.' };
    }

    // Messages must start with a user turn; cap history so old turns cannot
    // crowd out the live question.
    const trimmedHistory = (history ?? []).slice(-HISTORY_TURN_CAP);
    while (trimmedHistory.length > 0 && trimmedHistory[0].role === 'assistant') {
      trimmedHistory.shift();
    }
    const messages: MessageParam[] = trimmedHistory.map((t) => ({
      role: t.role,
      content: t.content,
    }));
    // Volatile context (current time) lives in the user turn, after the cached
    // system + tools prefix, so it never invalidates the cache.
    messages.push({
      role: 'user',
      content: `Current time: ${new Date().toISOString()}\n\nQuestion: ${question}`,
    });

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const forceFinal = iteration === MAX_ITERATIONS - 1;
      let res: Response;
      try {
        res = await callClaude(apiKey, buildRequestBody(messages, forceFinal));
      } catch (e) {
        console.error('analyst: fetch to Anthropic failed:', e);
        return { prose: 'Analyst error: could not reach the model API. Try again shortly.' };
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error('analyst: Anthropic API error', res.status, errText.slice(0, 500));
        return {
          prose: `Analyst error: the model API returned status ${res.status}. Try again shortly.`,
        };
      }
      const data = (await res.json()) as AnthropicMessage;
      const content = Array.isArray(data.content) ? data.content : [];
      const toolUses = content.filter((b) => b.type === 'tool_use');

      if (data.stop_reason === 'tool_use' && toolUses.length > 0) {
        messages.push({ role: 'assistant', content });
        const results: unknown[] = [];
        for (const block of toolUses) {
          const { json, isError } = await runTool(ctx, block.name ?? '', block.input);
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: json,
            ...(isError ? { is_error: true } : {}),
          });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }

      const text = content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('\n')
        .trim();
      if (text.length === 0) {
        return { prose: 'Analyst returned an empty response. Try rephrasing the question.' };
      }
      return parseAnalystResponse(text);
    }

    // Unreachable in practice: the final iteration forces tool_choice none.
    return { prose: 'Analyst hit the tool iteration limit before finishing. Ask a narrower question.' };
  },
});
