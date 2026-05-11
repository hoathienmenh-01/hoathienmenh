import { describe, expect, it } from 'vitest';
import {
  MAINTENANCE_BLOCK_ERROR_CODE,
  MAINTENANCE_BROADCAST_TYPES,
  MAINTENANCE_MAX_WINDOW_MS,
  MAINTENANCE_MESSAGE_MAX,
  MAINTENANCE_MIN_WINDOW_MS,
  MAINTENANCE_SEVERITIES,
  MAINTENANCE_TARGETS,
  MAINTENANCE_TITLE_MAX,
  MAINTENANCE_WINDOW_STATUSES,
  MAINTENANCE_WS_CHANNEL,
  buildMaintenanceBroadcastPayload,
  isMaintenanceTextSafe,
  isMaintenanceWindowActiveAt,
  isValidMaintenanceSeverity,
  isValidMaintenanceTarget,
  isValidMaintenanceWindowStatus,
  maintenanceSeverityRank,
  maintenanceTargetRank,
  nextMaintenanceWindowStatus,
  pickActiveMaintenanceWindow,
  pickMaintenanceText,
  validateMaintenanceWindowInput,
  type MaintenanceBroadcastInternalInput,
  type MaintenanceWindowInput,
  type MaintenanceWindowSelectorRow,
} from './maintenance-window';

const REF = new Date('2026-07-01T00:00:00.000Z');

function baseInput(
  overrides: Partial<MaintenanceWindowInput> = {},
): MaintenanceWindowInput {
  const startsAt = new Date(REF.getTime() + 3600_000); // +1h
  const endsAt = new Date(REF.getTime() + 7200_000); // +2h
  return {
    key: 'planned-db-migration',
    severity: 'WARNING',
    target: 'ALL_PLAYERS',
    titleVi: 'Bảo trì hệ thống',
    titleEn: null,
    messageVi: 'Server đang bảo trì, vui lòng quay lại sau.',
    messageEn: null,
    startsAt,
    endsAt,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Catalog enums
// ---------------------------------------------------------------------------

describe('Maintenance enums', () => {
  it('catalogs are exhaustive', () => {
    expect(MAINTENANCE_SEVERITIES).toEqual(['INFO', 'WARNING', 'CRITICAL']);
    expect(MAINTENANCE_TARGETS).toEqual([
      'ALL_PLAYERS',
      'NON_ADMIN_USERS',
      'API_WRITE_ONLY',
      'FULL_LOCKDOWN',
    ]);
    expect(MAINTENANCE_WINDOW_STATUSES).toEqual([
      'DRAFT',
      'SCHEDULED',
      'ACTIVE',
      'ENDED',
      'DISABLED',
    ]);
  });

  it('isValidMaintenanceSeverity / Target / WindowStatus accept valid + reject invalid', () => {
    expect(isValidMaintenanceSeverity('CRITICAL')).toBe(true);
    expect(isValidMaintenanceSeverity('FATAL')).toBe(false);
    expect(isValidMaintenanceTarget('ALL_PLAYERS')).toBe(true);
    expect(isValidMaintenanceTarget('GLOBAL')).toBe(false);
    expect(isValidMaintenanceWindowStatus('ACTIVE')).toBe(true);
    expect(isValidMaintenanceWindowStatus('PAUSED')).toBe(false);
  });

  it('exposes block error code constant', () => {
    expect(MAINTENANCE_BLOCK_ERROR_CODE).toBe('MAINTENANCE_ACTIVE');
  });
});

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

describe('validateMaintenanceWindowInput', () => {
  it('accepts valid base input', () => {
    expect(validateMaintenanceWindowInput(baseInput())).toBeNull();
  });

  it('rejects invalid key', () => {
    expect(
      validateMaintenanceWindowInput(baseInput({ key: 'BAD KEY' })),
    ).toBe('MAINTENANCE_KEY_INVALID');
    expect(
      validateMaintenanceWindowInput(baseInput({ key: '' })),
    ).toBe('MAINTENANCE_KEY_INVALID');
    expect(
      validateMaintenanceWindowInput(baseInput({ key: 'a' })),
    ).toBe('MAINTENANCE_KEY_INVALID');
  });

  it('rejects invalid severity / target', () => {
    const input = baseInput();
    expect(
      validateMaintenanceWindowInput({
        ...input,
        // @ts-expect-error force invalid
        severity: 'FATAL',
      }),
    ).toBe('MAINTENANCE_SEVERITY_INVALID');
    expect(
      validateMaintenanceWindowInput({
        ...input,
        // @ts-expect-error force invalid
        target: 'GLOBAL',
      }),
    ).toBe('MAINTENANCE_TARGET_INVALID');
  });

  it('rejects empty title / message', () => {
    expect(
      validateMaintenanceWindowInput(baseInput({ titleVi: '' })),
    ).toBe('MAINTENANCE_TITLE_REQUIRED');
    expect(
      validateMaintenanceWindowInput(baseInput({ messageVi: '   ' })),
    ).toBe('MAINTENANCE_MESSAGE_REQUIRED');
  });

  it('rejects overlong title / message', () => {
    expect(
      validateMaintenanceWindowInput(
        baseInput({ titleVi: 'a'.repeat(MAINTENANCE_TITLE_MAX + 1) }),
      ),
    ).toBe('MAINTENANCE_TITLE_TOO_LONG');
    expect(
      validateMaintenanceWindowInput(
        baseInput({ messageVi: 'b'.repeat(MAINTENANCE_MESSAGE_MAX + 1) }),
      ),
    ).toBe('MAINTENANCE_MESSAGE_TOO_LONG');
  });

  it('rejects HTML / script injection', () => {
    expect(
      validateMaintenanceWindowInput(
        baseInput({ titleVi: 'Bảo trì <script>' }),
      ),
    ).toBe('MAINTENANCE_TITLE_UNSAFE');
    expect(
      validateMaintenanceWindowInput(
        baseInput({
          messageVi: 'Click javascript:alert(1) để tiếp tục',
        }),
      ),
    ).toBe('MAINTENANCE_MESSAGE_UNSAFE');
    expect(
      validateMaintenanceWindowInput(
        baseInput({ messageVi: 'Hello &lt;encoded&gt;' }),
      ),
    ).toBe('MAINTENANCE_MESSAGE_UNSAFE');
  });

  it('isMaintenanceTextSafe accepts unicode + emoji', () => {
    expect(isMaintenanceTextSafe('Bảo trì 🚧 hệ thống')).toBe(true);
    expect(isMaintenanceTextSafe('plain ascii ok')).toBe(true);
    expect(isMaintenanceTextSafe('')).toBe(false);
    expect(isMaintenanceTextSafe('has\x00null')).toBe(false);
  });

  it('rejects locale parity violation', () => {
    expect(
      validateMaintenanceWindowInput(
        baseInput({ titleEn: 'Maintenance', messageEn: null }),
      ),
    ).toBe('MAINTENANCE_LOCALE_PARITY');
    expect(
      validateMaintenanceWindowInput(
        baseInput({ titleEn: null, messageEn: 'msg-en' }),
      ),
    ).toBe('MAINTENANCE_LOCALE_PARITY');
  });

  it('accepts both locales together', () => {
    expect(
      validateMaintenanceWindowInput(
        baseInput({
          titleEn: 'System maintenance',
          messageEn: 'Server is undergoing maintenance, please retry later.',
        }),
      ),
    ).toBeNull();
  });

  it('rejects invalid window (start >= end)', () => {
    const startsAt = new Date(REF.getTime() + 3600_000);
    expect(
      validateMaintenanceWindowInput(
        baseInput({ startsAt, endsAt: startsAt }),
      ),
    ).toBe('MAINTENANCE_WINDOW_INVALID');
    expect(
      validateMaintenanceWindowInput(
        baseInput({
          startsAt,
          endsAt: new Date(startsAt.getTime() - 1000),
        }),
      ),
    ).toBe('MAINTENANCE_WINDOW_INVALID');
  });

  it('rejects window too short / too long', () => {
    const startsAt = new Date(REF.getTime() + 3600_000);
    expect(
      validateMaintenanceWindowInput(
        baseInput({
          startsAt,
          endsAt: new Date(
            startsAt.getTime() + MAINTENANCE_MIN_WINDOW_MS - 1000,
          ),
        }),
      ),
    ).toBe('MAINTENANCE_WINDOW_TOO_SHORT');
    expect(
      validateMaintenanceWindowInput(
        baseInput({
          startsAt,
          endsAt: new Date(
            startsAt.getTime() + MAINTENANCE_MAX_WINDOW_MS + 1000,
          ),
        }),
      ),
    ).toBe('MAINTENANCE_WINDOW_TOO_LONG');
  });
});

// ---------------------------------------------------------------------------
// Status transition
// ---------------------------------------------------------------------------

describe('nextMaintenanceWindowStatus', () => {
  const startsAt = new Date(REF.getTime() + 3600_000);
  const endsAt = new Date(REF.getTime() + 7200_000);

  it('DRAFT / DISABLED / ENDED do not transition', () => {
    expect(
      nextMaintenanceWindowStatus(
        'DRAFT',
        startsAt,
        endsAt,
        new Date(endsAt.getTime() + 1000),
      ),
    ).toBe('DRAFT');
    expect(
      nextMaintenanceWindowStatus(
        'DISABLED',
        startsAt,
        endsAt,
        new Date(endsAt.getTime() + 1000),
      ),
    ).toBe('DISABLED');
    expect(
      nextMaintenanceWindowStatus('ENDED', startsAt, endsAt, REF),
    ).toBe('ENDED');
  });

  it('SCHEDULED → ACTIVE when now in window', () => {
    expect(
      nextMaintenanceWindowStatus(
        'SCHEDULED',
        startsAt,
        endsAt,
        new Date(startsAt.getTime() + 60_000),
      ),
    ).toBe('ACTIVE');
  });

  it('SCHEDULED → ENDED when now past endsAt', () => {
    expect(
      nextMaintenanceWindowStatus(
        'SCHEDULED',
        startsAt,
        endsAt,
        new Date(endsAt.getTime() + 60_000),
      ),
    ).toBe('ENDED');
  });

  it('ACTIVE → ENDED when now past endsAt', () => {
    expect(
      nextMaintenanceWindowStatus(
        'ACTIVE',
        startsAt,
        endsAt,
        new Date(endsAt.getTime() + 1),
      ),
    ).toBe('ENDED');
  });

  it('ACTIVE stays ACTIVE while inside window', () => {
    expect(
      nextMaintenanceWindowStatus(
        'ACTIVE',
        startsAt,
        endsAt,
        new Date(startsAt.getTime() + 1),
      ),
    ).toBe('ACTIVE');
  });

  it('idempotent — calling twice returns same value', () => {
    const now = new Date(startsAt.getTime() + 60_000);
    const a = nextMaintenanceWindowStatus('SCHEDULED', startsAt, endsAt, now);
    const b = nextMaintenanceWindowStatus(a, startsAt, endsAt, now);
    expect(a).toBe('ACTIVE');
    expect(b).toBe('ACTIVE');
  });
});

describe('isMaintenanceWindowActiveAt', () => {
  const startsAt = new Date(REF.getTime());
  const endsAt = new Date(REF.getTime() + 1000);
  it('start inclusive, end exclusive', () => {
    expect(isMaintenanceWindowActiveAt(startsAt, endsAt, startsAt)).toBe(true);
    expect(
      isMaintenanceWindowActiveAt(
        startsAt,
        endsAt,
        new Date(startsAt.getTime() + 500),
      ),
    ).toBe(true);
    expect(isMaintenanceWindowActiveAt(startsAt, endsAt, endsAt)).toBe(false);
    expect(
      isMaintenanceWindowActiveAt(
        startsAt,
        endsAt,
        new Date(startsAt.getTime() - 1),
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pickActiveMaintenanceWindow
// ---------------------------------------------------------------------------

function row(
  overrides: Partial<MaintenanceWindowSelectorRow>,
): MaintenanceWindowSelectorRow {
  return {
    key: overrides.key ?? 'k',
    status: overrides.status ?? 'ACTIVE',
    severity: overrides.severity ?? 'INFO',
    target: overrides.target ?? 'ALL_PLAYERS',
    startsAt: overrides.startsAt ?? new Date(REF.getTime() - 1000),
    endsAt: overrides.endsAt ?? new Date(REF.getTime() + 1000),
  };
}

describe('pickActiveMaintenanceWindow', () => {
  it('returns null when no rows', () => {
    expect(pickActiveMaintenanceWindow([], REF)).toBeNull();
  });

  it('skips non-ACTIVE rows', () => {
    expect(
      pickActiveMaintenanceWindow(
        [
          row({ key: 'a', status: 'SCHEDULED' }),
          row({ key: 'b', status: 'DISABLED' }),
          row({ key: 'c', status: 'ENDED' }),
        ],
        REF,
      ),
    ).toBeNull();
  });

  it('skips ACTIVE rows where now is outside the window', () => {
    const t = REF.getTime();
    expect(
      pickActiveMaintenanceWindow(
        [
          row({
            key: 'past',
            startsAt: new Date(t - 2000),
            endsAt: new Date(t - 1000),
          }),
          row({
            key: 'future',
            startsAt: new Date(t + 1000),
            endsAt: new Date(t + 2000),
          }),
        ],
        REF,
      ),
    ).toBeNull();
  });

  it('CRITICAL severity wins over WARNING / INFO', () => {
    const winner = pickActiveMaintenanceWindow(
      [
        row({ key: 'info', severity: 'INFO' }),
        row({ key: 'warn', severity: 'WARNING' }),
        row({ key: 'crit', severity: 'CRITICAL' }),
      ],
      REF,
    );
    expect(winner?.key).toBe('crit');
  });

  it('within same severity, stricter target wins', () => {
    const winner = pickActiveMaintenanceWindow(
      [
        row({
          key: 'write',
          severity: 'CRITICAL',
          target: 'API_WRITE_ONLY',
        }),
        row({
          key: 'lock',
          severity: 'CRITICAL',
          target: 'FULL_LOCKDOWN',
        }),
        row({
          key: 'all',
          severity: 'CRITICAL',
          target: 'ALL_PLAYERS',
        }),
      ],
      REF,
    );
    expect(winner?.key).toBe('lock');
  });

  it('within same severity + target, earlier endsAt wins', () => {
    const t = REF.getTime();
    const winner = pickActiveMaintenanceWindow(
      [
        row({
          key: 'late',
          severity: 'WARNING',
          endsAt: new Date(t + 5000),
        }),
        row({
          key: 'soon',
          severity: 'WARNING',
          endsAt: new Date(t + 2000),
        }),
      ],
      REF,
    );
    expect(winner?.key).toBe('soon');
  });

  it('rank helpers expose deterministic ordering', () => {
    expect(maintenanceSeverityRank('INFO')).toBeLessThan(
      maintenanceSeverityRank('WARNING'),
    );
    expect(maintenanceSeverityRank('WARNING')).toBeLessThan(
      maintenanceSeverityRank('CRITICAL'),
    );
    expect(maintenanceTargetRank('API_WRITE_ONLY')).toBeLessThan(
      maintenanceTargetRank('NON_ADMIN_USERS'),
    );
    expect(maintenanceTargetRank('NON_ADMIN_USERS')).toBeLessThan(
      maintenanceTargetRank('ALL_PLAYERS'),
    );
    expect(maintenanceTargetRank('ALL_PLAYERS')).toBeLessThan(
      maintenanceTargetRank('FULL_LOCKDOWN'),
    );
  });
});

// ---------------------------------------------------------------------------
// pickMaintenanceText
// ---------------------------------------------------------------------------

describe('pickMaintenanceText', () => {
  it('returns en when locale=en and en non-empty', () => {
    expect(pickMaintenanceText('vi', 'en text', 'en')).toBe('en text');
  });
  it('falls back to vi when locale=en and en is null/empty', () => {
    expect(pickMaintenanceText('vi text', null, 'en')).toBe('vi text');
    expect(pickMaintenanceText('vi text', '', 'en')).toBe('vi text');
  });
  it('returns vi when locale=vi regardless of en', () => {
    expect(pickMaintenanceText('vi text', 'en text', 'vi')).toBe('vi text');
  });
});

// ---------------------------------------------------------------------------
// Phase 15.8 — Maintenance WS broadcast payload sanitizer
// ---------------------------------------------------------------------------

function baseBroadcastInput(
  overrides: Partial<MaintenanceBroadcastInternalInput> = {},
): MaintenanceBroadcastInternalInput {
  return {
    key: 'mw-2026-08-01',
    status: 'ACTIVE',
    severity: 'WARNING',
    target: 'ALL_PLAYERS',
    titleVi: 'Bảo trì',
    titleEn: 'Maintenance',
    messageVi: 'Server đang bảo trì.',
    messageEn: 'Server is under maintenance.',
    startsAt: new Date('2026-08-01T00:00:00.000Z'),
    endsAt: new Date('2026-08-01T02:00:00.000Z'),
    allowAdminBypass: true,
    createdByAdminId: 'admin-secret-123',
    createdAt: new Date('2026-07-31T10:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:01.000Z'),
    disabledAt: null,
    allowMetrics: true,
    allowHealthcheck: true,
    ...overrides,
  };
}

describe('MAINTENANCE_WS_CHANNEL', () => {
  it('is stable channel constant', () => {
    expect(MAINTENANCE_WS_CHANNEL).toBe('maintenance:status');
  });
});

describe('MAINTENANCE_BROADCAST_TYPES', () => {
  it('contains exactly 3 transition types', () => {
    expect(MAINTENANCE_BROADCAST_TYPES).toEqual([
      'MAINTENANCE_ACTIVE',
      'MAINTENANCE_ENDED',
      'MAINTENANCE_DISABLED',
    ]);
  });
});

describe('buildMaintenanceBroadcastPayload', () => {
  const NOW = new Date('2026-08-01T00:30:00.000Z');

  it('maps ACTIVE status to MAINTENANCE_ACTIVE type', () => {
    const out = buildMaintenanceBroadcastPayload(
      baseBroadcastInput({ status: 'ACTIVE' }),
      NOW,
    );
    expect(out.type).toBe('MAINTENANCE_ACTIVE');
    expect(out.status).toBe('ACTIVE');
  });

  it('maps ENDED status to MAINTENANCE_ENDED type', () => {
    const out = buildMaintenanceBroadcastPayload(
      baseBroadcastInput({ status: 'ENDED' }),
      NOW,
    );
    expect(out.type).toBe('MAINTENANCE_ENDED');
  });

  it('maps DISABLED status to MAINTENANCE_DISABLED type', () => {
    const out = buildMaintenanceBroadcastPayload(
      baseBroadcastInput({ status: 'DISABLED' }),
      NOW,
    );
    expect(out.type).toBe('MAINTENANCE_DISABLED');
  });

  it('throws on DRAFT/SCHEDULED status (not broadcast-able)', () => {
    expect(() =>
      buildMaintenanceBroadcastPayload(
        baseBroadcastInput({ status: 'DRAFT' }),
        NOW,
      ),
    ).toThrow();
    expect(() =>
      buildMaintenanceBroadcastPayload(
        baseBroadcastInput({ status: 'SCHEDULED' }),
        NOW,
      ),
    ).toThrow();
  });

  it('serializes Date startsAt/endsAt to ISO string', () => {
    const out = buildMaintenanceBroadcastPayload(baseBroadcastInput(), NOW);
    expect(out.startsAt).toBe('2026-08-01T00:00:00.000Z');
    expect(out.endsAt).toBe('2026-08-01T02:00:00.000Z');
    expect(out.serverTime).toBe('2026-08-01T00:30:00.000Z');
  });

  it('passes through string ISO startsAt/endsAt unchanged', () => {
    const out = buildMaintenanceBroadcastPayload(
      baseBroadcastInput({
        startsAt: '2026-08-01T00:00:00.000Z',
        endsAt: '2026-08-01T02:00:00.000Z',
      }),
      NOW,
    );
    expect(out.startsAt).toBe('2026-08-01T00:00:00.000Z');
    expect(out.endsAt).toBe('2026-08-01T02:00:00.000Z');
  });

  it('does NOT leak admin metadata into payload', () => {
    const out = buildMaintenanceBroadcastPayload(
      baseBroadcastInput({
        createdByAdminId: 'admin-leaked-123',
      }),
      NOW,
    );
    const keys = Object.keys(out);
    expect(keys).not.toContain('createdByAdminId');
    expect(keys).not.toContain('createdAt');
    expect(keys).not.toContain('updatedAt');
    expect(keys).not.toContain('disabledAt');
    expect(keys).not.toContain('allowMetrics');
    expect(keys).not.toContain('allowHealthcheck');
    expect(keys).not.toContain('id');
    const json = JSON.stringify(out);
    expect(json).not.toContain('admin-leaked-123');
  });

  it('includes all required public-safe fields', () => {
    const out = buildMaintenanceBroadcastPayload(baseBroadcastInput(), NOW);
    expect(out).toEqual({
      type: 'MAINTENANCE_ACTIVE',
      key: 'mw-2026-08-01',
      status: 'ACTIVE',
      severity: 'WARNING',
      target: 'ALL_PLAYERS',
      titleVi: 'Bảo trì',
      titleEn: 'Maintenance',
      messageVi: 'Server đang bảo trì.',
      messageEn: 'Server is under maintenance.',
      startsAt: '2026-08-01T00:00:00.000Z',
      endsAt: '2026-08-01T02:00:00.000Z',
      serverTime: '2026-08-01T00:30:00.000Z',
      allowAdminBypass: true,
    });
  });
});
