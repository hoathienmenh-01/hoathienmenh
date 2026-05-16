/**
 * Phase 15.8 — Live Ops cron health helper tests.
 */

import { describe, it, expect } from 'vitest';
import {
  computeLiveOpsCronHealth,
  TERRITORY_CRON_MAX_SILENCE_MS,
  SECT_SEASON_CRON_MAX_SILENCE_MS,
  WEEKLY_CRON_MAX_SILENCE_MS,
  LIVEOPS_CRON_KEYS,
  pickWorstCronHealthStatus,
} from './liveops-cron-health';

const NOW = new Date('2026-08-01T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('Phase 15.8 — computeLiveOpsCronHealth', () => {
  it('DISABLED khi enabled=false', () => {
    const r = computeLiveOpsCronHealth({
      enabled: false,
      lastRunAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      maxSilenceMs: TERRITORY_CRON_MAX_SILENCE_MS,
      now: NOW,
    });
    expect(r.status).toBe('DISABLED');
    expect(r.staleReason).toMatch(/disabled/i);
  });

  it('OK khi enabled + lastSuccessAt gần đây + không có error sau success', () => {
    const r = computeLiveOpsCronHealth({
      enabled: true,
      lastRunAt: new Date(NOW.getTime() - 6 * DAY),
      lastSuccessAt: new Date(NOW.getTime() - 6 * DAY),
      lastErrorAt: null,
      maxSilenceMs: TERRITORY_CRON_MAX_SILENCE_MS,
      now: NOW,
    });
    expect(r.status).toBe('OK');
    expect(r.staleReason).toBeNull();
  });

  it('STALE khi enabled + chưa có lastSuccessAt', () => {
    const r = computeLiveOpsCronHealth({
      enabled: true,
      lastRunAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      maxSilenceMs: TERRITORY_CRON_MAX_SILENCE_MS,
      now: NOW,
    });
    expect(r.status).toBe('STALE');
    expect(r.staleReason).toMatch(/never recorded/i);
  });

  it('STALE khi enabled + lastSuccessAt quá maxSilenceMs (weekly > 8 days)', () => {
    const r = computeLiveOpsCronHealth({
      enabled: true,
      lastRunAt: new Date(NOW.getTime() - 9 * DAY),
      lastSuccessAt: new Date(NOW.getTime() - 9 * DAY),
      lastErrorAt: null,
      maxSilenceMs: TERRITORY_CRON_MAX_SILENCE_MS,
      now: NOW,
    });
    expect(r.status).toBe('STALE');
    expect(r.staleReason).toMatch(/no successful run for/i);
  });

  it('STALE cho daily cron (sect-season) khi > 2 ngày silent', () => {
    const r = computeLiveOpsCronHealth({
      enabled: true,
      lastRunAt: new Date(NOW.getTime() - 3 * DAY),
      lastSuccessAt: new Date(NOW.getTime() - 3 * DAY),
      lastErrorAt: null,
      maxSilenceMs: SECT_SEASON_CRON_MAX_SILENCE_MS,
      now: NOW,
    });
    expect(r.status).toBe('STALE');
  });

  it('DEGRADED khi lastErrorAt > lastSuccessAt (cron run nhưng commit fail)', () => {
    const r = computeLiveOpsCronHealth({
      enabled: true,
      lastRunAt: new Date(NOW.getTime() - 1 * HOUR),
      lastSuccessAt: new Date(NOW.getTime() - 5 * DAY),
      lastErrorAt: new Date(NOW.getTime() - 1 * HOUR),
      maxSilenceMs: TERRITORY_CRON_MAX_SILENCE_MS,
      now: NOW,
    });
    expect(r.status).toBe('DEGRADED');
    expect(r.staleReason).toMatch(/newer than last success/i);
  });

  it('DEGRADED khi đã có error nhưng chưa từng success', () => {
    const r = computeLiveOpsCronHealth({
      enabled: true,
      lastRunAt: new Date(NOW.getTime() - 1 * HOUR),
      lastSuccessAt: null,
      lastErrorAt: new Date(NOW.getTime() - 1 * HOUR),
      maxSilenceMs: TERRITORY_CRON_MAX_SILENCE_MS,
      now: NOW,
    });
    expect(r.status).toBe('DEGRADED');
    expect(r.staleReason).toMatch(/only errored/i);
  });

  it('OK khi cron có error cũ nhưng success mới hơn', () => {
    const r = computeLiveOpsCronHealth({
      enabled: true,
      lastRunAt: new Date(NOW.getTime() - 1 * DAY),
      lastSuccessAt: new Date(NOW.getTime() - 1 * DAY),
      lastErrorAt: new Date(NOW.getTime() - 5 * DAY),
      maxSilenceMs: TERRITORY_CRON_MAX_SILENCE_MS,
      now: NOW,
    });
    expect(r.status).toBe('OK');
  });

  it('DISABLED ưu tiên hơn DEGRADED và STALE', () => {
    const r = computeLiveOpsCronHealth({
      enabled: false,
      lastRunAt: null,
      lastSuccessAt: null,
      lastErrorAt: new Date(NOW.getTime() - 1 * HOUR),
      maxSilenceMs: TERRITORY_CRON_MAX_SILENCE_MS,
      now: NOW,
    });
    expect(r.status).toBe('DISABLED');
  });

  it('WEEKLY_CRON_MAX_SILENCE_MS = 8 ngày — STALE khi > 8d, OK khi <= 8d', () => {
    const justInside = computeLiveOpsCronHealth({
      enabled: true,
      lastRunAt: new Date(NOW.getTime() - 7 * DAY),
      lastSuccessAt: new Date(NOW.getTime() - 7 * DAY),
      lastErrorAt: null,
      maxSilenceMs: WEEKLY_CRON_MAX_SILENCE_MS,
      now: NOW,
    });
    expect(justInside.status).toBe('OK');
    const justOver = computeLiveOpsCronHealth({
      enabled: true,
      lastRunAt: new Date(NOW.getTime() - 9 * DAY),
      lastSuccessAt: new Date(NOW.getTime() - 9 * DAY),
      lastErrorAt: null,
      maxSilenceMs: WEEKLY_CRON_MAX_SILENCE_MS,
      now: NOW,
    });
    expect(justOver.status).toBe('STALE');
  });
});

describe('Phase 15.8 — LIVEOPS_CRON_KEYS const', () => {
  it('expose territory/sect-season/weekly literal strings', () => {
    expect(LIVEOPS_CRON_KEYS.TERRITORY).toBe('territory');
    expect(LIVEOPS_CRON_KEYS.SECT_SEASON).toBe('sect-season');
    expect(LIVEOPS_CRON_KEYS.WEEKLY).toBe('weekly');
  });
});

describe('Phase 15.8 — pickWorstCronHealthStatus', () => {
  it('empty → OK (no alarm)', () => {
    expect(pickWorstCronHealthStatus([])).toBe('OK');
  });
  it('toàn DISABLED → DISABLED', () => {
    expect(pickWorstCronHealthStatus(['DISABLED', 'DISABLED'])).toBe(
      'DISABLED',
    );
  });
  it('OK trộn DISABLED → OK (OK rank > DISABLED)', () => {
    expect(pickWorstCronHealthStatus(['DISABLED', 'OK'])).toBe('OK');
  });
  it('STALE thắng OK', () => {
    expect(pickWorstCronHealthStatus(['OK', 'STALE'])).toBe('STALE');
  });
  it('DEGRADED thắng STALE', () => {
    expect(pickWorstCronHealthStatus(['STALE', 'DEGRADED', 'OK'])).toBe(
      'DEGRADED',
    );
  });
});
