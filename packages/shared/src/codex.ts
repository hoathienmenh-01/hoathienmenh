/**
 * Phase 32.0 — Tu Tiên Bách Khoa / Content Codex / Bestiary / Guidebook.
 *
 * Codex là **read-only knowledge layer** trên catalog hiện có (items.ts,
 * monsters/combat.ts, maps/dungeons, realms, sects, methods, artifacts,
 * pills, quests). KHÔNG là reward generator — chỉ tổng hợp + index +
 * hiển thị + tích hợp với Market giá tham khảo.
 *
 * **Invariant (spec PHẦN 1 §3)**:
 *   - Codex KHÔNG tự generate item/tiền — chỉ là index + visibility.
 *   - Codex KHÔNG bypass shop / drop policy — sourceHint chỉ là gợi ý.
 *   - Codex KHÔNG hardcode mass catalog — reuse existing data.
 *   - Admin có thể hide/show/reindex 1 entry mà KHÔNG sửa catalog.
 *
 * Pure — không I/O, không Prisma, không env. Test deterministic.
 */

// ---------------------------------------------------------------------------
// 1. Enums — entry type / visibility / source / dependency
// ---------------------------------------------------------------------------

export const CODEX_ENTRY_TYPES = [
  'ITEM',
  'MATERIAL',
  'PILL',
  'EQUIPMENT',
  'ARTIFACT',
  'METHOD',
  'RECIPE',
  'MONSTER',
  'ELITE_MONSTER',
  'BOSS',
  'WORLD_BOSS',
  'EVENT_BOSS',
  'SECT_BOSS',
  'FARM_MAP',
  'DUNGEON',
  'SECT_DUNGEON',
  'TRIAL_TOWER',
  'REALM',
  'BODY_REALM',
  'NPC',
  'QUEST',
  'EVENT',
] as const;
export type CodexEntryType = (typeof CODEX_ENTRY_TYPES)[number];

export function isCodexEntryType(s: unknown): s is CodexEntryType {
  return (
    typeof s === 'string' && (CODEX_ENTRY_TYPES as readonly string[]).includes(s)
  );
}

export const CODEX_VISIBILITIES = [
  'PUBLIC',
  'DISCOVERED_ONLY',
  'HIDDEN_UNTIL_DISCOVERED',
  'ADMIN_ONLY',
] as const;
export type CodexVisibility = (typeof CODEX_VISIBILITIES)[number];

export function isCodexVisibility(s: unknown): s is CodexVisibility {
  return (
    typeof s === 'string' && (CODEX_VISIBILITIES as readonly string[]).includes(s)
  );
}

export const CODEX_SOURCE_TYPES = [
  'DROP',
  'SHOP',
  'CRAFT',
  'ALCHEMY',
  'ARTIFACT_CRAFT',
  'QUEST_REWARD',
  'EVENT_REWARD',
  'BOSS_REWARD',
  'DUNGEON_REWARD',
  'SECT_TREASURY',
  'MARKET',
  'ADMIN_ONLY',
] as const;
export type CodexSourceType = (typeof CODEX_SOURCE_TYPES)[number];

export function isCodexSourceType(s: unknown): s is CodexSourceType {
  return (
    typeof s === 'string' && (CODEX_SOURCE_TYPES as readonly string[]).includes(s)
  );
}

// ---------------------------------------------------------------------------
// 2. Entry & source hint types
// ---------------------------------------------------------------------------

/**
 * Source hint của 1 entry. KHÔNG đảm bảo drop rate exact — chỉ là gợi ý
 * để player biết nên đi đâu. Server vẫn áp dụng drop policy/multiplier
 * thực tế khi roll.
 */
export interface CodexSourceHint {
  type: CodexSourceType;
  /** Tham chiếu nguồn (e.g. monsterKey, mapKey, dungeonKey, shopKey). */
  sourceKey: string;
  /** Tên hiển thị cho UI (i18n VI default). */
  sourceLabel?: string;
  /** Tỉ lệ rơi ước tính (decimal 0..1) — chỉ để UI hiển thị. */
  estDropRatePct?: number;
  /** Realm/yêu cầu để có thể access nguồn này. */
  realmRequired?: string;
  /** Note bổ sung. */
  notes?: string;
}

/**
 * Usage hint — entry này dùng làm gì (recipe, breakthrough, summon, …).
 */
export interface CodexUsageHint {
  /** Kiểu sử dụng (CRAFT_INPUT, BREAKTHROUGH, SKILL_BOOK, …). */
  kind: string;
  /** Target key của recipe/skill/method nếu có. */
  targetKey?: string;
  description?: string;
}

/**
 * Codex entry chính. Tất cả field stable theo time — admin có thể
 * override `displayName/description/visibility` nhưng KHÔNG nên đổi
 * `entryKey/type/refKey`.
 */
export interface CodexEntryDef {
  entryKey: string;
  type: CodexEntryType;
  /** Key của object gốc (itemKey / monsterKey / mapKey …). */
  refKey: string;
  displayName: string;
  description?: string;
  iconKey?: string;
  visibility: CodexVisibility;
  tags?: readonly string[];
  /** Hint nguồn lấy entry này (chỉ với ITEM/MATERIAL/PILL/EQUIPMENT). */
  sourceHints?: readonly CodexSourceHint[];
  /** Hint sử dụng (chỉ với material/recipe/skill book). */
  usageHints?: readonly CodexUsageHint[];
  /** Linked entries (cross-reference). */
  relatedEntryKeys?: readonly string[];
  /** Realm tối thiểu để xem (gating). */
  realmRequired?: string;
  /** Quality (chỉ với item-like). */
  quality?: string;
  /** Tier (chỉ với item-like). */
  tier?: number;
  /** Updated by admin name + ISO timestamp. */
  updatedBy?: string;
  updatedAt?: string;
}

export const CODEX_DISPLAY_NAME_MAX = 80;
export const CODEX_DESCRIPTION_MAX = 1000;
export const CODEX_TAG_MAX_PER_ENTRY = 12;
export const CODEX_SOURCE_HINT_MAX_PER_ENTRY = 20;
export const CODEX_USAGE_HINT_MAX_PER_ENTRY = 20;
export const CODEX_RELATED_MAX_PER_ENTRY = 20;

export function validateCodexEntry(e: CodexEntryDef): string[] {
  const errors: string[] = [];
  if (!e.entryKey || e.entryKey.trim() === '') {
    errors.push('CODEX_ENTRY_KEY_REQUIRED');
  }
  if (!isCodexEntryType(e.type)) errors.push('CODEX_INVALID_TYPE');
  if (!e.refKey || e.refKey.trim() === '') errors.push('CODEX_REF_KEY_REQUIRED');
  if (!e.displayName || e.displayName.trim() === '') {
    errors.push('CODEX_DISPLAY_NAME_REQUIRED');
  }
  if (e.displayName && e.displayName.length > CODEX_DISPLAY_NAME_MAX) {
    errors.push('CODEX_DISPLAY_NAME_TOO_LONG');
  }
  if (e.description && e.description.length > CODEX_DESCRIPTION_MAX) {
    errors.push('CODEX_DESCRIPTION_TOO_LONG');
  }
  if (!isCodexVisibility(e.visibility)) {
    errors.push('CODEX_INVALID_VISIBILITY');
  }
  if (e.tags && e.tags.length > CODEX_TAG_MAX_PER_ENTRY) {
    errors.push('CODEX_TOO_MANY_TAGS');
  }
  if (
    e.sourceHints &&
    e.sourceHints.length > CODEX_SOURCE_HINT_MAX_PER_ENTRY
  ) {
    errors.push('CODEX_TOO_MANY_SOURCE_HINTS');
  }
  if (e.usageHints && e.usageHints.length > CODEX_USAGE_HINT_MAX_PER_ENTRY) {
    errors.push('CODEX_TOO_MANY_USAGE_HINTS');
  }
  if (
    e.relatedEntryKeys &&
    e.relatedEntryKeys.length > CODEX_RELATED_MAX_PER_ENTRY
  ) {
    errors.push('CODEX_TOO_MANY_RELATED_ENTRIES');
  }
  if (e.sourceHints) {
    for (const h of e.sourceHints) {
      if (!isCodexSourceType(h.type)) {
        errors.push('CODEX_INVALID_SOURCE_TYPE');
        break;
      }
      if (!h.sourceKey || h.sourceKey.trim() === '') {
        errors.push('CODEX_SOURCE_KEY_REQUIRED');
        break;
      }
      if (
        h.estDropRatePct !== undefined &&
        (h.estDropRatePct < 0 || h.estDropRatePct > 1)
      ) {
        errors.push('CODEX_SOURCE_DROP_OUT_OF_RANGE');
        break;
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// 3. Bestiary helper
// ---------------------------------------------------------------------------

export interface BestiaryStatBlock {
  hp?: number;
  atk?: number;
  def?: number;
  speed?: number;
  level?: number;
  realmOrder?: number;
  element?: string;
  weakness?: readonly string[];
  resistance?: readonly string[];
}

export interface BestiaryEntryDef extends CodexEntryDef {
  stats: BestiaryStatBlock;
  /** Drop hint pre-aggregated. */
  dropHints?: readonly CodexSourceHint[];
}

/**
 * Visibility logic: entry hiển thị cho player nếu:
 *   - visibility = PUBLIC; HOẶC
 *   - DISCOVERED_ONLY/HIDDEN_UNTIL_DISCOVERED và player đã discover; HOẶC
 *   - viewerIsAdmin.
 */
export function isEntryVisible(
  entry: CodexEntryDef,
  ctx: { viewerIsAdmin: boolean; discovered: boolean },
): boolean {
  if (ctx.viewerIsAdmin) return true;
  if (entry.visibility === 'ADMIN_ONLY') return false;
  if (entry.visibility === 'PUBLIC') return true;
  return ctx.discovered;
}

// ---------------------------------------------------------------------------
// 4. Collection progress
// ---------------------------------------------------------------------------

export interface CodexProgressInput {
  totalEntries: number;
  discoveredEntries: number;
  totalBestiary: number;
  discoveredBestiary: number;
}

export interface CodexProgressSummary {
  overallPct: number;
  bestiaryPct: number;
  isComplete: boolean;
}

export function summarizeCodexProgress(
  input: CodexProgressInput,
): CodexProgressSummary {
  const overall =
    input.totalEntries === 0
      ? 0
      : Math.min(100, (input.discoveredEntries / input.totalEntries) * 100);
  const bestiary =
    input.totalBestiary === 0
      ? 0
      : Math.min(100, (input.discoveredBestiary / input.totalBestiary) * 100);
  return {
    overallPct: Math.round(overall * 10) / 10,
    bestiaryPct: Math.round(bestiary * 10) / 10,
    isComplete: overall >= 100,
  };
}

// ---------------------------------------------------------------------------
// 5. Indexer — derive entries từ catalog
// ---------------------------------------------------------------------------

export interface IndexerInputItem {
  itemKey: string;
  name?: string;
  description?: string;
  quality?: string;
  tier?: number;
  marketTradeable?: boolean;
  bindOnPickup?: boolean;
  sourceHint?: readonly { kind: string; refKey?: string; label?: string }[];
}

export interface IndexerInputMonster {
  monsterKey: string;
  name?: string;
  description?: string;
  realmOrder?: number;
  element?: string;
  hp?: number;
  atk?: number;
  def?: number;
  speed?: number;
  level?: number;
  weakness?: readonly string[];
  resistance?: readonly string[];
  isBoss?: boolean;
  isWorldBoss?: boolean;
  isEliteMonster?: boolean;
  isSectBoss?: boolean;
  isEventBoss?: boolean;
}

export interface IndexerInputMap {
  mapKey: string;
  name?: string;
  description?: string;
  realmOrder?: number;
  isDungeon?: boolean;
  isSectDungeon?: boolean;
  isTrialTower?: boolean;
}

export interface IndexerInputRealm {
  realmKey: string;
  name?: string;
  description?: string;
  order: number;
  isBody?: boolean;
}

export interface IndexerInput {
  items?: readonly IndexerInputItem[];
  monsters?: readonly IndexerInputMonster[];
  maps?: readonly IndexerInputMap[];
  realms?: readonly IndexerInputRealm[];
}

/**
 * Derive codex entry list từ catalog input. Pure, deterministic.
 * KHÔNG generate reward / sửa catalog.
 */
export function indexCatalogToCodex(input: IndexerInput): CodexEntryDef[] {
  const out: CodexEntryDef[] = [];

  // Items
  for (const item of input.items ?? []) {
    out.push({
      entryKey: `item:${item.itemKey}`,
      type: classifyItemKind(item),
      refKey: item.itemKey,
      displayName: item.name ?? item.itemKey,
      description: item.description,
      visibility: 'PUBLIC',
      quality: item.quality,
      tier: item.tier,
      sourceHints: item.sourceHint?.map(
        (h): CodexSourceHint => ({
          type: hintKindToSourceType(h.kind),
          sourceKey: h.refKey ?? h.kind,
          sourceLabel: h.label,
        }),
      ),
    });
  }

  // Monsters
  for (const m of input.monsters ?? []) {
    out.push({
      entryKey: `monster:${m.monsterKey}`,
      type: classifyMonsterType(m),
      refKey: m.monsterKey,
      displayName: m.name ?? m.monsterKey,
      description: m.description,
      visibility: 'DISCOVERED_ONLY',
    });
  }

  // Maps
  for (const map of input.maps ?? []) {
    out.push({
      entryKey: `map:${map.mapKey}`,
      type: classifyMapType(map),
      refKey: map.mapKey,
      displayName: map.name ?? map.mapKey,
      description: map.description,
      visibility: 'PUBLIC',
    });
  }

  // Realms
  for (const r of input.realms ?? []) {
    out.push({
      entryKey: `realm:${r.realmKey}`,
      type: r.isBody ? 'BODY_REALM' : 'REALM',
      refKey: r.realmKey,
      displayName: r.name ?? r.realmKey,
      description: r.description,
      visibility: 'PUBLIC',
    });
  }

  return out;
}

function classifyItemKind(item: IndexerInputItem): CodexEntryType {
  const key = item.itemKey.toLowerCase();
  if (key.startsWith('pill_') || key.includes('_dan_') || key.endsWith('_dan')) {
    return 'PILL';
  }
  if (key.startsWith('artifact_') || key.includes('artifact')) return 'ARTIFACT';
  if (key.startsWith('material_') || key.startsWith('ore_') || key.includes('material')) {
    return 'MATERIAL';
  }
  if (
    key.includes('weapon') ||
    key.includes('armor') ||
    key.includes('boots') ||
    key.includes('hat') ||
    key.includes('belt')
  ) {
    return 'EQUIPMENT';
  }
  return 'ITEM';
}

function classifyMonsterType(m: IndexerInputMonster): CodexEntryType {
  if (m.isWorldBoss) return 'WORLD_BOSS';
  if (m.isSectBoss) return 'SECT_BOSS';
  if (m.isEventBoss) return 'EVENT_BOSS';
  if (m.isBoss) return 'BOSS';
  if (m.isEliteMonster) return 'ELITE_MONSTER';
  return 'MONSTER';
}

function classifyMapType(m: IndexerInputMap): CodexEntryType {
  if (m.isTrialTower) return 'TRIAL_TOWER';
  if (m.isSectDungeon) return 'SECT_DUNGEON';
  if (m.isDungeon) return 'DUNGEON';
  return 'FARM_MAP';
}

function hintKindToSourceType(kind: string): CodexSourceType {
  const upper = kind.toUpperCase();
  if (upper.includes('DROP')) return 'DROP';
  if (upper.includes('SHOP')) return 'SHOP';
  if (upper.includes('CRAFT_ARTIFACT')) return 'ARTIFACT_CRAFT';
  if (upper.includes('CRAFT')) return 'CRAFT';
  if (upper.includes('ALCHEMY') || upper.includes('LUYEN_DAN')) return 'ALCHEMY';
  if (upper.includes('QUEST')) return 'QUEST_REWARD';
  if (upper.includes('EVENT')) return 'EVENT_REWARD';
  if (upper.includes('BOSS')) return 'BOSS_REWARD';
  if (upper.includes('DUNGEON')) return 'DUNGEON_REWARD';
  if (upper.includes('SECT')) return 'SECT_TREASURY';
  return 'ADMIN_ONLY';
}

// ---------------------------------------------------------------------------
// 6. Audit (admin)
// ---------------------------------------------------------------------------

export const CODEX_AUDIT_ISSUE_TYPES = [
  'MISSING_DESCRIPTION',
  'MISSING_SOURCE_HINT',
  'MISSING_USAGE_HINT',
  'BROKEN_REF',
  'ORPHAN_REF',
  'DUPLICATE_ENTRY_KEY',
  'INVALID_VISIBILITY',
  'MISSING_ICON',
] as const;
export type CodexAuditIssueType = (typeof CODEX_AUDIT_ISSUE_TYPES)[number];

export const CODEX_AUDIT_SEVERITIES = ['INFO', 'WARN', 'CRITICAL'] as const;
export type CodexAuditSeverity = (typeof CODEX_AUDIT_SEVERITIES)[number];

export const CODEX_AUDIT_DEFAULT_SEVERITY: Readonly<
  Record<CodexAuditIssueType, CodexAuditSeverity>
> = {
  MISSING_DESCRIPTION: 'INFO',
  MISSING_SOURCE_HINT: 'WARN',
  MISSING_USAGE_HINT: 'INFO',
  BROKEN_REF: 'CRITICAL',
  ORPHAN_REF: 'WARN',
  DUPLICATE_ENTRY_KEY: 'CRITICAL',
  INVALID_VISIBILITY: 'WARN',
  MISSING_ICON: 'INFO',
};

export interface CodexAuditIssueDef {
  issueKey: string;
  entryKey: string;
  type: CodexAuditIssueType;
  severity: CodexAuditSeverity;
  message: string;
  resolved?: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
}

export function classifyCodexAuditSeverity(
  type: CodexAuditIssueType,
): CodexAuditSeverity {
  return CODEX_AUDIT_DEFAULT_SEVERITY[type];
}

/**
 * Pure audit pass — scan list entry, return list issues.
 */
export function auditCodexEntries(
  entries: readonly CodexEntryDef[],
): CodexAuditIssueDef[] {
  const issues: CodexAuditIssueDef[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.entryKey)) {
      issues.push({
        issueKey: `dup:${e.entryKey}`,
        entryKey: e.entryKey,
        type: 'DUPLICATE_ENTRY_KEY',
        severity: 'CRITICAL',
        message: `Duplicate entryKey ${e.entryKey}`,
      });
      continue;
    }
    seen.add(e.entryKey);
    if (!e.description || e.description.trim() === '') {
      issues.push({
        issueKey: `missing_desc:${e.entryKey}`,
        entryKey: e.entryKey,
        type: 'MISSING_DESCRIPTION',
        severity: 'INFO',
        message: `Missing description for ${e.entryKey}`,
      });
    }
    if (
      ['ITEM', 'MATERIAL', 'PILL', 'EQUIPMENT', 'ARTIFACT'].includes(e.type) &&
      (!e.sourceHints || e.sourceHints.length === 0)
    ) {
      issues.push({
        issueKey: `missing_src:${e.entryKey}`,
        entryKey: e.entryKey,
        type: 'MISSING_SOURCE_HINT',
        severity: 'WARN',
        message: `Item-like entry missing sourceHints: ${e.entryKey}`,
      });
    }
    if (!isCodexVisibility(e.visibility)) {
      issues.push({
        issueKey: `bad_vis:${e.entryKey}`,
        entryKey: e.entryKey,
        type: 'INVALID_VISIBILITY',
        severity: 'WARN',
        message: `Invalid visibility for ${e.entryKey}`,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 7. Error codes
// ---------------------------------------------------------------------------

export const CODEX_ERROR_CODES = [
  'CODEX_ENTRY_KEY_REQUIRED',
  'CODEX_INVALID_TYPE',
  'CODEX_REF_KEY_REQUIRED',
  'CODEX_DISPLAY_NAME_REQUIRED',
  'CODEX_DISPLAY_NAME_TOO_LONG',
  'CODEX_DESCRIPTION_TOO_LONG',
  'CODEX_INVALID_VISIBILITY',
  'CODEX_TOO_MANY_TAGS',
  'CODEX_TOO_MANY_SOURCE_HINTS',
  'CODEX_TOO_MANY_USAGE_HINTS',
  'CODEX_TOO_MANY_RELATED_ENTRIES',
  'CODEX_INVALID_SOURCE_TYPE',
  'CODEX_SOURCE_KEY_REQUIRED',
  'CODEX_SOURCE_DROP_OUT_OF_RANGE',
  'CODEX_ENTRY_NOT_FOUND',
  'CODEX_ENTRY_NOT_VISIBLE',
] as const;
export type CodexErrorCode = (typeof CODEX_ERROR_CODES)[number];
