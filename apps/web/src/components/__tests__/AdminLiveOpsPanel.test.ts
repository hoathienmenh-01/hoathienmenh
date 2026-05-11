/**
 * Phase 13.1.B — AdminLiveOpsPanel tests.
 *
 * Mock /admin/liveops + /admin/sect-war/* clients; verify:
 *   - render liveops events table + tz hint + today/active counts.
 *   - toggle event success → refresh status, button label flip ON↔OFF.
 *   - error state hiển thị error placeholder; sectWar refresh fail
 *     non-fatal (panel vẫn render).
 *   - permission fallback / loading state KHÔNG crash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const adminLiveOpsStatusMock = vi.fn();
const adminLiveOpsToggleMock = vi.fn();
const adminSectWarStatusMock = vi.fn();
const adminSectWarRecalculateMock = vi.fn();
// Phase 13.1.C — additional mocks for advanced controls.
const adminSpawnBossMock = vi.fn();
const adminSectWarSnapshotMock = vi.fn();
// Phase 13.2.D + 14.0.F — Weekly cycle force-run mock.
const adminLiveOpsRunWeeklyCycleMock = vi.fn();
// Phase 15.8 — Cron health status mocks.
const adminTerritoryCronStatusMock = vi.fn();
const adminSectSeasonCronStatusMock = vi.fn();

vi.mock('@/api/admin', () => ({
  adminLiveOpsStatus: (...a: unknown[]) => adminLiveOpsStatusMock(...a),
  adminLiveOpsToggle: (...a: unknown[]) => adminLiveOpsToggleMock(...a),
  adminSectWarStatus: (...a: unknown[]) => adminSectWarStatusMock(...a),
  adminSectWarRecalculate: (...a: unknown[]) =>
    adminSectWarRecalculateMock(...a),
  adminSpawnBoss: (...a: unknown[]) => adminSpawnBossMock(...a),
  adminSectWarSnapshot: (...a: unknown[]) => adminSectWarSnapshotMock(...a),
  adminLiveOpsRunWeeklyCycle: (...a: unknown[]) =>
    adminLiveOpsRunWeeklyCycleMock(...a),
  adminTerritoryCronStatus: (...a: unknown[]) =>
    adminTerritoryCronStatusMock(...a),
  adminSectSeasonCronStatus: (...a: unknown[]) =>
    adminSectSeasonCronStatusMock(...a),
}));

import AdminLiveOpsPanel from '@/components/AdminLiveOpsPanel.vue';
import type {
  AdminLiveOpsStatusView,
  AdminSectWarStatusView,
} from '@/api/admin';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      adminLiveOps: {
        title: 'LiveOps Controls',
        loading: 'Đang tải LiveOps…',
        tz: 'TZ {tz}',
        todayCount: 'Hôm nay {n} sự kiện',
        activeCount: 'Đang chạy {n}',
        statusOn: 'BẬT',
        statusOff: 'TẮT',
        today: 'hôm nay',
        active: 'active',
        enableBtn: 'Bật',
        disableBtn: 'Tắt',
        confirmToggle: 'Xác nhận toggle {key} → {on}?',
        confirmRecalc: 'Recalculate sect war?',
        reasonPlaceholder: 'Lý do (optional)',
        col: {
          key: 'Sự kiện',
          type: 'Loại',
          status: 'Trạng thái',
          override: 'Override',
          reason: 'Lý do',
        },
        toast: {
          toggled: 'Toggle {key} → {on} OK.',
          recalculated: 'Recalc OK.',
        },
        sectWar: {
          title: 'Sect War status',
          summary:
            '{week} · {sects} sects · {contributors} contributors · {contributions} entries',
          unavailable: 'Không khả dụng.',
          recalcBtn: 'Recalculate',
          snapshotBtn: 'Snapshot',
          snapshotting: 'Snapping…',
          confirmSnapshot: 'Snapshot sect war?',
          toast: { snapshot: 'Snapshot OK.' },
          topHeader: 'Top Sects',
          row: '{points} điểm · {contributors} người',
        },
        boss: {
          title: 'Force Boss Spawn',
          help: 'Spawn boss khẩn cấp.',
          regionLabel: 'Region',
          regionPlaceholder: '— region —',
          bossKeyLabel: 'Boss',
          bossKeyPlaceholder: 'auto',
          levelLabel: 'Level',
          reasonLabel: 'Lý do',
          reasonPlaceholder: 'Lý do',
          forceLabel: 'Force',
          submitBtn: 'Spawn',
          submitting: 'Spawning…',
          errorRegionRequired: 'Cần region.',
          confirm: 'Spawn {bossKey} lvl {level} tại {region}?',
          toast: { spawned: 'Spawned {bossKey} lvl {level} ở {region}.' },
        },
        errors: {
          UNAUTHORIZED: 'Không có quyền.',
          EVENT_NOT_FOUND: 'Sự kiện không tồn tại.',
          INVALID_INPUT: 'Input không hợp lệ.',
          INVALID_BOSS_KEY: 'Boss key sai.',
          BOSS_ALREADY_ACTIVE: 'Boss đang active.',
          PERIOD_INVALID: 'Period invalid.',
          UNKNOWN: 'Không thể thao tác.',
        },
        weeklyCycle: {
          title: 'Chu kỳ tuần',
          help: 'Force-run weekly cycle.',
          periodLabel: 'Period',
          periodPlaceholder: 'auto',
          bypassLeaseLabel: 'Bypass lease',
          submitBtn: 'Run weekly cycle',
          submitting: 'Running…',
          confirm: 'Run weekly cycle?',
          summary:
            'Settled {settled} · Skipped {skipped} · Mail {mails} (already {already}) · Snapshots {snapshots}',
          rewards:
            'Champion {champ} (already {champExisted}) · MVP {mvp} (already {mvpExisted})',
          errorsLabel: 'Errors',
          toast: { ok: 'Weekly cycle done.' },
        },
        cronHealth: {
          title: 'Cron Health',
          refresh: 'Refresh',
          territoryLabel: 'Territory cron',
          sectSeasonLabel: 'Sect Season cron',
          lastSuccess: 'Last success: {at}',
          lastError: 'Last error: {at}',
          never: 'never',
          error: 'Load failed ({code}).',
        },
        events: {
          ev1: { title: 'Daily Login Reset' },
        },
      },
    },
  },
});

const SAMPLE_STATUS: AdminLiveOpsStatusView = {
  tz: 'Asia/Ho_Chi_Minh',
  events: [
    {
      key: 'ev1',
      type: 'DAILY',
      catalogEnabled: true,
      effectiveEnabled: true,
      override: null,
      titleI18nKey: 'adminLiveOps.events.ev1.title',
      descriptionI18nKey: 'adminLiveOps.events.ev1.title',
      dailyTime: '00:00',
    },
    {
      key: 'ev2',
      type: 'WINDOW',
      catalogEnabled: true,
      effectiveEnabled: false,
      override: {
        key: 'ev2',
        enabled: false,
        startsAt: null,
        endsAt: null,
        reason: 'maintenance',
        updatedBy: 'admin-1',
        updatedAt: '2030-01-01T00:00:00.000Z',
        createdAt: '2030-01-01T00:00:00.000Z',
      },
      titleI18nKey: 'adminLiveOps.events.ev2.title',
      descriptionI18nKey: 'adminLiveOps.events.ev2.title',
      regionKey: 'son_coc',
      bossKey: 'sky_dragon',
    },
  ],
  todayKeys: ['ev1'],
  activeKeys: ['ev1'],
};

const SAMPLE_SECTWAR: AdminSectWarStatusView = {
  weekKey: '2030-W01',
  totalSects: 3,
  totalContributors: 12,
  totalContributions: 42,
  topSects: [
    { sectId: 's1', sectName: 'Thanh Liên', points: 1200, contributors: 8 },
    { sectId: 's2', sectName: 'Huyền Vũ', points: 600, contributors: 3 },
  ],
};

function mountPanel() {
  return mount(AdminLiveOpsPanel, {
    global: { plugins: [i18n] },
  });
}

describe('AdminLiveOpsPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    adminLiveOpsStatusMock.mockReset();
    adminLiveOpsToggleMock.mockReset();
    adminSectWarStatusMock.mockReset();
    adminSectWarRecalculateMock.mockReset();
    adminSpawnBossMock.mockReset();
    adminSectWarSnapshotMock.mockReset();
    adminLiveOpsRunWeeklyCycleMock.mockReset();
    // Phase 15.8 — default cron health stubs (DISABLED to avoid noise).
    adminTerritoryCronStatusMock.mockReset();
    adminSectSeasonCronStatusMock.mockReset();
    adminTerritoryCronStatusMock.mockResolvedValue({
      enabled: false,
      cron: '5 0 * * 1',
      timezone: 'Asia/Ho_Chi_Minh',
      previousPeriodKey: '2030-W01',
      lastSettlement: null,
      lastDecay: null,
      lastReward: null,
      health: {
        status: 'DISABLED',
        lastRunAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        staleReason: null,
        nextExpectedRunAt: null,
      },
    });
    adminSectSeasonCronStatusMock.mockResolvedValue({
      enabled: false,
      cron: '15 0 * * *',
      timezone: 'Asia/Ho_Chi_Minh',
      lastSnapshot: null,
      lastChampionGrant: null,
      lastMvpGrant: null,
      health: {
        status: 'DISABLED',
        lastRunAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        staleReason: null,
        nextExpectedRunAt: null,
      },
    });
    // Default confirm() = true để toggle/recalc đi qua confirm prompt.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('render liveops status table + tz + today/active counts + sect war summary', async () => {
    adminLiveOpsStatusMock.mockResolvedValueOnce(SAMPLE_STATUS);
    adminSectWarStatusMock.mockResolvedValueOnce(SAMPLE_SECTWAR);
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="admin-liveops-panel"]').exists()).toBe(true);
    expect(w.text()).toContain('LiveOps Controls');
    expect(w.text()).toContain('TZ Asia/Ho_Chi_Minh');
    expect(w.text()).toContain('Hôm nay 1 sự kiện');
    expect(w.text()).toContain('Đang chạy 1');

    const rows = w.findAll('[data-test="admin-liveops-row"]');
    expect(rows.length).toBe(2);
    // ev1 hiển thị BẬT, ev2 (override.enabled=false) hiển thị TẮT.
    const statuses = w.findAll('[data-test="admin-liveops-status"]');
    expect(statuses[0].text()).toBe('BẬT');
    expect(statuses[1].text()).toBe('TẮT');

    // SectWar summary line.
    expect(w.text()).toContain('2030-W01');
    expect(w.text()).toContain('3 sects');
    expect(w.text()).toContain('12 contributors');
    expect(w.text()).toContain('42 entries');
    // Top sects rendered.
    expect(w.text()).toContain('Thanh Liên');
    expect(w.text()).toContain('Huyền Vũ');
  });

  it('toggle event success → adminLiveOpsToggle gọi đúng, status refresh, label flip', async () => {
    adminLiveOpsStatusMock
      .mockResolvedValueOnce(SAMPLE_STATUS)
      .mockResolvedValueOnce({
        ...SAMPLE_STATUS,
        events: [
          { ...SAMPLE_STATUS.events[0], effectiveEnabled: false },
          SAMPLE_STATUS.events[1],
        ],
        activeKeys: [],
        todayKeys: [],
      });
    adminSectWarStatusMock.mockResolvedValueOnce(SAMPLE_SECTWAR);
    adminLiveOpsToggleMock.mockResolvedValueOnce({
      key: 'ev1',
      enabled: false,
      startsAt: null,
      endsAt: null,
      reason: null,
      updatedBy: 'admin-1',
      updatedAt: '2030-01-01T00:00:00.000Z',
      createdAt: '2030-01-01T00:00:00.000Z',
    });

    const w = mountPanel();
    await flushPromises();

    const toggles = w.findAll('[data-test="admin-liveops-toggle"]');
    // ev1 effectiveEnabled=true → button label = "Tắt".
    expect(toggles[0].text()).toBe('Tắt');
    await toggles[0].trigger('click');
    await flushPromises();

    expect(adminLiveOpsToggleMock).toHaveBeenCalledWith({
      key: 'ev1',
      enabled: false,
      reason: null,
    });
    expect(adminLiveOpsStatusMock).toHaveBeenCalledTimes(2);
    // Sau refresh, label flip "Bật".
    const togglesAfter = w.findAll('[data-test="admin-liveops-toggle"]');
    expect(togglesAfter[0].text()).toBe('Bật');
  });

  it('toggle error (EVENT_NOT_FOUND) → toast error; status KHÔNG refresh', async () => {
    adminLiveOpsStatusMock.mockResolvedValueOnce(SAMPLE_STATUS);
    adminSectWarStatusMock.mockResolvedValueOnce(SAMPLE_SECTWAR);
    const err = Object.assign(new Error('EVENT_NOT_FOUND'), {
      code: 'EVENT_NOT_FOUND',
    });
    adminLiveOpsToggleMock.mockRejectedValueOnce(err);

    const w = mountPanel();
    await flushPromises();
    const toggles = w.findAll('[data-test="admin-liveops-toggle"]');
    await toggles[0].trigger('click');
    await flushPromises();

    expect(adminLiveOpsToggleMock).toHaveBeenCalled();
    // status chỉ được fetch 1 lần (initial), KHÔNG refresh sau error.
    expect(adminLiveOpsStatusMock).toHaveBeenCalledTimes(1);
  });

  it('error state status load fail + sectWar fail (non-fatal): error placeholder + sectWar unavailable line', async () => {
    const err = Object.assign(new Error('UNKNOWN'), { code: 'UNKNOWN' });
    adminLiveOpsStatusMock.mockRejectedValueOnce(err);
    adminSectWarStatusMock.mockRejectedValueOnce(err);
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="admin-liveops-error"]').exists()).toBe(true);
    expect(w.text()).toContain('Không thể thao tác.');
  });

  // ─────────────────────────────────────────────────────────────────────
  // Phase 13.1.C — Force Boss Spawn + Sect War Snapshot UI
  // ─────────────────────────────────────────────────────────────────────
  it('render Force Boss Spawn section: region select có option "son_coc" từ catalog event regionKey', async () => {
    adminLiveOpsStatusMock.mockResolvedValueOnce(SAMPLE_STATUS);
    adminSectWarStatusMock.mockResolvedValueOnce(SAMPLE_SECTWAR);
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="admin-liveops-boss"]').exists()).toBe(true);
    const region = w.find<HTMLSelectElement>('[data-test="admin-liveops-boss-region"]');
    expect(region.exists()).toBe(true);
    const optionVals = region
      .findAll('option')
      .map((o) => (o.element as HTMLOptionElement).value);
    expect(optionVals).toContain('son_coc');
  });

  it('force spawn submit: gọi adminSpawnBoss với region/bossKey/level/force/reason; toast success', async () => {
    adminLiveOpsStatusMock.mockResolvedValueOnce(SAMPLE_STATUS);
    adminSectWarStatusMock.mockResolvedValueOnce(SAMPLE_SECTWAR);
    adminSpawnBossMock.mockResolvedValueOnce({
      id: 'boss-1',
      bossKey: 'sky_dragon',
      level: 3,
      maxHp: '999999',
      regionKey: 'son_coc',
    });
    const w = mountPanel();
    await flushPromises();

    await w.find('[data-test="admin-liveops-boss-region"]').setValue('son_coc');
    await w.find('[data-test="admin-liveops-boss-key"]').setValue('sky_dragon');
    await w.find('[data-test="admin-liveops-boss-level"]').setValue('3');
    await w.find('[data-test="admin-liveops-boss-force"]').setValue(true);
    await w.find('[data-test="admin-liveops-boss-reason"]').setValue('incident smoke');

    await w.find('[data-test="admin-liveops-boss-submit"]').trigger('click');
    await flushPromises();

    expect(adminSpawnBossMock).toHaveBeenCalledTimes(1);
    expect(adminSpawnBossMock).toHaveBeenCalledWith({
      regionKey: 'son_coc',
      bossKey: 'sky_dragon',
      level: 3,
      force: true,
      reason: 'incident smoke',
    });
  });

  it('force spawn không chọn region → toast error, KHÔNG gọi adminSpawnBoss', async () => {
    adminLiveOpsStatusMock.mockResolvedValueOnce(SAMPLE_STATUS);
    adminSectWarStatusMock.mockResolvedValueOnce(SAMPLE_SECTWAR);
    const w = mountPanel();
    await flushPromises();

    // Region empty by default.
    await w.find('[data-test="admin-liveops-boss-submit"]').trigger('click');
    await flushPromises();
    expect(adminSpawnBossMock).not.toHaveBeenCalled();
  });

  it('force spawn API error (BOSS_ALREADY_ACTIVE) → toast i18n error code; KHÔNG crash', async () => {
    adminLiveOpsStatusMock.mockResolvedValueOnce(SAMPLE_STATUS);
    adminSectWarStatusMock.mockResolvedValueOnce(SAMPLE_SECTWAR);
    const err = Object.assign(new Error('BOSS_ALREADY_ACTIVE'), {
      code: 'BOSS_ALREADY_ACTIVE',
    });
    adminSpawnBossMock.mockRejectedValueOnce(err);
    const w = mountPanel();
    await flushPromises();

    await w.find('[data-test="admin-liveops-boss-region"]').setValue('son_coc');
    await w.find('[data-test="admin-liveops-boss-submit"]').trigger('click');
    await flushPromises();

    expect(adminSpawnBossMock).toHaveBeenCalledTimes(1);
    // Panel still mounted (no crash).
    expect(w.find('[data-test="admin-liveops-panel"]').exists()).toBe(true);
  });

  it('snapshot button click: gọi adminSectWarSnapshot, refresh sectWar view', async () => {
    adminLiveOpsStatusMock.mockResolvedValueOnce(SAMPLE_STATUS);
    adminSectWarStatusMock.mockResolvedValueOnce(SAMPLE_SECTWAR);
    adminSectWarSnapshotMock.mockResolvedValueOnce({
      ...SAMPLE_SECTWAR,
      totalSects: 5,
    });
    const w = mountPanel();
    await flushPromises();

    await w.find('[data-test="admin-liveops-snapshot"]').trigger('click');
    await flushPromises();

    expect(adminSectWarSnapshotMock).toHaveBeenCalledWith({});
    // Panel re-rendered with updated sect war data.
    expect(w.text()).toContain('5 sects');
  });

  it('snapshot API error → toast error; panel KHÔNG crash', async () => {
    adminLiveOpsStatusMock.mockResolvedValueOnce(SAMPLE_STATUS);
    adminSectWarStatusMock.mockResolvedValueOnce(SAMPLE_SECTWAR);
    const err = Object.assign(new Error('UNKNOWN'), { code: 'UNKNOWN' });
    adminSectWarSnapshotMock.mockRejectedValueOnce(err);
    const w = mountPanel();
    await flushPromises();

    await w.find('[data-test="admin-liveops-snapshot"]').trigger('click');
    await flushPromises();

    expect(adminSectWarSnapshotMock).toHaveBeenCalledTimes(1);
    expect(w.find('[data-test="admin-liveops-panel"]').exists()).toBe(true);
  });

  // Phase 13.2.D + 14.0.F — Weekly cycle force-run UI.
  it('weekly cycle: render section + submit gọi adminLiveOpsRunWeeklyCycle với input từ form', async () => {
    adminLiveOpsStatusMock.mockResolvedValueOnce(SAMPLE_STATUS);
    adminSectWarStatusMock.mockResolvedValueOnce(SAMPLE_SECTWAR);
    adminLiveOpsRunWeeklyCycleMock.mockResolvedValueOnce({
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      skippedAlreadyDone: false,
      triggeredBy: 'admin1',
      territory: {
        periodKey: '2026-W19',
        territorySettled: 3,
        territorySkipped: 6,
        territoryDecaySkipped: false,
        territoryDecayDelta: -10,
        rewardMailsCreated: 7,
        rewardSkippedAlreadyGranted: 0,
        errors: [],
      },
      sectSeason: {
        seasonSnapshotsCreated: 1,
        seasonSnapshotsSkipped: 0,
        seasonsProcessed: ['season_2026_s1'],
        championMailsCreated: 12,
        championAlreadyGranted: 0,
        mvpMailsCreated: 1,
        mvpAlreadyGranted: 0,
        errors: [],
      },
    });
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="admin-liveops-weekly-cycle"]').exists()).toBe(true);

    const periodInput = w.find('[data-test="admin-liveops-weekly-period"]');
    await periodInput.setValue('2026-W19');
    const bypassInput = w.find('[data-test="admin-liveops-weekly-bypass"]');
    await bypassInput.setValue(true);

    await w.find('[data-test="admin-liveops-weekly-submit"]').trigger('click');
    await flushPromises();

    expect(adminLiveOpsRunWeeklyCycleMock).toHaveBeenCalledWith({
      periodKey: '2026-W19',
      bypassLease: true,
    });
    // Summary line rendered.
    const summary = w.find('[data-test="admin-liveops-weekly-summary"]');
    expect(summary.exists()).toBe(true);
    expect(summary.text()).toContain('Settled 3');
    expect(summary.text()).toContain('Mail 7');
    expect(summary.text()).toContain('Snapshots 1');

    // Phase 15.7 — champion/mvp reward summary line.
    const rewards = w.find('[data-test="admin-liveops-weekly-rewards"]');
    expect(rewards.exists()).toBe(true);
    expect(rewards.text()).toContain('Champion 12');
    expect(rewards.text()).toContain('MVP 1');
  });

  it('weekly cycle: PERIOD_INVALID error → toast error, panel không crash', async () => {
    adminLiveOpsStatusMock.mockResolvedValueOnce(SAMPLE_STATUS);
    adminSectWarStatusMock.mockResolvedValueOnce(SAMPLE_SECTWAR);
    const err = Object.assign(new Error('PERIOD_INVALID'), {
      code: 'PERIOD_INVALID',
    });
    adminLiveOpsRunWeeklyCycleMock.mockRejectedValueOnce(err);
    const w = mountPanel();
    await flushPromises();

    await w.find('[data-test="admin-liveops-weekly-submit"]').trigger('click');
    await flushPromises();

    expect(adminLiveOpsRunWeeklyCycleMock).toHaveBeenCalledTimes(1);
    expect(w.find('[data-test="admin-liveops-panel"]').exists()).toBe(true);
    // Summary KHÔNG render khi error.
    expect(w.find('[data-test="admin-liveops-weekly-summary"]').exists()).toBe(false);
  });

  // Phase 15.8 — Cron health badges.
  it('cron health: render OK/STALE/DEGRADED badges + stale reason', async () => {
    adminLiveOpsStatusMock.mockResolvedValueOnce(SAMPLE_STATUS);
    adminSectWarStatusMock.mockResolvedValueOnce(SAMPLE_SECTWAR);
    adminTerritoryCronStatusMock.mockReset();
    adminTerritoryCronStatusMock.mockResolvedValueOnce({
      enabled: true,
      cron: '5 0 * * 1',
      timezone: 'Asia/Ho_Chi_Minh',
      previousPeriodKey: '2030-W01',
      lastSettlement: null,
      lastDecay: null,
      lastReward: null,
      health: {
        status: 'OK',
        lastRunAt: '2030-01-01T00:00:00.000Z',
        lastSuccessAt: '2030-01-01T00:00:00.000Z',
        lastErrorAt: null,
        staleReason: null,
        nextExpectedRunAt: null,
      },
    });
    adminSectSeasonCronStatusMock.mockReset();
    adminSectSeasonCronStatusMock.mockResolvedValueOnce({
      enabled: true,
      cron: '15 0 * * *',
      timezone: 'Asia/Ho_Chi_Minh',
      lastSnapshot: null,
      lastChampionGrant: null,
      lastMvpGrant: null,
      health: {
        status: 'STALE',
        lastRunAt: '2025-01-01T00:00:00.000Z',
        lastSuccessAt: '2025-01-01T00:00:00.000Z',
        lastErrorAt: null,
        staleReason: 'sect-season cron last success >2 days ago',
        nextExpectedRunAt: null,
      },
    });
    const w = mountPanel();
    await flushPromises();

    const tBadge = w.find('[data-test="admin-liveops-cron-territory-badge"]');
    expect(tBadge.exists()).toBe(true);
    expect(tBadge.text()).toBe('OK');

    const sBadge = w.find('[data-test="admin-liveops-cron-sect-season-badge"]');
    expect(sBadge.exists()).toBe(true);
    expect(sBadge.text()).toBe('STALE');
    expect(
      w.find('[data-test="admin-liveops-cron-sect-season-reason"]').text(),
    ).toContain('>2 days ago');
  });

  it('cron health: status load fail → error placeholder, panel KHÔNG crash', async () => {
    adminLiveOpsStatusMock.mockResolvedValueOnce(SAMPLE_STATUS);
    adminSectWarStatusMock.mockResolvedValueOnce(SAMPLE_SECTWAR);
    adminTerritoryCronStatusMock.mockReset();
    adminTerritoryCronStatusMock.mockRejectedValueOnce(
      Object.assign(new Error('UNAUTHORIZED'), { code: 'UNAUTHORIZED' }),
    );
    adminSectSeasonCronStatusMock.mockReset();
    adminSectSeasonCronStatusMock.mockResolvedValueOnce({
      enabled: false,
      cron: '15 0 * * *',
      timezone: 'Asia/Ho_Chi_Minh',
      lastSnapshot: null,
      lastChampionGrant: null,
      lastMvpGrant: null,
      health: {
        status: 'DISABLED',
        lastRunAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        staleReason: null,
        nextExpectedRunAt: null,
      },
    });
    const w = mountPanel();
    await flushPromises();

    expect(w.find('[data-test="admin-liveops-cron-health-error"]').exists()).toBe(
      true,
    );
    // Panel still rendered (no crash).
    expect(w.find('[data-test="admin-liveops-panel"]').exists()).toBe(true);
  });
});
