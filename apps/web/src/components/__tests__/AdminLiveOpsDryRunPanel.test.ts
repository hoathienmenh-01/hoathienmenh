/**
 * Phase 13.1.D — AdminLiveOpsDryRunPanel tests.
 *
 * Mock /admin/liveops/dry-run client; verify:
 *   - submit event dry-run gọi đúng input + render result section.
 *   - submit boss dry-run với regionKey/level/reason gọi đúng input.
 *   - submit empty key → toast error, KHÔNG gọi API.
 *   - submit error API → render error placeholder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const adminLiveOpsDryRunMock = vi.fn();

vi.mock('@/api/admin', () => ({
  adminLiveOpsDryRun: (...a: unknown[]) => adminLiveOpsDryRunMock(...a),
}));

import AdminLiveOpsDryRunPanel from '@/components/AdminLiveOpsDryRunPanel.vue';
import type {
  AdminLiveOpsDryRunBossResult,
  AdminLiveOpsDryRunEventResult,
} from '@/api/admin';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      adminLiveOpsDryRun: {
        title: 'Dry-run',
        help: 'Mô phỏng event/boss.',
        kindLabel: 'Loại',
        kindEvent: 'Event',
        kindBoss: 'Boss',
        keyLabel: 'Key',
        keyPlaceholder: 'event_key hoặc boss_key',
        regionLabel: 'Region',
        regionPlaceholder: 'region_key',
        levelLabel: 'Level',
        reasonLabel: 'Lý do',
        reasonPlaceholder: 'optional',
        submitBtn: 'Mô phỏng',
        submitting: 'Đang chạy…',
        simulatedHint: 'KHÔNG ghi reward thật.',
        eventResultHeader: 'Kết quả event',
        eventEnabled: 'Effective {effective} (catalog {catalog})',
        eventNextSlot: 'Slot kế: {start}→{end}',
        eventRegionBoss: 'Region {region} · Boss {boss}',
        eventOverride:
          'Override enabled={enabled} bởi {updatedBy} @ {updatedAt}',
        bossResultHeader: 'Kết quả boss',
        bossRegionLevel: '{region} · level {level} · {realm}',
        bossSimulatedHp: 'HP giả lập: {hp}',
        bossReward: 'Linh thạch giả lập: {linhThach}',
        bossDropTop: 'Top:',
        bossDropMid: 'Mid:',
        bossDropLow: 'Low:',
        simulatedAt: 'Simulated at {iso}',
        toast: {
          simulated: 'Mô phỏng {kind} OK.',
        },
        errors: {
          KEY_REQUIRED: 'Cần key.',
          UNAUTHORIZED: 'Không có quyền.',
          ADMIN_ONLY: 'Cần ADMIN.',
          EVENT_NOT_FOUND: 'Sự kiện không tồn tại.',
          BOSS_NOT_FOUND: 'Boss không tồn tại.',
          INVALID_INPUT: 'Input sai.',
          UNKNOWN: 'Lỗi không xác định.',
        },
      },
    },
  },
});

const SAMPLE_EVENT_RESULT: AdminLiveOpsDryRunEventResult = {
  kind: 'event',
  key: 'ev_daily',
  type: 'DAILY',
  titleI18nKey: 'adminLiveOpsDryRun.events.ev_daily.title',
  descriptionI18nKey: 'adminLiveOpsDryRun.events.ev_daily.title',
  catalogEnabled: true,
  effectiveEnabled: true,
  override: null,
  nextSlotStartIso: '2030-01-02T00:00:00.000Z',
  nextSlotEndIso: '2030-01-02T01:00:00.000Z',
  simulated: true,
  reason: null,
  simulatedAt: '2030-01-01T00:00:00.000Z',
};

const SAMPLE_BOSS_RESULT: AdminLiveOpsDryRunBossResult = {
  kind: 'boss',
  bossKey: 'sky_dragon',
  bossName: 'Sky Dragon',
  regionKey: 'son_coc',
  level: 5,
  simulatedMaxHp: '999999',
  simulatedReward: {
    baseLinhThach: 100,
    topDropPool: ['top_item_1'],
    midDropPool: ['mid_item_1'],
    lowDropPool: ['low_item_1'],
  },
  recommendedRealm: 'JINDAN',
  simulated: true,
  reason: 'preview boss',
  simulatedAt: '2030-01-01T00:00:00.000Z',
};

function mountPanel() {
  return mount(AdminLiveOpsDryRunPanel, {
    global: { plugins: [i18n] },
  });
}

describe('AdminLiveOpsDryRunPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    adminLiveOpsDryRunMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('submit event dry-run: gọi adminLiveOpsDryRun với { kind:"event", key, reason } + render event result', async () => {
    adminLiveOpsDryRunMock.mockResolvedValueOnce(SAMPLE_EVENT_RESULT);
    const w = mountPanel();
    await flushPromises();

    await w.find('[data-test="admin-liveops-dryrun-key"]').setValue('ev_daily');
    await w
      .find('[data-test="admin-liveops-dryrun-reason"]')
      .setValue('preview event');
    await w
      .find('[data-test="admin-liveops-dryrun-submit"]')
      .trigger('click');
    await flushPromises();

    expect(adminLiveOpsDryRunMock).toHaveBeenCalledTimes(1);
    expect(adminLiveOpsDryRunMock).toHaveBeenCalledWith({
      kind: 'event',
      key: 'ev_daily',
      reason: 'preview event',
    });

    expect(
      w.find('[data-test="admin-liveops-dryrun-result-event"]').exists(),
    ).toBe(true);
    expect(w.text()).toContain('ev_daily');
  });

  it('submit boss dry-run: gọi adminLiveOpsDryRun với { kind:"boss", key, regionKey, level, reason } + render boss result', async () => {
    adminLiveOpsDryRunMock.mockResolvedValueOnce(SAMPLE_BOSS_RESULT);
    const w = mountPanel();
    await flushPromises();

    await w.find('[data-test="admin-liveops-dryrun-kind"]').setValue('boss');
    await w
      .find('[data-test="admin-liveops-dryrun-key"]')
      .setValue('sky_dragon');
    await w
      .find('[data-test="admin-liveops-dryrun-region"]')
      .setValue('son_coc');
    await w.find('[data-test="admin-liveops-dryrun-level"]').setValue('5');
    await w
      .find('[data-test="admin-liveops-dryrun-reason"]')
      .setValue('preview boss');
    await w
      .find('[data-test="admin-liveops-dryrun-submit"]')
      .trigger('click');
    await flushPromises();

    expect(adminLiveOpsDryRunMock).toHaveBeenCalledTimes(1);
    expect(adminLiveOpsDryRunMock).toHaveBeenCalledWith({
      kind: 'boss',
      key: 'sky_dragon',
      regionKey: 'son_coc',
      level: 5,
      reason: 'preview boss',
    });

    expect(
      w.find('[data-test="admin-liveops-dryrun-result-boss"]').exists(),
    ).toBe(true);
    expect(w.text()).toContain('Sky Dragon');
    expect(w.text()).toContain('999999');
    expect(w.text()).toContain('top_item_1');
  });

  it('submit empty key → KHÔNG gọi adminLiveOpsDryRun (toast error)', async () => {
    const w = mountPanel();
    await flushPromises();

    await w
      .find('[data-test="admin-liveops-dryrun-submit"]')
      .trigger('click');
    await flushPromises();

    expect(adminLiveOpsDryRunMock).not.toHaveBeenCalled();
  });

  it('submit error API (EVENT_NOT_FOUND) → render error placeholder; panel KHÔNG crash', async () => {
    const err = Object.assign(new Error('EVENT_NOT_FOUND'), {
      code: 'EVENT_NOT_FOUND',
    });
    adminLiveOpsDryRunMock.mockRejectedValueOnce(err);
    const w = mountPanel();
    await flushPromises();

    await w
      .find('[data-test="admin-liveops-dryrun-key"]')
      .setValue('nonexistent');
    await w
      .find('[data-test="admin-liveops-dryrun-submit"]')
      .trigger('click');
    await flushPromises();

    expect(adminLiveOpsDryRunMock).toHaveBeenCalledTimes(1);
    expect(
      w.find('[data-test="admin-liveops-dryrun-error"]').exists(),
    ).toBe(true);
    expect(w.text()).toContain('Sự kiện không tồn tại.');
  });
});
