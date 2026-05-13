import { describe, it, expect } from 'vitest';

import {
  validateCodexEntry,
  isEntryVisible,
  summarizeCodexProgress,
  indexCatalogToCodex,
  auditCodexEntries,
  classifyCodexAuditSeverity,
  CODEX_ENTRY_TYPES,
  CODEX_VISIBILITIES,
  CODEX_SOURCE_TYPES,
} from './codex';

describe('Phase 32.0 — codex: enums', () => {
  it('exposes 22 entry types', () => {
    expect(CODEX_ENTRY_TYPES.length).toBe(22);
    expect(CODEX_ENTRY_TYPES).toContain('REALM');
    expect(CODEX_ENTRY_TYPES).toContain('TRIAL_TOWER');
  });

  it('exposes 4 visibilities', () => {
    expect(CODEX_VISIBILITIES).toEqual([
      'PUBLIC',
      'DISCOVERED_ONLY',
      'HIDDEN_UNTIL_DISCOVERED',
      'ADMIN_ONLY',
    ]);
  });

  it('exposes 12 source types', () => {
    expect(CODEX_SOURCE_TYPES.length).toBe(12);
    expect(CODEX_SOURCE_TYPES).toContain('DROP');
    expect(CODEX_SOURCE_TYPES).toContain('ALCHEMY');
  });
});

describe('Phase 32.0 — codex: validateCodexEntry', () => {
  const ok = {
    entryKey: 'item:pill_hp_t1',
    type: 'PILL' as const,
    refKey: 'pill_hp_t1',
    displayName: 'Hồi Khí Đan',
    visibility: 'PUBLIC' as const,
  };

  it('chấp nhận entry hợp lệ', () => {
    expect(validateCodexEntry(ok)).toEqual([]);
  });

  it('reject missing entryKey', () => {
    const errs = validateCodexEntry({ ...ok, entryKey: '' });
    expect(errs).toContain('CODEX_ENTRY_KEY_REQUIRED');
  });

  it('reject invalid visibility', () => {
    const errs = validateCodexEntry({
      ...ok,
      visibility: 'INVALID' as never,
    });
    expect(errs).toContain('CODEX_INVALID_VISIBILITY');
  });

  it('reject displayName quá dài', () => {
    const errs = validateCodexEntry({
      ...ok,
      displayName: 'x'.repeat(100),
    });
    expect(errs).toContain('CODEX_DISPLAY_NAME_TOO_LONG');
  });

  it('reject source hint drop rate ngoài [0..1]', () => {
    const errs = validateCodexEntry({
      ...ok,
      sourceHints: [{ type: 'DROP', sourceKey: 'm1', estDropRatePct: 1.5 }],
    });
    expect(errs).toContain('CODEX_SOURCE_DROP_OUT_OF_RANGE');
  });

  it('reject source hint missing sourceKey', () => {
    const errs = validateCodexEntry({
      ...ok,
      sourceHints: [{ type: 'DROP', sourceKey: '' }],
    });
    expect(errs).toContain('CODEX_SOURCE_KEY_REQUIRED');
  });
});

describe('Phase 32.0 — codex: isEntryVisible', () => {
  const e = {
    entryKey: 'item:foo',
    type: 'ITEM' as const,
    refKey: 'foo',
    displayName: 'Foo',
    visibility: 'PUBLIC' as const,
  };

  it('PUBLIC luôn visible', () => {
    expect(isEntryVisible(e, { viewerIsAdmin: false, discovered: false })).toBe(true);
  });

  it('ADMIN_ONLY ẩn với player thường', () => {
    expect(
      isEntryVisible(
        { ...e, visibility: 'ADMIN_ONLY' },
        { viewerIsAdmin: false, discovered: true },
      ),
    ).toBe(false);
  });

  it('ADMIN_ONLY hiện với admin', () => {
    expect(
      isEntryVisible(
        { ...e, visibility: 'ADMIN_ONLY' },
        { viewerIsAdmin: true, discovered: false },
      ),
    ).toBe(true);
  });

  it('DISCOVERED_ONLY chỉ hiện khi discovered', () => {
    expect(
      isEntryVisible(
        { ...e, visibility: 'DISCOVERED_ONLY' },
        { viewerIsAdmin: false, discovered: false },
      ),
    ).toBe(false);
    expect(
      isEntryVisible(
        { ...e, visibility: 'DISCOVERED_ONLY' },
        { viewerIsAdmin: false, discovered: true },
      ),
    ).toBe(true);
  });
});

describe('Phase 32.0 — codex: summarizeCodexProgress', () => {
  it('rỗng → 0%', () => {
    expect(
      summarizeCodexProgress({
        totalEntries: 0,
        discoveredEntries: 0,
        totalBestiary: 0,
        discoveredBestiary: 0,
      }),
    ).toEqual({ overallPct: 0, bestiaryPct: 0, isComplete: false });
  });

  it('50% overall', () => {
    expect(
      summarizeCodexProgress({
        totalEntries: 10,
        discoveredEntries: 5,
        totalBestiary: 4,
        discoveredBestiary: 2,
      }),
    ).toEqual({ overallPct: 50, bestiaryPct: 50, isComplete: false });
  });

  it('isComplete = true khi 100%', () => {
    const r = summarizeCodexProgress({
      totalEntries: 4,
      discoveredEntries: 4,
      totalBestiary: 4,
      discoveredBestiary: 4,
    });
    expect(r.isComplete).toBe(true);
  });
});

describe('Phase 32.0 — codex: indexCatalogToCodex', () => {
  it('indexes empty input', () => {
    expect(indexCatalogToCodex({})).toEqual([]);
  });

  it('classifies pill correctly', () => {
    const out = indexCatalogToCodex({
      items: [
        {
          itemKey: 'truc_co_ho_mach_dan_t2',
          name: 'Trúc Cơ Hộ Mạch Đan',
          tier: 2,
        },
      ],
    });
    expect(out[0].type).toBe('PILL');
    expect(out[0].entryKey).toBe('item:truc_co_ho_mach_dan_t2');
  });

  it('classifies world boss correctly', () => {
    const out = indexCatalogToCodex({
      monsters: [
        { monsterKey: 'mb_t10', name: 'Yêu Tổ', isWorldBoss: true },
      ],
    });
    expect(out[0].type).toBe('WORLD_BOSS');
  });

  it('classifies dungeon vs farm map', () => {
    const out = indexCatalogToCodex({
      maps: [
        { mapKey: 'd1', isDungeon: true },
        { mapKey: 'f1' },
      ],
    });
    expect(out[0].type).toBe('DUNGEON');
    expect(out[1].type).toBe('FARM_MAP');
  });

  it('classifies body realm separately', () => {
    const out = indexCatalogToCodex({
      realms: [
        { realmKey: 'bodyR1', name: 'Luyện Thể', order: 1, isBody: true },
        { realmKey: 'qiR1', name: 'Luyện Khí', order: 1 },
      ],
    });
    expect(out[0].type).toBe('BODY_REALM');
    expect(out[1].type).toBe('REALM');
  });
});

describe('Phase 32.0 — codex: auditCodexEntries', () => {
  it('detects duplicate entryKey', () => {
    const issues = auditCodexEntries([
      {
        entryKey: 'item:foo',
        type: 'ITEM',
        refKey: 'foo',
        displayName: 'Foo',
        visibility: 'PUBLIC',
      },
      {
        entryKey: 'item:foo',
        type: 'ITEM',
        refKey: 'foo',
        displayName: 'Foo (dup)',
        visibility: 'PUBLIC',
      },
    ]);
    expect(issues.some((i) => i.type === 'DUPLICATE_ENTRY_KEY')).toBe(true);
  });

  it('flags missing source hint cho item-like entry', () => {
    const issues = auditCodexEntries([
      {
        entryKey: 'item:foo',
        type: 'EQUIPMENT',
        refKey: 'foo',
        displayName: 'Foo',
        visibility: 'PUBLIC',
      },
    ]);
    expect(issues.some((i) => i.type === 'MISSING_SOURCE_HINT')).toBe(true);
  });

  it('flags missing description', () => {
    const issues = auditCodexEntries([
      {
        entryKey: 'realm:r1',
        type: 'REALM',
        refKey: 'r1',
        displayName: 'R1',
        visibility: 'PUBLIC',
      },
    ]);
    expect(issues.some((i) => i.type === 'MISSING_DESCRIPTION')).toBe(true);
  });
});

describe('Phase 32.0 — codex: classifyCodexAuditSeverity', () => {
  it('BROKEN_REF = CRITICAL', () => {
    expect(classifyCodexAuditSeverity('BROKEN_REF')).toBe('CRITICAL');
  });
  it('MISSING_DESCRIPTION = INFO', () => {
    expect(classifyCodexAuditSeverity('MISSING_DESCRIPTION')).toBe('INFO');
  });
});
