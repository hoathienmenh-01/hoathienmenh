/**
 * Phase 28.0 — Event Builder & Tier-Balanced LiveOps Event System V2.
 *
 * Shared test suite theo spec PHẦN 16 (10 shared test bắt buộc + invariant
 * mở rộng cho catalog, validator, helper).
 */
import { describe, it, expect } from 'vitest';
import {
  EVENT_TYPES,
  EVENT_STATUSES,
  BRACKET_MODES,
  EVENT_TYPES_REQUIRE_BRACKET_RANKING,
  EVENT_ITEM_KINDS,
  EVENT_ITEM_RISK_GROUP_BY_KIND,
  EVENT_ITEM_DIRECT_CREATE_MAX_TIER_BY_GROUP,
  EVENT_MISSION_TYPES,
  EVENT_BOSS_TYPES,
  EVENT_RANKING_TYPES,
  PERSONAL_EVENT_TRIGGER_TYPES,
  PAID_REWARD_POLICIES,
  EVENT_ERROR_CODES,
  EVENT_ADMIN_ACTION_TYPES,
  EVENT_ADMIN_ACTION_REQUIRE_REASON,
  EVENT_KEY_PATTERN,
  EVENT_TOKEN_DAILY_CAP_HARD_MAX,
  EVENT_TOKEN_WEEKLY_CAP_HARD_MAX,
  EVENT_TOKEN_EVENT_CAP_HARD_MAX,
  EVENT_HIGH_LEVEL_TOKEN_PENALTY_DEFAULT,
  EVENT_MAX_REWARD_TIER_DELTA_DEFAULT,
  EVENT_MAX_REWARD_TIER_DELTA_HARD_MAX,
  DEFAULT_BRACKETS,
  PRESET_EVENT_TEMPLATES,
  findEventTemplate,
  defaultEventBalancePolicy,
  realmTierForEventBracket,
  computeEffectiveRewardTier,
  computeScoreNormalization,
  resolveBracketForPlayer,
  isHighLevelInLowBracket,
  computeTokenPenaltyMultiplier,
  validateEventDef,
  validateEventBracket,
  validateEventBalancePolicy,
  validateEventItem,
  validateEventReward,
  validateEventRewardList,
  validateEventShop,
  validateEventShopItem,
  validateEventMission,
  validateEventBoss,
  validateEventRanking,
  validateEventChestLootTable,
  validateEventPersonalMilestone,
  publicEventSummary,
  isEventType,
  isEventErrorCode,
  type EventDef,
  type EventBracketDef,
  type EventRewardContext,
  type RewardJsonEntry,
} from './events';

// ---------------------------------------------------------------------------
// Catalog sanity
// ---------------------------------------------------------------------------

describe('Phase 28.0 — Event Builder catalog sanity', () => {
  it('EVENT_TYPES exposes 19 entries from spec', () => {
    expect(EVENT_TYPES.length).toBe(19);
    expect(EVENT_TYPES).toContain('LOGIN_EVENT');
    expect(EVENT_TYPES).toContain('REALM_MILESTONE_EVENT');
    expect(EVENT_TYPES).toContain('BODY_REALM_MILESTONE_EVENT');
    expect(EVENT_TYPES).toContain('CUSTOM_EVENT');
  });

  it('EVENT_STATUSES exposes 9 lifecycle states', () => {
    expect(EVENT_STATUSES.length).toBe(9);
    expect(EVENT_STATUSES).toEqual([
      'DRAFT',
      'SCHEDULED',
      'ACTIVE',
      'PAUSED',
      'REWARD_LOCKED',
      'ENDED',
      'FINALIZED',
      'ARCHIVED',
      'CANCELLED',
    ]);
  });

  it('BRACKET_MODES expose 5 modes', () => {
    expect(BRACKET_MODES.length).toBe(5);
    expect(BRACKET_MODES).toContain('REALM_BRACKET');
    expect(BRACKET_MODES).toContain('BODY_REALM_BRACKET');
    expect(BRACKET_MODES).toContain('MIXED');
  });

  it('EVENT_ITEM_KINDS có map vào risk group A/B/C/D', () => {
    for (const k of EVENT_ITEM_KINDS) {
      const g = EVENT_ITEM_RISK_GROUP_BY_KIND[k];
      expect(['A', 'B', 'C', 'D']).toContain(g);
    }
    // Group D bị cấm tạo trực tiếp (tier max = 0).
    expect(EVENT_ITEM_DIRECT_CREATE_MAX_TIER_BY_GROUP.D).toBe(0);
    // Group A token / cosmetic ổn ở mọi tier.
    expect(EVENT_ITEM_DIRECT_CREATE_MAX_TIER_BY_GROUP.A).toBeGreaterThanOrEqual(
      9,
    );
  });

  it('PRESET_EVENT_TEMPLATES có ít nhất 30 mẫu (preset rich)', () => {
    expect(PRESET_EVENT_TEMPLATES.length).toBeGreaterThanOrEqual(30);
    expect(findEventTemplate('login_7_days')).toBeDefined();
    expect(findEventTemplate('kim_dan_khai_dao')).toBeDefined();
    expect(findEventTemplate('luyen_dan_dai_hoi')).toBeDefined();
    expect(findEventTemplate('non_existent_template')).toBeUndefined();
  });

  it('EVENT_ERROR_CODES & EVENT_ADMIN_ACTION_TYPES có size hợp lý', () => {
    expect(EVENT_ERROR_CODES.length).toBeGreaterThanOrEqual(20);
    expect(EVENT_ADMIN_ACTION_TYPES.length).toBeGreaterThanOrEqual(15);
    expect(isEventType('LOGIN_EVENT')).toBe(true);
    expect(isEventType('UNKNOWN')).toBe(false);
    expect(isEventErrorCode('EVENT_NOT_FOUND')).toBe(true);
    expect(isEventErrorCode('FOO')).toBe(false);
  });

  it('Các action HIGH risk yêu cầu reason', () => {
    expect(EVENT_ADMIN_ACTION_REQUIRE_REASON.has('EVENT_ACTIVATE')).toBe(true);
    expect(EVENT_ADMIN_ACTION_REQUIRE_REASON.has('EVENT_LOCK_REWARDS')).toBe(true);
    expect(EVENT_ADMIN_ACTION_REQUIRE_REASON.has('EVENT_FINALIZE')).toBe(true);
    expect(EVENT_ADMIN_ACTION_REQUIRE_REASON.has('EVENT_BALANCE_UPSERT')).toBe(true);
    // Update / item upsert chỉ MEDIUM — không bắt reason.
    expect(EVENT_ADMIN_ACTION_REQUIRE_REASON.has('EVENT_UPDATE')).toBe(false);
  });

  it('PAID_REWARD_POLICIES có 3 mode + ranking type catalog ổn định', () => {
    expect(PAID_REWARD_POLICIES.length).toBe(3);
    expect(EVENT_RANKING_TYPES.length).toBeGreaterThanOrEqual(5);
    expect(EVENT_BOSS_TYPES.length).toBeGreaterThanOrEqual(4);
    expect(EVENT_MISSION_TYPES).toContain('LOGIN');
    expect(EVENT_MISSION_TYPES).toContain('KILL_EVENT_BOSS');
    expect(PERSONAL_EVENT_TRIGGER_TYPES).toContain('REALM_REACHED');
    expect(PERSONAL_EVENT_TRIGGER_TYPES).toContain('BODY_REALM_REACHED');
  });

  it('DEFAULT_BRACKETS map realm order → tier theo realm chính', () => {
    expect(DEFAULT_BRACKETS.length).toBeGreaterThanOrEqual(10);
    const lk = DEFAULT_BRACKETS.find((b) => b.bracketKey === 'luyen_khi');
    expect(lk?.bracketTier).toBe(1);
    const kim = DEFAULT_BRACKETS.find((b) => b.bracketKey === 'kim_dan');
    expect(kim?.bracketTier).toBe(3);
    const tien = DEFAULT_BRACKETS.find((b) => b.bracketKey === 'tien_canh');
    expect(tien?.bracketTier).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// PHẦN 16 SHARED TEST 1 — validateEventDef pass
// ---------------------------------------------------------------------------

describe('PHẦN 16.1 — validateEventDef happy path', () => {
  it('event hợp lệ pass validator', () => {
    const now = Date.now();
    const res = validateEventDef({
      key: 'phase_28_demo_event',
      name: 'Demo Event',
      description: 'Mô tả demo.',
      eventType: 'FARM_EVENT',
      status: 'DRAFT',
      startsAt: new Date(now + 10_000),
      endsAt: new Date(now + 7 * 24 * 60 * 60 * 1000),
      bracketMode: 'REALM_BRACKET',
      timezone: 'Asia/Ho_Chi_Minh',
    });
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('reject key xấu / window quá ngắn / type không hợp lệ', () => {
    const now = Date.now();
    const res = validateEventDef({
      key: 'BadKey!',
      name: '',
      eventType: 'NOT_REAL' as unknown as 'FARM_EVENT',
      startsAt: new Date(now + 10_000),
      endsAt: new Date(now + 60_000), // < 5 min
      bracketMode: 'WRONG' as unknown as 'NONE',
      timezone: 'Bad TZ',
    });
    expect(res.ok).toBe(false);
    expect(res.errors.find((e) => e.code === 'EVENT_KEY_INVALID')).toBeTruthy();
    expect(res.errors.find((e) => e.code === 'EVENT_NAME_REQUIRED')).toBeTruthy();
    expect(res.errors.find((e) => e.code === 'EVENT_TYPE_INVALID')).toBeTruthy();
    expect(
      res.errors.find((e) => e.code === 'EVENT_WINDOW_TOO_SHORT'),
    ).toBeTruthy();
    expect(
      res.errors.find((e) => e.code === 'EVENT_BRACKET_MODE_INVALID'),
    ).toBeTruthy();
    expect(
      res.errors.find((e) => e.code === 'EVENT_TIMEZONE_INVALID'),
    ).toBeTruthy();
  });

  it('reject window quá dài (> 120 ngày)', () => {
    const now = Date.now();
    const res = validateEventDef({
      key: 'event_long',
      name: 'Long Event',
      eventType: 'HOLIDAY_EVENT',
      startsAt: new Date(now),
      endsAt: new Date(now + 200 * 24 * 60 * 60 * 1000),
      bracketMode: 'NONE',
    });
    expect(res.errors.find((e) => e.code === 'EVENT_WINDOW_TOO_LONG')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PHẦN 16.2 — validateEventBracket pass + reject tier leak
// ---------------------------------------------------------------------------

describe('PHẦN 16.2 — validateEventBracket', () => {
  it('bracket hợp lệ pass validator', () => {
    const res = validateEventBracket({
      key: 'phase_28_demo__b__kim_dan',
      eventKey: 'phase_28_demo',
      name: 'Kim Đan',
      minRealmOrder: 3,
      maxRealmOrder: 3,
      bracketTier: 3,
      rewardTierMin: 1,
      rewardTierMax: 3,
      eventMaxTier: 3,
      rankingEnabled: true,
      shopFilterTier: 3,
      bossPowerMultiplier: 1.0,
      missionScalingMultiplier: 1.0,
      enabled: true,
    });
    expect(res.ok).toBe(true);
  });

  it('reject reward tier vượt bracket (tier leak)', () => {
    const res = validateEventBracket({
      key: 'event_leak__b',
      eventKey: 'event_leak',
      name: 'Leak',
      minRealmOrder: 1,
      maxRealmOrder: 1,
      bracketTier: 2,
      rewardTierMin: 1,
      rewardTierMax: 9, // T9 cho bracket T2 → leak
      eventMaxTier: 9,
      rankingEnabled: true,
      shopFilterTier: 9,
      bossPowerMultiplier: 1,
      missionScalingMultiplier: 1,
      enabled: true,
    });
    expect(res.ok).toBe(false);
    expect(
      res.errors.find((e) => e.code === 'BRACKET_REWARD_TIER_LEAK'),
    ).toBeTruthy();
  });

  it('reject multiplier không hợp lệ (âm / quá lớn)', () => {
    const res = validateEventBracket({
      key: 'event__b',
      eventKey: 'event',
      name: 'b',
      minRealmOrder: 0,
      maxRealmOrder: 1,
      bracketTier: 1,
      bossPowerMultiplier: 1000,
      missionScalingMultiplier: -1,
    });
    expect(
      res.errors.find((e) => e.code === 'BRACKET_MULTIPLIER_INVALID'),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PHẦN 16.3 — rewardTier = min(playerTier, bracketTier, eventMaxTier)
// ---------------------------------------------------------------------------

describe('PHẦN 16.3 — rewardTier formula', () => {
  it('reward tier = min(player, bracket, event max)', () => {
    expect(computeEffectiveRewardTier(5, 3, 4)).toBe(3);
    expect(computeEffectiveRewardTier(3, 5, 4)).toBe(3);
    expect(computeEffectiveRewardTier(5, 5, 4)).toBe(4);
    expect(computeEffectiveRewardTier(2, 2, 2)).toBe(2);
  });

  it('reward tier clamp [1..9]', () => {
    expect(computeEffectiveRewardTier(0, 0, 0)).toBe(1);
    expect(computeEffectiveRewardTier(100, 100, 100)).toBe(9);
  });

  it('realm tier mapping đồng bộ với drop-economy', () => {
    expect(realmTierForEventBracket(1)).toBe(1);
    expect(realmTierForEventBracket(3)).toBeGreaterThanOrEqual(2);
    expect(realmTierForEventBracket(27)).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// PHẦN 16.4 — event thấp không reward item tier cao
// ---------------------------------------------------------------------------

describe('PHẦN 16.4 — event thấp không reward item tier cao', () => {
  const ctx: EventRewardContext = {
    bracketTier: 2,
    eventMaxTier: 2,
    sourceTier: 2,
    maxAllowedRewardTierDelta: 1,
  };

  it('reward T2 OK trong bracket T2', () => {
    const r: RewardJsonEntry = {
      kind: 'ITEM',
      key: 'material_t2_qi_essence',
      qty: 10,
      itemTier: 2,
    };
    const res = validateEventReward(r, ctx);
    expect(res.ok).toBe(true);
  });

  it('reward T7 reject trong bracket T2', () => {
    const r: RewardJsonEntry = {
      kind: 'ITEM',
      key: 'material_t7_essence',
      qty: 1,
      itemTier: 7,
    };
    const res = validateEventReward(r, ctx);
    expect(res.ok).toBe(false);
    expect(
      res.errors.find((e) => e.code === 'REWARD_TIER_EXCEEDS_BRACKET'),
    ).toBeTruthy();
  });

  it('reward qty vượt cap tier bị reject', () => {
    const r: RewardJsonEntry = {
      kind: 'ITEM',
      key: 'rare_t9_mat',
      qty: 100,
      itemTier: 9,
    };
    const res = validateEventReward(r, {
      ...ctx,
      bracketTier: 9,
      eventMaxTier: 9,
      sourceTier: 9,
    });
    expect(
      res.errors.find((e) => e.code === 'REWARD_QTY_EXCEEDS_TIER_CAP'),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PHẦN 16.5 — event token có cap
// ---------------------------------------------------------------------------

describe('PHẦN 16.5 — event token có cap', () => {
  it('event item TOKEN không khai báo cap nào → reject', () => {
    const res = validateEventItem({
      key: 'token_kim_dan_no_cap',
      name: 'Kim Đan Token',
      description: 'token thiếu cap',
      itemKind: 'EVENT_TOKEN',
      itemTier: 1,
      sourceHint: 'rơi từ event farm',
      maxStack: 99999,
    });
    expect(
      res.errors.find((e) => e.code === 'ITEM_CAP_REQUIRED'),
    ).toBeTruthy();
  });

  it('event token có dailyGainCap → pass', () => {
    const res = validateEventItem({
      key: 'token_kim_dan_with_cap',
      name: 'Kim Đan Token',
      description: 'ok',
      itemKind: 'EVENT_TOKEN',
      itemTier: 1,
      sourceHint: 'rơi từ event farm',
      maxStack: 99999,
      dailyGainCap: 500,
      eventKey: 'phase_28_demo_event',
    });
    expect(res.ok).toBe(true);
  });

  it('balance policy reject token cap vượt hard max', () => {
    const res = validateEventBalancePolicy({
      eventKey: 'evt_demo',
      maxTokenPerDay: EVENT_TOKEN_DAILY_CAP_HARD_MAX + 1,
      maxTokenPerWeek: EVENT_TOKEN_WEEKLY_CAP_HARD_MAX + 1,
      maxTokenPerEvent: EVENT_TOKEN_EVENT_CAP_HARD_MAX + 1,
      maxRareRewardPerDay: 2,
      maxRareRewardPerWeek: 5,
      maxShopRareExchangePerEvent: 5,
      allowHighLevelEnterLowBracket: true,
      highLevelLowBracketTokenPenaltyPercent: 0.5,
      highLevelLowBracketRankingDisabled: true,
      sourceTierRewardCap: 9,
      maxAllowedRewardTierDelta: 1,
      paidRewardPolicy: 'FREE_ONLY',
      enabled: true,
    });
    expect(res.ok).toBe(false);
    const dayErr = res.errors.find(
      (e) =>
        e.code === 'BALANCE_TOKEN_CAP_HARD_MAX' && e.field === 'maxTokenPerDay',
    );
    expect(dayErr).toBeTruthy();
  });

  it('balance policy reject penalty âm / quá lớn', () => {
    const res = validateEventBalancePolicy({
      eventKey: 'evt',
      maxTokenPerDay: 100,
      maxTokenPerWeek: 500,
      maxTokenPerEvent: 2000,
      maxRareRewardPerDay: 1,
      maxRareRewardPerWeek: 3,
      maxShopRareExchangePerEvent: 3,
      allowHighLevelEnterLowBracket: true,
      highLevelLowBracketTokenPenaltyPercent: 1.5, // quá lớn
      highLevelLowBracketRankingDisabled: true,
      sourceTierRewardCap: 5,
      maxAllowedRewardTierDelta: 0,
      paidRewardPolicy: 'FREE_ONLY',
      enabled: true,
    });
    expect(
      res.errors.find((e) => e.code === 'BALANCE_PENALTY_INVALID'),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PHẦN 16.6 — event shop chặn item hiếm vô hạn
// ---------------------------------------------------------------------------

describe('PHẦN 16.6 — shop chặn item hiếm vô hạn', () => {
  const ctx: EventRewardContext = {
    bracketTier: 9,
    eventMaxTier: 9,
    sourceTier: 9,
    maxAllowedRewardTierDelta: 1,
  };

  it('shop item rare (T6+) thiếu limit → reject', () => {
    const res = validateEventShopItem(
      {
        key: 'shop_item_rare_no_limit',
        shopKey: 'shop_demo',
        itemKey: 'rare_t7',
        rewardJson: [
          {
            kind: 'ITEM',
            key: 'rare_t7',
            qty: 1,
            itemTier: 7,
          },
        ],
        priceTokenAmount: 500,
        enabled: true,
      },
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(
      res.errors.find(
        (e) => e.code === 'SHOP_PURCHASE_LIMIT_MISSING_FOR_RARE',
      ),
    ).toBeTruthy();
  });

  it('shop item rare có purchaseLimit → pass', () => {
    const res = validateEventShopItem(
      {
        key: 'shop_item_rare_with_limit',
        shopKey: 'shop_demo',
        itemKey: 'rare_t7',
        rewardJson: [
          {
            kind: 'ITEM',
            key: 'rare_t7',
            qty: 1,
            itemTier: 7,
          },
        ],
        priceTokenAmount: 500,
        purchaseLimitEvent: 1,
        enabled: true,
      },
      ctx,
    );
    expect(res.ok).toBe(true);
  });

  it('shop item price âm bị reject', () => {
    const res = validateEventShopItem(
      {
        key: 'shop_item_bad_price',
        shopKey: 'shop_demo',
        itemKey: 'something',
        rewardJson: [],
        priceTokenAmount: -1,
        enabled: true,
      },
      ctx,
    );
    expect(
      res.errors.find((e) => e.code === 'SHOP_PRICE_INVALID'),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PHẦN 16.7 — event chest loot table chặn endgame item
// ---------------------------------------------------------------------------

describe('PHẦN 16.7 — chest loot table chặn endgame item', () => {
  it('loot table có item tier vượt bracket → reject', () => {
    const ctx: EventRewardContext = {
      bracketTier: 2,
      eventMaxTier: 2,
      sourceTier: 2,
      maxAllowedRewardTierDelta: 0,
    };
    const res = validateEventChestLootTable(
      [
        {
          itemKey: 'leak_mat_t8',
          itemTier: 8,
          weight: 1,
          isRare: true,
          qtyMin: 1,
          qtyMax: 1,
        },
      ],
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(
      res.errors.find((e) => e.code === 'CHEST_LOOT_TIER_LEAK'),
    ).toBeTruthy();
  });

  it('loot table chứa FORBIDDEN_REWARD_ITEM (top pháp bảo) → reject', () => {
    const ctx: EventRewardContext = {
      bracketTier: 9,
      eventMaxTier: 9,
      sourceTier: 9,
      maxAllowedRewardTierDelta: 0,
    };
    const res = validateEventChestLootTable(
      [
        {
          itemKey: 'phap_bao_tien_huyen_kiem',
          itemTier: 8,
          weight: 1,
          isRare: true,
          qtyMin: 1,
          qtyMax: 1,
        },
      ],
      ctx,
    );
    expect(res.ok).toBe(false);
    expect(
      res.errors.find((e) => e.code === 'CHEST_LOOT_FORBIDDEN_ITEM'),
    ).toBeTruthy();
  });

  it('loot table empty / weight zero → reject', () => {
    const ctx: EventRewardContext = {
      bracketTier: 3,
      eventMaxTier: 3,
      sourceTier: 3,
    };
    const empty = validateEventChestLootTable([], ctx);
    expect(empty.ok).toBe(false);
    const zero = validateEventChestLootTable(
      [
        {
          itemKey: 'a',
          itemTier: 2,
          weight: 0,
          isRare: false,
          qtyMin: 1,
          qtyMax: 1,
        },
      ],
      ctx,
    );
    expect(zero.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PHẦN 16.8 — ranking thi đấu bắt buộc bracket nếu eventType cần bracket
// ---------------------------------------------------------------------------

describe('PHẦN 16.8 — ranking competitive event bắt buộc bracket', () => {
  it('BOSS_EVENT ranking phải bracketMode != NONE', () => {
    const res = validateEventRanking({
      key: 'rk_bad',
      eventType: 'BOSS_EVENT',
      rankingType: 'BOSS_DAMAGE',
      bracketMode: 'NONE',
      scoreFormulaKey: 'damage_normalized_v1',
    });
    expect(res.ok).toBe(false);
    expect(
      res.errors.find((e) => e.code === 'RANKING_BRACKET_REQUIRED'),
    ).toBeTruthy();
  });

  it('TOWER_EVENT ranking với REALM_BRACKET pass', () => {
    const res = validateEventRanking({
      key: 'rk_tower',
      eventType: 'TOWER_EVENT',
      rankingType: 'TOWER_FLOOR',
      bracketMode: 'REALM_BRACKET',
      scoreFormulaKey: 'tower_floor_v1',
    });
    expect(res.ok).toBe(true);
  });

  it('LOGIN_EVENT ranking có thể NONE (login không phải competitive)', () => {
    const res = validateEventRanking({
      key: 'rk_login',
      eventType: 'LOGIN_EVENT',
      rankingType: 'EVENT_SCORE',
      bracketMode: 'NONE',
      scoreFormulaKey: 'login_streak_v1',
    });
    expect(res.ok).toBe(true);
  });

  it('event type ranking-required catalog đủ', () => {
    for (const t of [
      'BOSS_EVENT',
      'WORLD_BOSS_EVENT',
      'TOWER_EVENT',
      'ALCHEMY_EVENT',
      'ARTIFACT_EVENT',
      'DUNGEON_EVENT',
      'SECT_EVENT',
    ] as const) {
      expect(EVENT_TYPES_REQUIRE_BRACKET_RANKING.has(t)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// PHẦN 16.9 — high-level player vào low bracket không được ranking
// ---------------------------------------------------------------------------

describe('PHẦN 16.9 — high-level low-bracket guard', () => {
  it('isHighLevelInLowBracket nhận diện đúng', () => {
    expect(isHighLevelInLowBracket(5, 1)).toBe(true); // Hóa Thần vào Luyện Khí
    expect(isHighLevelInLowBracket(1, 1)).toBe(false); // cùng bracket
    expect(isHighLevelInLowBracket(2, 3)).toBe(false); // player thấp hơn
  });

  it('computeTokenPenaltyMultiplier áp penalty mặc định 50%', () => {
    const m = computeTokenPenaltyMultiplier(
      5,
      1,
      EVENT_HIGH_LEVEL_TOKEN_PENALTY_DEFAULT,
    );
    expect(m).toBeCloseTo(1 - 0.5);
  });

  it('không penalty nếu cùng bracket', () => {
    const m = computeTokenPenaltyMultiplier(1, 1, 0.5);
    expect(m).toBe(1);
  });

  it('penalty bị clamp 0..0.95', () => {
    const m = computeTokenPenaltyMultiplier(5, 1, 5);
    expect(m).toBeCloseTo(0.05);
  });

  it('resolveBracketForPlayer trả bracket phù hợp realm order', () => {
    const brackets: EventBracketDef[] = [
      {
        key: 'b1',
        eventKey: 'evt',
        name: 'Luyện Khí',
        minRealmOrder: 1,
        maxRealmOrder: 1,
        bracketTier: 1,
        rewardTierMin: 1,
        rewardTierMax: 1,
        eventMaxTier: 1,
        rankingEnabled: true,
        shopFilterTier: 1,
        bossPowerMultiplier: 1,
        missionScalingMultiplier: 1,
        enabled: true,
      },
      {
        key: 'b2',
        eventKey: 'evt',
        name: 'Kim Đan',
        minRealmOrder: 3,
        maxRealmOrder: 3,
        bracketTier: 3,
        rewardTierMin: 2,
        rewardTierMax: 3,
        eventMaxTier: 3,
        rankingEnabled: true,
        shopFilterTier: 3,
        bossPowerMultiplier: 1,
        missionScalingMultiplier: 1,
        enabled: true,
      },
    ];
    expect(resolveBracketForPlayer(brackets, 1)?.key).toBe('b1');
    expect(resolveBracketForPlayer(brackets, 3)?.key).toBe('b2');
    // Player Hóa Thần (5) không có bracket nào → null
    expect(resolveBracketForPlayer(brackets, 5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PHẦN 16.10 — personal milestone event trigger đúng
// ---------------------------------------------------------------------------

describe('PHẦN 16.10 — personal milestone event trigger', () => {
  it('validateEventPersonalMilestone pass với realm trigger', () => {
    const res = validateEventPersonalMilestone({
      key: 'milestone_kim_dan',
      name: 'Kim Đan Khai Đạo',
      description: 'Bạn vừa đạt Kim Đan!',
      triggerType: 'REALM_REACHED',
      triggerValue: 3,
      durationDays: 10,
      bracketTier: 3,
      enabled: true,
    });
    expect(res.ok).toBe(true);
  });

  it('reject duration âm / quá dài', () => {
    const r1 = validateEventPersonalMilestone({
      key: 'milestone_bad',
      triggerType: 'REALM_REACHED',
      triggerValue: 3,
      durationDays: 0,
      bracketTier: 3,
    });
    expect(
      r1.errors.find((e) => e.code === 'PERSONAL_DURATION_INVALID'),
    ).toBeTruthy();

    const r2 = validateEventPersonalMilestone({
      key: 'milestone_bad2',
      triggerType: 'REALM_REACHED',
      triggerValue: 3,
      durationDays: 365,
      bracketTier: 3,
    });
    expect(
      r2.errors.find((e) => e.code === 'PERSONAL_DURATION_INVALID'),
    ).toBeTruthy();
  });

  it('reject trigger type không hợp lệ', () => {
    const res = validateEventPersonalMilestone({
      key: 'milestone_bad_trigger',
      triggerType: 'GHOST_TRIGGER' as unknown as 'REALM_REACHED',
      triggerValue: 3,
      durationDays: 7,
      bracketTier: 3,
    });
    expect(
      res.errors.find((e) => e.code === 'PERSONAL_TRIGGER_INVALID'),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Item validator — Group D forbidden
// ---------------------------------------------------------------------------

describe('Phase 28.0 — Group D item kind bị cấm tạo', () => {
  it('Group C item tier cao reject ở môi trường mặc định', () => {
    const res = validateEventItem({
      key: 'method_event_top_a',
      name: 'Top Method',
      description: 'reject vì group C tier cao',
      itemKind: 'METHOD_FRAGMENT',
      itemTier: 9,
      sourceHint: 'event',
      maxStack: 1,
    });
    expect(res.ok).toBe(false);
    expect(
      res.errors.find((e) => e.code === 'ITEM_TIER_TOO_HIGH_FOR_GROUP'),
    ).toBeTruthy();
  });

  it('cosmetic group A tier cao vẫn pass', () => {
    const res = validateEventItem({
      key: 'cosmetic_tien_canh',
      name: 'Cosmetic',
      description: 'frame tien canh',
      itemKind: 'EVENT_FRAME',
      itemTier: 9,
      sourceHint: 'event',
      maxStack: 1,
    });
    expect(res.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reward currency / item forbidden checks
// ---------------------------------------------------------------------------

describe('Phase 28.0 — reward forbidden currency / item', () => {
  const ctx: EventRewardContext = {
    bracketTier: 9,
    eventMaxTier: 9,
    sourceTier: 9,
    maxAllowedRewardTierDelta: 1,
  };

  it('TIEN_NGOC currency bị reject', () => {
    const r: RewardJsonEntry = {
      kind: 'CURRENCY',
      key: 'TIEN_NGOC',
      qty: 100,
    };
    const res = validateEventReward(r, ctx);
    expect(
      res.errors.find((e) => e.code === 'REWARD_FORBIDDEN_CURRENCY'),
    ).toBeTruthy();
  });

  it('ADMIN_FORBIDDEN_GRANT_ITEMS bị reject ở reward', () => {
    const r: RewardJsonEntry = {
      kind: 'ITEM',
      key: 'phap_bao_tien_huyen_kiem',
      qty: 1,
      itemTier: 9,
    };
    const res = validateEventReward(r, ctx);
    expect(
      res.errors.find((e) => e.code === 'REWARD_FORBIDDEN_ITEM'),
    ).toBeTruthy();
  });

  it('paid policy PAID_COSMETIC chặn reward không phải cosmetic', () => {
    const r: RewardJsonEntry = {
      kind: 'ITEM',
      key: 'mat_t3',
      qty: 1,
      itemTier: 3,
    };
    const res = validateEventReward(r, {
      ...ctx,
      paidRewardPolicy: 'PAID_COSMETIC',
    });
    expect(
      res.errors.find((e) => e.code === 'REWARD_FORBIDDEN_ITEM'),
    ).toBeTruthy();
  });

  it('validateEventRewardList aggregate errors', () => {
    const list: RewardJsonEntry[] = [
      { kind: 'ITEM', key: 'phap_bao_tien_huyen_kiem', qty: 1, itemTier: 9 },
      { kind: 'CURRENCY', key: 'TIEN_NGOC', qty: 1000 },
      { kind: 'ITEM', key: 'mat_ok', qty: 1, itemTier: 9 },
    ];
    const res = validateEventRewardList(list, ctx);
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Score normalization
// ---------------------------------------------------------------------------

describe('Phase 28.0 — computeScoreNormalization', () => {
  it('cùng tier = 100', () => {
    expect(computeScoreNormalization(3, 3)).toBe(100);
  });
  it('thấp 1 tier = 50', () => {
    expect(computeScoreNormalization(2, 3)).toBe(50);
  });
  it('thấp 2 tier = 10', () => {
    expect(computeScoreNormalization(1, 3)).toBe(10);
  });
  it('thấp ≥ 3 tier = 0', () => {
    expect(computeScoreNormalization(1, 5)).toBe(0);
  });
  it('cao 1 tier = 30', () => {
    expect(computeScoreNormalization(4, 3)).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Default balance policy
// ---------------------------------------------------------------------------

describe('Phase 28.0 — defaultEventBalancePolicy', () => {
  it('factory trả policy hợp lệ', () => {
    const p = defaultEventBalancePolicy('evt_demo');
    expect(p.eventKey).toBe('evt_demo');
    expect(p.maxTokenPerDay).toBeGreaterThan(0);
    expect(p.maxAllowedRewardTierDelta).toBe(EVENT_MAX_REWARD_TIER_DELTA_DEFAULT);
    expect(p.highLevelLowBracketRankingDisabled).toBe(true);
    const v = validateEventBalancePolicy(p);
    expect(v.ok).toBe(true);
  });

  it('override fields qua options', () => {
    const p = defaultEventBalancePolicy('evt_demo', {
      paidRewardPolicy: 'PAID_TIER_CAP',
      maxAllowedRewardTierDelta: 0,
    });
    expect(p.paidRewardPolicy).toBe('PAID_TIER_CAP');
    expect(p.maxAllowedRewardTierDelta).toBe(0);
  });

  it('delta vượt hard max → invalid', () => {
    const p = defaultEventBalancePolicy('evt', {
      maxAllowedRewardTierDelta: EVENT_MAX_REWARD_TIER_DELTA_HARD_MAX + 1,
    });
    const v = validateEventBalancePolicy(p);
    expect(v.ok).toBe(false);
    expect(
      v.errors.find((e) => e.code === 'BALANCE_DELTA_INVALID'),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Mission + boss + shop validator
// ---------------------------------------------------------------------------

describe('Phase 28.0 — mission / boss / shop validator', () => {
  it('mission target value > 0 yêu cầu', () => {
    const res = validateEventMission({
      key: 'mission_bad',
      eventKey: 'evt',
      missionType: 'FARM_MINUTES',
      targetValue: 0,
      resetType: 'DAILY',
    });
    expect(
      res.errors.find((e) => e.code === 'MISSION_TARGET_INVALID'),
    ).toBeTruthy();
  });

  it('boss tier > sourceTier + delta → reject', () => {
    const res = validateEventBoss({
      key: 'boss_leak',
      eventKey: 'evt',
      bossType: 'BRACKET_EVENT_BOSS',
      sourceTier: 3,
      bossTier: 7,
      dailyAttempts: 3,
    });
    expect(res.ok).toBe(false);
    expect(res.errors.find((e) => e.code === 'BOSS_TIER_INVALID')).toBeTruthy();
  });

  it('shop window invalid bị reject', () => {
    const now = Date.now();
    const res = validateEventShop({
      key: 'shop_bad',
      eventKey: 'evt',
      name: 'shop',
      tokenCurrencyKey: 'token_kim_dan',
      startsAt: new Date(now + 1000),
      endsAt: new Date(now), // end < start
      enabled: true,
    });
    expect(res.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EVENT_KEY_PATTERN catalog invariant
// ---------------------------------------------------------------------------

describe('Phase 28.0 — EVENT_KEY_PATTERN', () => {
  it('cho phép a-z 0-9 _ -', () => {
    expect(EVENT_KEY_PATTERN.test('hello_event_v1')).toBe(true);
    expect(EVENT_KEY_PATTERN.test('kim-dan-khai-dao')).toBe(true);
  });
  it('reject hoa, ký tự đặc biệt, khoảng trắng, quá ngắn / dài', () => {
    expect(EVENT_KEY_PATTERN.test('Bad')).toBe(false);
    expect(EVENT_KEY_PATTERN.test('a')).toBe(false);
    expect(EVENT_KEY_PATTERN.test('a!b')).toBe(false);
    expect(EVENT_KEY_PATTERN.test('a b')).toBe(false);
    expect(EVENT_KEY_PATTERN.test('a'.repeat(80))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// publicEventSummary
// ---------------------------------------------------------------------------

describe('Phase 28.0 — publicEventSummary', () => {
  it('strip nội bộ admin + compute effective tier khi có context', () => {
    const now = Date.now();
    const e: EventDef = {
      key: 'demo_event_summary',
      name: 'Demo',
      description: 'desc',
      eventType: 'FARM_EVENT',
      status: 'ACTIVE',
      startsAt: new Date(now - 60_000),
      endsAt: new Date(now + 5 * 60 * 60 * 1000),
      timezone: 'Asia/Ho_Chi_Minh',
      enabled: true,
      bracketMode: 'REALM_BRACKET',
      adminNote: 'internal',
      createdBy: 'admin1',
      updatedBy: 'admin1',
    };
    const s = publicEventSummary(
      e,
      { bracketKey: 'kim_dan', bracketTier: 3, playerTier: 5 },
      now,
    );
    expect((s as unknown as Record<string, unknown>).adminNote).toBeUndefined();
    expect(s.myEffectiveRewardTier).toBe(3); // min(5,3,9)
    expect(s.msRemaining).toBeGreaterThan(0);
  });
});
