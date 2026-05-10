/**
 * Phase 13.2.D + 14.0.F + 15.7 — Tests cho `readLiveOpsCronConfig`.
 *
 * Cover:
 *   - default disabled (env trống) → cả 2 cron `*_ENABLED=false`.
 *   - parse 'true'/'1'/'yes'/'on' → true.
 *   - cron pattern fallback default nếu env trống.
 *   - timezone default `Asia/Ho_Chi_Minh` (Phase 15.7 — đổi từ UTC).
 *   - SECT_TERRITORY_CRON_TZ priority cao hơn TERRITORY_CRON_TZ legacy.
 *   - leaseTtlSec parse int dương; fallback 300 nếu invalid.
 */
import { describe, expect, it } from 'vitest';
import {
  readLiveOpsCronConfig,
  LIVEOPS_CRON_DEFAULT_TZ,
  SECT_SEASON_SNAPSHOT_CRON_DEFAULT,
  TERRITORY_WEEKLY_SETTLE_CRON_DEFAULT,
} from './liveops-cron.config';

describe('readLiveOpsCronConfig', () => {
  it('default: env trống → cron disabled, pattern default, tz Asia/Ho_Chi_Minh', () => {
    const cfg = readLiveOpsCronConfig({});
    expect(cfg.territoryEnabled).toBe(false);
    expect(cfg.sectSeasonEnabled).toBe(false);
    expect(cfg.territoryCron).toBe(TERRITORY_WEEKLY_SETTLE_CRON_DEFAULT);
    expect(cfg.sectSeasonCron).toBe(SECT_SEASON_SNAPSHOT_CRON_DEFAULT);
    expect(cfg.timezone).toBe(LIVEOPS_CRON_DEFAULT_TZ);
    expect(cfg.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(cfg.leaseTtlSec).toBe(300);
  });

  it('TERRITORY_CRON_ENABLED truthy values (true/1/yes/on) → enabled', () => {
    for (const v of ['true', '1', 'yes', 'on', 'TRUE', 'YES']) {
      const cfg = readLiveOpsCronConfig({ TERRITORY_CRON_ENABLED: v });
      expect(cfg.territoryEnabled).toBe(true);
    }
  });

  it('TERRITORY_CRON_ENABLED falsy (false/0/empty) → disabled', () => {
    for (const v of ['false', '0', '', 'no', 'off']) {
      const cfg = readLiveOpsCronConfig({ TERRITORY_CRON_ENABLED: v });
      expect(cfg.territoryEnabled).toBe(false);
    }
  });

  it('cron pattern + tz override (legacy TERRITORY_CRON_TZ)', () => {
    const cfg = readLiveOpsCronConfig({
      TERRITORY_CRON_ENABLED: 'true',
      TERRITORY_WEEKLY_SETTLE_CRON: '0 0 * * *',
      TERRITORY_CRON_TZ: 'UTC',
      SECT_SEASON_CRON_ENABLED: 'true',
      SECT_SEASON_SNAPSHOT_CRON: '30 0 * * *',
    });
    expect(cfg.territoryCron).toBe('0 0 * * *');
    expect(cfg.timezone).toBe('UTC');
    expect(cfg.sectSeasonCron).toBe('30 0 * * *');
  });

  it('Phase 15.7 — SECT_TERRITORY_CRON_TZ priority cao hơn legacy TERRITORY_CRON_TZ', () => {
    const cfg = readLiveOpsCronConfig({
      SECT_TERRITORY_CRON_TZ: 'America/New_York',
      TERRITORY_CRON_TZ: 'Asia/Tokyo',
    });
    expect(cfg.timezone).toBe('America/New_York');
  });

  it('Phase 15.7 — SECT_TERRITORY_CRON_TZ empty → fall back legacy', () => {
    const cfg = readLiveOpsCronConfig({
      SECT_TERRITORY_CRON_TZ: '',
      TERRITORY_CRON_TZ: 'Asia/Tokyo',
    });
    expect(cfg.timezone).toBe('Asia/Tokyo');
  });

  it('LIVEOPS_CRON_LEASE_TTL_SEC parse int; invalid → fallback 300', () => {
    expect(readLiveOpsCronConfig({ LIVEOPS_CRON_LEASE_TTL_SEC: '60' }).leaseTtlSec).toBe(60);
    expect(readLiveOpsCronConfig({ LIVEOPS_CRON_LEASE_TTL_SEC: '0' }).leaseTtlSec).toBe(0);
    expect(readLiveOpsCronConfig({ LIVEOPS_CRON_LEASE_TTL_SEC: 'abc' }).leaseTtlSec).toBe(300);
    expect(readLiveOpsCronConfig({ LIVEOPS_CRON_LEASE_TTL_SEC: '-5' }).leaseTtlSec).toBe(300);
  });
});
