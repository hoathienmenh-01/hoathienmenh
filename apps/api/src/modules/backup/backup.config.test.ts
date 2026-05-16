import { describe, expect, it } from 'vitest';
import {
  BACKUP_ALERT_CONSECUTIVE_FAILURES_DEFAULT,
  BACKUP_CRON_DEFAULT_TZ,
  BACKUP_CRON_SCHEDULE_DEFAULT,
  BACKUP_DIR_DEFAULT,
  BACKUP_VERIFY_CRON_SCHEDULE_DEFAULT,
  readBackupConfig,
} from './backup.config';

describe('Phase 17.2 — readBackupConfig', () => {
  it('env trống → cả backup + verify cron DISABLED, dùng default schedule + TZ + dir', () => {
    const cfg = readBackupConfig({});
    expect(cfg.backupEnabled).toBe(false);
    expect(cfg.verifyEnabled).toBe(false);
    expect(cfg.backupSchedule).toBe(BACKUP_CRON_SCHEDULE_DEFAULT);
    expect(cfg.verifySchedule).toBe(BACKUP_VERIFY_CRON_SCHEDULE_DEFAULT);
    expect(cfg.timezone).toBe(BACKUP_CRON_DEFAULT_TZ);
    expect(cfg.backupDir).toBe(BACKUP_DIR_DEFAULT);
    expect(cfg.retentionDays).toBe(0);
  });

  it('BACKUP_CRON_ENABLED chấp nhận true / 1 / yes / on (case-insensitive)', () => {
    for (const v of ['true', '1', 'yes', 'on', 'TRUE', 'YES', 'On']) {
      const cfg = readBackupConfig({ BACKUP_CRON_ENABLED: v });
      expect(cfg.backupEnabled).toBe(true);
    }
  });

  it('BACKUP_CRON_ENABLED reject các giá trị khác → fallback false', () => {
    for (const v of ['false', '0', 'no', 'off', '', 'maybe']) {
      const cfg = readBackupConfig({ BACKUP_CRON_ENABLED: v });
      expect(cfg.backupEnabled).toBe(false);
    }
  });

  it('Backup + verify enable độc lập (toggle riêng)', () => {
    const cfgBackupOnly = readBackupConfig({
      BACKUP_CRON_ENABLED: 'true',
      BACKUP_VERIFY_CRON_ENABLED: 'false',
    });
    expect(cfgBackupOnly.backupEnabled).toBe(true);
    expect(cfgBackupOnly.verifyEnabled).toBe(false);

    const cfgVerifyOnly = readBackupConfig({
      BACKUP_CRON_ENABLED: 'false',
      BACKUP_VERIFY_CRON_ENABLED: 'true',
    });
    expect(cfgVerifyOnly.backupEnabled).toBe(false);
    expect(cfgVerifyOnly.verifyEnabled).toBe(true);
  });

  it('Override schedule + timezone từ env', () => {
    const cfg = readBackupConfig({
      BACKUP_CRON_ENABLED: 'true',
      BACKUP_CRON_SCHEDULE: '30 2 * * 6',
      BACKUP_VERIFY_CRON_SCHEDULE: '30 5 * * 6',
      BACKUP_CRON_TZ: 'UTC',
    });
    expect(cfg.backupSchedule).toBe('30 2 * * 6');
    expect(cfg.verifySchedule).toBe('30 5 * * 6');
    expect(cfg.timezone).toBe('UTC');
  });

  it('BACKUP_DIR + BACKUP_RETENTION_DAYS forward đúng', () => {
    const cfg = readBackupConfig({
      BACKUP_DIR: '/var/backups/xuantoi',
      BACKUP_RETENTION_DAYS: '7',
    });
    expect(cfg.backupDir).toBe('/var/backups/xuantoi');
    expect(cfg.retentionDays).toBe(7);
  });

  it('BACKUP_RETENTION_DAYS invalid → fallback 0', () => {
    for (const v of ['abc', '-1', '', 'NaN']) {
      const cfg = readBackupConfig({ BACKUP_RETENTION_DAYS: v });
      expect(cfg.retentionDays).toBe(0);
    }
  });

  it('Empty env value coi như chưa set → fallback default', () => {
    const cfg = readBackupConfig({
      BACKUP_CRON_SCHEDULE: '',
      BACKUP_CRON_TZ: '',
      BACKUP_DIR: '',
    });
    expect(cfg.backupSchedule).toBe(BACKUP_CRON_SCHEDULE_DEFAULT);
    expect(cfg.timezone).toBe(BACKUP_CRON_DEFAULT_TZ);
    expect(cfg.backupDir).toBe(BACKUP_DIR_DEFAULT);
  });

  it('Phase 17.3 — offsiteUploadEnabled default false, opt-in qua env', () => {
    expect(readBackupConfig({}).offsiteUploadEnabled).toBe(false);
    expect(
      readBackupConfig({ BACKUP_OFFSITE_UPLOAD_ENABLED: 'true' })
        .offsiteUploadEnabled,
    ).toBe(true);
    // Khi env giá trị lạ → fallback false (giống các bool khác).
    expect(
      readBackupConfig({ BACKUP_OFFSITE_UPLOAD_ENABLED: 'maybe' })
        .offsiteUploadEnabled,
    ).toBe(false);
  });

  it('Phase 17.3 — alertConsecutiveFailures default 3, env override int', () => {
    expect(readBackupConfig({}).alertConsecutiveFailures).toBe(
      BACKUP_ALERT_CONSECUTIVE_FAILURES_DEFAULT,
    );
    expect(
      readBackupConfig({ BACKUP_ALERT_CONSECUTIVE_FAILURES: '5' })
        .alertConsecutiveFailures,
    ).toBe(5);
    // Invalid int → fallback default.
    expect(
      readBackupConfig({ BACKUP_ALERT_CONSECUTIVE_FAILURES: 'abc' })
        .alertConsecutiveFailures,
    ).toBe(BACKUP_ALERT_CONSECUTIVE_FAILURES_DEFAULT);
  });
});
