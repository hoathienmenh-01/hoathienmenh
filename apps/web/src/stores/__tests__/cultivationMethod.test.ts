import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('@/api/cultivationMethod', () => ({
  getCultivationMethodState: vi.fn(),
  equipCultivationMethod: vi.fn(),
}));

import * as api from '@/api/cultivationMethod';
import { useCultivationMethodStore } from '@/stores/cultivationMethod';

const mockedGet = vi.mocked(api.getCultivationMethodState);
const mockedEquip = vi.mocked(api.equipCultivationMethod);

const STUB_LEARNED: api.CultivationMethodLearnedRow = {
  methodKey: 'khai_thien_quyet',
  source: 'starter',
  learnedAt: '2026-01-01T00:00:00.000Z',
};

const STUB_HUYEN: api.CultivationMethodLearnedRow = {
  methodKey: 'cuu_cuc_kim_cuong_quyet',
  source: 'sect_shop',
  learnedAt: '2026-02-01T00:00:00.000Z',
};

describe('useCultivationMethodStore — Phase 11.1.C', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('initial state: equippedMethodKey null, learned empty, not loaded, no inFlight, affinity 0', () => {
    const s = useCultivationMethodStore();
    expect(s.equippedMethodKey).toBeNull();
    expect(s.equippedMethodElementAffinity).toBe(0);
    expect(s.affinityPercentLabel).toBeNull();
    expect(s.affinityTierKey).toBeNull();
    expect(s.learned).toEqual([]);
    expect(s.loaded).toBe(false);
    expect(s.inFlight.size).toBe(0);
  });

  it('fetchState: hydrate equippedMethodKey + learned + loaded=true', async () => {
    mockedGet.mockResolvedValueOnce({
      equippedMethodKey: 'khai_thien_quyet',
      equippedMethodElementAffinity: 0,
      learned: [STUB_LEARNED],
    });
    const s = useCultivationMethodStore();
    await s.fetchState();
    expect(s.equippedMethodKey).toBe('khai_thien_quyet');
    expect(s.learned).toHaveLength(1);
    expect(s.learned[0].methodKey).toBe('khai_thien_quyet');
    expect(s.loaded).toBe(true);
  });

  it('fetchState: equippedMethodElementAffinity 0.10 → affinityPercentLabel "+10%" + tierKey primary', async () => {
    mockedGet.mockResolvedValueOnce({
      equippedMethodKey: 'liet_hoa_phap',
      equippedMethodElementAffinity: 0.1,
      learned: [STUB_LEARNED],
    });
    const s = useCultivationMethodStore();
    await s.fetchState();
    expect(s.equippedMethodElementAffinity).toBe(0.1);
    expect(s.affinityPercentLabel).toBe('+10%');
    expect(s.affinityTierKey).toBe('cultivationMethod.affinity.primary');
  });

  it('fetchState: equippedMethodElementAffinity 0.05 → affinityPercentLabel "+5%" + tierKey secondary', async () => {
    mockedGet.mockResolvedValueOnce({
      equippedMethodKey: 'liet_hoa_phap',
      equippedMethodElementAffinity: 0.05,
      learned: [STUB_LEARNED],
    });
    const s = useCultivationMethodStore();
    await s.fetchState();
    expect(s.equippedMethodElementAffinity).toBe(0.05);
    expect(s.affinityPercentLabel).toBe('+5%');
    expect(s.affinityTierKey).toBe('cultivationMethod.affinity.secondary');
  });

  it('fetchState: equippedMethodElementAffinity 0 (vô hệ / khác hệ) → label & tierKey null', async () => {
    mockedGet.mockResolvedValueOnce({
      equippedMethodKey: 'khai_thien_quyet',
      equippedMethodElementAffinity: 0,
      learned: [STUB_LEARNED],
    });
    const s = useCultivationMethodStore();
    await s.fetchState();
    expect(s.equippedMethodElementAffinity).toBe(0);
    expect(s.affinityPercentLabel).toBeNull();
    expect(s.affinityTierKey).toBeNull();
  });

  it('isEquipped/isEquipping: true cho key đang equip / không cho key khác', async () => {
    mockedGet.mockResolvedValueOnce({
      equippedMethodKey: 'khai_thien_quyet',
      equippedMethodElementAffinity: 0,
      learned: [STUB_LEARNED],
    });
    const s = useCultivationMethodStore();
    await s.fetchState();
    expect(s.isEquipped('khai_thien_quyet')).toBe(true);
    expect(s.isEquipped('cuu_cuc_kim_cuong_quyet')).toBe(false);
    expect(s.isEquipping('khai_thien_quyet')).toBe(false);
  });

  it('equip success: cập nhật equippedMethodKey + learned mới', async () => {
    const s = useCultivationMethodStore();
    s.learned = [STUB_LEARNED, STUB_HUYEN];
    s.equippedMethodKey = 'khai_thien_quyet';
    s.loaded = true;
    mockedEquip.mockResolvedValueOnce({
      equippedMethodKey: 'cuu_cuc_kim_cuong_quyet',
      equippedMethodElementAffinity: 0,
      learned: [STUB_LEARNED, STUB_HUYEN],
    });
    const err = await s.equip('cuu_cuc_kim_cuong_quyet');
    expect(err).toBeNull();
    expect(s.equippedMethodKey).toBe('cuu_cuc_kim_cuong_quyet');
    expect(s.inFlight.has('cuu_cuc_kim_cuong_quyet')).toBe(false);
  });

  it('equip server error code: trả code, không update equipped', async () => {
    const s = useCultivationMethodStore();
    s.learned = [STUB_LEARNED, STUB_HUYEN];
    s.equippedMethodKey = 'khai_thien_quyet';
    s.loaded = true;
    mockedEquip.mockRejectedValueOnce({ code: 'NOT_LEARNED' });
    const err = await s.equip('cuu_cuc_kim_cuong_quyet');
    expect(err).toBe('NOT_LEARNED');
    expect(s.equippedMethodKey).toBe('khai_thien_quyet');
    expect(s.inFlight.has('cuu_cuc_kim_cuong_quyet')).toBe(false);
  });

  it('equip nested error.code: extract đúng (axios envelope shape)', async () => {
    const s = useCultivationMethodStore();
    mockedEquip.mockRejectedValueOnce({
      error: { code: 'REALM_TOO_LOW', message: 'too low' },
    });
    const err = await s.equip('cuu_cuc_kim_cuong_quyet');
    expect(err).toBe('REALM_TOO_LOW');
  });

  it('equip unknown error: trả "UNKNOWN"', async () => {
    const s = useCultivationMethodStore();
    mockedEquip.mockRejectedValueOnce(new Error('boom'));
    const err = await s.equip('cuu_cuc_kim_cuong_quyet');
    expect(err).toBe('UNKNOWN');
  });

  it('equip already equipped key: return ALREADY_EQUIPPED, không gọi API', async () => {
    const s = useCultivationMethodStore();
    s.equippedMethodKey = 'khai_thien_quyet';
    s.loaded = true;
    const err = await s.equip('khai_thien_quyet');
    expect(err).toBe('ALREADY_EQUIPPED');
    expect(mockedEquip).not.toHaveBeenCalled();
  });

  it('equip double-call same key → second returns IN_FLIGHT (race protect)', async () => {
    const s = useCultivationMethodStore();
    s.learned = [STUB_LEARNED, STUB_HUYEN];
    s.equippedMethodKey = 'khai_thien_quyet';
    s.loaded = true;
    let resolveFn!: (v: api.CultivationMethodState) => void;
    mockedEquip.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );
    const p1 = s.equip('cuu_cuc_kim_cuong_quyet');
    const r2 = await s.equip('cuu_cuc_kim_cuong_quyet');
    expect(r2).toBe('IN_FLIGHT');
    resolveFn({
      equippedMethodKey: 'cuu_cuc_kim_cuong_quyet',
      equippedMethodElementAffinity: 0,
      learned: [STUB_LEARNED, STUB_HUYEN],
    });
    await p1;
  });

  it('isEquipping reflect inFlight set during pending equip', async () => {
    const s = useCultivationMethodStore();
    s.learned = [STUB_LEARNED, STUB_HUYEN];
    s.equippedMethodKey = 'khai_thien_quyet';
    s.loaded = true;
    let resolveFn!: (v: api.CultivationMethodState) => void;
    mockedEquip.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );
    const p = s.equip('cuu_cuc_kim_cuong_quyet');
    expect(s.isEquipping('cuu_cuc_kim_cuong_quyet')).toBe(true);
    resolveFn({
      equippedMethodKey: 'cuu_cuc_kim_cuong_quyet',
      equippedMethodElementAffinity: 0,
      learned: [STUB_LEARNED, STUB_HUYEN],
    });
    await p;
    expect(s.isEquipping('cuu_cuc_kim_cuong_quyet')).toBe(false);
  });

  it('reset: trả store về initial state', async () => {
    const s = useCultivationMethodStore();
    s.equippedMethodKey = 'khai_thien_quyet';
    s.learned = [STUB_LEARNED];
    s.loaded = true;
    s.reset();
    expect(s.equippedMethodKey).toBeNull();
    expect(s.learned).toEqual([]);
    expect(s.loaded).toBe(false);
    expect(s.inFlight.size).toBe(0);
  });
});
