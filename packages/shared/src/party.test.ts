import { describe, expect, it } from 'vitest';
import {
  PARTY_INVITE_STATUSES,
  PARTY_LIMITS,
  PARTY_ROLES,
  PARTY_STATUSES,
  buildPartyMemberKey,
  canDisbandParty,
  canInviteToParty,
  canKickPartyMember,
  canTransferLeader,
  computePartyInviteExpiresAt,
  isPartyInviteExpired,
  isPartyInviteStatus,
  isPartyRole,
  isPartyStatus,
  validatePartyName,
} from './party';

describe('Phase 19.4 — party shared catalog enum guards', () => {
  it('PARTY_STATUSES contains ACTIVE + DISBANDED', () => {
    expect(PARTY_STATUSES).toEqual(['ACTIVE', 'DISBANDED']);
    expect(isPartyStatus('ACTIVE')).toBe(true);
    expect(isPartyStatus('DISBANDED')).toBe(true);
    expect(isPartyStatus('OTHER')).toBe(false);
    expect(isPartyStatus(null)).toBe(false);
  });

  it('PARTY_ROLES contains LEADER + MEMBER', () => {
    expect(PARTY_ROLES).toEqual(['LEADER', 'MEMBER']);
    expect(isPartyRole('LEADER')).toBe(true);
    expect(isPartyRole('MEMBER')).toBe(true);
    expect(isPartyRole('ADMIN')).toBe(false);
  });

  it('PARTY_INVITE_STATUSES covers full lifecycle', () => {
    expect(PARTY_INVITE_STATUSES).toEqual([
      'PENDING',
      'ACCEPTED',
      'DECLINED',
      'CANCELED',
      'EXPIRED',
    ]);
    for (const s of PARTY_INVITE_STATUSES) {
      expect(isPartyInviteStatus(s)).toBe(true);
    }
    expect(isPartyInviteStatus('FOO')).toBe(false);
  });
});

describe('Phase 19.4 — PARTY_LIMITS', () => {
  it('maxMembers ≥ 2 và hợp lý cho dungeon co-op tương lai', () => {
    expect(PARTY_LIMITS.maxMembers).toBeGreaterThanOrEqual(2);
    expect(PARTY_LIMITS.maxMembers).toBeLessThanOrEqual(8);
  });

  it('inviteExpireMinutes là số dương', () => {
    expect(PARTY_LIMITS.inviteExpireMinutes).toBeGreaterThan(0);
  });

  it('maxPendingInvitesPerInvitee chống spam tới 1 người', () => {
    expect(PARTY_LIMITS.maxPendingInvitesPerInvitee).toBeGreaterThan(0);
    expect(PARTY_LIMITS.maxPendingInvitesPerInvitee).toBeLessThanOrEqual(20);
  });

  it('maxPendingInvitesPerParty không quá nới', () => {
    expect(PARTY_LIMITS.maxPendingInvitesPerParty).toBeGreaterThanOrEqual(
      PARTY_LIMITS.maxMembers,
    );
    expect(PARTY_LIMITS.maxPendingInvitesPerParty).toBeLessThanOrEqual(50);
  });
});

describe('Phase 19.4 — validatePartyName', () => {
  it('null/undefined → OK với value null', () => {
    expect(validatePartyName(null)).toEqual({ ok: true, value: null });
    expect(validatePartyName(undefined)).toEqual({ ok: true, value: null });
  });

  it('empty/whitespace → OK với value null', () => {
    expect(validatePartyName('')).toEqual({ ok: true, value: null });
    expect(validatePartyName('   ')).toEqual({ ok: true, value: null });
  });

  it('TOO_SHORT khi length < nameMin', () => {
    const tooShort = 'a'.repeat(PARTY_LIMITS.nameMin - 1);
    const r = validatePartyName(tooShort);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TOO_SHORT');
  });

  it('TOO_LONG khi length > nameMax', () => {
    const tooLong = 'a'.repeat(PARTY_LIMITS.nameMax + 1);
    const r = validatePartyName(tooLong);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TOO_LONG');
  });

  it('trim trước khi validate', () => {
    const r = validatePartyName('  Đạo Hữu Team  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('Đạo Hữu Team');
  });

  it('reject INVALID khi truyền non-string non-null', () => {
    const r = validatePartyName(42 as unknown as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID');
  });
});

describe('Phase 19.4 — permission helpers', () => {
  const leaderId = 'leader-1';
  const memberId = 'member-1';

  it('canInviteToParty chỉ true cho leader', () => {
    expect(
      canInviteToParty({ actorUserId: leaderId, leaderUserId: leaderId }),
    ).toBe(true);
    expect(
      canInviteToParty({ actorUserId: memberId, leaderUserId: leaderId }),
    ).toBe(false);
  });

  it('canKickPartyMember chỉ leader + không tự kick mình', () => {
    expect(
      canKickPartyMember({
        actorUserId: leaderId,
        leaderUserId: leaderId,
        targetUserId: memberId,
      }),
    ).toBe(true);
    // member không kick được
    expect(
      canKickPartyMember({
        actorUserId: memberId,
        leaderUserId: leaderId,
        targetUserId: leaderId,
      }),
    ).toBe(false);
    // leader không tự kick
    expect(
      canKickPartyMember({
        actorUserId: leaderId,
        leaderUserId: leaderId,
        targetUserId: leaderId,
      }),
    ).toBe(false);
  });

  it('canTransferLeader chỉ leader + không transfer cho mình', () => {
    expect(
      canTransferLeader({
        actorUserId: leaderId,
        leaderUserId: leaderId,
        targetUserId: memberId,
      }),
    ).toBe(true);
    expect(
      canTransferLeader({
        actorUserId: leaderId,
        leaderUserId: leaderId,
        targetUserId: leaderId,
      }),
    ).toBe(false);
    expect(
      canTransferLeader({
        actorUserId: memberId,
        leaderUserId: leaderId,
        targetUserId: leaderId,
      }),
    ).toBe(false);
  });

  it('canDisbandParty chỉ true cho leader', () => {
    expect(
      canDisbandParty({ actorUserId: leaderId, leaderUserId: leaderId }),
    ).toBe(true);
    expect(
      canDisbandParty({ actorUserId: memberId, leaderUserId: leaderId }),
    ).toBe(false);
  });
});

describe('Phase 19.4 — buildPartyMemberKey deterministic', () => {
  it('return canonical string', () => {
    expect(buildPartyMemberKey('p1', 'u1')).toBe('p1:u1');
    expect(buildPartyMemberKey('p1', 'u2')).toBe('p1:u2');
  });
});

describe('Phase 19.4 — invite expiry helpers', () => {
  it('computePartyInviteExpiresAt offsets by inviteExpireMinutes', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const exp = computePartyInviteExpiresAt(now);
    expect(exp.getTime() - now.getTime()).toBe(
      PARTY_LIMITS.inviteExpireMinutes * 60 * 1000,
    );
  });

  it('isPartyInviteExpired true sau khi expiresAt', () => {
    const now = new Date('2026-01-01T01:00:00Z');
    expect(
      isPartyInviteExpired(
        {
          status: 'PENDING',
          expiresAt: '2026-01-01T00:59:00Z',
        },
        now,
      ),
    ).toBe(true);
  });

  it('isPartyInviteExpired false khi chưa quá hạn', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect(
      isPartyInviteExpired(
        { status: 'PENDING', expiresAt: '2026-01-01T00:01:00Z' },
        now,
      ),
    ).toBe(false);
  });

  it('isPartyInviteExpired false cho non-pending status', () => {
    const now = new Date('2026-01-01T01:00:00Z');
    expect(
      isPartyInviteExpired(
        { status: 'ACCEPTED', expiresAt: '2025-01-01T00:00:00Z' },
        now,
      ),
    ).toBe(false);
  });
});
