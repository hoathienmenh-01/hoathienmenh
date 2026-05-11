import { describe, it, expect } from 'vitest';
import {
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_POLICY_KEYS,
  RATE_LIMIT_SCOPES,
  RATE_LIMIT_SEVERITIES,
  SENSITIVE_RATE_LIMIT_POLICIES,
  buildAbuseBlockKey,
  buildRateLimitKey,
  getRateLimitPolicy,
  getRateLimitPolicyGroup,
  isRateLimitPolicyKey,
  isRateLimitScope,
  isRateLimitSeverity,
  isSensitivePolicy,
  normalizeRateLimitSubject,
  validateRateLimitPolicy,
} from './security-rate-limit';

describe('Phase 18.1 — security rate-limit policy catalog', () => {
  it('mọi policy key đều có entry catalog tương ứng', () => {
    for (const key of RATE_LIMIT_POLICY_KEYS) {
      const p = RATE_LIMIT_POLICIES[key];
      expect(p).toBeDefined();
      expect(p.key).toBe(key);
    }
  });

  it('không key trùng + không entry catalog thừa', () => {
    expect(new Set(RATE_LIMIT_POLICY_KEYS).size).toBe(
      RATE_LIMIT_POLICY_KEYS.length,
    );
    const catalogKeys = Object.keys(RATE_LIMIT_POLICIES);
    expect(catalogKeys.sort()).toEqual([...RATE_LIMIT_POLICY_KEYS].sort());
  });

  it('mọi policy đều pass validateRateLimitPolicy', () => {
    for (const key of RATE_LIMIT_POLICY_KEYS) {
      const issues = validateRateLimitPolicy(RATE_LIMIT_POLICIES[key]);
      expect(issues, `${key} issues=${JSON.stringify(issues)}`).toEqual([]);
    }
  });

  it('validateRateLimitPolicy phát hiện tham số không hợp lệ', () => {
    const bad = validateRateLimitPolicy({
      key: 'AUTH_LOGIN',
      windowSec: 0,
      maxRequests: 0,
      blockSec: -1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      scope: 'BAD' as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      severity: 'BAD' as any,
      sensitive: false,
      descriptionVi: '',
      descriptionEn: '',
    });
    expect(bad.length).toBeGreaterThanOrEqual(5);
  });

  it('validateRateLimitPolicy reject maxRequests quá cao (~tắt rate-limit)', () => {
    const bad = validateRateLimitPolicy({
      key: 'PUBLIC_READ',
      windowSec: 60,
      maxRequests: 1_000_000,
      blockSec: 0,
      scope: 'IP',
      severity: 'LOW',
      sensitive: false,
      descriptionVi: '',
      descriptionEn: '',
    });
    expect(bad.find((i) => i.field === 'maxRequests')).toBeTruthy();
  });

  it('validateRateLimitPolicy reject blockSec > 24h (ban vĩnh viễn lén)', () => {
    const bad = validateRateLimitPolicy({
      key: 'AUTH_LOGIN',
      windowSec: 60,
      maxRequests: 10,
      blockSec: 48 * 60 * 60,
      scope: 'IP',
      severity: 'HIGH',
      sensitive: true,
      descriptionVi: '',
      descriptionEn: '',
    });
    expect(bad.find((i) => i.field === 'blockSec')).toBeTruthy();
  });

  it('SENSITIVE_RATE_LIMIT_POLICIES bao gồm tất cả auth/topup/admin mutation', () => {
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('AUTH_LOGIN');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('AUTH_REGISTER');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('AUTH_REFRESH');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('AUTH_PASSWORD_RESET');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('SHOP_BUY');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('SECT_SHOP_BUY');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('MARKET_CREATE_LISTING');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('MARKET_BUY');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('DAILY_LOGIN_CLAIM');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('DUNGEON_CLAIM');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('LIVEOPS_GIFT_CLAIM');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('TOPUP_CREATE_ORDER');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('ADMIN_MUTATION');
  });

  it('Phase 19.1.B — SENSITIVE bao gồm mọi social/chat mutation', () => {
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('SOCIAL_FRIEND_REQUEST');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('SOCIAL_BLOCK_TOGGLE');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('CHAT_PRIVATE_SEND');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('CHAT_GROUP_SEND');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('CHAT_GROUP_CREATE');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).toContain('CHAT_GROUP_MEMBER_ADD');
  });

  it('SENSITIVE_RATE_LIMIT_POLICIES không bao gồm public read/default/admin report view', () => {
    expect(SENSITIVE_RATE_LIMIT_POLICIES).not.toContain('PUBLIC_READ');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).not.toContain('DEFAULT_API');
    expect(SENSITIVE_RATE_LIMIT_POLICIES).not.toContain('ADMIN_REPORT_VIEW');
  });

  it('isSensitivePolicy parity với SENSITIVE_RATE_LIMIT_POLICIES', () => {
    for (const key of RATE_LIMIT_POLICY_KEYS) {
      expect(isSensitivePolicy(key)).toBe(
        SENSITIVE_RATE_LIMIT_POLICIES.includes(key),
      );
    }
  });

  it('getRateLimitPolicy throw khi key unknown', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getRateLimitPolicy('UNKNOWN' as any),
    ).toThrow();
  });

  it('isRateLimitPolicyKey type-guard hoạt động', () => {
    expect(isRateLimitPolicyKey('AUTH_LOGIN')).toBe(true);
    expect(isRateLimitPolicyKey('FOO_BAR')).toBe(false);
    expect(isRateLimitPolicyKey(123)).toBe(false);
    expect(isRateLimitPolicyKey(null)).toBe(false);
  });

  it('isRateLimitScope/Severity type-guard hoạt động', () => {
    expect(RATE_LIMIT_SCOPES.every(isRateLimitScope)).toBe(true);
    expect(RATE_LIMIT_SEVERITIES.every(isRateLimitSeverity)).toBe(true);
    expect(isRateLimitScope('NOPE')).toBe(false);
    expect(isRateLimitSeverity('NOPE')).toBe(false);
  });

  it('normalizeRateLimitSubject trim + lowercase + null-safe', () => {
    expect(normalizeRateLimitSubject('  ABC ')).toBe('abc');
    expect(normalizeRateLimitSubject('')).toBe('');
    expect(normalizeRateLimitSubject(null)).toBe('');
    expect(normalizeRateLimitSubject(undefined)).toBe('');
  });

  it('buildRateLimitKey format stable', () => {
    expect(buildRateLimitKey('AUTH_LOGIN', 'IP', '1.2.3.4')).toBe(
      'ratelimit:AUTH_LOGIN:IP:1.2.3.4',
    );
    expect(buildRateLimitKey('SHOP_BUY', 'USER', 'USER-CUID-1')).toBe(
      'ratelimit:SHOP_BUY:USER:user-cuid-1',
    );
  });

  it('buildRateLimitKey gắn `unknown` khi subject rỗng (an toàn)', () => {
    expect(buildRateLimitKey('AUTH_LOGIN', 'IP', '')).toBe(
      'ratelimit:AUTH_LOGIN:IP:unknown',
    );
  });

  it('buildAbuseBlockKey format stable', () => {
    expect(buildAbuseBlockKey('IP', 'hash-abc')).toBe(
      'abuse:block:IP:hash-abc',
    );
    expect(buildAbuseBlockKey('USER', 'cuid-1')).toBe(
      'abuse:block:USER:cuid-1',
    );
  });

  it('AUTH policy có severity HIGH (chống brute force)', () => {
    expect(RATE_LIMIT_POLICIES.AUTH_LOGIN.severity).toBe('HIGH');
    expect(RATE_LIMIT_POLICIES.AUTH_REGISTER.severity).toBe('HIGH');
    expect(RATE_LIMIT_POLICIES.AUTH_PASSWORD_RESET.severity).toBe('HIGH');
    expect(RATE_LIMIT_POLICIES.TOPUP_CREATE_ORDER.severity).toBe('HIGH');
  });

  it('PUBLIC_READ/DEFAULT_API/ADMIN_REPORT_VIEW có blockSec=0 (throttle only)', () => {
    expect(RATE_LIMIT_POLICIES.PUBLIC_READ.blockSec).toBe(0);
    expect(RATE_LIMIT_POLICIES.DEFAULT_API.blockSec).toBe(0);
    expect(RATE_LIMIT_POLICIES.ADMIN_REPORT_VIEW.blockSec).toBe(0);
  });

  it('getRateLimitPolicyGroup phân loại đúng', () => {
    expect(getRateLimitPolicyGroup('AUTH_LOGIN')).toBe('AUTH');
    expect(getRateLimitPolicyGroup('AUTH_PASSWORD_RESET')).toBe('AUTH');
    expect(getRateLimitPolicyGroup('SHOP_BUY')).toBe('ECONOMY');
    expect(getRateLimitPolicyGroup('MARKET_BUY')).toBe('ECONOMY');
    expect(getRateLimitPolicyGroup('TOPUP_CREATE_ORDER')).toBe('ECONOMY');
    expect(getRateLimitPolicyGroup('ADMIN_MUTATION')).toBe('ADMIN');
    expect(getRateLimitPolicyGroup('ADMIN_REPORT_VIEW')).toBe('ADMIN');
    expect(getRateLimitPolicyGroup('PUBLIC_READ')).toBe('PUBLIC');
    expect(getRateLimitPolicyGroup('DEFAULT_API')).toBe('PUBLIC');
    expect(getRateLimitPolicyGroup('SOCIAL_FRIEND_REQUEST')).toBe('SOCIAL');
    expect(getRateLimitPolicyGroup('SOCIAL_BLOCK_TOGGLE')).toBe('SOCIAL');
    expect(getRateLimitPolicyGroup('CHAT_PRIVATE_SEND')).toBe('SOCIAL');
    expect(getRateLimitPolicyGroup('CHAT_GROUP_SEND')).toBe('SOCIAL');
    expect(getRateLimitPolicyGroup('CHAT_GROUP_CREATE')).toBe('SOCIAL');
    expect(getRateLimitPolicyGroup('CHAT_GROUP_MEMBER_ADD')).toBe('SOCIAL');
  });

  it('tham số lock-in: blockSec không vượt 24h, windowSec hợp lý', () => {
    for (const key of RATE_LIMIT_POLICY_KEYS) {
      const p = RATE_LIMIT_POLICIES[key];
      expect(p.blockSec).toBeGreaterThanOrEqual(0);
      expect(p.blockSec).toBeLessThanOrEqual(24 * 60 * 60);
      expect(p.windowSec).toBeGreaterThan(0);
      expect(p.windowSec).toBeLessThanOrEqual(24 * 60 * 60);
      expect(p.maxRequests).toBeGreaterThan(0);
      expect(p.maxRequests).toBeLessThanOrEqual(10_000);
    }
  });

  it('description không rỗng (VI/EN)', () => {
    for (const key of RATE_LIMIT_POLICY_KEYS) {
      const p = RATE_LIMIT_POLICIES[key];
      expect(p.descriptionVi.length).toBeGreaterThan(10);
      expect(p.descriptionEn.length).toBeGreaterThan(10);
    }
  });

  it('Phase 19.1.B — SOCIAL_FRIEND_REQUEST tham số lock-in (10/min user, block 5 min)', () => {
    const p = RATE_LIMIT_POLICIES.SOCIAL_FRIEND_REQUEST;
    expect(p.windowSec).toBe(60);
    expect(p.maxRequests).toBe(10);
    expect(p.blockSec).toBe(5 * 60);
    expect(p.scope).toBe('USER');
    expect(p.severity).toBe('MEDIUM');
    expect(p.sensitive).toBe(true);
  });

  it('Phase 19.1.B — CHAT_PRIVATE_SEND + CHAT_GROUP_SEND cùng baseline (30/min user, block 5 min)', () => {
    for (const key of ['CHAT_PRIVATE_SEND', 'CHAT_GROUP_SEND'] as const) {
      const p = RATE_LIMIT_POLICIES[key];
      expect(p.windowSec).toBe(60);
      expect(p.maxRequests).toBe(30);
      expect(p.blockSec).toBe(5 * 60);
      expect(p.scope).toBe('USER');
      expect(p.severity).toBe('MEDIUM');
      expect(p.sensitive).toBe(true);
    }
  });

  it('Phase 19.1.B — SOCIAL_BLOCK_TOGGLE + CHAT_GROUP_MEMBER_ADD: 30 / 10 min user', () => {
    for (const key of ['SOCIAL_BLOCK_TOGGLE', 'CHAT_GROUP_MEMBER_ADD'] as const) {
      const p = RATE_LIMIT_POLICIES[key];
      expect(p.windowSec).toBe(10 * 60);
      expect(p.maxRequests).toBe(30);
      expect(p.blockSec).toBe(10 * 60);
      expect(p.scope).toBe('USER');
    }
  });

  it('Phase 19.1.B — CHAT_GROUP_CREATE: 10/h user, block 30 min', () => {
    const p = RATE_LIMIT_POLICIES.CHAT_GROUP_CREATE;
    expect(p.windowSec).toBe(60 * 60);
    expect(p.maxRequests).toBe(10);
    expect(p.blockSec).toBe(30 * 60);
    expect(p.scope).toBe('USER');
  });
});
