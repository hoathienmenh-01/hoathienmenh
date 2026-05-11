/**
 * Phase 17.2 — AdminBackupPanel tests.
 *
 * Cover:
 *   - loading state ban đầu (trước khi promise resolve).
 *   - empty state khi không có row latestBackup/latestVerify.
 *   - render: status payload đầy đủ → 2 badge OK + metadata, generatedAt.
 *   - error state: API throw → error message + retry button.
 *   - badge: STALE / FAILED / DISABLED render đúng class + label.
 *   - run backup: confirm false KHÔNG gọi API, confirm true gọi + reload.
 *   - run verify: confirm true gọi + reload.
 *   - i18n VI/EN: title render từ messages catalog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import type {
  BackupRunSummary,
  BackupStatusEntry,
  BackupStatusResponse,
  BackupVerifyRunSummary,
} from '@xuantoi/shared';

const { statusMock, runBackupMock, runVerifyMock } = vi.hoisted(() => ({
  statusMock: vi.fn(),
  runBackupMock: vi.fn(),
  runVerifyMock: vi.fn(),
}));

vi.mock('@/api/adminBackup', () => ({
  adminGetBackupStatus: statusMock,
  adminRunBackup: runBackupMock,
  adminRunBackupVerify: runVerifyMock,
}));

import AdminBackupPanel from '@/components/AdminBackupPanel.vue';
import viMessages from '@/i18n/vi.json';
import enMessages from '@/i18n/en.json';

function makeI18n(locale: 'vi' | 'en' = 'vi') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'vi',
    messages: { vi: viMessages, en: enMessages },
  });
}

function mountPanel(locale: 'vi' | 'en' = 'vi') {
  return mount(AdminBackupPanel, {
    global: {
      plugins: [makeI18n(locale)],
    },
  });
}

function makeEntry(
  overrides: Partial<BackupStatusEntry> = {},
): BackupStatusEntry {
  return {
    enabled: true,
    status: 'OK',
    staleReason: null,
    lastRunAt: new Date('2026-05-04T03:00:00Z').toISOString(),
    lastSuccessAt: new Date('2026-05-04T03:00:00Z').toISOString(),
    lastErrorAt: null,
    cronExpression: '0 3 * * 0',
    timezone: 'Asia/Ho_Chi_Minh',
    maxSilenceMs: 8 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

const SAMPLE_BACKUP_ROW: BackupRunSummary = {
  id: 'br-1',
  status: 'SUCCESS',
  startedAt: '2026-05-04T03:00:00Z',
  finishedAt: '2026-05-04T03:00:10Z',
  fileName: 'xuantoi-20260504-030000.sql.gz',
  fileSizeBytes: 2048,
  checksumSha256: null,
  storage: 'LOCAL',
  errorMessage: null,
  triggeredBy: 'CRON',
};

const SAMPLE_VERIFY_ROW: BackupVerifyRunSummary = {
  id: 'vr-1',
  backupRunId: 'br-1',
  status: 'SUCCESS',
  startedAt: '2026-05-04T04:00:00Z',
  finishedAt: '2026-05-04T04:00:05Z',
  checkedTables: 12,
  latestMigration: '20260628000000_phase_17_2_backup_run',
  errorMessage: null,
  triggeredBy: 'CRON',
};

function makeStatus(
  overrides: Partial<BackupStatusResponse> = {},
): BackupStatusResponse {
  return {
    backup: makeEntry(),
    verify: makeEntry(),
    latestBackup: SAMPLE_BACKUP_ROW,
    latestVerify: SAMPLE_VERIFY_ROW,
    generatedAt: '2026-05-04T05:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  statusMock.mockReset();
  runBackupMock.mockReset();
  runVerifyMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AdminBackupPanel', () => {
  it('renders loading state trước khi API resolve', async () => {
    let resolve: ((v: BackupStatusResponse) => void) | null = null;
    statusMock.mockReturnValue(
      new Promise<BackupStatusResponse>((r) => {
        resolve = r;
      }),
    );
    const w = mountPanel();
    expect(w.find('[data-testid="admin-backup-loading"]').exists()).toBe(true);
    resolve!(makeStatus());
    await flushPromises();
    expect(w.find('[data-testid="admin-backup-loading"]').exists()).toBe(false);
  });

  it('renders OK badge + metadata khi status đầy đủ', async () => {
    statusMock.mockResolvedValue(makeStatus());
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="admin-backup-panel"]').exists()).toBe(true);
    const backupBadge = w.get('[data-testid="admin-backup-badge"]');
    const verifyBadge = w.get('[data-testid="admin-verify-badge"]');
    expect(backupBadge.text()).toBe('OK');
    expect(verifyBadge.text()).toBe('OK');
    expect(w.find('[data-testid="admin-backup-latest"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-verify-latest"]').exists()).toBe(true);
    expect(w.html()).toContain('xuantoi-20260504-030000.sql.gz');
    expect(w.html()).toContain('20260628000000_phase_17_2_backup_run');
    expect(w.find('[data-testid="admin-backup-generated-at"]').exists()).toBe(
      true,
    );
  });

  it('empty state khi latestBackup/latestVerify đều null', async () => {
    statusMock.mockResolvedValue(
      makeStatus({ latestBackup: null, latestVerify: null }),
    );
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="admin-backup-latest-empty"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-testid="admin-verify-latest-empty"]').exists()).toBe(
      true,
    );
  });

  it('error state khi API throw + retry button gọi lại API', async () => {
    statusMock.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { code: 'FORBIDDEN' }),
    );
    statusMock.mockResolvedValueOnce(makeStatus());
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="admin-backup-error"]').exists()).toBe(true);
    await w.find('[data-testid="admin-backup-error-retry"]').trigger('click');
    await flushPromises();
    expect(statusMock).toHaveBeenCalledTimes(2);
    expect(w.find('[data-testid="admin-backup-panel"]').exists()).toBe(true);
    expect(w.find('[data-testid="admin-backup-error"]').exists()).toBe(false);
  });

  it('STALE/FAILED/DISABLED badge render đúng label', async () => {
    statusMock.mockResolvedValue(
      makeStatus({
        backup: makeEntry({
          enabled: false,
          status: 'DISABLED',
          staleReason: 'cron disabled',
        }),
        verify: makeEntry({
          status: 'STALE',
          staleReason: 'last success > 8 days ago',
        }),
      }),
    );
    const w = mountPanel();
    await flushPromises();
    expect(w.get('[data-testid="admin-backup-badge"]').text()).toBe('DISABLED');
    expect(w.get('[data-testid="admin-verify-badge"]').text()).toBe('STALE');
    expect(w.find('[data-testid="admin-verify-stale-reason"]').text()).toContain(
      'last success',
    );
  });

  it('DEGRADED ở BE map sang FAILED ở UI', async () => {
    statusMock.mockResolvedValue(
      makeStatus({
        backup: makeEntry({
          status: 'DEGRADED',
          staleReason: 'lastErrorAt fresher than lastSuccessAt',
          lastErrorAt: new Date().toISOString(),
        }),
      }),
    );
    const w = mountPanel();
    await flushPromises();
    expect(w.get('[data-testid="admin-backup-badge"]').text()).toBe('FAILED');
  });

  it('confirm false KHÔNG gọi runBackup API', async () => {
    statusMock.mockResolvedValue(makeStatus());
    const w = mountPanel();
    await flushPromises();
    await w.find('[data-testid="admin-backup-run-btn"]').trigger('click');
    await flushPromises();
    const modal = document.querySelector(
      '[data-testid="admin-backup-run-confirm"]',
    );
    expect(modal).not.toBeNull();
    const cancelBtn = document.querySelector(
      '[data-testid="admin-backup-run-confirm-cancel"]',
    ) as HTMLButtonElement | null;
    expect(cancelBtn).not.toBeNull();
    cancelBtn!.click();
    await flushPromises();
    expect(runBackupMock).not.toHaveBeenCalled();
  });

  it('confirm true gọi runBackup + reload status', async () => {
    statusMock.mockResolvedValue(makeStatus());
    runBackupMock.mockResolvedValue({
      ...SAMPLE_BACKUP_ROW,
      id: 'br-2',
      fileName: 'xuantoi-20260505-030000.sql.gz',
      triggeredBy: 'ADMIN' as const,
    });
    const w = mountPanel();
    await flushPromises();
    await w.find('[data-testid="admin-backup-run-btn"]').trigger('click');
    await flushPromises();
    const confirmBtn = document.querySelector(
      '[data-testid="admin-backup-run-confirm-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    await flushPromises();
    expect(runBackupMock).toHaveBeenCalledTimes(1);
    // Reload after success: initial mount + manual reload = 2.
    expect(statusMock).toHaveBeenCalledTimes(2);
  });

  it('confirm true gọi runVerify + reload status', async () => {
    statusMock.mockResolvedValue(makeStatus());
    runVerifyMock.mockResolvedValue({
      ...SAMPLE_VERIFY_ROW,
      id: 'vr-2',
      triggeredBy: 'ADMIN' as const,
    });
    const w = mountPanel();
    await flushPromises();
    await w.find('[data-testid="admin-verify-run-btn"]').trigger('click');
    await flushPromises();
    const confirmBtn = document.querySelector(
      '[data-testid="admin-verify-run-confirm-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    await flushPromises();
    expect(runVerifyMock).toHaveBeenCalledTimes(1);
    expect(runVerifyMock.mock.calls[0]).toEqual([]);
    expect(statusMock).toHaveBeenCalledTimes(2);
  });

  it('runBackup FAILED vẫn reload status để row FAILED hiện ra', async () => {
    statusMock.mockResolvedValue(makeStatus());
    runBackupMock.mockRejectedValue(
      Object.assign(new Error('failed'), { code: 'BACKUP_RUN_FAILED' }),
    );
    const w = mountPanel();
    await flushPromises();
    await w.find('[data-testid="admin-backup-run-btn"]').trigger('click');
    await flushPromises();
    const confirmBtn = document.querySelector(
      '[data-testid="admin-backup-run-confirm-confirm"]',
    ) as HTMLButtonElement | null;
    confirmBtn!.click();
    await flushPromises();
    expect(runBackupMock).toHaveBeenCalledTimes(1);
    // Initial mount + reload after failure.
    expect(statusMock).toHaveBeenCalledTimes(2);
  });

  it('i18n EN render English title', async () => {
    statusMock.mockResolvedValue(makeStatus());
    const w = mountPanel('en');
    await flushPromises();
    expect(w.text()).toContain('Backup & Verify Restore');
    expect(w.text()).toContain('Run backup now');
    expect(w.text()).toContain('Run verify now');
  });
});
