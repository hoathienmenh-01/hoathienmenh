/**
 * Phase 27.6 — Admin Control Center V2 catalog invariants.
 *
 * Mục tiêu test:
 *   - Role/permission matrix đầy đủ + đúng theo spec.
 *   - Risk level mapping ổn định.
 *   - Validator chặn TIER LEAK, FORBIDDEN ITEM, TIEN_NGOC grant,
 *     amount âm/NaN, role không có quyền, missing reason/confirmText.
 *   - Drop simulator deterministic theo seed.
 */
import { describe, it, expect } from 'vitest';
import {
  ADMIN_ROLE_KEYS,
  ADMIN_PERMISSION_KEYS,
  ADMIN_ACTION_TYPES,
  ADMIN_RISK_LEVELS,
  ADMIN_CURRENCY_KEYS,
  ADMIN_ROLE_PERMISSIONS,
  ADMIN_CURRENCY_ADJUST_LIMIT,
  ADMIN_ITEM_GRANT_LIMIT,
  ADMIN_FORBIDDEN_GRANT_ITEMS,
  DEFAULT_ACTION_RISK,
  CONTENT_STATUS_TYPES,
  DROP_PROFILE_SOURCE_TYPES,
  DROP_MATERIAL_CATEGORIES,
  DROP_SOURCE_MAX_TIER,
  DROP_RARE_RATE_MAX,
  REWARD_PROFILE_CONTENT_TYPES,
  REWARD_ENTRY_KINDS,
  REWARD_QTY_CAP_BY_TIER,
  REWARD_PROFILE_FORBIDDEN_CURRENCY,
  hasAdminPermission,
  getPermissionsForRole,
  defaultRiskFor,
  actionRequiresConfirmation,
  validateAdminCurrencyAdjust,
  validateAdminItemGrant,
  validateRewardProfile,
  validateDropProfile,
  validateContentStatus,
  simulateDropProfile,
  createAdminSimulatorRng,
  isAdminRoleKey,
  isAdminPermissionKey,
  isAdminActionType,
  isAdminRiskLevel,
  isAdminCurrencyKey,
  isForbiddenAdminGrantItem,
  isRewardProfileContentType,
  isRewardEntryKind,
  isDropProfileSourceType,
  isDropMaterialCategory,
  isContentStatusType,
  type DropProfileSpec,
  type RewardProfileSpec,
  type ContentStatusSpec,
} from './admin-control-center';

describe('admin-control-center — roles & permissions', () => {
  it('exposes exactly 7 admin role keys (Phase 27.6 §1)', () => {
    expect(ADMIN_ROLE_KEYS.length).toBe(7);
    expect(new Set(ADMIN_ROLE_KEYS).size).toBe(7);
  });

  it('exposes exactly 32 admin permission keys (Phase 30.0/32.0 §0 — +ADMIN_MANAGE_MARKET + ADMIN_MANAGE_CODEX)', () => {
    expect(ADMIN_PERMISSION_KEYS.length).toBe(32);
    expect(new Set(ADMIN_PERMISSION_KEYS).size).toBe(32);
    expect(ADMIN_PERMISSION_KEYS).toContain('ADMIN_MANAGE_PVP');
    expect(ADMIN_PERMISSION_KEYS).toContain('ADMIN_MANAGE_MARKET');
    expect(ADMIN_PERMISSION_KEYS).toContain('ADMIN_MANAGE_CODEX');
  });

  it('SUPER_ADMIN has all permissions', () => {
    const perms = getPermissionsForRole('SUPER_ADMIN');
    expect(perms.length).toBe(ADMIN_PERMISSION_KEYS.length);
    for (const p of ADMIN_PERMISSION_KEYS) {
      expect(hasAdminPermission('SUPER_ADMIN', p)).toBe(true);
    }
  });

  it('MODERATOR cannot adjust currency or grant items', () => {
    expect(hasAdminPermission('MODERATOR', 'ADMIN_ADJUST_CURRENCY')).toBe(false);
    expect(hasAdminPermission('MODERATOR', 'ADMIN_GRANT_ITEM')).toBe(false);
    expect(hasAdminPermission('MODERATOR', 'ADMIN_MODERATE_CHAT')).toBe(true);
    expect(hasAdminPermission('MODERATOR', 'ADMIN_BAN_USER')).toBe(true);
  });

  it('SUPPORT_ADMIN cannot manage shop / battle pass / reward profile', () => {
    expect(hasAdminPermission('SUPPORT_ADMIN', 'ADMIN_MANAGE_SHOP')).toBe(false);
    expect(hasAdminPermission('SUPPORT_ADMIN', 'ADMIN_MANAGE_BATTLE_PASS')).toBe(false);
    expect(hasAdminPermission('SUPPORT_ADMIN', 'ADMIN_MANAGE_REWARD_PROFILE')).toBe(
      false,
    );
    expect(hasAdminPermission('SUPPORT_ADMIN', 'ADMIN_EDIT_PLAYER_SUPPORT')).toBe(true);
  });

  it('CONTENT_ADMIN cannot adjust currency', () => {
    expect(hasAdminPermission('CONTENT_ADMIN', 'ADMIN_ADJUST_CURRENCY')).toBe(false);
    expect(hasAdminPermission('CONTENT_ADMIN', 'ADMIN_MANAGE_MAPS')).toBe(true);
    expect(hasAdminPermission('CONTENT_ADMIN', 'ADMIN_MANAGE_DUNGEONS')).toBe(true);
  });

  it('OPERATIONS_ADMIN can manage flag / events / maintenance / announcement', () => {
    for (const p of [
      'ADMIN_MANAGE_FEATURE_FLAGS',
      'ADMIN_MANAGE_EVENTS',
      'ADMIN_MANAGE_MAINTENANCE',
      'ADMIN_MANAGE_ANNOUNCEMENT',
    ] as const) {
      expect(hasAdminPermission('OPERATIONS_ADMIN', p)).toBe(true);
    }
    expect(hasAdminPermission('OPERATIONS_ADMIN', 'ADMIN_ADJUST_CURRENCY')).toBe(false);
  });

  it('QA_ADMIN has dev tools but no economy power', () => {
    expect(hasAdminPermission('QA_ADMIN', 'ADMIN_RUN_DEV_TOOLS')).toBe(true);
    expect(hasAdminPermission('QA_ADMIN', 'ADMIN_ADJUST_CURRENCY')).toBe(false);
    expect(hasAdminPermission('QA_ADMIN', 'ADMIN_GRANT_ITEM')).toBe(false);
    expect(hasAdminPermission('QA_ADMIN', 'ADMIN_MANAGE_FEATURE_FLAGS')).toBe(false);
  });

  it('all roles in role-perm map are valid', () => {
    for (const role of ADMIN_ROLE_KEYS) {
      expect(ADMIN_ROLE_PERMISSIONS[role]).toBeDefined();
      for (const p of ADMIN_ROLE_PERMISSIONS[role]) {
        expect(ADMIN_PERMISSION_KEYS).toContain(p);
      }
    }
  });

  it('type-guards work for catalog keys', () => {
    expect(isAdminRoleKey('SUPER_ADMIN')).toBe(true);
    expect(isAdminRoleKey('xxx')).toBe(false);
    expect(isAdminPermissionKey('ADMIN_ADJUST_CURRENCY')).toBe(true);
    expect(isAdminPermissionKey('foo')).toBe(false);
    expect(isAdminActionType('CURRENCY_ADJUST')).toBe(true);
    expect(isAdminActionType('XXX')).toBe(false);
    expect(isAdminRiskLevel('HIGH')).toBe(true);
    expect(isAdminRiskLevel('weird')).toBe(false);
    expect(isAdminCurrencyKey('LINH_THACH')).toBe(true);
    expect(isAdminCurrencyKey('foo')).toBe(false);
    expect(isRewardProfileContentType('BOSS')).toBe(true);
    expect(isRewardEntryKind('item')).toBe(true);
    expect(isDropProfileSourceType('BOSS')).toBe(true);
    expect(isDropMaterialCategory('GENERAL')).toBe(true);
    expect(isContentStatusType('FARM_MAP')).toBe(true);
  });
});

describe('admin-control-center — action types & risk levels', () => {
  it('exposes >=27 action types incl. core economy actions', () => {
    expect(ADMIN_ACTION_TYPES.length).toBeGreaterThanOrEqual(27);
    for (const t of [
      'CONFIG_UPDATE',
      'FEATURE_FLAG_UPDATE',
      'CURRENCY_ADJUST',
      'ITEM_GRANT',
      'ITEM_REVOKE',
      'REWARD_PROFILE_UPDATE',
      'DROP_PROFILE_UPDATE',
      'BAN_USER',
      'ANTI_CHEAT_RESOLVE',
    ] as const) {
      expect(ADMIN_ACTION_TYPES).toContain(t);
    }
  });

  it('risk-levels has LOW/MEDIUM/HIGH/CRITICAL', () => {
    expect(ADMIN_RISK_LEVELS).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  });

  it('default risk mapping = HIGH+ for currency/item/refund/ban actions', () => {
    expect(defaultRiskFor('CURRENCY_ADJUST')).toBe('HIGH');
    expect(defaultRiskFor('ITEM_GRANT')).toBe('HIGH');
    expect(defaultRiskFor('ITEM_REVOKE')).toBe('HIGH');
    expect(defaultRiskFor('REFUND')).toBe('HIGH');
    expect(defaultRiskFor('BAN_USER')).toBe('HIGH');
    expect(defaultRiskFor('TOWER_SEASON_RESET')).toBe('CRITICAL');
    expect(defaultRiskFor('MAINTENANCE_START')).toBe('CRITICAL');
    expect(defaultRiskFor('ANNOUNCEMENT_PUBLISH')).toBe('LOW');
  });

  it('HIGH and CRITICAL require confirmation', () => {
    expect(actionRequiresConfirmation('LOW')).toBe(false);
    expect(actionRequiresConfirmation('MEDIUM')).toBe(false);
    expect(actionRequiresConfirmation('HIGH')).toBe(true);
    expect(actionRequiresConfirmation('CRITICAL')).toBe(true);
  });

  it('every action has a default risk entry', () => {
    for (const a of ADMIN_ACTION_TYPES) {
      expect(DEFAULT_ACTION_RISK[a]).toBeDefined();
      expect(ADMIN_RISK_LEVELS).toContain(DEFAULT_ACTION_RISK[a]);
    }
  });
});

describe('admin-control-center — currency adjust validator', () => {
  it('rejects amount=0', () => {
    expect(
      validateAdminCurrencyAdjust({
        role: 'SUPER_ADMIN',
        currency: 'LINH_THACH',
        amount: 0,
        reason: 'test',
      }),
    ).toBe('AMOUNT_ZERO');
  });

  it('rejects non-integer or NaN amount', () => {
    expect(
      validateAdminCurrencyAdjust({
        role: 'SUPER_ADMIN',
        currency: 'LINH_THACH',
        amount: 1.5,
        reason: 'test',
      }),
    ).toBe('AMOUNT_NOT_INTEGER');
    expect(
      validateAdminCurrencyAdjust({
        role: 'SUPER_ADMIN',
        currency: 'LINH_THACH',
        amount: NaN,
        reason: 'test',
      }),
    ).toBe('AMOUNT_NOT_FINITE');
  });

  it('rejects unsupported currency', () => {
    expect(
      validateAdminCurrencyAdjust({
        role: 'SUPER_ADMIN',
        currency: 'BTC',
        amount: 100,
        reason: 'test',
      }),
    ).toBe('CURRENCY_UNSUPPORTED');
  });

  it('rejects role-not-allowed currency', () => {
    expect(
      validateAdminCurrencyAdjust({
        role: 'SUPPORT_ADMIN',
        currency: 'TIEN_NGOC',
        amount: 100,
        reason: 'test',
      }),
    ).toBe('CURRENCY_NOT_ALLOWED_FOR_ROLE');
    expect(
      validateAdminCurrencyAdjust({
        role: 'CONTENT_ADMIN',
        currency: 'LINH_THACH',
        amount: 100,
        reason: 'test',
      }),
    ).toBe('CURRENCY_NOT_ALLOWED_FOR_ROLE');
  });

  it('rejects amount over role limit', () => {
    expect(
      validateAdminCurrencyAdjust({
        role: 'SUPPORT_ADMIN',
        currency: 'LINH_THACH',
        amount: 100_000_001,
        reason: 'test',
      }),
    ).toBe('CURRENCY_AMOUNT_OVER_LIMIT');
  });

  it('requires reason', () => {
    expect(
      validateAdminCurrencyAdjust({
        role: 'SUPER_ADMIN',
        currency: 'LINH_THACH',
        amount: 100,
        reason: '',
      }),
    ).toBe('REASON_REQUIRED');
  });

  it('requires confirmText if amount > 50% cap on HIGH actions', () => {
    const cap = ADMIN_CURRENCY_ADJUST_LIMIT.SUPER_ADMIN.LINH_THACH;
    expect(
      validateAdminCurrencyAdjust({
        role: 'SUPER_ADMIN',
        currency: 'LINH_THACH',
        amount: Math.floor(cap * 0.6),
        reason: 'test',
      }),
    ).toBe('CONFIRM_TEXT_REQUIRED');
    expect(
      validateAdminCurrencyAdjust({
        role: 'SUPER_ADMIN',
        currency: 'LINH_THACH',
        amount: Math.floor(cap * 0.6),
        reason: 'test',
        confirmText: 'CONFIRM',
      }),
    ).toBeNull();
  });

  it('accepts valid small support adjust', () => {
    expect(
      validateAdminCurrencyAdjust({
        role: 'SUPPORT_ADMIN',
        currency: 'LINH_THACH',
        amount: 5000,
        reason: 'refund stuck farm',
      }),
    ).toBeNull();
  });

  it('accepts negative amount (revoke) within abs(amount) cap', () => {
    expect(
      validateAdminCurrencyAdjust({
        role: 'SUPPORT_ADMIN',
        currency: 'LINH_THACH',
        amount: -5000,
        reason: 'duplicate reward revoke',
      }),
    ).toBeNull();
  });
});

describe('admin-control-center — item grant validator', () => {
  it('rejects qty <= 0 or non-integer', () => {
    for (const qty of [0, -1, 1.5, NaN]) {
      expect(
        validateAdminItemGrant({
          role: 'SUPER_ADMIN',
          itemKey: 'tinh_thiet',
          qty,
          reason: 'test',
        }),
      ).toBe('QTY_NOT_POSITIVE_INTEGER');
    }
  });

  it('rejects qty > role limit', () => {
    expect(
      validateAdminItemGrant({
        role: 'SUPPORT_ADMIN',
        itemKey: 'tinh_thiet',
        qty: 11,
        reason: 'test',
      }),
    ).toBe('QTY_OVER_LIMIT');
  });

  it('rejects MODERATOR / CONTENT_ADMIN / QA_ADMIN grant any qty', () => {
    for (const role of ['MODERATOR', 'CONTENT_ADMIN', 'QA_ADMIN'] as const) {
      expect(
        validateAdminItemGrant({
          role,
          itemKey: 'tinh_thiet',
          qty: 1,
          reason: 'test',
        }),
      ).toBe('QTY_OVER_LIMIT');
    }
  });

  it('rejects forbidden item except SUPER_ADMIN with confirmText', () => {
    expect(isForbiddenAdminGrantItem('hau_tho_tran_hon_an')).toBe(true);
    expect(
      validateAdminItemGrant({
        role: 'ECONOMY_ADMIN',
        itemKey: 'hau_tho_tran_hon_an',
        qty: 1,
        reason: 'support refund',
      }),
    ).toBe('ITEM_FORBIDDEN_FOR_ROLE');
    expect(
      validateAdminItemGrant({
        role: 'SUPER_ADMIN',
        itemKey: 'hau_tho_tran_hon_an',
        qty: 1,
        reason: 'support refund',
      }),
    ).toBe('CONFIRM_TEXT_REQUIRED');
    expect(
      validateAdminItemGrant({
        role: 'SUPER_ADMIN',
        itemKey: 'hau_tho_tran_hon_an',
        qty: 1,
        reason: 'support refund',
        confirmText: 'CONFIRM_FORBIDDEN_GRANT',
      }),
    ).toBeNull();
  });

  it('requires reason on every grant', () => {
    expect(
      validateAdminItemGrant({
        role: 'SUPPORT_ADMIN',
        itemKey: 'tinh_thiet',
        qty: 5,
        reason: '',
      }),
    ).toBe('REASON_REQUIRED');
  });
});

describe('admin-control-center — reward profile validator', () => {
  const baseSpec = (): RewardProfileSpec => ({
    key: 'BOSS_PERSONAL_T3_DEFAULT',
    name: 'Boss cá nhân T3 default',
    contentType: 'BOSS',
    contentKey: 'boss_t3_dummy',
    sourceTier: 3,
    rewards: [
      { kind: 'item', key: 'tinh_thiet', qty: 5, itemTier: 3 },
      { kind: 'currency', key: 'LINH_THACH', qty: 200 },
    ],
    active: false,
    version: 1,
  });

  it('accepts valid profile', () => {
    expect(validateRewardProfile(baseSpec())).toEqual([]);
  });

  it('rejects empty rewards', () => {
    const s = baseSpec();
    s.rewards = [];
    expect(validateRewardProfile(s).map((i) => i.code)).toContain('REWARDS_EMPTY');
  });

  it('rejects reward qty <= 0 or non-integer', () => {
    const s = baseSpec();
    s.rewards = [
      { kind: 'item', key: 'tinh_thiet', qty: 0, itemTier: 3 },
      { kind: 'item', key: 'tinh_thiet', qty: 1.5, itemTier: 3 },
      { kind: 'item', key: 'tinh_thiet', qty: -1, itemTier: 3 },
    ];
    const codes = validateRewardProfile(s).map((i) => i.code);
    expect(codes.filter((c) => c === 'REWARD_QTY_INVALID').length).toBe(3);
  });

  it('rejects tier leak (T1 boss rewarding T9 item)', () => {
    const s = baseSpec();
    s.sourceTier = 1;
    s.rewards = [{ kind: 'item', key: 'foo', qty: 1, itemTier: 9 }];
    const codes = validateRewardProfile(s).map((i) => i.code);
    expect(codes).toContain('TIER_LEAK_FORBIDDEN');
  });

  it('rejects forbidden item even at matching tier', () => {
    const s = baseSpec();
    s.sourceTier = 9;
    s.rewards = [{ kind: 'item', key: 'hau_tho_tran_hon_an', qty: 1, itemTier: 9 }];
    // Need weekly cap or it'll also raise WEEKLY_CAP_REQUIRED_FOR_RARE
    s.cap = { weeklyCount: 1 };
    const codes = validateRewardProfile(s).map((i) => i.code);
    expect(codes).toContain('FORBIDDEN_ITEM');
  });

  it('rejects TIEN_NGOC reward currency', () => {
    const s = baseSpec();
    s.rewards = [{ kind: 'currency', key: 'TIEN_NGOC', qty: 10 }];
    const codes = validateRewardProfile(s).map((i) => i.code);
    expect(codes).toContain('TIEN_NGOC_GRANT_FORBIDDEN');
  });

  it('rejects qty exceeding tier cap', () => {
    const s = baseSpec();
    s.sourceTier = 9;
    s.rewards = [{ kind: 'item', key: 'foo', qty: 100, itemTier: 9 }]; // T9 cap = 1
    s.cap = { weeklyCount: 1 };
    const codes = validateRewardProfile(s).map((i) => i.code);
    expect(codes).toContain('REWARD_QTY_OVER_TIER_CAP');
  });

  it('requires weekly cap for rare items (T7+)', () => {
    const s = baseSpec();
    s.sourceTier = 8;
    s.rewards = [{ kind: 'item', key: 'foo', qty: 1, itemTier: 7 }];
    expect(validateRewardProfile(s).map((i) => i.code)).toContain(
      'WEEKLY_CAP_REQUIRED_FOR_RARE',
    );
    s.cap = { weeklyCount: 1 };
    expect(validateRewardProfile(s).map((i) => i.code)).not.toContain(
      'WEEKLY_CAP_REQUIRED_FOR_RARE',
    );
  });

  it('rejects sourceTier out of [1..9]', () => {
    for (const t of [0, 10, -1, 1.5]) {
      const s = baseSpec();
      s.sourceTier = t;
      expect(validateRewardProfile(s).map((i) => i.code)).toContain(
        'SOURCE_TIER_INVALID',
      );
    }
  });
});

describe('admin-control-center — drop profile validator', () => {
  const baseSpec = (): DropProfileSpec => ({
    key: 'BOSS_T3_GENERAL',
    name: 'Boss T3 general drop',
    sourceType: 'BOSS',
    sourceTier: 3,
    materialCategory: 'GENERAL',
    baseRate: 0.3,
    rareRate: 0.02,
    items: [
      { itemKey: 'tinh_thiet', tier: 3, weight: 50 },
      { itemKey: 'yeu_dan', tier: 3, weight: 10, rare: true },
    ],
    cap: { weeklyRare: 5 },
    active: false,
    version: 1,
  });

  it('accepts valid spec', () => {
    expect(validateDropProfile(baseSpec())).toEqual([]);
  });

  it('rejects baseRate or rareRate out of [0..1]', () => {
    const s = baseSpec();
    s.baseRate = 1.5;
    s.rareRate = -0.1;
    const codes = validateDropProfile(s).map((i) => i.code);
    expect(codes).toContain('BASE_RATE_INVALID');
    expect(codes).toContain('RARE_RATE_INVALID');
  });

  it('rejects rareRate above DROP_RARE_RATE_MAX', () => {
    const s = baseSpec();
    s.rareRate = DROP_RARE_RATE_MAX + 0.1;
    expect(validateDropProfile(s).map((i) => i.code)).toContain(
      'RARE_RATE_TOO_HIGH',
    );
  });

  it('rejects normal monster dropping T5+ rare', () => {
    const s = baseSpec();
    s.sourceType = 'NORMAL_MONSTER';
    s.sourceTier = 3;
    s.items = [{ itemKey: 'foo_t5', tier: 5, weight: 1 }];
    const codes = validateDropProfile(s).map((i) => i.code);
    expect(codes).toContain('NORMAL_MONSTER_RARE_TIER_FORBIDDEN');
  });

  it('rejects tier leak source < item.tier', () => {
    const s = baseSpec();
    s.sourceTier = 2;
    s.items = [{ itemKey: 'foo_t5', tier: 5, weight: 1 }];
    expect(validateDropProfile(s).map((i) => i.code)).toContain(
      'TIER_LEAK_FORBIDDEN',
    );
  });

  it('rejects forbidden item in drop pool', () => {
    const s = baseSpec();
    s.sourceTier = 9;
    s.sourceType = 'WORLD_BOSS';
    s.items = [{ itemKey: 'hau_tho_tran_hon_an', tier: 9, weight: 1 }];
    const codes = validateDropProfile(s).map((i) => i.code);
    expect(codes).toContain('ITEM_FORBIDDEN');
  });

  it('requires weekly rare cap when rareRate > 0', () => {
    const s = baseSpec();
    s.cap = undefined;
    expect(validateDropProfile(s).map((i) => i.code)).toContain(
      'WEEKLY_CAP_REQUIRED_FOR_RARE',
    );
  });

  it('ARTIFACT_CRAFT rareRate must be <= 0.05', () => {
    const s = baseSpec();
    s.materialCategory = 'ARTIFACT_CRAFT';
    s.rareRate = 0.1;
    expect(validateDropProfile(s).map((i) => i.code)).toContain(
      'ARTIFACT_RARE_HIGHER_THAN_ALCHEMY',
    );
    s.rareRate = 0.04;
    expect(validateDropProfile(s).map((i) => i.code)).not.toContain(
      'ARTIFACT_RARE_HIGHER_THAN_ALCHEMY',
    );
  });
});

describe('admin-control-center — drop simulator', () => {
  it('is deterministic for same seed', () => {
    const spec: DropProfileSpec = {
      key: 'DUNGEON_T5_TEST',
      name: 'Dungeon T5 test',
      sourceType: 'DUNGEON',
      sourceTier: 5,
      baseRate: 0.5,
      rareRate: 0.05,
      items: [
        { itemKey: 'common_t5', tier: 5, weight: 80 },
        { itemKey: 'rare_t5', tier: 5, weight: 20, rare: true },
      ],
      cap: { weeklyRare: 10 },
      active: false,
      version: 1,
    };
    const a = simulateDropProfile(spec, 1000, 7);
    const b = simulateDropProfile(spec, 1000, 7);
    expect(a.totalDrops).toBe(b.totalDrops);
    expect(a.rareDrops).toBe(b.rareDrops);
    expect(a.perItem).toEqual(b.perItem);
    expect(a.perTier).toEqual(b.perTier);
  });

  it('expected drop rate stays within base rate * 1.5 over 5000 trials', () => {
    const spec: DropProfileSpec = {
      key: 'SIM_T5',
      name: 'Sim T5',
      sourceType: 'BOSS',
      sourceTier: 5,
      baseRate: 0.4,
      rareRate: 0.05,
      items: [
        { itemKey: 'common_t5', tier: 5, weight: 80 },
        { itemKey: 'rare_t5', tier: 5, weight: 20, rare: true },
      ],
      cap: { weeklyRare: 10 },
      active: false,
      version: 1,
    };
    const result = simulateDropProfile(spec, 5000, 42);
    expect(result.expectedDropRate).toBeGreaterThan(0.2);
    expect(result.expectedDropRate).toBeLessThan(0.5);
  });

  it('createAdminSimulatorRng produces values in [0,1)', () => {
    const rng = createAdminSimulatorRng(123);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('warns when tier leak appears in simulation', () => {
    const spec: DropProfileSpec = {
      key: 'BAD_PROFILE',
      name: 'Bad profile',
      sourceType: 'BOSS',
      sourceTier: 3,
      baseRate: 1,
      rareRate: 0,
      // intentionally tier 8 item on tier 3 boss — simulator will count leaks
      items: [{ itemKey: 'leaky', tier: 8, weight: 1 }],
      cap: { weeklyRare: 1 },
      active: false,
      version: 1,
    };
    const result = simulateDropProfile(spec, 100, 1);
    expect(result.tierLeakCount).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('tier leak'))).toBe(true);
  });
});

describe('admin-control-center — content status validator', () => {
  it('exposes 16 content types', () => {
    expect(CONTENT_STATUS_TYPES.length).toBe(16);
  });

  it('accepts enabled content with no flags', () => {
    const s: ContentStatusSpec = {
      contentType: 'FARM_MAP',
      contentKey: 'farm_phong_van',
      enabled: true,
      paused: false,
      disableReward: false,
      disableClaim: false,
    };
    expect(validateContentStatus(s)).toEqual([]);
  });

  it('rejects paused/disableReward when not enabled', () => {
    const s: ContentStatusSpec = {
      contentType: 'FARM_MAP',
      contentKey: 'farm_phong_van',
      enabled: false,
      paused: true,
      disableReward: true,
      disableClaim: false,
    };
    const issues = validateContentStatus(s);
    expect(issues).toContain('PAUSE_WITHOUT_ENABLED');
    expect(issues).toContain('DISABLE_REWARD_WITHOUT_ENABLED');
  });

  it('rejects invalid contentType / empty contentKey / huge message', () => {
    const s: ContentStatusSpec = {
      contentType: 'FOO' as never,
      contentKey: '',
      enabled: true,
      paused: false,
      disableReward: false,
      disableClaim: false,
      message: 'x'.repeat(2000),
    };
    const issues = validateContentStatus(s);
    expect(issues).toContain('CONTENT_TYPE_INVALID');
    expect(issues).toContain('CONTENT_KEY_INVALID');
    expect(issues).toContain('MESSAGE_TOO_LONG');
  });
});

describe('admin-control-center — sanity sets', () => {
  it('currency keys cover wallet currencies', () => {
    for (const c of ['LINH_THACH', 'TIEN_NGOC', 'TIEN_NGOC_KHOA']) {
      expect(ADMIN_CURRENCY_KEYS).toContain(c);
    }
  });

  it('forbidden grant items extends Phase 27.1–27.5 forbidden rewards', () => {
    expect(ADMIN_FORBIDDEN_GRANT_ITEMS.size).toBeGreaterThan(5);
    expect(ADMIN_FORBIDDEN_GRANT_ITEMS.has('hau_tho_tran_hon_an')).toBe(true);
    expect(ADMIN_FORBIDDEN_GRANT_ITEMS.has('METHOD_TIEN_THUONG')).toBe(true);
  });

  it('REWARD_QTY_CAP_BY_TIER decreases monotonically', () => {
    let prev = Infinity;
    for (let t = 1; t <= 9; t++) {
      expect(REWARD_QTY_CAP_BY_TIER[t]).toBeLessThanOrEqual(prev);
      prev = REWARD_QTY_CAP_BY_TIER[t];
    }
  });

  it('DROP_SOURCE_MAX_TIER monotonically expands across source types', () => {
    expect(DROP_SOURCE_MAX_TIER.NORMAL_MONSTER).toBeLessThan(
      DROP_SOURCE_MAX_TIER.ELITE_MONSTER,
    );
    expect(DROP_SOURCE_MAX_TIER.BOSS).toBeLessThanOrEqual(DROP_SOURCE_MAX_TIER.WORLD_BOSS);
  });

  it('REWARD_ENTRY_KINDS includes all spec entries', () => {
    expect(REWARD_ENTRY_KINDS).toContain('item');
    expect(REWARD_ENTRY_KINDS).toContain('currency');
    expect(REWARD_ENTRY_KINDS).toContain('cosmetic');
    expect(REWARD_ENTRY_KINDS).toContain('entitlement');
    expect(REWARD_ENTRY_KINDS).toContain('sweepTicket');
  });

  it('REWARD_PROFILE_FORBIDDEN_CURRENCY includes both styles of TIEN_NGOC key', () => {
    expect(REWARD_PROFILE_FORBIDDEN_CURRENCY.has('TIEN_NGOC')).toBe(true);
    expect(REWARD_PROFILE_FORBIDDEN_CURRENCY.has('tienNgoc')).toBe(true);
  });

  it('REWARD_PROFILE_CONTENT_TYPES, DROP_PROFILE_SOURCE_TYPES are unique', () => {
    expect(new Set(REWARD_PROFILE_CONTENT_TYPES).size).toBe(
      REWARD_PROFILE_CONTENT_TYPES.length,
    );
    expect(new Set(DROP_PROFILE_SOURCE_TYPES).size).toBe(
      DROP_PROFILE_SOURCE_TYPES.length,
    );
    expect(new Set(DROP_MATERIAL_CATEGORIES).size).toBe(
      DROP_MATERIAL_CATEGORIES.length,
    );
  });
});
