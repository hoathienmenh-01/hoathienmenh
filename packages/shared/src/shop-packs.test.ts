import { describe, expect, it } from 'vitest';
import {
  SHOP_PACKS,
  canPurchaseShopPack,
  getActiveShopPacks,
  getPurchaseWindowKey,
  getShopPackById,
  validateShopPackDef,
  validateShopPackReward,
} from './shop-packs';

describe('shop-packs shared config', () => {
  it('has unique pack ids', () => {
    const ids = SHOP_PACKS.map((p) => p.packId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all packs pass validation', () => {
    for (const pack of SHOP_PACKS) {
      expect(validateShopPackDef(pack)).toBe(true);
    }
  });

  it('all rewards pass validation', () => {
    for (const pack of SHOP_PACKS) {
      for (const reward of pack.rewards) {
        expect(validateShopPackReward(reward)).toBe(true);
      }
    }
  });

  it('blocks forbidden equipment rewards', () => {
    expect(validateShopPackReward({ kind: 'item', key: 'tien_huyen_kiem', qty: 1 })).toBe(false);
    expect(validateShopPackReward({ kind: 'item', key: 'tien_huyen_giap', qty: 1 })).toBe(false);
  });

  it('blocks forbidden artifact rewards', () => {
    expect(validateShopPackReward({ kind: 'item', key: 'hau_tho_tran_hon_an', qty: 1 })).toBe(false);
  });

  it('blocks zero/negative quantity', () => {
    expect(validateShopPackReward({ kind: 'item', key: 'tinh_thiet', qty: 0 })).toBe(false);
    expect(validateShopPackReward({ kind: 'item', key: 'tinh_thiet', qty: -1 })).toBe(false);
  });

  it('blocks excessive linhThach', () => {
    expect(validateShopPackReward({ kind: 'currency', key: 'linhThach', qty: 100_000 })).toBe(false);
    expect(validateShopPackReward({ kind: 'currency', key: 'linhThach', qty: 10_000 })).toBe(true);
  });

  it('getShopPackById returns correct pack', () => {
    const pack = getShopPackById('daily_cultivation_support');
    expect(pack).toBeDefined();
    expect(pack!.category).toBe('DAILY');
  });

  it('getShopPackById returns undefined for invalid id', () => {
    expect(getShopPackById('nonexistent')).toBeUndefined();
  });

  it('getActiveShopPacks filters inactive packs', () => {
    const all = getActiveShopPacks();
    expect(all.length).toBe(SHOP_PACKS.filter((p) => p.active).length);
  });

  describe('getPurchaseWindowKey', () => {
    const d = new Date('2026-05-12T10:00:00Z');

    it('DAY returns date string', () => {
      expect(getPurchaseWindowKey('DAY', d)).toBe('2026-05-12');
    });

    it('MONTH returns year-month', () => {
      expect(getPurchaseWindowKey('MONTH', d)).toBe('2026-05');
    });

    it('SEASON returns quarter', () => {
      expect(getPurchaseWindowKey('SEASON', d)).toBe('2026-Q2');
    });

    it('LIFETIME returns fixed string', () => {
      expect(getPurchaseWindowKey('LIFETIME', d)).toBe('LIFETIME');
    });

    it('WEEK returns year-week', () => {
      const key = getPurchaseWindowKey('WEEK', d);
      expect(key).toMatch(/^2026-W\d{2}$/);
    });
  });

  describe('canPurchaseShopPack', () => {
    const activePack = SHOP_PACKS[0]!;

    it('allows purchase for valid realm', () => {
      const result = canPurchaseShopPack(activePack, 5);
      expect(result.ok).toBe(true);
    });

    it('blocks inactive pack', () => {
      const inactive = { ...activePack, active: false };
      expect(canPurchaseShopPack(inactive, 5).ok).toBe(false);
      expect(canPurchaseShopPack(inactive, 5).reason).toBe('PACK_INACTIVE');
    });

    it('blocks expired pack', () => {
      const expired = { ...activePack, endsAt: '2020-01-01T00:00:00Z' };
      expect(canPurchaseShopPack(expired, 5).ok).toBe(false);
      expect(canPurchaseShopPack(expired, 5).reason).toBe('PACK_EXPIRED');
    });

    it('blocks pack not started yet', () => {
      const future = { ...activePack, startsAt: '2099-01-01T00:00:00Z' };
      expect(canPurchaseShopPack(future, 5).ok).toBe(false);
      expect(canPurchaseShopPack(future, 5).reason).toBe('PACK_NOT_STARTED');
    });

    it('blocks realm too low', () => {
      const gated = { ...activePack, requiredRealmOrder: 10 };
      expect(canPurchaseShopPack(gated, 5).ok).toBe(false);
      expect(canPurchaseShopPack(gated, 5).reason).toBe('REALM_TOO_LOW');
    });

    it('blocks realm too high', () => {
      const capped = { ...activePack, maxRealmOrder: 2 };
      expect(canPurchaseShopPack(capped, 5).ok).toBe(false);
      expect(canPurchaseShopPack(capped, 5).reason).toBe('REALM_TOO_HIGH');
    });

    it('blocks vip required', () => {
      const vipPack = { ...activePack, vipRequired: 3 };
      expect(canPurchaseShopPack(vipPack, 5, 0).ok).toBe(false);
      expect(canPurchaseShopPack(vipPack, 5, 0).reason).toBe('VIP_REQUIRED');
    });
  });
});
