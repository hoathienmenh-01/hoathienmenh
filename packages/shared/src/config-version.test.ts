import { describe, it, expect } from 'vitest';
import {
  CONFIG_ROLLBACK_CONFIRM_PHRASE,
  CONFIG_ROLLBACK_SAFETY_LEVELS,
  CONFIG_ROLLBACK_STATUSES,
  CONFIG_VERSION_ACTIONS,
  CONFIG_VERSION_ENTITY_TYPES,
  computeRollbackSafety,
  diffSnapshots,
  isConfigRollbackSafetyLevel,
  isConfigRollbackStatus,
  isConfigVersionAction,
  isConfigVersionEntityType,
  isSecretLikeKey,
  sanitizeSnapshot,
} from './config-version';

describe('config-version: enum validators', () => {
  it('isConfigVersionEntityType true cho 4 entity types đã khai báo', () => {
    for (const t of CONFIG_VERSION_ENTITY_TYPES) {
      expect(isConfigVersionEntityType(t)).toBe(true);
    }
  });

  it('isConfigVersionEntityType false cho string lạ', () => {
    expect(isConfigVersionEntityType('UNKNOWN_ENTITY')).toBe(false);
    expect(isConfigVersionEntityType('feature_flag')).toBe(false);
    expect(isConfigVersionEntityType('')).toBe(false);
  });

  it('isConfigVersionAction true cho 6 action types', () => {
    for (const a of CONFIG_VERSION_ACTIONS) {
      expect(isConfigVersionAction(a)).toBe(true);
    }
    expect(CONFIG_VERSION_ACTIONS).toContain('CREATE');
    expect(CONFIG_VERSION_ACTIONS).toContain('UPDATE');
    expect(CONFIG_VERSION_ACTIONS).toContain('DISABLE');
    expect(CONFIG_VERSION_ACTIONS).toContain('ENABLE');
    expect(CONFIG_VERSION_ACTIONS).toContain('STATUS_RECOMPUTE');
    expect(CONFIG_VERSION_ACTIONS).toContain('ROLLBACK');
  });

  it('isConfigVersionAction false cho string lạ', () => {
    expect(isConfigVersionAction('PATCH')).toBe(false);
    expect(isConfigVersionAction('rollback')).toBe(false);
  });

  it('isConfigRollbackSafetyLevel covers SAFE/NEED_CONFIRM/BLOCKED', () => {
    for (const lvl of CONFIG_ROLLBACK_SAFETY_LEVELS) {
      expect(isConfigRollbackSafetyLevel(lvl)).toBe(true);
    }
    expect(isConfigRollbackSafetyLevel('UNKNOWN')).toBe(false);
  });

  it('isConfigRollbackStatus covers DRY_RUN/APPLIED/BLOCKED/FAILED', () => {
    for (const s of CONFIG_ROLLBACK_STATUSES) {
      expect(isConfigRollbackStatus(s)).toBe(true);
    }
    expect(isConfigRollbackStatus('OK')).toBe(false);
  });
});

describe('config-version: sanitizeSnapshot', () => {
  it('strip giá trị các key chứa password/secret/token/cookie/apiKey', () => {
    const snap = {
      key: 'flag1',
      enabled: true,
      password: 'super-secret',
      adminToken: 'tok-123',
      sessionCookie: 'cookie-xyz',
      apiKey: 'key-abc',
      api_key: 'key-snake',
      privateKey: 'pk-1',
      access_key: 'akid',
      sessionid: 'sid-1',
      meta: { nested_token: 't', value: 1 },
    };
    const out = sanitizeSnapshot(snap);
    expect(out.password).toBe('[REDACTED]');
    expect(out.adminToken).toBe('[REDACTED]');
    expect(out.sessionCookie).toBe('[REDACTED]');
    expect(out.apiKey).toBe('[REDACTED]');
    expect(out.api_key).toBe('[REDACTED]');
    expect(out.privateKey).toBe('[REDACTED]');
    expect(out.access_key).toBe('[REDACTED]');
    expect(out.sessionid).toBe('[REDACTED]');
    // Field gốc giữ nguyên
    expect(out.key).toBe('flag1');
    expect(out.enabled).toBe(true);
    // Recursive
    const nested = out.meta as Record<string, unknown>;
    expect(nested.nested_token).toBe('[REDACTED]');
    expect(nested.value).toBe(1);
    // Outer key matching secret pattern is also redacted as scalar value.
    const snapWithSecretKey = sanitizeSnapshot({ nestedSecret: { x: 1 } });
    expect(snapWithSecretKey.nestedSecret).toBe('[REDACTED]');
  });

  it('isSecretLikeKey case-insensitive + variant naming', () => {
    expect(isSecretLikeKey('PASSWORD')).toBe(true);
    expect(isSecretLikeKey('userPassword')).toBe(true);
    expect(isSecretLikeKey('refresh_token')).toBe(true);
    expect(isSecretLikeKey('api-key')).toBe(true);
    expect(isSecretLikeKey('username')).toBe(false);
    expect(isSecretLikeKey('id')).toBe(false);
  });

  it('không mutate input snapshot', () => {
    const snap = { password: 'plain', n: 1 } as const;
    const out = sanitizeSnapshot(snap);
    expect(snap.password).toBe('plain');
    expect(out.password).toBe('[REDACTED]');
  });
});

describe('config-version: diffSnapshots', () => {
  it('thay đổi top-level field → entry với before/after', () => {
    const a = { x: 1, y: 'a', z: true };
    const b = { x: 2, y: 'a', z: false };
    const d = diffSnapshots(a, b);
    expect(d).toEqual({
      x: { before: 1, after: 2 },
      z: { before: true, after: false },
    });
  });

  it('field chỉ trên một bên → entry với before|after null', () => {
    const a = { x: 1 };
    const b = { y: 2 };
    const d = diffSnapshots(a, b);
    expect(d.x).toEqual({ before: 1, after: null });
    expect(d.y).toEqual({ before: null, after: 2 });
  });

  it('null snapshot → coi như object rỗng', () => {
    const d = diffSnapshots(null, { a: 1 });
    expect(d.a).toEqual({ before: null, after: 1 });
  });

  it('nested object equal → không entry', () => {
    const a = { configJson: { multiplier: 2, items: [1, 2] } };
    const b = { configJson: { multiplier: 2, items: [1, 2] } };
    expect(diffSnapshots(a, b)).toEqual({});
  });

  it('nested object khác → entry với toàn nested object', () => {
    const a = { configJson: { multiplier: 2 } };
    const b = { configJson: { multiplier: 3 } };
    const d = diffSnapshots(a, b);
    expect(d.configJson).toEqual({
      before: { multiplier: 2 },
      after: { multiplier: 3 },
    });
  });
});

describe('config-version: computeRollbackSafety FEATURE_FLAG', () => {
  it('SAFE cho flag thường', () => {
    const result = computeRollbackSafety(
      'FEATURE_FLAG',
      { key: 'ARENA_ENABLED', enabled: true },
      { key: 'ARENA_ENABLED', enabled: false },
    );
    expect(result.level).toBe('SAFE');
    expect(result.warnings).toEqual([]);
    expect(result.requiresConfirm).toBe(false);
  });

  it('NEED_CONFIRM cho critical flag (default list)', () => {
    const result = computeRollbackSafety(
      'FEATURE_FLAG',
      { key: 'MARKET_ENABLED', enabled: false },
      { key: 'MARKET_ENABLED', enabled: true },
    );
    expect(result.level).toBe('NEED_CONFIRM');
    expect(result.requiresConfirm).toBe(true);
    expect(result.confirmPhrase).toBe(CONFIG_ROLLBACK_CONFIRM_PHRASE);
    expect(result.warnings).toContain('rollback.warning.featureFlagCritical');
  });

  it('NEED_CONFIRM nếu key match override criticalFeatureFlagKeys', () => {
    const result = computeRollbackSafety(
      'FEATURE_FLAG',
      { key: 'CUSTOM_FLAG', enabled: true },
      null,
      { criticalFeatureFlagKeys: ['CUSTOM_FLAG'] },
    );
    expect(result.level).toBe('NEED_CONFIRM');
  });
});

describe('config-version: computeRollbackSafety LIVEOPS_ANNOUNCEMENT', () => {
  it('SAFE rollback title/message', () => {
    const result = computeRollbackSafety(
      'LIVEOPS_ANNOUNCEMENT',
      {
        key: 'a1',
        status: 'SCHEDULED',
        titleVi: 'old',
        endsAt: new Date('2099-01-01').toISOString(),
      },
      {
        key: 'a1',
        status: 'SCHEDULED',
        titleVi: 'new',
        endsAt: new Date('2099-01-01').toISOString(),
      },
    );
    expect(result.level).toBe('SAFE');
  });

  it('BLOCKED rollback về ACTIVE nhưng endsAt đã qua', () => {
    const past = new Date('2020-01-01').toISOString();
    const result = computeRollbackSafety(
      'LIVEOPS_ANNOUNCEMENT',
      { key: 'a1', status: 'ACTIVE', endsAt: past },
      { key: 'a1', status: 'ENDED', endsAt: past },
      { now: new Date('2025-01-01') },
    );
    expect(result.level).toBe('BLOCKED');
    expect(result.warnings).toContain(
      'rollback.warning.announcementEnded',
    );
  });
});

describe('config-version: computeRollbackSafety MAINTENANCE_WINDOW', () => {
  it('SAFE rollback INFO + ALL_PLAYERS không đang active', () => {
    const result = computeRollbackSafety(
      'MAINTENANCE_WINDOW',
      {
        key: 'm1',
        severity: 'INFO',
        target: 'ALL_PLAYERS',
        status: 'SCHEDULED',
        allowAdminBypass: true,
      },
      {
        key: 'm1',
        severity: 'INFO',
        target: 'ALL_PLAYERS',
        status: 'DRAFT',
        allowAdminBypass: true,
      },
    );
    expect(result.level).toBe('SAFE');
  });

  it('NEED_CONFIRM rollback CRITICAL', () => {
    const result = computeRollbackSafety(
      'MAINTENANCE_WINDOW',
      {
        key: 'm1',
        severity: 'CRITICAL',
        target: 'ALL_PLAYERS',
        status: 'SCHEDULED',
        allowAdminBypass: true,
      },
      {
        key: 'm1',
        severity: 'INFO',
        target: 'ALL_PLAYERS',
        status: 'SCHEDULED',
        allowAdminBypass: true,
      },
    );
    expect(result.level).toBe('NEED_CONFIRM');
    expect(result.warnings).toContain(
      'rollback.warning.maintenanceCritical',
    );
  });

  it('NEED_CONFIRM rollback FULL_LOCKDOWN', () => {
    const result = computeRollbackSafety(
      'MAINTENANCE_WINDOW',
      {
        key: 'm1',
        severity: 'WARNING',
        target: 'FULL_LOCKDOWN',
        status: 'SCHEDULED',
        allowAdminBypass: true,
      },
      null,
    );
    expect(result.level).toBe('NEED_CONFIRM');
  });

  it('BLOCKED nếu target snapshot allowAdminBypass=false (lock out admin)', () => {
    const result = computeRollbackSafety(
      'MAINTENANCE_WINDOW',
      {
        key: 'm1',
        severity: 'WARNING',
        target: 'ALL_PLAYERS',
        status: 'SCHEDULED',
        allowAdminBypass: false,
      },
      null,
    );
    expect(result.level).toBe('BLOCKED');
    expect(result.warnings).toContain(
      'rollback.warning.maintenanceLocksOutAdmin',
    );
  });

  it('NEED_CONFIRM với warning current ACTIVE khi đang bị maintenance', () => {
    const result = computeRollbackSafety(
      'MAINTENANCE_WINDOW',
      {
        key: 'm1',
        severity: 'INFO',
        target: 'ALL_PLAYERS',
        status: 'SCHEDULED',
        allowAdminBypass: true,
      },
      {
        key: 'm1',
        severity: 'WARNING',
        target: 'ALL_PLAYERS',
        status: 'ACTIVE',
        allowAdminBypass: true,
      },
    );
    expect(result.level).toBe('NEED_CONFIRM');
    expect(result.warnings).toContain(
      'rollback.warning.maintenanceCurrentlyActive',
    );
  });
});

describe('config-version: computeRollbackSafety LIVEOPS_EVENT', () => {
  const futureEnd = new Date('2099-01-01').toISOString();

  it('SAFE rollback config khi chưa có claim', () => {
    const result = computeRollbackSafety(
      'LIVEOPS_EVENT',
      {
        key: 'e1',
        type: 'CULTIVATION_EXP_BOOST',
        status: 'SCHEDULED',
        endsAt: futureEnd,
        configJson: { multiplier: 1.5 },
      },
      {
        key: 'e1',
        type: 'CULTIVATION_EXP_BOOST',
        status: 'SCHEDULED',
        endsAt: futureEnd,
        configJson: { multiplier: 1.8 },
      },
      { liveOpsEventClaimCount: 0, liveOpsEventTypeMultiplierMax: 2.0 },
    );
    expect(result.level).toBe('SAFE');
  });

  it('BLOCKED nếu rollback FESTIVAL_GIFT rewardJson sau khi đã có claim', () => {
    const result = computeRollbackSafety(
      'LIVEOPS_EVENT',
      {
        key: 'fg',
        type: 'FESTIVAL_GIFT',
        status: 'ACTIVE',
        endsAt: futureEnd,
        configJson: { rewardJson: { linhThach: 100 } },
      },
      {
        key: 'fg',
        type: 'FESTIVAL_GIFT',
        status: 'ACTIVE',
        endsAt: futureEnd,
        configJson: { rewardJson: { linhThach: 50 } },
      },
      { liveOpsEventClaimCount: 5 },
    );
    expect(result.level).toBe('BLOCKED');
    expect(result.warnings).toContain(
      'rollback.warning.festivalGiftRewardChanged',
    );
  });

  it('SAFE nếu rollback FESTIVAL_GIFT KHÔNG đụng rewardJson + chưa có claim', () => {
    const result = computeRollbackSafety(
      'LIVEOPS_EVENT',
      {
        key: 'fg',
        type: 'FESTIVAL_GIFT',
        status: 'SCHEDULED',
        endsAt: futureEnd,
        configJson: { rewardJson: { linhThach: 100 } },
      },
      {
        key: 'fg',
        type: 'FESTIVAL_GIFT',
        status: 'SCHEDULED',
        endsAt: futureEnd,
        configJson: { rewardJson: { linhThach: 100 } },
      },
      { liveOpsEventClaimCount: 0 },
    );
    expect(result.level).toBe('SAFE');
  });

  it('BLOCKED nếu multiplier vượt cap', () => {
    const result = computeRollbackSafety(
      'LIVEOPS_EVENT',
      {
        key: 'b1',
        type: 'BOSS_REWARD_BOOST',
        status: 'SCHEDULED',
        endsAt: futureEnd,
        configJson: { multiplier: 5.0 },
      },
      null,
      { liveOpsEventClaimCount: 0, liveOpsEventTypeMultiplierMax: 2.0 },
    );
    expect(result.level).toBe('BLOCKED');
    expect(result.warnings).toContain(
      'rollback.warning.eventMultiplierOverCap',
    );
  });

  it('BLOCKED rollback về ACTIVE khi endsAt đã qua', () => {
    const past = new Date('2020-01-01').toISOString();
    const result = computeRollbackSafety(
      'LIVEOPS_EVENT',
      {
        key: 'e1',
        type: 'BOSS_REWARD_BOOST',
        status: 'ACTIVE',
        endsAt: past,
        configJson: { multiplier: 1.5 },
      },
      null,
      {
        liveOpsEventClaimCount: 0,
        liveOpsEventTypeMultiplierMax: 2.0,
        now: new Date('2025-01-01'),
      },
    );
    expect(result.level).toBe('BLOCKED');
    expect(result.warnings).toContain('rollback.warning.eventEnded');
  });

  it('NEED_CONFIRM nếu rollback đổi status sau khi đã có claim', () => {
    const result = computeRollbackSafety(
      'LIVEOPS_EVENT',
      {
        key: 'e1',
        type: 'CULTIVATION_EXP_BOOST',
        status: 'SCHEDULED',
        endsAt: futureEnd,
        configJson: { multiplier: 1.5 },
      },
      {
        key: 'e1',
        type: 'CULTIVATION_EXP_BOOST',
        status: 'DISABLED',
        endsAt: futureEnd,
        configJson: { multiplier: 1.5 },
      },
      { liveOpsEventClaimCount: 3, liveOpsEventTypeMultiplierMax: 2.0 },
    );
    expect(result.level).toBe('NEED_CONFIRM');
    expect(result.warnings).toContain(
      'rollback.warning.eventStatusChangeAfterClaims',
    );
  });
});
