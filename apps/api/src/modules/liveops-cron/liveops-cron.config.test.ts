/**
 * Phase 13.2.D + 14.0.F — Tests cho `readLiveOpsCronConfig`.
 *
 * Cover:
 *   - default disabled (env trống) → cả 2 cron `*_ENABLED=false`.
 *   - parse 'true'/'1'/'yes'/'on' → true.
 *   - cron pattern fallback default nếu env trống.
 *   - timezone default UTC.
 *   - leaseTtlSec parse int dương; fallback 300 nếu invalid.
 */
import { describe, expect, it } from 'vitest';
import {
  readLiveOpsCronConfig,
  SECT_SEASON_SNAPSHOT_CRON_DEFAULT,
  TERRITORY_WEEKLY_SETTLE_CRON_DEFAULT,
} from './liveops-cron.config';

describe('readLiveOpsCronConfig', () => {
  it('default: env trống → cron disabled, pattern default, tz UTC', () => {
    const cfg = readLiveOpsCronConfig({});
    expect(cfg.territoryEnabled).toBe(false);
    expect(cfg.sectSeasonEnabled).toBe(false);
    expect(cfg.territoryCron).toBe(TERRITORY_WEEKLY_SETTLE_CRON_DEFAULT);
    expect(cfg.sectSeasonCron).toBe(SECT_SEASON_SNAPSHOT_CRON_DEFAULT);
    expect(cfg.timezone).toBe('UTC');
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

  it('cron pattern + tz override', () => {
    const cfg = readLiveOpsCronConfig({
      TERRITORY_CRON_ENABLED: 'true',
      TERRITORY_WEEKLY_SETTLE_CRON: '0 0 * * *',
      TERRITORY_CRON_TZ: 'Asia/Ho_Chi_Minh',
      SECT_SEASON_CRON_ENABLED: 'true',
      SECT_SEASON_SNAPSHOT_CRON: '30 0 * * *',
    });
    expect(cfg.territoryCron).toBe('0 0 * * *');
    expect(cfg.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(cfg.sectSeasonCron).toBe('30 0 * * *');
  });

  it('LIVEOPS_CRON_LEASE_TTL_SEC parse int; invalid → fallback 300', () => {
    expect(readLiveOpsCronConfig({ LIVEOPS_CRON_LEASE_TTL_SEC: '60' }).leaseTtlSec).toBe(60);
    expect(readLiveOpsCronConfig({ LIVEOPS_CRON_LEASE_TTL_SEC: '0' }).leaseTtlSec).toBe(0);
    expect(readLiveOpsCronConfig({ LIVEOPS_CRON_LEASE_TTL_SEC: 'abc' }).leaseTtlSec).toBe(300);
    expect(readLiveOpsCronConfig({ LIVEOPS_CRON_LEASE_TTL_SEC: '-5' }).leaseTtlSec).toBe(300);
  });
});
