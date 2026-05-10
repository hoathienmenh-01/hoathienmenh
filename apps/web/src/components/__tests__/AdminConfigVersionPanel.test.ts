/**
 * Phase 15.6 — AdminConfigVersionPanel tests.
 *
 * Cover:
 *   - render list versions sau khi nhập entityId + click refresh.
 *   - empty state khi list trả mảng rỗng.
 *   - dry-run rollback hiển thị safety badge + apply button (không hiện
 *     khi BLOCKED).
 *   - apply rollback gọi API với confirmPhrase đúng khi NEED_CONFIRM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import type {
  ConfigRollbackResponse,
  ConfigVersionAction,
  ConfigVersionEntityType,
} from '@xuantoi/shared';

const { listMock, dryRunMock, applyMock, diffMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  dryRunMock: vi.fn(),
  applyMock: vi.fn(),
  diffMock: vi.fn(),
}));

vi.mock('@/api/configVersion', () => ({
  adminListConfigVersions: listMock,
  adminDryRunConfigRollback: dryRunMock,
  adminApplyConfigRollback: applyMock,
  adminDiffConfigVersions: diffMock,
}));

import AdminConfigVersionPanel from '@/components/AdminConfigVersionPanel.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      common: { loading: 'Đang tải…', confirm: 'OK', cancel: 'Huỷ' },
      adminConfigVersion: {
        title: 'Config Version',
        hint: 'Hint',
        entityType: 'EntityType',
        entityId: 'EntityId',
        entityIdPlaceholder: 'id',
        refresh: 'Refresh',
        loading: 'Loading',
        empty: 'Empty.',
        diff: 'Diff',
        dryRun: 'DryRun',
        diffTitle: 'Diff v{from} → v{to}',
        dryRunTitle: 'Dry-run v{from} → v{to}',
        warningsLabel: 'Warnings',
        changedFields: '{count} fields',
        noChanges: 'No changes',
        applyRollback: 'Apply',
        blockedNotice: 'Blocked',
        confirmTitle: 'Confirm',
        confirmDescriptionSafe: 'Safe.',
        confirmDescriptionNeedConfirm: 'Type {phrase}',
        reasonLabel: 'Reason',
        reasonPlaceholder: 'reason',
        confirmPhraseLabel: 'Phrase {phrase}',
        col: { action: 'Action', changedAt: 'Time', reason: 'Reason', actions: 'Actions' },
        entityTypeLabel: {
          LIVEOPS_EVENT: 'LiveOps Event',
          LIVEOPS_ANNOUNCEMENT: 'Announcement',
          FEATURE_FLAG: 'Feature Flag',
          MAINTENANCE_WINDOW: 'Maintenance Window',
        },
        toast: {
          applied: 'Applied {from}→{to} v{applied}',
          blocked: 'Blocked',
        },
        errors: { UNKNOWN: 'Lỗi.', CONFIG_ROLLBACK_BLOCKED: 'Blocked.' },
      },
      toast: { title: { info: 'Info', error: 'Lỗi', success: 'OK' } },
    },
  },
});

interface VersionRow {
  id: string;
  entityType: ConfigVersionEntityType;
  entityId: string;
  version: number;
  action: ConfigVersionAction;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown>;
  changedByAdminId: string | null;
  reason: string | null;
  createdAt: string;
}

function makeRow(over: Partial<VersionRow> = {}): VersionRow {
  return {
    id: `v-${over.version ?? 1}`,
    entityType: 'FEATURE_FLAG',
    entityId: 'MARKET_ENABLED',
    version: over.version ?? 1,
    action: 'UPDATE',
    beforeJson: { enabled: true },
    afterJson: { enabled: false },
    changedByAdminId: 'admin-1',
    reason: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

function makeDryRun(
  over: Partial<ConfigRollbackResponse> = {},
): ConfigRollbackResponse {
  return {
    status: 'DRY_RUN',
    safetyLevel: 'SAFE',
    entityType: 'FEATURE_FLAG',
    entityId: 'MARKET_ENABLED',
    fromVersion: 2,
    targetVersion: 1,
    changedFields: ['enabled'],
    diff: { enabled: { before: false, after: true } },
    warnings: [],
    requiresConfirm: false,
    confirmPhrase: null,
    appliedVersion: null,
    newVersionId: null,
    ...over,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  listMock.mockReset();
  dryRunMock.mockReset();
  applyMock.mockReset();
  diffMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

async function mountAndLoad(rows: VersionRow[]) {
  listMock.mockResolvedValue(rows);
  const w = mount(AdminConfigVersionPanel, {
    attachTo: document.body,
    global: { plugins: [i18n] },
  });
  await w
    .find('[data-testid="admin-config-version-entity-id"]')
    .setValue('MARKET_ENABLED');
  await w.find('[data-testid="admin-config-version-refresh"]').trigger('click');
  await flushPromises();
  return w;
}

describe('AdminConfigVersionPanel', () => {
  it('render list versions sau refresh', async () => {
    const w = await mountAndLoad([makeRow({ version: 1 }), makeRow({ version: 2 })]);
    expect(
      w.find('[data-testid="admin-config-version-row-1"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="admin-config-version-row-2"]').exists(),
    ).toBe(true);
    w.unmount();
  });

  it('empty state khi list rỗng', async () => {
    const w = await mountAndLoad([]);
    expect(w.find('[data-testid="admin-config-version-empty"]').exists()).toBe(
      true,
    );
    w.unmount();
  });

  it('dry-run SAFE → hiện safety badge + apply button', async () => {
    dryRunMock.mockResolvedValue(makeDryRun({ safetyLevel: 'SAFE' }));
    const w = await mountAndLoad([makeRow({ version: 1 }), makeRow({ version: 2 })]);
    await w
      .find('[data-testid="admin-config-version-dry-run-1"]')
      .trigger('click');
    await flushPromises();
    expect(
      w.find('[data-testid="admin-config-version-safety-badge"]').text(),
    ).toBe('SAFE');
    expect(w.find('[data-testid="admin-config-version-apply"]').exists()).toBe(
      true,
    );
    w.unmount();
  });

  it('dry-run BLOCKED → KHÔNG hiện apply button', async () => {
    dryRunMock.mockResolvedValue(
      makeDryRun({
        safetyLevel: 'BLOCKED',
        warnings: ['CONFIG_ROLLBACK_LIVEOPS_EVENT_REWARD_AFTER_CLAIM'],
      }),
    );
    const w = await mountAndLoad([makeRow({ version: 1 }), makeRow({ version: 2 })]);
    await w
      .find('[data-testid="admin-config-version-dry-run-1"]')
      .trigger('click');
    await flushPromises();
    expect(
      w.find('[data-testid="admin-config-version-safety-badge"]').text(),
    ).toBe('BLOCKED');
    expect(w.find('[data-testid="admin-config-version-apply"]').exists()).toBe(
      false,
    );
    w.unmount();
  });

  it('apply NEED_CONFIRM gọi API với confirmPhrase đúng', async () => {
    dryRunMock.mockResolvedValue(
      makeDryRun({
        safetyLevel: 'NEED_CONFIRM',
        requiresConfirm: true,
        confirmPhrase: 'CONFIRM_ROLLBACK',
      }),
    );
    applyMock.mockResolvedValue(
      makeDryRun({
        status: 'APPLIED',
        appliedVersion: 3,
        newVersionId: 'v-3',
      }),
    );
    const w = await mountAndLoad([makeRow({ version: 1 }), makeRow({ version: 2 })]);
    await w
      .find('[data-testid="admin-config-version-dry-run-1"]')
      .trigger('click');
    await flushPromises();
    await w.find('[data-testid="admin-config-version-apply"]').trigger('click');
    await flushPromises();
    // ConfirmModal is teleported to body; query via document.
    const phraseInput = document.querySelector<HTMLInputElement>(
      '[data-testid="admin-config-version-confirm-phrase-input"]',
    );
    expect(phraseInput).not.toBeNull();
    if (phraseInput) {
      phraseInput.value = 'CONFIRM_ROLLBACK';
      phraseInput.dispatchEvent(new Event('input'));
    }
    await flushPromises();
    const confirmBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="admin-config-version-confirm-modal-confirm"]',
    );
    expect(confirmBtn).not.toBeNull();
    confirmBtn?.click();
    await flushPromises();
    expect(applyMock).toHaveBeenCalledWith('v-1', {
      reason: undefined,
      confirmPhrase: 'CONFIRM_ROLLBACK',
    });
    w.unmount();
  });
});
