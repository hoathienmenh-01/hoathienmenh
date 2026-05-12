/**
 * Phase 23.3 — Tests cho `apps/web/src/components/EquipmentBuildPanel.vue`.
 *
 * Lock-in:
 *   - Loading state khi getEquipmentBuild đang pending
 *   - Empty state khi summary null
 *   - Render mainElement / pieceCount / activeSetCount / resonance tier
 *   - Render active set list với missing slots
 *   - Render resonance list
 *   - Total bonus percent đúng
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';

import EquipmentBuildPanel from '@/components/EquipmentBuildPanel.vue';
import viMessages from '@/i18n/vi.json';
import { getEquipmentBuild, type EquipmentBuildSummaryDto } from '@/api/inventory';

vi.mock('@/api/inventory', () => ({
  getEquipmentBuild: vi.fn(),
}));

const mockedGet = vi.mocked(getEquipmentBuild);

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    messages: { vi: viMessages },
  });
}

function mountPanel() {
  return mount(EquipmentBuildPanel, {
    global: { plugins: [makeI18n()] },
  });
}

const sampleSummary: EquipmentBuildSummaryDto = {
  pieceCount: 6,
  mainElement: 'kim',
  elementDistribution: { kim: 6 },
  activeSets: [
    {
      setKey: 'kim_phong_set',
      pieceCount: 6,
      missingSlots: [],
      totalRatio: { atkRatio: 0.15 },
      activeTiers: [
        { pieces: 2, bonusRatio: { atkRatio: 0.04 }, description: '+4% atk', descriptionVi: '+4% sát thương' },
        { pieces: 4, bonusRatio: { atkRatio: 0.08 }, description: '+8% atk', descriptionVi: '+8% sát thương' },
        { pieces: 6, bonusRatio: { atkRatio: 0.12 }, description: '+12% atk', descriptionVi: '+12% sát thương' },
      ],
      // @ts-expect-error — partial mock cho UI test
      set: {
        setKey: 'kim_phong_set',
        name: 'Kim Phong',
        nameVi: 'Kim Phong',
        elementAffinity: 'kim',
      },
    },
  ],
  activeSetCount: 1,
  resonance: {
    pieceCount: 6,
    dominantElement: 'kim',
    elementDistribution: { kim: 6 },
    totalRatio: { atkRatio: 0.03, defRatio: 0.03 },
    active: [
      {
        kind: 'SAME_TIER',
        key: 'SAME_TIER_4',
        ratio: { atkRatio: 0.006, defRatio: 0.006 },
        description: 'Full tier 4',
        descriptionVi: 'Đủ 6 món tầng 4',
      },
    ],
  },
  totalBonusRatio: { atkRatio: 0.18, defRatio: 0.03 },
  totalPowerScore: 1200,
  resonanceTier: 'BASIC',
};

beforeEach(() => {
  mockedGet.mockReset();
});

describe('EquipmentBuildPanel', () => {
  it('loading state khi pending', async () => {
    mockedGet.mockReturnValue(new Promise(() => {}));
    const w = mountPanel();
    await nextTick();
    expect(w.find('[data-testid="build-loading"]').exists()).toBe(true);
  });

  it('empty state khi summary=null', async () => {
    mockedGet.mockResolvedValue(null);
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="build-empty"]').exists()).toBe(true);
  });

  it('render mainElement + pieceCount + activeSetCount + resonance tier', async () => {
    mockedGet.mockResolvedValue(sampleSummary);
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="build-content"]').exists()).toBe(true);
    expect(w.find('[data-testid="build-main-element"]').text()).toBe('Kim');
    expect(w.find('[data-testid="build-piece-count"]').text()).toBe('6');
    expect(w.find('[data-testid="build-active-set-count"]').text()).toBe('1');
    expect(w.find('[data-testid="build-resonance-tier"]').text()).not.toBe('');
  });

  it('render set list với tier descriptions', async () => {
    mockedGet.mockResolvedValue(sampleSummary);
    const w = mountPanel();
    await flushPromises();
    const setRows = w.findAll('[data-testid="build-set-row"]');
    expect(setRows.length).toBe(1);
    const tiers = w.findAll('[data-testid="build-set-tier"]');
    expect(tiers.length).toBe(3);
  });

  it('render resonance list', async () => {
    mockedGet.mockResolvedValue(sampleSummary);
    const w = mountPanel();
    await flushPromises();
    const rows = w.findAll('[data-testid="build-resonance-row"]');
    expect(rows.length).toBe(1);
  });

  it('totalBonus percent rendered', async () => {
    mockedGet.mockResolvedValue(sampleSummary);
    const w = mountPanel();
    await flushPromises();
    const txt = w.find('[data-testid="build-total-bonus"]').text();
    // 0.18 + 0.03 = 0.21 → 21%
    expect(txt).toContain('21%');
  });

  it('error state khi API throw', async () => {
    mockedGet.mockRejectedValue(new Error('FAIL'));
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="build-error"]').exists()).toBe(true);
  });

  it('empty active sets → show "no set" placeholder', async () => {
    mockedGet.mockResolvedValue({ ...sampleSummary, activeSets: [], activeSetCount: 0 });
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="build-set-empty"]').exists()).toBe(true);
  });

  it('empty resonance → show "no resonance" placeholder', async () => {
    mockedGet.mockResolvedValue({
      ...sampleSummary,
      resonance: { ...sampleSummary.resonance, active: [] },
    });
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="build-resonance-empty"]').exists()).toBe(true);
  });
});
