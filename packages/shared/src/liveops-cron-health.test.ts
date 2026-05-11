/**
 * Phase 15.8 — Live Ops cron health helper tests.
 */

import { describe, it, expect } from 'vitest';
import {
  computeLiveOpsCronHealth,
  TERRITORY_CRON_MAX_SILENCE_MS,
  SECT_SEASON_CRON_MAX_SILENCE_MS,
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
});
