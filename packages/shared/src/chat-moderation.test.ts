import { describe, expect, it } from 'vitest';
import {
  CHAT_HIDDEN_MESSAGE_PLACEHOLDER,
  CHAT_MESSAGE_REPORT_REASONS,
  CHAT_MESSAGE_REPORT_STATUSES,
  CHAT_MESSAGE_REPORT_TYPES,
  CHAT_MODERATION_LIMITS,
  CHAT_MUTE_SCOPES,
  isChatMessageReportReason,
  isChatMessageReportStatus,
  isChatMessageReportType,
  isChatMuteActive,
  isChatMuteScope,
  muteScopeApplies,
  sanitizeChatModerationText,
  validateChatMutePayload,
  validateChatReportSubmission,
} from './chat-moderation';

describe('Phase 19.2 — chat-moderation enums lock-in', () => {
  it('CHAT_MESSAGE_REPORT_TYPES = [PRIVATE, GROUP]', () => {
    expect(CHAT_MESSAGE_REPORT_TYPES).toEqual(['PRIVATE', 'GROUP']);
  });
  it('CHAT_MESSAGE_REPORT_STATUSES = [OPEN, ACKNOWLEDGED, RESOLVED, REJECTED]', () => {
    expect(CHAT_MESSAGE_REPORT_STATUSES).toEqual([
      'OPEN',
      'ACKNOWLEDGED',
      'RESOLVED',
      'REJECTED',
    ]);
  });
  it('CHAT_MESSAGE_REPORT_REASONS = [SPAM, HARASSMENT, SCAM, OFFENSIVE, OTHER]', () => {
    expect(CHAT_MESSAGE_REPORT_REASONS).toEqual([
      'SPAM',
      'HARASSMENT',
      'SCAM',
      'OFFENSIVE',
      'OTHER',
    ]);
  });
  it('CHAT_MUTE_SCOPES = [PRIVATE_CHAT, GROUP_CHAT, WORLD_SECT_CHAT, ALL_CHAT]', () => {
    expect(CHAT_MUTE_SCOPES).toEqual([
      'PRIVATE_CHAT',
      'GROUP_CHAT',
      'WORLD_SECT_CHAT',
      'ALL_CHAT',
    ]);
  });
  it('caps are stable', () => {
    expect(CHAT_MODERATION_LIMITS.REPORT_DETAILS_MAX).toBe(500);
    expect(CHAT_MODERATION_LIMITS.ADMIN_REASON_MAX).toBe(200);
    expect(CHAT_MODERATION_LIMITS.RESOLUTION_NOTE_MAX).toBe(500);
    expect(CHAT_MODERATION_LIMITS.MUTE_DURATION_PRESETS_MS.ONE_HOUR).toBe(
      60 * 60 * 1000,
    );
    expect(CHAT_MODERATION_LIMITS.MUTE_DURATION_PRESETS_MS.ONE_DAY).toBe(
      24 * 60 * 60 * 1000,
    );
    expect(CHAT_MODERATION_LIMITS.MUTE_DURATION_PRESETS_MS.SEVEN_DAYS).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
  });
});

describe('Phase 19.2 — type guards', () => {
  it('isChatMessageReportReason accepts only enum', () => {
    expect(isChatMessageReportReason('SPAM')).toBe(true);
    expect(isChatMessageReportReason('OFFENSIVE')).toBe(true);
    expect(isChatMessageReportReason('UNKNOWN')).toBe(false);
    expect(isChatMessageReportReason('')).toBe(false);
    expect(isChatMessageReportReason(null)).toBe(false);
    expect(isChatMessageReportReason(123)).toBe(false);
  });
  it('isChatMessageReportType', () => {
    expect(isChatMessageReportType('PRIVATE')).toBe(true);
    expect(isChatMessageReportType('GROUP')).toBe(true);
    expect(isChatMessageReportType('WORLD')).toBe(false);
  });
  it('isChatMessageReportStatus', () => {
    for (const s of CHAT_MESSAGE_REPORT_STATUSES) {
      expect(isChatMessageReportStatus(s)).toBe(true);
    }
    expect(isChatMessageReportStatus('XYZ')).toBe(false);
  });
  it('isChatMuteScope', () => {
    for (const s of CHAT_MUTE_SCOPES) expect(isChatMuteScope(s)).toBe(true);
    expect(isChatMuteScope('GLOBAL_CHAT')).toBe(false); // historical typo guard
  });
});

describe('Phase 19.2 — sanitizeChatModerationText', () => {
  it('trims whitespace + caps length', () => {
    const out = sanitizeChatModerationText('  hello  ', 50);
    expect(out).toBe('hello');
  });
  it('returns null on empty / whitespace-only / null / non-string', () => {
    expect(sanitizeChatModerationText(null, 10)).toBeNull();
    expect(sanitizeChatModerationText('', 10)).toBeNull();
    expect(sanitizeChatModerationText('   ', 10)).toBeNull();
    expect(sanitizeChatModerationText(undefined, 10)).toBeNull();
    expect(sanitizeChatModerationText(123 as unknown as string, 10)).toBeNull();
  });
  it('strips control characters but keeps \\n and \\t', () => {
    const evil = 'abc\x00\x01def\nghi\tjkl\x07';
    const out = sanitizeChatModerationText(evil, 100);
    expect(out).toBe('abcdef\nghi\tjkl');
  });
  it('returns null when only control chars after trim', () => {
    expect(sanitizeChatModerationText('\x00\x01\x02', 50)).toBeNull();
  });
  it('truncates to max length', () => {
    const long = 'x'.repeat(1000);
    const out = sanitizeChatModerationText(long, 100);
    expect(out?.length).toBe(100);
  });
});

describe('Phase 19.2 — validateChatReportSubmission', () => {
  it('rejects bad messageType', () => {
    const r = validateChatReportSubmission({
      messageType: 'WORLD',
      reason: 'SPAM',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_INPUT');
  });
  it('rejects bad reason', () => {
    const r = validateChatReportSubmission({
      messageType: 'PRIVATE',
      reason: 'NOT_LIKED',
    });
    expect(r.ok).toBe(false);
  });
  it('accepts valid input and sanitizes details', () => {
    const r = validateChatReportSubmission({
      messageType: 'PRIVATE',
      reason: 'SPAM',
      detailsText: '  spam link \x00\x01 here  ',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.messageType).toBe('PRIVATE');
      expect(r.value.reason).toBe('SPAM');
      expect(r.value.detailsText).toBe('spam link  here');
    }
  });
  it('returns null detailsText when omitted or empty', () => {
    const r = validateChatReportSubmission({
      messageType: 'GROUP',
      reason: 'OFFENSIVE',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.detailsText).toBeNull();
  });
  it('truncates detailsText to 500 chars', () => {
    const r = validateChatReportSubmission({
      messageType: 'PRIVATE',
      reason: 'SCAM',
      detailsText: 'y'.repeat(2000),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.detailsText?.length).toBe(500);
  });
});

describe('Phase 19.2 — validateChatMutePayload', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');
  it('rejects invalid scope', () => {
    const r = validateChatMutePayload(
      { scope: 'NOPE', reason: 'spam' },
      now,
    );
    expect(r.ok).toBe(false);
  });
  it('rejects empty reason', () => {
    const r = validateChatMutePayload(
      { scope: 'PRIVATE_CHAT', reason: '   ' },
      now,
    );
    expect(r.ok).toBe(false);
  });
  it('rejects expiresAt in the past', () => {
    const r = validateChatMutePayload(
      {
        scope: 'PRIVATE_CHAT',
        reason: 'spam',
        expiresAt: '2025-01-01T00:00:00.000Z',
      },
      now,
    );
    expect(r.ok).toBe(false);
  });
  it('accepts expiresAt null for indefinite mute', () => {
    const r = validateChatMutePayload(
      { scope: 'ALL_CHAT', reason: 'harassment', expiresAt: null },
      now,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.expiresAt).toBeNull();
  });
  it('accepts future expiresAt as string', () => {
    const r = validateChatMutePayload(
      {
        scope: 'GROUP_CHAT',
        reason: 'flood',
        expiresAt: '2027-01-01T00:00:00.000Z',
      },
      now,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.expiresAt).toEqual(new Date('2027-01-01T00:00:00.000Z'));
  });
  it('truncates reason to 200 chars', () => {
    const r = validateChatMutePayload(
      { scope: 'PRIVATE_CHAT', reason: 'r'.repeat(500) },
      now,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.reason.length).toBe(200);
  });
});

describe('Phase 19.2 — isChatMuteActive', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');
  it('inactive when revokedAt set', () => {
    expect(
      isChatMuteActive(
        { expiresAt: new Date('2027-01-01'), revokedAt: new Date('2026-08-01') },
        now,
      ),
    ).toBe(false);
  });
  it('active when expiresAt null and revokedAt null', () => {
    expect(
      isChatMuteActive({ expiresAt: null, revokedAt: null }, now),
    ).toBe(true);
  });
  it('active when expiresAt future', () => {
    expect(
      isChatMuteActive(
        { expiresAt: new Date('2026-12-01'), revokedAt: null },
        now,
      ),
    ).toBe(true);
  });
  it('inactive when expiresAt past', () => {
    expect(
      isChatMuteActive(
        { expiresAt: new Date('2026-01-01'), revokedAt: null },
        now,
      ),
    ).toBe(false);
  });
  it('accepts ISO string for expiresAt', () => {
    expect(
      isChatMuteActive(
        { expiresAt: '2026-12-01T00:00:00.000Z', revokedAt: null },
        now,
      ),
    ).toBe(true);
  });
});

describe('Phase 19.2 — muteScopeApplies', () => {
  it('ALL_CHAT active covers every target scope', () => {
    for (const target of CHAT_MUTE_SCOPES) {
      expect(muteScopeApplies('ALL_CHAT', target)).toBe(true);
    }
  });
  it('Specific active matches only same target', () => {
    expect(muteScopeApplies('PRIVATE_CHAT', 'PRIVATE_CHAT')).toBe(true);
    expect(muteScopeApplies('PRIVATE_CHAT', 'GROUP_CHAT')).toBe(false);
    expect(muteScopeApplies('GROUP_CHAT', 'PRIVATE_CHAT')).toBe(false);
    expect(muteScopeApplies('WORLD_SECT_CHAT', 'WORLD_SECT_CHAT')).toBe(true);
  });
  it('Non-ALL active cannot cover ALL target', () => {
    expect(muteScopeApplies('PRIVATE_CHAT', 'ALL_CHAT')).toBe(false);
  });
});

describe('Phase 19.2 — placeholder constant', () => {
  it('placeholder is non-empty stable string', () => {
    expect(CHAT_HIDDEN_MESSAGE_PLACEHOLDER).toBe('[hidden by moderator]');
  });
});
