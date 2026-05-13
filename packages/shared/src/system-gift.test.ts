import { describe, it, expect } from 'vitest';
import {
  SYSTEM_GIFT_LIMITS,
  validateSystemGiftDef,
  type SystemGiftDef,
} from './system-gift';

const baseDef: SystemGiftDef = {
  giftKey: 'maintenance_2026_05_13',
  title: 'Quà bồi thường bảo trì',
  body: 'Cảm ơn các đạo hữu đã kiên nhẫn chờ đợi.',
  reward: {
    linhThach: '50000',
    tienNgoc: 0,
    exp: '0',
    items: [{ itemKey: 'qi_pill_minor', qty: 5 }],
  },
  targetRule: { type: 'ALL_PLAYERS' },
  expiresAt: null,
  createdByAdminId: null,
};

describe('Phase 31 — system-gift', () => {
  it('accepts valid baseDef', () => {
    expect(validateSystemGiftDef(baseDef)).toBeNull();
  });

  it('rejects invalid giftKey (uppercase or special chars)', () => {
    expect(
      validateSystemGiftDef({ ...baseDef, giftKey: 'BadKey!' }),
    ).toBe('INVALID_GIFT_KEY');
    expect(
      validateSystemGiftDef({ ...baseDef, giftKey: '' }),
    ).toBe('INVALID_GIFT_KEY');
  });

  it('rejects tien ngoc > 0 (anti-P2W)', () => {
    expect(
      validateSystemGiftDef({
        ...baseDef,
        reward: { ...baseDef.reward, tienNgoc: 1 },
      }),
    ).toBe('TIEN_NGOC_CAP');
  });

  it('rejects forbidden endgame item', () => {
    expect(
      validateSystemGiftDef({
        ...baseDef,
        reward: {
          ...baseDef.reward,
          items: [{ itemKey: 'than_dan', qty: 1 }],
        },
      }),
    ).toBe('ITEM_FORBIDDEN');
  });

  it('REALM_RANGE rule must include valid min/max', () => {
    expect(
      validateSystemGiftDef({
        ...baseDef,
        targetRule: {
          type: 'REALM_RANGE',
          realmTierMin: 5,
          realmTierMax: 3,
        },
      }),
    ).toBe('INVALID_REALM_RANGE');
    expect(
      validateSystemGiftDef({
        ...baseDef,
        targetRule: {
          type: 'REALM_RANGE',
          realmTierMin: 3,
          realmTierMax: 9,
        },
      }),
    ).toBeNull();
  });

  it('ACTIVE_IN_LAST_DAYS rule must be in range', () => {
    expect(
      validateSystemGiftDef({
        ...baseDef,
        targetRule: {
          type: 'ACTIVE_IN_LAST_DAYS',
          activeInLastDays: 0,
        },
      }),
    ).toBe('INVALID_DAYS_RANGE');
    expect(
      validateSystemGiftDef({
        ...baseDef,
        targetRule: {
          type: 'ACTIVE_IN_LAST_DAYS',
          activeInLastDays: 7,
        },
      }),
    ).toBeNull();
  });

  it('SECT_MEMBERS and EVENT_PARTICIPANTS require id', () => {
    expect(
      validateSystemGiftDef({
        ...baseDef,
        targetRule: { type: 'SECT_MEMBERS' },
      }),
    ).toBe('INVALID_TARGET_RULE');
    expect(
      validateSystemGiftDef({
        ...baseDef,
        targetRule: { type: 'EVENT_PARTICIPANTS' },
      }),
    ).toBe('INVALID_TARGET_RULE');
  });

  it('caps title/body length', () => {
    expect(
      validateSystemGiftDef({
        ...baseDef,
        title: 'x'.repeat(SYSTEM_GIFT_LIMITS.TITLE_MAX + 1),
      }),
    ).toBe('INVALID_TITLE');
    expect(
      validateSystemGiftDef({
        ...baseDef,
        body: 'x'.repeat(SYSTEM_GIFT_LIMITS.BODY_MAX + 1),
      }),
    ).toBe('INVALID_BODY');
  });
});
