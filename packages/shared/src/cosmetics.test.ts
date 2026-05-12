import { describe, expect, it } from 'vitest';
import {
  COSMETIC_RARITIES,
  COSMETIC_TYPES,
  COSMETICS_CATALOG,
  EMPTY_COSMETIC_LOADOUT,
  FORBIDDEN_COSMETIC_TYPES,
  buildCosmeticView,
  canEquipCosmetic,
  getActiveCosmetics,
  getCosmeticById,
  getCosmeticsBySource,
  getCosmeticsByType,
  isCosmeticOwnershipExpired,
  loadoutFieldForType,
  validateCosmeticDefinition,
  type CosmeticRarity,
} from './cosmetics';
import { ELEMENTS } from './combat';

describe('cosmetics catalog — Phase 25.3', () => {
  it('cosmeticId is unique across the catalog', () => {
    const ids = COSMETICS_CATALOG.map((c) => c.cosmeticId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('catalog ships at least 20 entries (target 20–25)', () => {
    expect(COSMETICS_CATALOG.length).toBeGreaterThanOrEqual(20);
    expect(COSMETICS_CATALOG.length).toBeLessThanOrEqual(40);
  });

  it('catalog never contains forbidden weapon/pháp bảo skin types', () => {
    for (const def of COSMETICS_CATALOG) {
      expect(FORBIDDEN_COSMETIC_TYPES).not.toContain(def.type);
      expect(COSMETIC_TYPES).toContain(def.type);
    }
  });

  it('every cosmetic has non-empty cssClass + previewClass', () => {
    for (const def of COSMETICS_CATALOG) {
      expect(def.cssClass.trim().length).toBeGreaterThan(0);
      expect(def.previewClass.trim().length).toBeGreaterThan(0);
    }
  });

  it('every cosmetic def passes validateCosmeticDefinition', () => {
    for (const def of COSMETICS_CATALOG) {
      const result = validateCosmeticDefinition(def);
      expect(result.ok, `validate ${def.cosmeticId}: ${result.errors.join(',')}`).toBe(true);
    }
  });

  it('catalog covers all 5 Ngũ Hành element auras', () => {
    const elementAuras = COSMETICS_CATALOG.filter((c) => c.type === 'ELEMENT_AURA');
    const affinities = new Set(elementAuras.map((c) => c.elementAffinity));
    for (const el of ELEMENTS) {
      expect(affinities.has(el)).toBe(true);
    }
    expect(elementAuras.length).toBeGreaterThanOrEqual(5);
  });

  it('every CosmeticType has at least one catalog entry', () => {
    for (const t of COSMETIC_TYPES) {
      const some = COSMETICS_CATALOG.some((c) => c.type === t);
      expect(some, `expected at least one cosmetic of type ${t}`).toBe(true);
    }
  });

  it('every CosmeticRarity tier has at least one catalog entry', () => {
    const byRarity: Record<CosmeticRarity, number> = {
      COMMON: 0,
      RARE: 0,
      EPIC: 0,
      LEGENDARY: 0,
      MYTHIC: 0,
    };
    for (const def of COSMETICS_CATALOG) {
      byRarity[def.rarity]++;
    }
    for (const r of COSMETIC_RARITIES) {
      expect(byRarity[r], `expected at least one ${r} cosmetic`).toBeGreaterThanOrEqual(1);
    }
  });

  it('cosmetic def shape never carries stat/power/realm fields', () => {
    const forbidden = [
      'power',
      'spirit',
      'speed',
      'luck',
      'hp',
      'hpMax',
      'mp',
      'mpMax',
      'damage',
      'combat',
      'powerScore',
      'powerBudget',
      'requiredRealmOrder',
    ];
    for (const def of COSMETICS_CATALOG) {
      for (const f of forbidden) {
        expect(
          Object.prototype.hasOwnProperty.call(def, f),
          `${def.cosmeticId} unexpectedly carries forbidden field ${f}`,
        ).toBe(false);
      }
    }
  });

  it('Battle Pass / Monthly Card cosmetic reward keys (Phase 25.1) resolve to catalog entries', () => {
    const requiredIds = [
      'title_tien_lo_lenh_so_khoi',
      'aura_tien_lo_moc_nien',
      'frame_tien_lo_lenh',
      'aura_nguyet_tap_vien_man',
      'title_vip_light_1',
      'title_vip_light_2',
      'title_vip_light_3',
      'title_vip_light_4',
      'title_vip_light_5',
      'frame_vip_light_4',
      'frame_vip_light_5',
    ];
    for (const id of requiredIds) {
      expect(getCosmeticById(id), `expected catalog entry for ${id}`).not.toBeNull();
    }
  });

  it('getActiveCosmetics returns only active entries', () => {
    const active = getActiveCosmetics();
    for (const def of active) {
      expect(def.active).toBe(true);
    }
    expect(active.length).toBeGreaterThan(0);
  });

  it('getCosmeticsByType / getCosmeticsBySource filter correctly', () => {
    const titles = getCosmeticsByType('TITLE');
    expect(titles.every((c) => c.type === 'TITLE')).toBe(true);
    expect(titles.length).toBeGreaterThanOrEqual(5);

    const battlePass = getCosmeticsBySource('BATTLE_PASS');
    expect(battlePass.every((c) => c.source === 'BATTLE_PASS')).toBe(true);
  });
});

describe('cosmetics validation', () => {
  it('rejects forbidden WEAPON_SKIN / PHAP_BAO_SKIN type', () => {
    const r1 = validateCosmeticDefinition({
      cosmeticId: 'bad_weapon',
      type: 'WEAPON_SKIN',
      nameVi: 'X',
      nameEn: 'X',
      descriptionVi: 'X',
      descriptionEn: 'X',
      rarity: 'COMMON',
      source: 'EVENT',
      cssClass: 'x',
      previewClass: 'x',
      active: true,
    });
    expect(r1.ok).toBe(false);
    expect(r1.errors).toContain('FORBIDDEN_COSMETIC_TYPE');

    const r2 = validateCosmeticDefinition({
      cosmeticId: 'bad_phap_bao',
      type: 'PHAP_BAO_SKIN',
      nameVi: 'X',
      nameEn: 'X',
      descriptionVi: 'X',
      descriptionEn: 'X',
      rarity: 'COMMON',
      source: 'EVENT',
      cssClass: 'x',
      previewClass: 'x',
      active: true,
    });
    expect(r2.ok).toBe(false);
    expect(r2.errors).toContain('FORBIDDEN_COSMETIC_TYPE');
  });

  it('rejects cosmetic carrying stat/power field', () => {
    const r = validateCosmeticDefinition({
      cosmeticId: 'sneaky_power',
      type: 'TITLE',
      nameVi: 'X',
      nameEn: 'X',
      descriptionVi: 'X',
      descriptionEn: 'X',
      rarity: 'COMMON',
      source: 'EVENT',
      cssClass: 'x',
      previewClass: 'x',
      active: true,
      // @ts-expect-error intentional bad field
      power: 100,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('FORBIDDEN_STAT_FIELD'))).toBe(true);
  });

  it('rejects cosmetic carrying requiredRealmOrder bypass field', () => {
    const r = validateCosmeticDefinition({
      cosmeticId: 'sneaky_realm',
      type: 'TITLE',
      nameVi: 'X',
      nameEn: 'X',
      descriptionVi: 'X',
      descriptionEn: 'X',
      rarity: 'COMMON',
      source: 'EVENT',
      cssClass: 'x',
      previewClass: 'x',
      active: true,
      // @ts-expect-error intentional bad field
      requiredRealmOrder: 5,
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('FORBIDDEN_STAT_FIELD:requiredRealmOrder');
  });

  it('rejects empty cssClass', () => {
    const r = validateCosmeticDefinition({
      cosmeticId: 'empty_css',
      type: 'TITLE',
      nameVi: 'X',
      nameEn: 'X',
      descriptionVi: 'X',
      descriptionEn: 'X',
      rarity: 'COMMON',
      source: 'EVENT',
      cssClass: '',
      previewClass: 'x',
      active: true,
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('INVALID_CSS_CLASS');
  });

  it('rejects unknown elementAffinity', () => {
    const r = validateCosmeticDefinition({
      cosmeticId: 'bad_element',
      type: 'ELEMENT_AURA',
      nameVi: 'X',
      nameEn: 'X',
      descriptionVi: 'X',
      descriptionEn: 'X',
      rarity: 'COMMON',
      source: 'EVENT',
      cssClass: 'x',
      previewClass: 'x',
      active: true,
      elementAffinity: 'gold' as never,
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('INVALID_ELEMENT_AFFINITY');
  });

  it('rejects non-integer durationDays', () => {
    const r = validateCosmeticDefinition({
      cosmeticId: 'bad_duration',
      type: 'TITLE',
      nameVi: 'X',
      nameEn: 'X',
      descriptionVi: 'X',
      descriptionEn: 'X',
      rarity: 'COMMON',
      source: 'EVENT',
      cssClass: 'x',
      previewClass: 'x',
      active: true,
      durationDays: 1.5,
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('INVALID_DURATION_DAYS');
  });
});

describe('cosmetics ownership/loadout helpers', () => {
  it('loadoutFieldForType returns the correct loadout field', () => {
    expect(loadoutFieldForType('AURA')).toBe('activeAuraId');
    expect(loadoutFieldForType('TITLE')).toBe('activeTitleId');
    expect(loadoutFieldForType('AVATAR_FRAME')).toBe('activeAvatarFrameId');
    expect(loadoutFieldForType('CHAT_BADGE')).toBe('activeChatBadgeId');
    expect(loadoutFieldForType('PROFILE_DECORATION')).toBe('activeProfileDecorationId');
    expect(loadoutFieldForType('ELEMENT_AURA')).toBe('activeElementAuraId');
  });

  it('EMPTY_COSMETIC_LOADOUT has all six slots null', () => {
    expect(EMPTY_COSMETIC_LOADOUT.activeAuraId).toBeNull();
    expect(EMPTY_COSMETIC_LOADOUT.activeTitleId).toBeNull();
    expect(EMPTY_COSMETIC_LOADOUT.activeAvatarFrameId).toBeNull();
    expect(EMPTY_COSMETIC_LOADOUT.activeChatBadgeId).toBeNull();
    expect(EMPTY_COSMETIC_LOADOUT.activeProfileDecorationId).toBeNull();
    expect(EMPTY_COSMETIC_LOADOUT.activeElementAuraId).toBeNull();
  });

  it('isCosmeticOwnershipExpired returns false for permanent ownership', () => {
    const own = { cosmeticId: 'x', expiresAt: null };
    expect(isCosmeticOwnershipExpired(own)).toBe(false);
  });

  it('isCosmeticOwnershipExpired returns true when expiresAt in past', () => {
    const past = new Date('2020-01-01T00:00:00.000Z');
    const now = new Date('2024-01-01T00:00:00.000Z');
    const own = { cosmeticId: 'x', expiresAt: past };
    expect(isCosmeticOwnershipExpired(own, now)).toBe(true);
  });

  it('isCosmeticOwnershipExpired returns false when expiresAt in future', () => {
    const future = new Date('2030-01-01T00:00:00.000Z');
    const now = new Date('2024-01-01T00:00:00.000Z');
    const own = { cosmeticId: 'x', expiresAt: future };
    expect(isCosmeticOwnershipExpired(own, now)).toBe(false);
  });

  it('canEquipCosmetic returns NOT_OWNED when ownership is null', () => {
    const def = getCosmeticById('title_so_hoc_de_tu')!;
    const result = canEquipCosmetic(def, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('NOT_OWNED');
  });

  it('canEquipCosmetic returns OWNERSHIP_EXPIRED when ownership expired', () => {
    const def = getCosmeticById('chat_badge_event_xuan_to')!;
    const past = new Date('2020-01-01T00:00:00.000Z');
    const now = new Date('2024-01-01T00:00:00.000Z');
    const result = canEquipCosmetic(
      def,
      { cosmeticId: def.cosmeticId, expiresAt: past },
      now,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('OWNERSHIP_EXPIRED');
  });

  it('canEquipCosmetic succeeds for owned non-expired def', () => {
    const def = getCosmeticById('title_so_hoc_de_tu')!;
    const result = canEquipCosmetic(def, { cosmeticId: def.cosmeticId });
    expect(result.ok).toBe(true);
  });

  it('canEquipCosmetic returns COSMETIC_INACTIVE when def inactive', () => {
    const inactiveDef = {
      ...getCosmeticById('title_so_hoc_de_tu')!,
      active: false,
    };
    const result = canEquipCosmetic(
      inactiveDef,
      { cosmeticId: inactiveDef.cosmeticId },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('COSMETIC_INACTIVE');
  });

  it('buildCosmeticView marks owned + equipped flags', () => {
    const def = getCosmeticById('title_so_hoc_de_tu')!;
    const view = buildCosmeticView(
      def,
      { cosmeticId: def.cosmeticId },
      new Set([def.cosmeticId]),
    );
    expect(view.owned).toBe(true);
    expect(view.equipped).toBe(true);
    expect(view.cosmeticId).toBe(def.cosmeticId);
  });

  it('buildCosmeticView for unowned shows owned=false', () => {
    const def = getCosmeticById('title_so_hoc_de_tu')!;
    const view = buildCosmeticView(def, null, new Set());
    expect(view.owned).toBe(false);
    expect(view.equipped).toBe(false);
  });
});
