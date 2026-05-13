import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER_SETTINGS,
  filterNavigationEntries,
  mergePlayerSettings,
  NAVIGATION_REGISTRY,
  sanitizeUserText,
  validateAdminFeedbackPatch,
  validateAdminPlayerReportPatch,
  validateFeedbackInput,
  validatePlayerReportInput,
  validatePlayerSettings,
} from './player-experience';

describe('player-experience — validatePlayerSettings', () => {
  it('returns invalid sanitized when input is not an object', () => {
    expect(validatePlayerSettings(null).ok).toBe(false);
    expect(validatePlayerSettings('x').ok).toBe(false);
    expect(validatePlayerSettings(42).ok).toBe(false);
  });

  it('accepts a valid partial patch and ignores unknown keys', () => {
    const r = validatePlayerSettings({
      fontSize: 'large',
      appearance: 'dark',
      compactMode: true,
      __weird__: 'ignored',
    });
    expect(r.ok).toBe(true);
    expect(r.sanitized.fontSize).toBe('large');
    expect(r.sanitized.appearance).toBe('dark');
    expect(r.sanitized.compactMode).toBe(true);
    expect((r.sanitized as Record<string, unknown>).__weird__).toBeUndefined();
  });

  it('rejects an invalid enum value', () => {
    const r = validatePlayerSettings({ fontSize: 'humongous' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('PLAYER_SETTINGS_INVALID:fontSize'))).toBe(true);
  });

  it('rejects payload over 4 KiB', () => {
    const big = { stub: 'x'.repeat(5000) };
    const r = validatePlayerSettings(big);
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('PLAYER_SETTINGS_PAYLOAD_TOO_LARGE');
  });

  it('accepts and sanitizes timezone string', () => {
    const r = validatePlayerSettings({ timezone: 'Asia/Ho_Chi_Minh' });
    expect(r.ok).toBe(true);
    expect(r.sanitized.timezone).toBe('Asia/Ho_Chi_Minh');
  });

  it('rejects invalid timezone characters', () => {
    const r = validatePlayerSettings({ timezone: 'Asia/<script>' });
    expect(r.ok).toBe(false);
  });

  it('mergePlayerSettings falls back to defaults for invalid stored', () => {
    const merged = mergePlayerSettings('not-an-object', { fontSize: 'large' });
    expect(merged.fontSize).toBe('large');
    expect(merged.appearance).toBe(DEFAULT_PLAYER_SETTINGS.appearance);
  });

  it('mergePlayerSettings prefers patch over stored', () => {
    const merged = mergePlayerSettings({ appearance: 'dark' }, { appearance: 'light' });
    expect(merged.appearance).toBe('light');
  });

  it('strips invalid notificationPreferencesJson entries', () => {
    const r = validatePlayerSettings({
      notificationPreferencesJson: { goodKey: true, badKey: 'yes', '': true },
    });
    expect(r.ok).toBe(true);
    expect(r.sanitized.notificationPreferencesJson).toEqual({ goodKey: true });
  });
});

describe('player-experience — sanitizeUserText', () => {
  it('strips script tags', () => {
    expect(sanitizeUserText('Hello <script>alert(1)</script> world')).toBe(
      'Hello alert(1) world',
    );
  });

  it('strips control bytes', () => {
    expect(sanitizeUserText('a\x00b\x01c')).toBe('abc');
  });

  it('keeps newlines and tabs but collapses 4+ blank lines', () => {
    const out = sanitizeUserText('line1\n\n\n\n\nline2');
    expect(out).toBe('line1\n\n\nline2');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeUserText('   hi   ')).toBe('hi');
  });
});

describe('player-experience — validateFeedbackInput', () => {
  it('rejects when type missing', () => {
    const r = validateFeedbackInput({
      title: 'Hello title',
      description: 'A long enough description goes here.',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects when title too short', () => {
    const r = validateFeedbackInput({
      type: 'BUG_REPORT',
      title: 'Hi',
      description: 'A description that is plenty long enough.',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('title'))).toBe(true);
  });

  it('rejects when description too short', () => {
    const r = validateFeedbackInput({
      type: 'BUG_REPORT',
      title: 'A title that is long enough',
      description: 'short',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('description'))).toBe(true);
  });

  it('rejects when description too long', () => {
    const r = validateFeedbackInput({
      type: 'BUG_REPORT',
      title: 'A title that is long enough',
      description: 'x'.repeat(5000),
    });
    expect(r.ok).toBe(false);
  });

  it('strips script tags from description', () => {
    const r = validateFeedbackInput({
      type: 'BUG_REPORT',
      title: 'A title that is long enough',
      description: 'OK <script>bad()</script> still long enough for min check',
    });
    expect(r.ok).toBe(true);
    expect(r.sanitized?.description.includes('<script>')).toBe(false);
  });

  it('accepts a valid feedback', () => {
    const r = validateFeedbackInput({
      type: 'UI_FEEDBACK',
      title: 'Sidebar collapse',
      description: 'Sidebar does not collapse on small screens.',
      severity: 'LOW',
      relatedFeature: 'web/sidebar',
    });
    expect(r.ok).toBe(true);
    expect(r.sanitized?.type).toBe('UI_FEEDBACK');
    expect(r.sanitized?.severity).toBe('LOW');
    expect(r.sanitized?.relatedFeature).toBe('web/sidebar');
  });

  it('admin patch rejects invalid status', () => {
    const r = validateAdminFeedbackPatch({ status: 'BOGUS' });
    expect(r.ok).toBe(false);
  });

  it('admin patch accepts null adminNote', () => {
    const r = validateAdminFeedbackPatch({ adminNote: null });
    expect(r.ok).toBe(true);
    expect(r.sanitized.adminNote).toBeNull();
  });
});

describe('player-experience — validatePlayerReportInput', () => {
  it('rejects missing target', () => {
    const r = validatePlayerReportInput({
      reportType: 'HARASSMENT',
      description: 'Reported player keeps spamming chat with offensive remarks.',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects bad report type', () => {
    const r = validatePlayerReportInput({
      targetCharacterId: 'char-1',
      reportType: 'NOT_A_TYPE',
      description: 'Reported player keeps spamming chat with offensive remarks.',
    });
    expect(r.ok).toBe(false);
  });

  it('accepts a valid report', () => {
    const r = validatePlayerReportInput({
      targetCharacterId: 'char-1',
      reportType: 'HARASSMENT',
      description: 'Reported player keeps spamming chat with offensive remarks.',
      evidenceJson: { messageIds: ['m-1', 'm-2'] },
    });
    expect(r.ok).toBe(true);
    expect(r.sanitized?.reportType).toBe('HARASSMENT');
  });

  it('rejects evidence over cap', () => {
    const r = validatePlayerReportInput({
      targetCharacterId: 'char-1',
      reportType: 'HARASSMENT',
      description: 'Reported player keeps spamming chat with offensive remarks.',
      evidenceJson: { dump: 'x'.repeat(5000) },
    });
    expect(r.ok).toBe(false);
  });

  it('admin patch accepts a valid status', () => {
    const r = validateAdminPlayerReportPatch({ status: 'REVIEWING' });
    expect(r.ok).toBe(true);
    expect(r.sanitized.status).toBe('REVIEWING');
  });
});

describe('player-experience — navigation registry', () => {
  it('exposes core entries', () => {
    const keys = NAVIGATION_REGISTRY.map((e) => e.key);
    expect(keys).toContain('settings');
    expect(keys).toContain('dashboard');
    expect(keys).toContain('feedback');
  });

  it('admin entries are filtered out for PLAYER role', () => {
    const entries = filterNavigationEntries('PLAYER', null);
    expect(entries.find((e) => e.key === 'adminFeedback')).toBeUndefined();
  });

  it('admin entries appear for MOD role', () => {
    const entries = filterNavigationEntries('MOD', null);
    expect(entries.find((e) => e.key === 'adminFeedback')).toBeDefined();
  });

  it('filters by keyword query (vi)', () => {
    const entries = filterNavigationEntries('PLAYER', 'túi đồ');
    expect(entries.some((e) => e.key === 'inventory')).toBe(true);
  });

  it('filters by keyword query (en)', () => {
    const entries = filterNavigationEntries('PLAYER', 'cultivation');
    expect(entries.length).toBeGreaterThan(0);
  });

  it('all entries have stable keys and i18n keys', () => {
    for (const e of NAVIGATION_REGISTRY) {
      expect(e.key.length).toBeGreaterThan(0);
      expect(e.titleKey).toMatch(/^nav\..+\.title$/);
      expect(e.descriptionKey).toMatch(/^nav\..+\.description$/);
    }
  });
});
