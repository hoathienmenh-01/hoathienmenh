import { describe, expect, it } from 'vitest';
import {
  LIVEOPS_EVENT_KEY_PATTERN,
  LIVEOPS_EVENT_MAX_WINDOW_MS,
  LIVEOPS_EVENT_MIN_WINDOW_MS,
  LIVEOPS_EVENT_RECOMPUTE_CRON,
  LIVEOPS_EVENT_STATUSES,
  LIVEOPS_EVENT_TYPES,
  LIVEOPS_EVENT_TYPE_CAPS,
  clampLiveOpsMultiplier,
  isLiveOpsEventActiveAt,
  isValidLiveOpsScheduledEventStatus,
  isValidLiveOpsScheduledEventType,
  nextLiveOpsScheduledEventStatus,
  pickActiveLiveOpsMultiplier,
  validateLiveOpsScheduledEventInput,
  type LiveOpsRuntimeModifier,
  type LiveOpsScheduledEventInput,
} from './liveops-event-scheduler';

const TYPE = {
  drop: 'DOUBLE_DUNGEON_DROP',
  exp: 'CULTIVATION_EXP_BOOST',
  shop: 'SHOP_DISCOUNT',
  sectShop: 'SECT_SHOP_DISCOUNT',
  daily: 'DAILY_LOGIN_BONUS',
  boss: 'BOSS_REWARD_BOOST',
  festival: 'FESTIVAL_GIFT',
} as const;

function baseInput(
  overrides: Partial<LiveOpsScheduledEventInput> = {},
): LiveOpsScheduledEventInput {
  return {
    key: 'event_test_001',
    type: 'DOUBLE_DUNGEON_DROP',
    title: 'Test Event',
    description: 'desc',
    startsAt: new Date('2026-07-01T00:00:00Z'),
    endsAt: new Date('2026-07-02T00:00:00Z'),
    configJson: { multiplier: 1.5 },
    ...overrides,
  };
}

describe('LiveOps Event Scheduler — catalog', () => {
  it('exports all 7 type values', () => {
    expect(LIVEOPS_EVENT_TYPES).toHaveLength(7);
    expect(new Set(LIVEOPS_EVENT_TYPES)).toEqual(
      new Set([
        'DOUBLE_DUNGEON_DROP',
        'CULTIVATION_EXP_BOOST',
        'SHOP_DISCOUNT',
        'SECT_SHOP_DISCOUNT',
        'DAILY_LOGIN_BONUS',
        'BOSS_REWARD_BOOST',
        'FESTIVAL_GIFT',
      ]),
    );
  });

  it('exports all 5 status values', () => {
    expect(LIVEOPS_EVENT_STATUSES).toEqual([
      'DRAFT',
      'SCHEDULED',
      'ACTIVE',
      'ENDED',
      'DISABLED',
    ]);
  });

  it('per-type caps are sane (drop ≤ 2.0, exp ≤ 2.0, discount ≤ 0.5)', () => {
    expect(LIVEOPS_EVENT_TYPE_CAPS.DOUBLE_DUNGEON_DROP.multiplierMax).toBeLessThanOrEqual(2.0);
    expect(LIVEOPS_EVENT_TYPE_CAPS.CULTIVATION_EXP_BOOST.multiplierMax).toBeLessThanOrEqual(2.0);
    expect(LIVEOPS_EVENT_TYPE_CAPS.SHOP_DISCOUNT.multiplierMax).toBeLessThanOrEqual(0.5);
    expect(LIVEOPS_EVENT_TYPE_CAPS.SECT_SHOP_DISCOUNT.multiplierMax).toBeLessThanOrEqual(0.5);
    expect(LIVEOPS_EVENT_TYPE_CAPS.BOSS_REWARD_BOOST.multiplierMax).toBeLessThanOrEqual(2.0);
    expect(LIVEOPS_EVENT_TYPE_CAPS.DAILY_LOGIN_BONUS.multiplierMax).toBeLessThanOrEqual(2.0);
  });

  it('FESTIVAL_GIFT requires rewardJson, kind=REWARD', () => {
    expect(LIVEOPS_EVENT_TYPE_CAPS.FESTIVAL_GIFT.kind).toBe('REWARD');
    expect(LIVEOPS_EVENT_TYPE_CAPS.FESTIVAL_GIFT.rewardJsonRequired).toBe(true);
  });

  it('exports recompute cron pattern (every 5 min)', () => {
    expect(LIVEOPS_EVENT_RECOMPUTE_CRON).toBe('*/5 * * * *');
  });

  it('exports min/max window constants', () => {
    expect(LIVEOPS_EVENT_MIN_WINDOW_MS).toBe(60_000);
    expect(LIVEOPS_EVENT_MAX_WINDOW_MS).toBe(365 * 24 * 60 * 60 * 1000);
  });

  it('isValid type guard accepts catalog values', () => {
    for (const t of LIVEOPS_EVENT_TYPES) {
      expect(isValidLiveOpsScheduledEventType(t)).toBe(true);
    }
    expect(isValidLiveOpsScheduledEventType('GACHA')).toBe(false);
    expect(isValidLiveOpsScheduledEventType('')).toBe(false);
  });

  it('isValid status guard accepts catalog values', () => {
    for (const s of LIVEOPS_EVENT_STATUSES) {
      expect(isValidLiveOpsScheduledEventStatus(s)).toBe(true);
    }
    expect(isValidLiveOpsScheduledEventStatus('PAUSED')).toBe(false);
  });
});

describe('LiveOps Event Scheduler — validateLiveOpsScheduledEventInput', () => {
  it('accepts valid input', () => {
    expect(validateLiveOpsScheduledEventInput(baseInput())).toBeNull();
  });

  it('rejects invalid key', () => {
    expect(validateLiveOpsScheduledEventInput(baseInput({ key: 'AB' }))).toBe(
      'EVENT_KEY_INVALID',
    );
    expect(
      validateLiveOpsScheduledEventInput(baseInput({ key: 'has spaces' })),
    ).toBe('EVENT_KEY_INVALID');
    expect(
      validateLiveOpsScheduledEventInput(baseInput({ key: '_starts_underscore' })),
    ).toBe('EVENT_KEY_INVALID');
  });

  it('rejects invalid type', () => {
    expect(
      validateLiveOpsScheduledEventInput(
        baseInput({ type: 'GACHA' as never }),
      ),
    ).toBe('EVENT_TYPE_INVALID');
  });

  it('rejects empty/long title', () => {
    expect(validateLiveOpsScheduledEventInput(baseInput({ title: '' }))).toBe(
      'EVENT_TITLE_REQUIRED',
    );
    expect(
      validateLiveOpsScheduledEventInput(baseInput({ title: 'x'.repeat(121) })),
    ).toBe('EVENT_TITLE_TOO_LONG');
  });

  it('rejects too-long description', () => {
    expect(
      validateLiveOpsScheduledEventInput(
        baseInput({ description: 'x'.repeat(501) }),
      ),
    ).toBe('EVENT_DESC_TOO_LONG');
  });

  it('rejects startsAt >= endsAt', () => {
    expect(
      validateLiveOpsScheduledEventInput(
        baseInput({
          startsAt: new Date('2026-07-02T00:00:00Z'),
          endsAt: new Date('2026-07-01T00:00:00Z'),
        }),
      ),
    ).toBe('EVENT_WINDOW_INVALID');
  });

  it('rejects window shorter than 60s', () => {
    const start = new Date('2026-07-01T00:00:00Z');
    const end = new Date(start.getTime() + 30_000);
    expect(
      validateLiveOpsScheduledEventInput(
        baseInput({ startsAt: start, endsAt: end }),
      ),
    ).toBe('EVENT_WINDOW_TOO_SHORT');
  });

  it('rejects window longer than 365 days', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2027-01-02T00:00:00Z');
    expect(
      validateLiveOpsScheduledEventInput(
        baseInput({ startsAt: start, endsAt: end }),
      ),
    ).toBe('EVENT_WINDOW_TOO_LONG');
  });

  it('rejects missing multiplier on BOOST', () => {
    expect(
      validateLiveOpsScheduledEventInput(
        baseInput({ type: TYPE.drop, configJson: {} }),
      ),
    ).toBe('EVENT_MULTIPLIER_REQUIRED');
  });

  it('rejects multiplier under min on BOOST (< 1.0)', () => {
    expect(
      validateLiveOpsScheduledEventInput(
        baseInput({ type: TYPE.exp, configJson: { multiplier: 0.5 } }),
      ),
    ).toBe('EVENT_MULTIPLIER_BELOW_MIN');
  });

  it('rejects multiplier over cap on BOOST (> 2.0)', () => {
    expect(
      validateLiveOpsScheduledEventInput(
        baseInput({ type: TYPE.drop, configJson: { multiplier: 3.0 } }),
      ),
    ).toBe('EVENT_MULTIPLIER_OVER_CAP');
    expect(
      validateLiveOpsScheduledEventInput(
        baseInput({ type: TYPE.boss, configJson: { multiplier: 5.0 } }),
      ),
    ).toBe('EVENT_MULTIPLIER_OVER_CAP');
  });

  it('rejects multiplier over cap on DISCOUNT (> 0.5)', () => {
    expect(
      validateLiveOpsScheduledEventInput(
        baseInput({ type: TYPE.shop, configJson: { multiplier: 0.8 } }),
      ),
    ).toBe('EVENT_MULTIPLIER_OVER_CAP');
    expect(
      validateLiveOpsScheduledEventInput(
        baseInput({ type: TYPE.sectShop, configJson: { multiplier: 0.6 } }),
      ),
    ).toBe('EVENT_MULTIPLIER_OVER_CAP');
  });

  it('accepts DISCOUNT multiplier 0..0.5', () => {
    expect(
      validateLiveOpsScheduledEventInput(
        baseInput({ type: TYPE.shop, configJson: { multiplier: 0.3 } }),
      ),
    ).toBeNull();
    expect(
      validateLiveOpsScheduledEventInput(
        baseInput({ type: TYPE.shop, configJson: { multiplier: 0 } }),
      ),
    ).toBeNull();
  });

  it('rejects FESTIVAL_GIFT without rewardJson', () => {
    expect(
      validateLiveOpsScheduledEventInput(
        baseInput({ type: TYPE.festival, configJson: {} }),
      ),
    ).toBe('EVENT_REWARD_JSON_REQUIRED');
    expect(
      validateLiveOpsScheduledEventInput(
        baseInput({ type: TYPE.festival, configJson: { rewardJson: {} } }),
      ),
    ).toBe('EVENT_REWARD_JSON_REQUIRED');
  });

  it('accepts FESTIVAL_GIFT with rewardJson', () => {
    expect(
      validateLiveOpsScheduledEventInput(
        baseInput({
          type: TYPE.festival,
          configJson: {
            rewardJson: {
              items: [{ itemKey: 'tinh_thiet', qty: 5 }],
              linhThach: 100,
            },
          },
        }),
      ),
    ).toBeNull();
  });
});

describe('LiveOps Event Scheduler — clampLiveOpsMultiplier', () => {
  it('clamps BOOST multiplier to [1.0, 2.0]', () => {
    expect(clampLiveOpsMultiplier(TYPE.drop, 0.5)).toBe(1.0);
    expect(clampLiveOpsMultiplier(TYPE.drop, 1.5)).toBe(1.5);
    expect(clampLiveOpsMultiplier(TYPE.drop, 5.0)).toBe(2.0);
    expect(clampLiveOpsMultiplier(TYPE.exp, 100)).toBe(2.0);
  });

  it('clamps DISCOUNT multiplier to [0, 0.5]', () => {
    expect(clampLiveOpsMultiplier(TYPE.shop, -0.1)).toBe(0);
    expect(clampLiveOpsMultiplier(TYPE.shop, 0.3)).toBe(0.3);
    expect(clampLiveOpsMultiplier(TYPE.shop, 0.9)).toBe(0.5);
  });

  it('returns min on NaN/Infinity', () => {
    expect(clampLiveOpsMultiplier(TYPE.drop, Number.NaN)).toBe(1.0);
    expect(clampLiveOpsMultiplier(TYPE.shop, Number.POSITIVE_INFINITY)).toBe(0.5);
    expect(clampLiveOpsMultiplier(TYPE.exp, Number.NEGATIVE_INFINITY)).toBe(1.0);
  });
});

describe('LiveOps Event Scheduler — pickActiveLiveOpsMultiplier', () => {
  const start = new Date('2026-07-01T00:00:00Z');
  const end = new Date('2026-07-02T00:00:00Z');
  function mod(
    type: (typeof LIVEOPS_EVENT_TYPES)[number],
    mul: number,
    key = 'k',
  ): LiveOpsRuntimeModifier {
    return { eventKey: key, type, multiplier: mul, startsAt: start, endsAt: end };
  }

  it('returns 1.0 identity for BOOST when no modifier', () => {
    expect(pickActiveLiveOpsMultiplier([], TYPE.drop)).toBe(1.0);
    expect(pickActiveLiveOpsMultiplier([], TYPE.exp)).toBe(1.0);
  });

  it('returns 0 identity for DISCOUNT when no modifier', () => {
    expect(pickActiveLiveOpsMultiplier([], TYPE.shop)).toBe(0);
  });

  it('picks max BOOST multiplier across modifiers (no stacking)', () => {
    const mods = [
      mod(TYPE.drop, 1.2, 'a'),
      mod(TYPE.drop, 1.8, 'b'),
      mod(TYPE.drop, 1.5, 'c'),
    ];
    expect(pickActiveLiveOpsMultiplier(mods, TYPE.drop)).toBe(1.8);
  });

  it('clamps individual modifier above cap before pick', () => {
    const mods = [mod(TYPE.drop, 5.0, 'cheat')];
    expect(pickActiveLiveOpsMultiplier(mods, TYPE.drop)).toBe(2.0);
  });

  it('ignores modifiers of other types', () => {
    const mods = [mod(TYPE.exp, 2.0, 'a'), mod(TYPE.boss, 1.9, 'b')];
    expect(pickActiveLiveOpsMultiplier(mods, TYPE.drop)).toBe(1.0);
    expect(pickActiveLiveOpsMultiplier(mods, TYPE.exp)).toBe(2.0);
    expect(pickActiveLiveOpsMultiplier(mods, TYPE.boss)).toBe(1.9);
  });

  it('picks max DISCOUNT (more discount = better for player)', () => {
    const mods = [
      mod(TYPE.shop, 0.1, 'a'),
      mod(TYPE.shop, 0.4, 'b'),
      mod(TYPE.shop, 0.2, 'c'),
    ];
    expect(pickActiveLiveOpsMultiplier(mods, TYPE.shop)).toBe(0.4);
  });
});

describe('LiveOps Event Scheduler — isLiveOpsEventActiveAt', () => {
  const start = new Date('2026-07-01T00:00:00Z');
  const end = new Date('2026-07-02T00:00:00Z');

  it('inclusive at start, exclusive at end', () => {
    expect(isLiveOpsEventActiveAt(start, end, new Date('2026-06-30T23:59:59Z'))).toBe(false);
    expect(isLiveOpsEventActiveAt(start, end, start)).toBe(true);
    expect(
      isLiveOpsEventActiveAt(start, end, new Date('2026-07-01T12:00:00Z')),
    ).toBe(true);
    expect(isLiveOpsEventActiveAt(start, end, end)).toBe(false);
    expect(
      isLiveOpsEventActiveAt(start, end, new Date('2026-07-02T00:00:01Z')),
    ).toBe(false);
  });
});

describe('LiveOps Event Scheduler — nextLiveOpsScheduledEventStatus', () => {
  const start = new Date('2026-07-01T00:00:00Z');
  const end = new Date('2026-07-02T00:00:00Z');

  it('SCHEDULED → ACTIVE when now reaches startsAt', () => {
    expect(nextLiveOpsScheduledEventStatus('SCHEDULED', start, end, start)).toBe('ACTIVE');
    expect(
      nextLiveOpsScheduledEventStatus(
        'SCHEDULED',
        start,
        end,
        new Date('2026-07-01T12:00:00Z'),
      ),
    ).toBe('ACTIVE');
  });

  it('SCHEDULED stays SCHEDULED before startsAt', () => {
    expect(
      nextLiveOpsScheduledEventStatus(
        'SCHEDULED',
        start,
        end,
        new Date('2026-06-30T23:59:00Z'),
      ),
    ).toBe('SCHEDULED');
  });

  it('SCHEDULED → ENDED if scheduled in the past', () => {
    expect(
      nextLiveOpsScheduledEventStatus(
        'SCHEDULED',
        start,
        end,
        new Date('2026-07-02T00:00:01Z'),
      ),
    ).toBe('ENDED');
  });

  it('ACTIVE → ENDED when now passes endsAt', () => {
    expect(nextLiveOpsScheduledEventStatus('ACTIVE', start, end, end)).toBe('ENDED');
    expect(
      nextLiveOpsScheduledEventStatus(
        'ACTIVE',
        start,
        end,
        new Date('2026-07-02T00:01:00Z'),
      ),
    ).toBe('ENDED');
  });

  it('ACTIVE stays ACTIVE inside window', () => {
    expect(
      nextLiveOpsScheduledEventStatus(
        'ACTIVE',
        start,
        end,
        new Date('2026-07-01T12:00:00Z'),
      ),
    ).toBe('ACTIVE');
  });

  it('DRAFT/DISABLED/ENDED do not transition', () => {
    const inside = new Date('2026-07-01T12:00:00Z');
    expect(nextLiveOpsScheduledEventStatus('DRAFT', start, end, inside)).toBe('DRAFT');
    expect(nextLiveOpsScheduledEventStatus('DISABLED', start, end, inside)).toBe('DISABLED');
    expect(nextLiveOpsScheduledEventStatus('ENDED', start, end, inside)).toBe('ENDED');
  });

  it('idempotent — same input → same output', () => {
    const t = new Date('2026-07-01T12:00:00Z');
    const a = nextLiveOpsScheduledEventStatus('SCHEDULED', start, end, t);
    const b = nextLiveOpsScheduledEventStatus('SCHEDULED', start, end, t);
    expect(a).toBe(b);
  });
});

describe('LiveOps Event Scheduler — key pattern', () => {
  it('accepts valid keys', () => {
    expect(LIVEOPS_EVENT_KEY_PATTERN.test('event_test_001')).toBe(true);
    expect(LIVEOPS_EVENT_KEY_PATTERN.test('a-b-c')).toBe(true);
    expect(LIVEOPS_EVENT_KEY_PATTERN.test('abc')).toBe(true);
  });

  it('rejects invalid keys', () => {
    expect(LIVEOPS_EVENT_KEY_PATTERN.test('AB')).toBe(false);
    expect(LIVEOPS_EVENT_KEY_PATTERN.test('a')).toBe(false);
    expect(LIVEOPS_EVENT_KEY_PATTERN.test('_underscore')).toBe(false);
    expect(LIVEOPS_EVENT_KEY_PATTERN.test('Has Caps')).toBe(false);
  });
});
