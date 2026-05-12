/**
 * Phase 23.5 — Tests cho `apps/web/src/components/PhapBaoPanel.vue`.
 *
 * Lock-in:
 *   - Loading state khi listPhapBao đang pending
 *   - Empty state khi items=[]
 *   - Render owned + locked catalog
 *   - Realm lock hint khi canEquip=false
 *   - Detail modal mở khi click "Chi tiết", refresh-key trigger reload
 *   - Star-up + awaken buttons disabled (foundation)
 *   - i18n vi/en parity (smoke test bằng cách render en)
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';

import PhapBaoPanel from '@/components/PhapBaoPanel.vue';
import viMessages from '@/i18n/vi.json';
import enMessages from '@/i18n/en.json';
import {
  listPhapBao,
  previewPhapBao,
  type PhapBaoDefView,
  type PhapBaoPreview,
  type PhapBaoView,
} from '@/api/phapBao';

vi.mock('@/api/phapBao', () => ({
  listPhapBao: vi.fn(),
  previewPhapBao: vi.fn(),
}));

const mockedList = vi.mocked(listPhapBao);
const mockedPreview = vi.mocked(previewPhapBao);

function makeI18n(locale: 'vi' | 'en' = 'vi') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'vi',
    messages: { vi: viMessages, en: enMessages },
  });
}

function mountPanel(locale: 'vi' | 'en' = 'vi') {
  return mount(PhapBaoPanel, {
    global: { plugins: [makeI18n(locale)] },
  });
}

const sampleDef: PhapBaoDefView = {
  artifactKey: 'ngu_hanh_linh_chau',
  itemKey: 'ngu_hanh_linh_chau',
  nameVi: 'Ngũ Hành Linh Châu',
  nameEn: 'Five Elements Spirit Bead',
  descriptionVi: 'Hỗ trợ tăng kháng + element bonus.',
  descriptionEn: 'Support: elemental resist & bonus.',
  artifactTier: 2,
  requiredRealmOrder: 4,
  quality: 'LINH',
  elementAffinity: 'NEUTRAL',
  role: 'support',
  activeSkill: {
    skillKey: 'ngu_hanh_aura',
    nameVi: 'Ngũ Hành Quang',
    nameEn: 'Five Elements Aura',
    descriptionVi: 'Buff toàn đội.',
    descriptionEn: 'Buff entire team.',
    unlockStar: 3,
    baseCooldownSec: 60,
    cooldownFloorSec: 30,
    baseEffect: { atk: 10 },
  },
  starCap: 5,
  refineCap: 10,
  awakenCap: 0,
  source: 'quest',
  powerBudget: 120,
};

const sampleOwned: PhapBaoView = {
  inventoryItemId: 'inv-1',
  def: sampleDef,
  equippedSlot: null,
  refineLevel: 2,
  starLevel: 0,
  awakenStage: 0,
  canEquip: true,
  requiredRealmOrder: 4,
  powerScore: 145,
};

const sampleLockedOwned: PhapBaoView = {
  ...sampleOwned,
  inventoryItemId: 'inv-2',
  canEquip: false,
};

const lockedCatalog: PhapBaoDefView = {
  ...sampleDef,
  artifactKey: 'thanh_lien_kiem_an',
  itemKey: 'thanh_lien_kiem_an',
  nameVi: 'Thanh Liên Kiếm Ấn',
  nameEn: 'Azure Lotus Sword Seal',
  artifactTier: 3,
  requiredRealmOrder: 7,
  quality: 'HUYEN',
  elementAffinity: 'kim',
  role: 'burst',
  source: 'boss',
  activeSkill: null,
  awakenCap: 0,
};

const samplePreview: PhapBaoPreview = {
  inventoryItemId: 'inv-1',
  def: sampleDef,
  equippedSlot: null,
  refineLevel: 2,
  starLevel: 0,
  awakenStage: 0,
  canEquip: true,
  realmOrder: 4,
  requiredRealmOrder: 4,
  passiveBonus: { atk: 25, def: 18, hpMax: 60 },
  activeSkill: {
    available: true,
    unlocked: false,
    skillKey: 'ngu_hanh_aura',
    nameVi: 'Ngũ Hành Quang',
    nameEn: 'Five Elements Aura',
    cooldownSec: 60,
    effect: { atk: 10 },
    unlockStar: 3,
  },
  powerScore: 145,
  refineCost: {
    linhThachCost: 750,
    materialKey: 'kim_thach',
    materialQty: 6,
    shardKey: null,
    shardQty: null,
    awakenStoneKey: null,
    awakenStoneQty: null,
  },
  starCost: {
    linhThachCost: 1200,
    materialKey: 'ngu_hanh_linh_chau_shard',
    materialQty: 10,
    shardKey: null,
    shardQty: null,
    awakenStoneKey: null,
    awakenStoneQty: null,
  },
  awakenCost: null,
  starUpEnabled: false,
  awakenEnabled: false,
};

beforeEach(() => {
  mockedList.mockReset();
  mockedPreview.mockReset();
});

describe('PhapBaoPanel', () => {
  it('loading state khi list pending', async () => {
    mockedList.mockReturnValue(new Promise(() => {}));
    const w = mountPanel();
    await nextTick();
    expect(w.find('[data-testid="phap-bao-loading"]').exists()).toBe(true);
  });

  it('error state khi listPhapBao throw', async () => {
    mockedList.mockRejectedValue(new Error('FAIL'));
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="phap-bao-error"]').exists()).toBe(true);
  });

  it('empty state khi items=[]', async () => {
    mockedList.mockResolvedValue({ items: [], catalog: [] });
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="phap-bao-empty"]').exists()).toBe(true);
  });

  it('render owned + locked catalog', async () => {
    mockedList.mockResolvedValue({
      items: [sampleOwned],
      catalog: [sampleDef, lockedCatalog],
    });
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="phap-bao-content"]').exists()).toBe(true);
    expect(
      w.find('[data-testid="phap-bao-item-ngu_hanh_linh_chau"]').exists(),
    ).toBe(true);
    // Locked catalog hiển thị item chưa sở hữu (thanh_lien_kiem_an).
    expect(
      w.find('[data-testid="phap-bao-locked-thanh_lien_kiem_an"]').exists(),
    ).toBe(true);
    // Không có badge locked cho item đã sở hữu.
    expect(
      w.find('[data-testid="phap-bao-locked-ngu_hanh_linh_chau"]').exists(),
    ).toBe(false);
  });

  it('realm lock hint khi canEquip=false', async () => {
    mockedList.mockResolvedValue({
      items: [sampleLockedOwned],
      catalog: [sampleDef],
    });
    const w = mountPanel();
    await flushPromises();
    const realmText = w
      .find('[data-testid="phap-bao-realm-ngu_hanh_linh_chau"]')
      .text();
    expect(realmText).toContain('Cần đạt cảnh giới yêu cầu để sử dụng');
  });

  it('tooltip hiển thị phẩm cấp và powerScore', async () => {
    mockedList.mockResolvedValue({
      items: [sampleOwned],
      catalog: [sampleDef],
    });
    const w = mountPanel();
    await flushPromises();

    const text = w.find('[data-testid="phap-bao-item-ngu_hanh_linh_chau"]').text();
    expect(text).toContain('Phẩm cấp');
    expect(text).toContain('Linh');
    expect(text).toContain('Lực pháp bảo 145');
    expect(text).toContain('Phẩm cấp tăng sức mạnh trong cùng tầng trang bị.');
  });

  it('open detail modal khi click "Chi tiết" + render preview content', async () => {
    mockedList.mockResolvedValue({
      items: [sampleOwned],
      catalog: [sampleDef],
    });
    mockedPreview.mockResolvedValue(samplePreview);
    const w = mountPanel();
    await flushPromises();

    await w
      .find('[data-testid="phap-bao-detail-ngu_hanh_linh_chau"]')
      .trigger('click');
    await flushPromises();

    expect(
      document.querySelector('[data-testid="phap-bao-detail-modal"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-testid="phap-bao-preview-content"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-testid="phap-bao-refine-cost"]'),
    ).toBeTruthy();
    // Foundation: awaken null → "Sắp ra mắt" hint.
    expect(
      document.querySelector('[data-testid="phap-bao-awaken-upcoming"]'),
    ).toBeTruthy();
    w.unmount();
  });

  it('star-up + awaken buttons disabled (foundation)', async () => {
    mockedList.mockResolvedValue({
      items: [sampleOwned],
      catalog: [sampleDef],
    });
    mockedPreview.mockResolvedValue(samplePreview);
    const w = mountPanel();
    await flushPromises();
    await w
      .find('[data-testid="phap-bao-detail-ngu_hanh_linh_chau"]')
      .trigger('click');
    await flushPromises();
    const starBtn = document.querySelector(
      '[data-testid="phap-bao-star-action"]',
    ) as HTMLButtonElement | null;
    const awakenBtn = document.querySelector(
      '[data-testid="phap-bao-awaken-action"]',
    ) as HTMLButtonElement | null;
    expect(starBtn?.disabled).toBe(true);
    expect(awakenBtn?.disabled).toBe(true);
    w.unmount();
  });

  it('refine action emit "refine" event với inventoryItemId + close modal', async () => {
    mockedList.mockResolvedValue({
      items: [sampleOwned],
      catalog: [sampleDef],
    });
    mockedPreview.mockResolvedValue(samplePreview);
    const w = mountPanel();
    await flushPromises();
    await w
      .find('[data-testid="phap-bao-detail-ngu_hanh_linh_chau"]')
      .trigger('click');
    await flushPromises();
    const btn = document.querySelector(
      '[data-testid="phap-bao-refine-action"]',
    ) as HTMLElement | null;
    btn?.click();
    await flushPromises();
    expect(w.emitted('refine')).toBeTruthy();
    expect(w.emitted('refine')?.[0]).toEqual(['inv-1']);
    w.unmount();
  });

  it('en locale render Artifact title (i18n parity smoke)', async () => {
    mockedList.mockResolvedValue({ items: [], catalog: [] });
    const w = mountPanel('en');
    await flushPromises();
    expect(w.find('[data-testid="phap-bao-panel"]').text()).toContain(
      'Artifact',
    );
  });
});
