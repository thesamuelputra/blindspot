import { describe, expect, it } from 'vitest';
import { buildPushPayload, isGoneStatus, pushOptionsFor, vapidFromEnv } from '../push';

describe('vapidFromEnv', () => {
  const full = {
    VAPID_PUBLIC_KEY: 'pub',
    VAPID_PRIVATE_KEY: 'priv',
    VAPID_SUBJECT: 'mailto:ops@example.com',
  };

  it('returns the config when all three vars are set', () => {
    expect(vapidFromEnv(full)).toEqual({
      publicKey: 'pub',
      privateKey: 'priv',
      subject: 'mailto:ops@example.com',
    });
  });

  it('returns null when any var is missing (env-gated no-op)', () => {
    expect(vapidFromEnv({})).toBeNull();
    expect(vapidFromEnv({ ...full, VAPID_PUBLIC_KEY: undefined })).toBeNull();
    expect(vapidFromEnv({ ...full, VAPID_PRIVATE_KEY: undefined })).toBeNull();
    expect(vapidFromEnv({ ...full, VAPID_SUBJECT: undefined })).toBeNull();
  });

  it('treats empty strings as missing', () => {
    expect(vapidFromEnv({ ...full, VAPID_PRIVATE_KEY: '' })).toBeNull();
  });
});

describe('buildPushPayload', () => {
  it('produces JSON with title, body, severity and timestamp', () => {
    const parsed = JSON.parse(
      buildPushPayload({ title: 'SQUAWK 7700', body: 'Aircraft emergency', severity: 'critical', at: 1718000000000 }),
    ) as Record<string, unknown>;
    expect(parsed).toEqual({
      title: 'SQUAWK 7700',
      body: 'Aircraft emergency',
      severity: 'critical',
      at: 1718000000000,
    });
  });

  it('defaults the timestamp to now', () => {
    const before = Date.now();
    const parsed = JSON.parse(
      buildPushPayload({ title: 't', body: 'b', severity: 'info' }),
    ) as { at: number };
    expect(parsed.at).toBeGreaterThanOrEqual(before);
    expect(parsed.at).toBeLessThanOrEqual(Date.now());
  });

  it('truncates oversized title and body to stay under the push payload limit', () => {
    const payload = buildPushPayload({
      title: 'T'.repeat(500),
      body: 'B'.repeat(5000),
      severity: 'warning',
      at: 0,
    });
    const parsed = JSON.parse(payload) as { title: string; body: string };
    expect(parsed.title).toHaveLength(120);
    expect(parsed.body).toHaveLength(1000);
    expect(payload.length).toBeLessThan(3500); // 4KB web push ceiling with headroom
  });
});

describe('isGoneStatus', () => {
  it('flags 404 and 410 as permanently gone', () => {
    expect(isGoneStatus(404)).toBe(true);
    expect(isGoneStatus(410)).toBe(true);
  });

  it('does not flag other statuses or missing status', () => {
    expect(isGoneStatus(400)).toBe(false);
    expect(isGoneStatus(413)).toBe(false);
    expect(isGoneStatus(429)).toBe(false);
    expect(isGoneStatus(500)).toBe(false);
    expect(isGoneStatus(201)).toBe(false);
    expect(isGoneStatus(undefined)).toBe(false);
  });
});

describe('pushOptionsFor', () => {
  it('marks warning and critical as high urgency with a short TTL', () => {
    expect(pushOptionsFor('warning')).toEqual({ TTL: 3600, urgency: 'high' });
    expect(pushOptionsFor('critical')).toEqual({ TTL: 3600, urgency: 'high' });
  });

  it('keeps info and watch at normal urgency', () => {
    expect(pushOptionsFor('info').urgency).toBe('normal');
    expect(pushOptionsFor('watch').urgency).toBe('normal');
  });
});
