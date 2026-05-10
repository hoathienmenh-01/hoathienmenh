import { describe, expect, it } from 'vitest';
import {
  LIVEOPS_ANNOUNCEMENT_MAX_WINDOW_MS,
  LIVEOPS_ANNOUNCEMENT_MESSAGE_MAX,
  LIVEOPS_ANNOUNCEMENT_MIN_WINDOW_MS,
  LIVEOPS_ANNOUNCEMENT_SEVERITIES,
  LIVEOPS_ANNOUNCEMENT_STATUSES,
  LIVEOPS_ANNOUNCEMENT_TARGETS,
  LIVEOPS_ANNOUNCEMENT_TITLE_MAX,
  LIVEOPS_BROADCAST_EVENT_TYPES,
  LIVEOPS_WS_CHANNEL_ANNOUNCEMENT,
  LIVEOPS_WS_CHANNEL_EVENT,
  isLiveOpsAnnouncementActiveAt,
  isLiveOpsAnnouncementTextSafe,
  isValidLiveOpsAnnouncementStatus,
  nextLiveOpsAnnouncementStatus,
  pickLiveOpsAnnouncementText,
  validateLiveOpsAnnouncementInput,
  type LiveOpsAnnouncementInput,
} from './liveops-announcement';

const REF = new Date('2026-06-01T00:00:00.000Z');

function baseInput(
  overrides: Partial<LiveOpsAnnouncementInput> = {},
): LiveOpsAnnouncementInput {
  const startsAt = new Date(REF.getTime() + 3600_000); // +1h
  const endsAt = new Date(REF.getTime() + 7200_000); // +2h
  return {
    key: 'test-announcement',
    severity: 'INFO',
    target: 'ALL',
    titleVi: 'Tiêu đề',
    titleEn: null,
    messageVi: 'Nội dung thông báo',
    messageEn: null,
    startsAt,
    endsAt,
    ...overrides,
  };
}

describe('LiveOpsAnnouncement enums', () => {
  it('catalog matches type union', () => {
    expect(LIVEOPS_ANNOUNCEMENT_SEVERITIES).toEqual([
      'INFO',
      'EVENT',
      'WARNING',
      'MAINTENANCE',
    ]);
    expect(LIVEOPS_ANNOUNCEMENT_STATUSES).toEqual([
      'DRAFT',
      'SCHEDULED',
      'ACTIVE',
      'ENDED',
      'DISABLED',
    ]);
    expect(LIVEOPS_ANNOUNCEMENT_TARGETS).toEqual([
      'ALL',
      'AUTHENTICATED',
      'ADMIN_ONLY',
    ]);
    expect(LIVEOPS_BROADCAST_EVENT_TYPES).toEqual([
      'ANNOUNCEMENT_ACTIVE',
      'ANNOUNCEMENT_ENDED',
      'LIVEOPS_EVENT_ACTIVE',
      'LIVEOPS_EVENT_ENDED',
      'LIVEOPS_EVENT_UPDATED',
    ]);
  });

  it('isValidLiveOpsAnnouncementStatus accepts valid + rejects invalid', () => {
    expect(isValidLiveOpsAnnouncementStatus('ACTIVE')).toBe(true);
    expect(isValidLiveOpsAnnouncementStatus('DRAFT')).toBe(true);
    expect(isValidLiveOpsAnnouncementStatus('PAUSED')).toBe(false);
    expect(isValidLiveOpsAnnouncementStatus('')).toBe(false);
  });

  it('exposes WS channel constants', () => {
    expect(LIVEOPS_WS_CHANNEL_ANNOUNCEMENT).toBe('liveops:announcement');
    expect(LIVEOPS_WS_CHANNEL_EVENT).toBe('liveops:event');
  });
});

describe('isLiveOpsAnnouncementTextSafe', () => {
  it('accepts plain text + dấu i18n', () => {
    expect(isLiveOpsAnnouncementTextSafe('Hello — world!')).toBe(true);
    expect(isLiveOpsAnnouncementTextSafe('Cập nhật mới: kiếp 9')).toBe(true);
    expect(isLiveOpsAnnouncementTextSafe('Server bảo trì 22:00–22:30 (UTC+7)')).toBe(true);
    expect(isLiveOpsAnnouncementTextSafe('Use & enjoy!')).toBe(true);
  });

  it('rejects HTML angle brackets', () => {
    expect(isLiveOpsAnnouncementTextSafe('<script>x</script>')).toBe(false);
    expect(isLiveOpsAnnouncementTextSafe('<a href="x">link</a>')).toBe(false);
    expect(isLiveOpsAnnouncementTextSafe('a < b')).toBe(false);
  });

  it('rejects javascript:/data:text/html/vbscript: scheme', () => {
    expect(isLiveOpsAnnouncementTextSafe('Click javascript:alert(1)')).toBe(false);
    expect(isLiveOpsAnnouncementTextSafe('JavaScript : alert')).toBe(false);
    expect(isLiveOpsAnnouncementTextSafe('vbscript: msgbox')).toBe(false);
    expect(isLiveOpsAnnouncementTextSafe('data:text/html,<x>')).toBe(false);
  });

  it('rejects HTML entity numeric reference', () => {
    expect(isLiveOpsAnnouncementTextSafe('&#x3c;script&#x3e;')).toBe(false);
    expect(isLiveOpsAnnouncementTextSafe('&#60;')).toBe(false);
  });
});

describe('validateLiveOpsAnnouncementInput', () => {
  it('passes valid input with VI only', () => {
    expect(validateLiveOpsAnnouncementInput(baseInput())).toBeNull();
  });

  it('passes valid input with VI + EN parity', () => {
    const code = validateLiveOpsAnnouncementInput(
      baseInput({
        titleEn: 'Title',
        messageEn: 'Body content',
      }),
    );
    expect(code).toBeNull();
  });

  it('rejects invalid key pattern', () => {
    expect(
      validateLiveOpsAnnouncementInput(baseInput({ key: 'ab' })),
    ).toBe('ANNOUNCEMENT_KEY_INVALID');
    expect(
      validateLiveOpsAnnouncementInput(baseInput({ key: '_bad-start' })),
    ).toBe('ANNOUNCEMENT_KEY_INVALID');
    expect(
      validateLiveOpsAnnouncementInput(baseInput({ key: 'BAD UPPER' })),
    ).toBe('ANNOUNCEMENT_KEY_INVALID');
  });

  it('rejects invalid severity / target', () => {
    expect(
      validateLiveOpsAnnouncementInput(
        baseInput({ severity: 'CRITICAL' as never }),
      ),
    ).toBe('ANNOUNCEMENT_SEVERITY_INVALID');
    expect(
      validateLiveOpsAnnouncementInput(baseInput({ target: 'PUBLIC' as never })),
    ).toBe('ANNOUNCEMENT_TARGET_INVALID');
  });

  it('rejects empty / overlong title + message', () => {
    expect(
      validateLiveOpsAnnouncementInput(baseInput({ titleVi: '   ' })),
    ).toBe('ANNOUNCEMENT_TITLE_REQUIRED');
    expect(
      validateLiveOpsAnnouncementInput(baseInput({ messageVi: '' })),
    ).toBe('ANNOUNCEMENT_MESSAGE_REQUIRED');
    expect(
      validateLiveOpsAnnouncementInput(
        baseInput({
          titleVi: 'a'.repeat(LIVEOPS_ANNOUNCEMENT_TITLE_MAX + 1),
        }),
      ),
    ).toBe('ANNOUNCEMENT_TITLE_TOO_LONG');
    expect(
      validateLiveOpsAnnouncementInput(
        baseInput({
          messageVi: 'b'.repeat(LIVEOPS_ANNOUNCEMENT_MESSAGE_MAX + 1),
        }),
      ),
    ).toBe('ANNOUNCEMENT_MESSAGE_TOO_LONG');
  });

  it('rejects HTML/script in title or message', () => {
    expect(
      validateLiveOpsAnnouncementInput(
        baseInput({ titleVi: '<script>alert(1)</script>' }),
      ),
    ).toBe('ANNOUNCEMENT_TITLE_UNSAFE');
    expect(
      validateLiveOpsAnnouncementInput(
        baseInput({ messageVi: 'Click javascript:alert(1)' }),
      ),
    ).toBe('ANNOUNCEMENT_MESSAGE_UNSAFE');
    expect(
      validateLiveOpsAnnouncementInput(
        baseInput({ messageVi: 'Visit <a href="x">link</a>' }),
      ),
    ).toBe('ANNOUNCEMENT_MESSAGE_UNSAFE');
  });

  it('rejects half-translated locale (titleEn but no messageEn)', () => {
    expect(
      validateLiveOpsAnnouncementInput(
        baseInput({ titleEn: 'Title', messageEn: null }),
      ),
    ).toBe('ANNOUNCEMENT_LOCALE_PARITY');
    expect(
      validateLiveOpsAnnouncementInput(
        baseInput({ titleEn: null, messageEn: 'Body' }),
      ),
    ).toBe('ANNOUNCEMENT_LOCALE_PARITY');
  });

  it('rejects window where startsAt >= endsAt or NaN', () => {
    const bad = baseInput({
      startsAt: new Date(REF.getTime() + 3600_000),
      endsAt: new Date(REF.getTime() + 3600_000),
    });
    expect(validateLiveOpsAnnouncementInput(bad)).toBe(
      'ANNOUNCEMENT_WINDOW_INVALID',
    );
    expect(
      validateLiveOpsAnnouncementInput(
        baseInput({ startsAt: new Date(NaN) }),
      ),
    ).toBe('ANNOUNCEMENT_WINDOW_INVALID');
  });

  it('rejects window too short (<60s) or too long (>90 days)', () => {
    expect(
      validateLiveOpsAnnouncementInput(
        baseInput({
          startsAt: REF,
          endsAt: new Date(REF.getTime() + LIVEOPS_ANNOUNCEMENT_MIN_WINDOW_MS - 1),
        }),
      ),
    ).toBe('ANNOUNCEMENT_WINDOW_TOO_SHORT');
    expect(
      validateLiveOpsAnnouncementInput(
        baseInput({
          startsAt: REF,
          endsAt: new Date(
            REF.getTime() + LIVEOPS_ANNOUNCEMENT_MAX_WINDOW_MS + 60_000,
          ),
        }),
      ),
    ).toBe('ANNOUNCEMENT_WINDOW_TOO_LONG');
  });
});

describe('isLiveOpsAnnouncementActiveAt', () => {
  it('inclusive start, exclusive end', () => {
    const start = new Date('2026-06-01T00:00:00Z');
    const end = new Date('2026-06-02T00:00:00Z');
    expect(isLiveOpsAnnouncementActiveAt(start, end, start)).toBe(true);
    expect(
      isLiveOpsAnnouncementActiveAt(
        start,
        end,
        new Date('2026-06-01T12:00:00Z'),
      ),
    ).toBe(true);
    expect(isLiveOpsAnnouncementActiveAt(start, end, end)).toBe(false);
    expect(
      isLiveOpsAnnouncementActiveAt(
        start,
        end,
        new Date('2026-05-31T23:59:59.999Z'),
      ),
    ).toBe(false);
  });
});

describe('nextLiveOpsAnnouncementStatus (recompute idempotent)', () => {
  const start = new Date('2026-06-01T01:00:00Z');
  const end = new Date('2026-06-01T03:00:00Z');

  it('DRAFT/DISABLED/ENDED terminal-or-manual — never auto-transition', () => {
    const at = new Date('2026-06-01T02:00:00Z');
    expect(nextLiveOpsAnnouncementStatus('DRAFT', start, end, at)).toBe('DRAFT');
    expect(nextLiveOpsAnnouncementStatus('DISABLED', start, end, at)).toBe('DISABLED');
    expect(nextLiveOpsAnnouncementStatus('ENDED', start, end, at)).toBe('ENDED');
  });

  it('SCHEDULED → ACTIVE when now in window', () => {
    expect(
      nextLiveOpsAnnouncementStatus(
        'SCHEDULED',
        start,
        end,
        new Date('2026-06-01T01:30:00Z'),
      ),
    ).toBe('ACTIVE');
  });

  it('SCHEDULED → ENDED when now past endsAt', () => {
    expect(
      nextLiveOpsAnnouncementStatus(
        'SCHEDULED',
        start,
        end,
        new Date('2026-06-01T03:00:00Z'),
      ),
    ).toBe('ENDED');
  });

  it('ACTIVE → ENDED at end boundary, stays ACTIVE inside window', () => {
    expect(
      nextLiveOpsAnnouncementStatus(
        'ACTIVE',
        start,
        end,
        new Date('2026-06-01T02:30:00Z'),
      ),
    ).toBe('ACTIVE');
    expect(
      nextLiveOpsAnnouncementStatus(
        'ACTIVE',
        start,
        end,
        new Date('2026-06-01T03:00:00Z'),
      ),
    ).toBe('ENDED');
  });

  it('idempotent: gọi nhiều lần cùng input trả cùng output', () => {
    const at = new Date('2026-06-01T01:30:00Z');
    const a = nextLiveOpsAnnouncementStatus('SCHEDULED', start, end, at);
    const b = nextLiveOpsAnnouncementStatus(a, start, end, at);
    const c = nextLiveOpsAnnouncementStatus(b, start, end, at);
    expect(a).toBe('ACTIVE');
    expect(b).toBe('ACTIVE');
    expect(c).toBe('ACTIVE');
  });
});

describe('pickLiveOpsAnnouncementText', () => {
  it('prefers en when locale=en and en non-empty', () => {
    expect(pickLiveOpsAnnouncementText('Tiêu đề', 'Title', 'en')).toBe('Title');
  });
  it('falls back to vi when en empty/null', () => {
    expect(pickLiveOpsAnnouncementText('Tiêu đề', null, 'en')).toBe('Tiêu đề');
    expect(pickLiveOpsAnnouncementText('Tiêu đề', '', 'en')).toBe('Tiêu đề');
    expect(pickLiveOpsAnnouncementText('Tiêu đề', '   ', 'en')).toBe('Tiêu đề');
  });
  it('always returns vi when locale=vi', () => {
    expect(pickLiveOpsAnnouncementText('Tiêu đề', 'Title', 'vi')).toBe('Tiêu đề');
  });
});
