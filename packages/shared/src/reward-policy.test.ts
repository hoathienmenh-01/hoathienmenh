import { describe, expect, it } from 'vitest';
import {
  ENDGAME_ITEM_KEY_PREFIXES,
  MAX_ADMIN_GRANT_LINH_THACH,
  MAX_ADMIN_GRANT_TIEN_NGOC,
  MAX_BROADCAST_LINH_THACH,
  MAX_BROADCAST_TIEN_NGOC,
  MAX_MAIL_LINH_THACH,
  MAX_MAIL_TIEN_NGOC,
  MIN_REASON_LENGTH,
  MAX_REASON_LENGTH,
  getRewardLimits,
  isEndgameItemKey,
  validateAdminGrant,
  validateReason,
  validateRewardShape,
} from './reward-policy';

describe('reward-policy — invariants', () => {
  it('caps là số dương / BigInt dương', () => {
    expect(MAX_ADMIN_GRANT_LINH_THACH > 0n).toBe(true);
    expect(MAX_ADMIN_GRANT_TIEN_NGOC).toBeGreaterThan(0);
    expect(MAX_BROADCAST_LINH_THACH > 0n).toBe(true);
    expect(MAX_BROADCAST_TIEN_NGOC).toBeGreaterThan(0);
    expect(MAX_MAIL_LINH_THACH > 0n).toBe(true);
    expect(MAX_MAIL_TIEN_NGOC).toBeGreaterThan(0);
  });

  it('broadcast cap < admin grant cap (anti-mass-mint)', () => {
    expect(MAX_BROADCAST_LINH_THACH).toBeLessThan(MAX_ADMIN_GRANT_LINH_THACH);
    expect(MAX_BROADCAST_TIEN_NGOC).toBeLessThan(MAX_ADMIN_GRANT_TIEN_NGOC);
  });

  it('reason length policy hợp lý', () => {
    expect(MIN_REASON_LENGTH).toBeGreaterThanOrEqual(1);
    expect(MAX_REASON_LENGTH).toBeGreaterThan(MIN_REASON_LENGTH);
  });
});

describe('isEndgameItemKey', () => {
  it.each(ENDGAME_ITEM_KEY_PREFIXES)(
    'flag prefix %s',
    (prefix) => {
      expect(isEndgameItemKey(`${prefix}example_item`)).toBe(true);
    },
  );

  it('không flag item thường', () => {
    expect(isEndgameItemKey('huyet_chi_dan')).toBe(false);
    expect(isEndgameItemKey('linh_can_dan')).toBe(false);
    expect(isEndgameItemKey('tinh_thiet')).toBe(false);
  });

  it('không flag empty / null-ish input', () => {
    expect(isEndgameItemKey('')).toBe(false);
  });
});

describe('validateRewardShape — happy paths', () => {
  it('clean reward → no violations', () => {
    const v = validateRewardShape(
      { linhThach: 1000n, tienNgoc: 50, exp: 200n, items: [{ itemKey: 'huyet_chi_dan', qty: 3 }] },
      'MAIL',
    );
    expect(v).toEqual([]);
  });

  it('admin grant với linhThach=cap → no violation', () => {
    const v = validateRewardShape(
      { linhThach: MAX_ADMIN_GRANT_LINH_THACH },
      'ADMIN_GRANT',
    );
    expect(v).toEqual([]);
  });
});

describe('validateRewardShape — currency caps', () => {
  it('flag linhThach > cap', () => {
    const v = validateRewardShape(
      { linhThach: MAX_BROADCAST_LINH_THACH + 1n },
      'BROADCAST',
    );
    expect(v.some((x) => x.code === 'LINH_THACH_OVER_CAP')).toBe(true);
  });

  it('flag linhThach âm', () => {
    const v = validateRewardShape({ linhThach: -1n }, 'MAIL');
    expect(v.some((x) => x.code === 'LINH_THACH_NEGATIVE')).toBe(true);
  });

  it('flag tienNgoc > cap', () => {
    const v = validateRewardShape(
      { tienNgoc: MAX_BROADCAST_TIEN_NGOC + 1 },
      'BROADCAST',
    );
    expect(v.some((x) => x.code === 'TIEN_NGOC_OVER_CAP')).toBe(true);
  });

  it('flag tienNgocKhoa âm + over cap', () => {
    const v1 = validateRewardShape({ tienNgocKhoa: -10 }, 'MAIL');
    expect(v1.some((x) => x.code === 'TIEN_NGOC_NEGATIVE')).toBe(true);
    const v2 = validateRewardShape(
      { tienNgocKhoa: MAX_MAIL_TIEN_NGOC + 1 },
      'MAIL',
    );
    expect(v2.some((x) => x.code === 'TIEN_NGOC_OVER_CAP')).toBe(true);
  });

  it('flag exp âm và over cap', () => {
    const negV = validateRewardShape({ exp: -1n }, 'MAIL');
    expect(negV.some((x) => x.code === 'EXP_NEGATIVE')).toBe(true);
    const overV = validateRewardShape({ exp: 10n ** 30n }, 'ADMIN_GRANT_EXP');
    expect(overV.some((x) => x.code === 'EXP_OVER_CAP')).toBe(true);
  });
});

describe('validateRewardShape — item rules', () => {
  it('flag item rows over cap', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      itemKey: `it_${i}`,
      qty: 1,
    }));
    const v = validateRewardShape({ items }, 'MAIL');
    expect(v.some((x) => x.code === 'ITEM_ROWS_OVER_CAP')).toBe(true);
  });

  it('flag item qty <= 0', () => {
    const v = validateRewardShape(
      { items: [{ itemKey: 'huyet_chi_dan', qty: 0 }] },
      'MAIL',
    );
    expect(v.some((x) => x.code === 'ITEM_QTY_NEGATIVE_OR_ZERO')).toBe(true);
  });

  it('flag item qty > cap', () => {
    const v = validateRewardShape(
      { items: [{ itemKey: 'huyet_chi_dan', qty: 100_000 }] },
      'MAIL',
    );
    expect(v.some((x) => x.code === 'ITEM_QTY_OVER_CAP')).toBe(true);
  });

  it('flag endgame item by default', () => {
    const v = validateRewardShape(
      { items: [{ itemKey: 'mythic_blade_of_dao', qty: 1 }] },
      'BROADCAST',
    );
    expect(v.some((x) => x.code === 'ENDGAME_ITEM_NOT_ALLOWED')).toBe(true);
  });

  it('không flag endgame item khi allowEndgameItems=true', () => {
    const v = validateRewardShape(
      { items: [{ itemKey: 'mythic_blade_of_dao', qty: 1 }] },
      'BROADCAST',
      { allowEndgameItems: true },
    );
    expect(v.some((x) => x.code === 'ENDGAME_ITEM_NOT_ALLOWED')).toBe(false);
  });
});

describe('validateReason', () => {
  it('null / undefined / empty trimmed → REASON_EMPTY', () => {
    expect(validateReason(null).some((v) => v.code === 'REASON_EMPTY')).toBe(true);
    expect(validateReason(undefined).some((v) => v.code === 'REASON_EMPTY')).toBe(true);
    expect(validateReason('').some((v) => v.code === 'REASON_EMPTY')).toBe(true);
    expect(validateReason('   ').some((v) => v.code === 'REASON_EMPTY')).toBe(true);
  });

  it('quá ngắn → REASON_TOO_SHORT', () => {
    expect(validateReason('ab').some((v) => v.code === 'REASON_TOO_SHORT')).toBe(true);
  });

  it('hợp lệ → no violations', () => {
    expect(validateReason('Hoàn tiền cho user X bug Phase 32')).toEqual([]);
  });

  it('quá dài → REASON_TOO_LONG', () => {
    expect(
      validateReason('x'.repeat(MAX_REASON_LENGTH + 1)).some(
        (v) => v.code === 'REASON_TOO_LONG',
      ),
    ).toBe(true);
  });
});

describe('validateAdminGrant — combined', () => {
  it('clean grant happy path', () => {
    expect(
      validateAdminGrant({ linhThach: 100n }, 'Hoàn tiền bug ledger Phase 32'),
    ).toEqual([]);
  });

  it('flag empty reason', () => {
    const v = validateAdminGrant({ linhThach: 100n }, '');
    expect(v.some((x) => x.code === 'REASON_EMPTY')).toBe(true);
  });

  it('flag over-cap + empty reason cùng lúc', () => {
    const v = validateAdminGrant(
      { linhThach: MAX_ADMIN_GRANT_LINH_THACH + 1n },
      '',
    );
    expect(v.some((x) => x.code === 'LINH_THACH_OVER_CAP')).toBe(true);
    expect(v.some((x) => x.code === 'REASON_EMPTY')).toBe(true);
  });
});

describe('getRewardLimits', () => {
  it('ADMIN_GRANT > BROADCAST > MAIL caps linh thạch monotonic', () => {
    expect(getRewardLimits('ADMIN_GRANT').linhThach).toBeGreaterThanOrEqual(
      getRewardLimits('BROADCAST').linhThach,
    );
    expect(getRewardLimits('MAIL').linhThach).toBeGreaterThanOrEqual(
      getRewardLimits('BROADCAST').linhThach,
    );
  });
});
