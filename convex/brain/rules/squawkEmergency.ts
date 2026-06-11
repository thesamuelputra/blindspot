import type { RuleImpl } from '../types';

// BRIEF §8.1 seed rule: aircraft squawking 7500 (hijack) / 7600 (radio fail)
// / 7700 (emergency) → critical/warning derived signal + fly-to flag.
const SQUAWK_MEANINGS: Record<string, { label: string; severity: 'critical' | 'warning' }> = {
  '7500': { label: 'unlawful interference', severity: 'critical' },
  '7600': { label: 'radio failure', severity: 'warning' },
  '7700': { label: 'general emergency', severity: 'critical' },
};

export const squawkEmergency: RuleImpl = (ctx) => {
  const out = [];
  for (const m of ctx.movers) {
    if (m.kind !== 'aircraft' || !m.state) continue;
    let squawk: string | undefined;
    try {
      squawk = (JSON.parse(m.state) as { squawk?: string }).squawk;
    } catch {
      continue;
    }
    const meaning = squawk ? SQUAWK_MEANINGS[squawk] : undefined;
    if (!meaning) continue;
    out.push({
      rule: 'squawk-emergency',
      title: `SQUAWK ${squawk} — ${m.label}`,
      summary: `Aircraft ${m.label} squawking ${squawk} (${meaning.label}) at ${
        m.altitude ?? '?'
      } ft near ${m.lat.toFixed(2)}, ${m.lng.toFixed(2)}`,
      severity: meaning.severity,
      lat: m.lat,
      lng: m.lng,
      confidence: 0.9, // transponder data is authoritative but mis-sets happen
      contributingIds: [],
      rationale: `Transponder code ${squawk} is the ICAO ${meaning.label} code; observed via ADS-B.`,
      // per aircraft per day — a continuing emergency must not re-fire every tick
      dedupeKey: `derived:squawk-emergency:${m.extId}:${new Date(ctx.now).toISOString().slice(0, 10)}`,
      notify: true,
    });
  }
  return out;
};
