/**
 * Phase 41.0 — Player Experience, Settings, Feedback, Dashboard,
 * Navigation & UI Quality of Life V1 shared catalog.
 *
 * Định nghĩa enum + DTO + helper validator + i18n key cho:
 *   - Player Settings (font size / appearance / compact / number format / …)
 *   - Player Dashboard + Today Checklist (read-only aggregation,
 *     KHÔNG mint reward).
 *   - Feedback / Bug Report Center.
 *   - Report Player foundation (không auto-ban).
 *   - Navigation registry / Command Palette catalog.
 *
 * Tất cả deterministic, server-authoritative, không có runtime
 * dependency ngoài builtin.
 *
 * KHÔNG đụng gameplay/story/quest/PvP — Phase 41 chỉ là QoL lớp UI/UX
 * + 1 module support backend nhẹ. Không tạo currency/reward mới.
 */

// ─────────────────────────────────────────────────────────────────────
// Player Settings
// ─────────────────────────────────────────────────────────────────────

export const APPEARANCE_VALUES = ['light', 'dark', 'system'] as const;
export type Appearance = (typeof APPEARANCE_VALUES)[number];

export const FONT_SIZE_VALUES = ['small', 'normal', 'large', 'xlarge'] as const;
export type FontSize = (typeof FONT_SIZE_VALUES)[number];

export const NUMBER_FORMAT_VALUES = ['FULL', 'COMPACT'] as const;
export type NumberFormat = (typeof NUMBER_FORMAT_VALUES)[number];

export const LANGUAGE_VALUES = ['vi', 'en'] as const;
export type LanguagePreference = (typeof LANGUAGE_VALUES)[number];

export const LANDING_PAGE_VALUES = [
  'home',
  'dashboard',
  'cultivation',
  'inventory',
  'mail',
] as const;
export type LandingPage = (typeof LANDING_PAGE_VALUES)[number];

/**
 * Phase 42.0 — Visual effect motion level cho PlayerSettings.
 *
 * Cứ "OFF" → tắt mọi animation, fallback static. "LOW" → chỉ effect
 * nhẹ. "MEDIUM" (mặc định) → cần thiết. "HIGH" → đầy đủ.
 */
export const VISUAL_EFFECT_LEVEL_VALUES = [
  'OFF',
  'LOW',
  'MEDIUM',
  'HIGH',
] as const;
export type VisualEffectLevel = (typeof VISUAL_EFFECT_LEVEL_VALUES)[number];

/** Player Settings hard limits / default. */
export const PLAYER_SETTINGS_LIMITS = {
  /** Cap JSON size để tránh blow-up DB row. */
  SETTINGS_JSON_MAX_BYTES: 4 * 1024,
  /** Cap timezone string. */
  TIMEZONE_MAX_LENGTH: 64,
} as const;

export interface PlayerSettings {
  language: LanguagePreference;
  appearance: Appearance;
  fontSize: FontSize;
  compactMode: boolean;
  reduceMotion: boolean;
  showAdvancedStats: boolean;
  showCombatLogDetail: boolean;
  showFarmLogDetail: boolean;
  showSystemTips: boolean;
  defaultLandingPage: LandingPage;
  numberFormat: NumberFormat;
  timezone: string | null;
  /** Notification preferences (per Phase 31 NotificationType key). */
  notificationPreferencesJson: Record<string, boolean>;
  /**
   * Phase 42.0 — Visual effect master level. OFF tắt mọi animation;
   * tuân thủ `reduceMotion` cũ — nếu reduceMotion=true, runtime override
   * mọi mức về LOW max.
   */
  visualEffectLevel: VisualEffectLevel;
  /** Phase 42.0 — Hiện floating combat text (damage/heal/miss popup). */
  showFloatingCombatText: boolean;
  /** Phase 42.0 — Hiện rare drop popup khi loot rare ≥ RARE. */
  showRareDropPopup: boolean;
  /** Phase 42.0 — Hiện boss warning banner. */
  showBossWarning: boolean;
  /** Phase 42.0 — Hiện breakthrough/đột phá banner. */
  showBreakthroughEffect: boolean;
  /** Phase 42.0 — Hiện crafting/alchemy result banner. */
  showCraftingEffect: boolean;
  /** Phase 42.0 — Bật item aura frame ở inventory/item cards. */
  showItemAura: boolean;
  /** Phase 42.0 — Bật status effect bar trong combat HUD. */
  showStatusEffectBar: boolean;
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = Object.freeze({
  language: 'vi',
  appearance: 'system',
  fontSize: 'normal',
  compactMode: false,
  reduceMotion: false,
  showAdvancedStats: true,
  showCombatLogDetail: true,
  showFarmLogDetail: true,
  showSystemTips: true,
  defaultLandingPage: 'home',
  numberFormat: 'FULL',
  timezone: null,
  notificationPreferencesJson: {},
  // Phase 42.0 — visual effect prefs (default MEDIUM, mọi toggle bật).
  visualEffectLevel: 'MEDIUM',
  showFloatingCombatText: true,
  showRareDropPopup: true,
  showBossWarning: true,
  showBreakthroughEffect: true,
  showCraftingEffect: true,
  showItemAura: true,
  showStatusEffectBar: true,
});

export interface PlayerSettingsRow {
  characterId: string;
  settings: PlayerSettings;
  createdAt: string;
  updatedAt: string;
}

/** PATCH /player/settings body — toàn bộ field optional, validator chuẩn hoá. */
export type PlayerSettingsPatchInput = Partial<PlayerSettings>;

export interface PlayerSettingsValidationResult {
  ok: boolean;
  errors: string[];
  /** Sanitized settings sau khi clamp/strip. */
  sanitized: Partial<PlayerSettings>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function jsonByteSize(value: unknown): number {
  try {
    // Buffer.byteLength có ở Node; TextEncoder có ở browser. Shared chạy ở cả
    // 2 môi trường, fallback length string nếu cả 2 đều thiếu.
    const s = JSON.stringify(value);
    const g = globalThis as unknown as {
      TextEncoder?: new () => { encode(input: string): { length: number } };
      Buffer?: { byteLength(input: string, encoding?: string): number };
    };
    if (g.TextEncoder) return new g.TextEncoder().encode(s).length;
    if (g.Buffer) return g.Buffer.byteLength(s, 'utf8');
    return s.length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Validate + sanitize PATCH body cho /player/settings.
 *
 * Trả về `sanitized` chỉ chứa field hợp lệ; field nào sai sẽ được bỏ
 * và push error code vào `errors`. Caller (service layer) quyết định
 * có reject toàn bộ request không khi `errors.length > 0`.
 */
export function validatePlayerSettings(
  input: unknown,
): PlayerSettingsValidationResult {
  const errors: string[] = [];
  const out: Partial<PlayerSettings> = {};

  if (!isPlainObject(input)) {
    return { ok: false, errors: ['PLAYER_SETTINGS_INVALID'], sanitized: {} };
  }
  const raw = input as Record<string, unknown>;

  if (jsonByteSize(raw) > PLAYER_SETTINGS_LIMITS.SETTINGS_JSON_MAX_BYTES) {
    return { ok: false, errors: ['PLAYER_SETTINGS_PAYLOAD_TOO_LARGE'], sanitized: {} };
  }

  function pickEnum<T extends string>(
    key: keyof PlayerSettings,
    values: readonly T[],
  ): void {
    const v = raw[key as string];
    if (v === undefined) return;
    if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) {
      errors.push(`PLAYER_SETTINGS_INVALID:${String(key)}`);
      return;
    }
    (out as Record<string, unknown>)[key as string] = v;
  }

  function pickBoolean(key: keyof PlayerSettings): void {
    const v = raw[key as string];
    if (v === undefined) return;
    if (typeof v !== 'boolean') {
      errors.push(`PLAYER_SETTINGS_INVALID:${String(key)}`);
      return;
    }
    (out as Record<string, unknown>)[key as string] = v;
  }

  pickEnum('language', LANGUAGE_VALUES);
  pickEnum('appearance', APPEARANCE_VALUES);
  pickEnum('fontSize', FONT_SIZE_VALUES);
  pickEnum('numberFormat', NUMBER_FORMAT_VALUES);
  pickEnum('defaultLandingPage', LANDING_PAGE_VALUES);

  pickBoolean('compactMode');
  pickBoolean('reduceMotion');
  pickBoolean('showAdvancedStats');
  pickBoolean('showCombatLogDetail');
  pickBoolean('showFarmLogDetail');
  pickBoolean('showSystemTips');

  // Phase 42.0 — visual effect fields
  pickEnum('visualEffectLevel', VISUAL_EFFECT_LEVEL_VALUES);
  pickBoolean('showFloatingCombatText');
  pickBoolean('showRareDropPopup');
  pickBoolean('showBossWarning');
  pickBoolean('showBreakthroughEffect');
  pickBoolean('showCraftingEffect');
  pickBoolean('showItemAura');
  pickBoolean('showStatusEffectBar');

  if (raw.timezone !== undefined) {
    if (raw.timezone === null) {
      out.timezone = null;
    } else if (
      typeof raw.timezone === 'string' &&
      raw.timezone.length <= PLAYER_SETTINGS_LIMITS.TIMEZONE_MAX_LENGTH &&
      /^[A-Za-z0-9_\-/+:]*$/.test(raw.timezone)
    ) {
      out.timezone = raw.timezone;
    } else {
      errors.push('PLAYER_SETTINGS_INVALID:timezone');
    }
  }

  if (raw.notificationPreferencesJson !== undefined) {
    if (!isPlainObject(raw.notificationPreferencesJson)) {
      errors.push('PLAYER_SETTINGS_INVALID:notificationPreferencesJson');
    } else {
      const sanitized: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(raw.notificationPreferencesJson)) {
        if (typeof k !== 'string' || k.length === 0 || k.length > 64) continue;
        if (typeof v !== 'boolean') continue;
        sanitized[k] = v;
      }
      out.notificationPreferencesJson = sanitized;
    }
  }

  return { ok: errors.length === 0, errors, sanitized: out };
}

/**
 * Hợp nhất stored settings (Json) + default + patch → settings cuối cùng.
 *
 * Tolerant với field thiếu / sai kiểu (dùng default khi không hợp lệ).
 */
export function mergePlayerSettings(
  stored: unknown,
  patch?: Partial<PlayerSettings>,
): PlayerSettings {
  const base: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS };
  if (isPlainObject(stored)) {
    const valid = validatePlayerSettings(stored).sanitized;
    Object.assign(base, valid);
  }
  if (patch && isPlainObject(patch)) {
    const valid = validatePlayerSettings(patch).sanitized;
    Object.assign(base, valid);
  }
  return base;
}

// ─────────────────────────────────────────────────────────────────────
// Feedback / Bug Report Center
// ─────────────────────────────────────────────────────────────────────

export const FEEDBACK_TYPES = [
  'BUG_REPORT',
  'BALANCE_FEEDBACK',
  'UI_FEEDBACK',
  'LOST_ITEM_REPORT',
  'PAYMENT_REPORT',
  'MARKET_REPORT',
  'PLAYER_REPORT',
  'CHEAT_REPORT',
  'QUEST_STUCK_REPORT',
  'OTHER',
] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_STATUSES = [
  'NEW',
  'TRIAGE',
  'IN_PROGRESS',
  'RESOLVED',
  'DUPLICATE',
  'CLOSED',
] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_SEVERITIES = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;
export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number];

export const FEEDBACK_LIMITS = {
  TITLE_MIN: 4,
  TITLE_MAX: 120,
  DESCRIPTION_MIN: 10,
  DESCRIPTION_MAX: 4000,
  ADMIN_NOTE_MAX: 4000,
  RELATED_FEATURE_MAX: 64,
  RELATED_ENTITY_TYPE_MAX: 64,
  RELATED_ENTITY_ID_MAX: 128,
  /** Cap số feedback PENDING (NEW/TRIAGE/IN_PROGRESS) mỗi user — soft anti-spam. */
  USER_OPEN_CAP: 20,
  /** Page size mặc định cho list. */
  LIST_PAGE_DEFAULT: 20,
  LIST_PAGE_MAX: 50,
} as const;

export interface FeedbackInput {
  type: FeedbackType;
  title: string;
  description: string;
  severity?: FeedbackSeverity;
  relatedFeature?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  targetCharacterId?: string | null;
}

export interface FeedbackValidationResult {
  ok: boolean;
  errors: string[];
  sanitized: FeedbackInput | null;
}

/**
 * Strip raw HTML / control chars khỏi user-supplied text.
 *
 * KHÔNG dùng cho text hiển thị HTML — chỉ cho plain-text storage. Phase
 * 41 lưu raw plain-text + admin/player view escape qua Vue `{{ }}` (auto
 * escape). Sanitize layer này chỉ bảo vệ chống control byte / NBSP spam
 * / script-tag literal bị render nhầm ở 1 view nào đó quên escape.
 */
export function sanitizeUserText(value: string): string {
  if (typeof value !== 'string') return '';
  // Strip control chars (0x00-0x08, 0x0b, 0x0c, 0x0e-0x1f, 0x7f) nhưng giữ
  // \n (0x0a) và \t (0x09).
  let out = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  // Strip <script ...> tag (case-insensitive); raw < > được giữ vì Vue
  // template tự escape khi render qua `{{ }}`.
  out = out.replace(/<\s*\/?\s*script\b[^>]*>/gi, '');
  // Trim NBSP / runs of 4+ blank lines.
  out = out.replace(/\u00a0/g, ' ');
  out = out.replace(/\n{4,}/g, '\n\n\n');
  return out.trim();
}

export function validateFeedbackInput(input: unknown): FeedbackValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['FEEDBACK_VALIDATION_FAILED'], sanitized: null };
  }
  const raw = input as Record<string, unknown>;

  const type =
    typeof raw.type === 'string' && (FEEDBACK_TYPES as readonly string[]).includes(raw.type)
      ? (raw.type as FeedbackType)
      : null;
  if (!type) errors.push('FEEDBACK_VALIDATION_FAILED:type');

  const titleRaw = typeof raw.title === 'string' ? sanitizeUserText(raw.title) : '';
  if (titleRaw.length < FEEDBACK_LIMITS.TITLE_MIN) {
    errors.push('FEEDBACK_VALIDATION_FAILED:title.tooShort');
  }
  if (titleRaw.length > FEEDBACK_LIMITS.TITLE_MAX) {
    errors.push('FEEDBACK_VALIDATION_FAILED:title.tooLong');
  }

  const descRaw =
    typeof raw.description === 'string' ? sanitizeUserText(raw.description) : '';
  if (descRaw.length < FEEDBACK_LIMITS.DESCRIPTION_MIN) {
    errors.push('FEEDBACK_VALIDATION_FAILED:description.tooShort');
  }
  if (descRaw.length > FEEDBACK_LIMITS.DESCRIPTION_MAX) {
    errors.push('FEEDBACK_VALIDATION_FAILED:description.tooLong');
  }

  let severity: FeedbackSeverity = 'MEDIUM';
  if (raw.severity !== undefined) {
    if (
      typeof raw.severity === 'string' &&
      (FEEDBACK_SEVERITIES as readonly string[]).includes(raw.severity)
    ) {
      severity = raw.severity as FeedbackSeverity;
    } else {
      errors.push('FEEDBACK_VALIDATION_FAILED:severity');
    }
  }

  function pickString(
    key: keyof FeedbackInput,
    max: number,
  ): string | null {
    const v = raw[key as string];
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string') {
      errors.push(`FEEDBACK_VALIDATION_FAILED:${String(key)}`);
      return null;
    }
    const trimmed = sanitizeUserText(v);
    if (trimmed.length === 0) return null;
    if (trimmed.length > max) {
      errors.push(`FEEDBACK_VALIDATION_FAILED:${String(key)}.tooLong`);
      return null;
    }
    return trimmed;
  }

  const relatedFeature = pickString(
    'relatedFeature',
    FEEDBACK_LIMITS.RELATED_FEATURE_MAX,
  );
  const relatedEntityType = pickString(
    'relatedEntityType',
    FEEDBACK_LIMITS.RELATED_ENTITY_TYPE_MAX,
  );
  const relatedEntityId = pickString(
    'relatedEntityId',
    FEEDBACK_LIMITS.RELATED_ENTITY_ID_MAX,
  );
  const targetCharacterId = pickString(
    'targetCharacterId',
    FEEDBACK_LIMITS.RELATED_ENTITY_ID_MAX,
  );

  if (errors.length > 0 || !type) {
    return { ok: false, errors, sanitized: null };
  }

  return {
    ok: true,
    errors: [],
    sanitized: {
      type,
      title: titleRaw,
      description: descRaw,
      severity,
      relatedFeature,
      relatedEntityType,
      relatedEntityId,
      targetCharacterId,
    },
  };
}

export interface PlayerFeedbackRow {
  id: string;
  reporterCharacterId: string;
  reporterDisplayName: string | null;
  type: FeedbackType;
  title: string;
  description: string;
  severity: FeedbackSeverity;
  status: FeedbackStatus;
  relatedFeature: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  targetCharacterId: string | null;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface FeedbackListResponse {
  feedback: PlayerFeedbackRow[];
  total: number;
  nextCursor: string | null;
}

export interface AdminFeedbackPatchInput {
  status?: FeedbackStatus;
  severity?: FeedbackSeverity;
  adminNote?: string | null;
}

export function validateAdminFeedbackPatch(
  input: unknown,
): { ok: boolean; errors: string[]; sanitized: AdminFeedbackPatchInput } {
  const errors: string[] = [];
  const out: AdminFeedbackPatchInput = {};
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['FEEDBACK_VALIDATION_FAILED'], sanitized: out };
  }
  const raw = input as Record<string, unknown>;
  if (raw.status !== undefined) {
    if (
      typeof raw.status !== 'string' ||
      !(FEEDBACK_STATUSES as readonly string[]).includes(raw.status)
    ) {
      errors.push('FEEDBACK_VALIDATION_FAILED:status');
    } else {
      out.status = raw.status as FeedbackStatus;
    }
  }
  if (raw.severity !== undefined) {
    if (
      typeof raw.severity !== 'string' ||
      !(FEEDBACK_SEVERITIES as readonly string[]).includes(raw.severity)
    ) {
      errors.push('FEEDBACK_VALIDATION_FAILED:severity');
    } else {
      out.severity = raw.severity as FeedbackSeverity;
    }
  }
  if (raw.adminNote !== undefined) {
    if (raw.adminNote === null) {
      out.adminNote = null;
    } else if (typeof raw.adminNote === 'string') {
      const trimmed = sanitizeUserText(raw.adminNote);
      if (trimmed.length > FEEDBACK_LIMITS.ADMIN_NOTE_MAX) {
        errors.push('FEEDBACK_VALIDATION_FAILED:adminNote.tooLong');
      } else {
        out.adminNote = trimmed.length === 0 ? null : trimmed;
      }
    } else {
      errors.push('FEEDBACK_VALIDATION_FAILED:adminNote');
    }
  }
  return { ok: errors.length === 0, errors, sanitized: out };
}

// ─────────────────────────────────────────────────────────────────────
// Player Report (foundation, KHÔNG auto-ban)
// ─────────────────────────────────────────────────────────────────────

export const PLAYER_REPORT_TYPES = [
  'HARASSMENT',
  'CHEATING',
  'SCAM',
  'MARKET_ABUSE',
  'BUG_EXPLOIT',
  'OFFENSIVE_NAME',
  'SPAM',
  'OTHER',
] as const;
export type PlayerReportType = (typeof PLAYER_REPORT_TYPES)[number];

export const PLAYER_REPORT_STATUSES = [
  'NEW',
  'REVIEWING',
  'ACTION_TAKEN',
  'DISMISSED',
  'DUPLICATE',
] as const;
export type PlayerReportStatus = (typeof PLAYER_REPORT_STATUSES)[number];

export const PLAYER_REPORT_LIMITS = {
  DESCRIPTION_MIN: 10,
  DESCRIPTION_MAX: 2000,
  EVIDENCE_MAX_BYTES: 2 * 1024,
  /** Soft anti-spam: max NEW report per reporter/target/day. */
  USER_OPEN_CAP_PER_TARGET: 3,
  USER_OPEN_CAP_TOTAL: 10,
  LIST_PAGE_DEFAULT: 20,
  LIST_PAGE_MAX: 50,
} as const;

export interface PlayerReportInput {
  targetCharacterId: string;
  reportType: PlayerReportType;
  description: string;
  evidenceJson?: Record<string, unknown> | null;
}

export interface PlayerReportValidationResult {
  ok: boolean;
  errors: string[];
  sanitized: PlayerReportInput | null;
}

export function validatePlayerReportInput(
  input: unknown,
): PlayerReportValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['REPORT_VALIDATION_FAILED'], sanitized: null };
  }
  const raw = input as Record<string, unknown>;

  const target =
    typeof raw.targetCharacterId === 'string' &&
    raw.targetCharacterId.length > 0 &&
    raw.targetCharacterId.length <= 128
      ? raw.targetCharacterId
      : null;
  if (!target) errors.push('REPORT_VALIDATION_FAILED:targetCharacterId');

  const type =
    typeof raw.reportType === 'string' &&
    (PLAYER_REPORT_TYPES as readonly string[]).includes(raw.reportType)
      ? (raw.reportType as PlayerReportType)
      : null;
  if (!type) errors.push('REPORT_VALIDATION_FAILED:reportType');

  const descRaw =
    typeof raw.description === 'string' ? sanitizeUserText(raw.description) : '';
  if (descRaw.length < PLAYER_REPORT_LIMITS.DESCRIPTION_MIN) {
    errors.push('REPORT_VALIDATION_FAILED:description.tooShort');
  }
  if (descRaw.length > PLAYER_REPORT_LIMITS.DESCRIPTION_MAX) {
    errors.push('REPORT_VALIDATION_FAILED:description.tooLong');
  }

  let evidence: Record<string, unknown> | null = null;
  if (raw.evidenceJson !== undefined && raw.evidenceJson !== null) {
    if (!isPlainObject(raw.evidenceJson)) {
      errors.push('REPORT_VALIDATION_FAILED:evidenceJson');
    } else if (
      jsonByteSize(raw.evidenceJson) > PLAYER_REPORT_LIMITS.EVIDENCE_MAX_BYTES
    ) {
      errors.push('REPORT_VALIDATION_FAILED:evidenceJson.tooLarge');
    } else {
      evidence = raw.evidenceJson;
    }
  }

  if (errors.length > 0 || !target || !type) {
    return { ok: false, errors, sanitized: null };
  }
  return {
    ok: true,
    errors: [],
    sanitized: {
      targetCharacterId: target,
      reportType: type,
      description: descRaw,
      evidenceJson: evidence,
    },
  };
}

export interface PlayerReportRow {
  id: string;
  reporterCharacterId: string;
  reporterDisplayName: string | null;
  targetCharacterId: string;
  targetDisplayName: string | null;
  reportType: PlayerReportType;
  status: PlayerReportStatus;
  description: string;
  evidenceJson: Record<string, unknown> | null;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface PlayerReportListResponse {
  reports: PlayerReportRow[];
  total: number;
  nextCursor: string | null;
}

export interface AdminPlayerReportPatchInput {
  status?: PlayerReportStatus;
  adminNote?: string | null;
}

export function validateAdminPlayerReportPatch(
  input: unknown,
): { ok: boolean; errors: string[]; sanitized: AdminPlayerReportPatchInput } {
  const errors: string[] = [];
  const out: AdminPlayerReportPatchInput = {};
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['REPORT_VALIDATION_FAILED'], sanitized: out };
  }
  const raw = input as Record<string, unknown>;
  if (raw.status !== undefined) {
    if (
      typeof raw.status !== 'string' ||
      !(PLAYER_REPORT_STATUSES as readonly string[]).includes(raw.status)
    ) {
      errors.push('REPORT_VALIDATION_FAILED:status');
    } else {
      out.status = raw.status as PlayerReportStatus;
    }
  }
  if (raw.adminNote !== undefined) {
    if (raw.adminNote === null) {
      out.adminNote = null;
    } else if (typeof raw.adminNote === 'string') {
      const trimmed = sanitizeUserText(raw.adminNote);
      if (trimmed.length > FEEDBACK_LIMITS.ADMIN_NOTE_MAX) {
        errors.push('REPORT_VALIDATION_FAILED:adminNote.tooLong');
      } else {
        out.adminNote = trimmed.length === 0 ? null : trimmed;
      }
    } else {
      errors.push('REPORT_VALIDATION_FAILED:adminNote');
    }
  }
  return { ok: errors.length === 0, errors, sanitized: out };
}

// ─────────────────────────────────────────────────────────────────────
// Dashboard + Today Checklist
// ─────────────────────────────────────────────────────────────────────

export const CHECKLIST_KEYS = [
  'START_CULTIVATION',
  'CLAIM_MAIL',
  'RUN_FARM',
  'CLEAR_DUNGEON',
  'CHALLENGE_BOSS',
  'CLIMB_TOWER',
  'CRAFT_ALCHEMY',
  'UPGRADE_METHOD',
  'CHECK_MARKET',
  'JOIN_SECT_ACTIVITY',
  'CLAIM_EVENT',
  'READ_MENTOR_REQUEST',
  'CHECK_RETURNER',
] as const;
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];

export const CHECKLIST_STATUS_VALUES = ['TODO', 'DONE', 'UNAVAILABLE'] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUS_VALUES)[number];

export const CHECKLIST_PRIORITY_VALUES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ChecklistPriority = (typeof CHECKLIST_PRIORITY_VALUES)[number];

export interface TodayChecklistItem {
  key: ChecklistKey;
  /** i18n key — không lưu free-text. */
  titleKey: string;
  /** i18n key cho description (mô tả ngắn). */
  descriptionKey: string;
  status: ChecklistStatus;
  priority: ChecklistPriority;
  /** Frontend route gợi ý điều hướng. */
  route: string;
  /** Reason text key (vd lý do `UNAVAILABLE`). */
  reasonKey: string | null;
  /** Progress text (vd `3/5`); KHÔNG i18n vì là số. */
  progressText: string | null;
}

export interface DashboardWarning {
  /** i18n key cảnh báo (vd `dashboard.warnings.mailFull`). */
  key: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  /** Optional route to act on warning. */
  route?: string | null;
}

export interface DashboardCharacterSummary {
  characterId: string;
  displayName: string;
  realmKey: string;
  realmStage: number;
  level: number;
  cultivating: boolean;
  bodyRealmKey: string;
  bodyStage: number;
  bodyCultivating: boolean;
  power: number;
  spirit: number;
  speed: number;
  luck: number;
}

export interface DashboardProgressionSummary {
  /** EXP toward next stage (BigInt-as-string để giữ độ chính xác). */
  exp: string;
  bodyExp: string;
  linhThach: string;
  tienNgoc: number;
}

export interface DashboardCounters {
  unreadMail: number;
  unreadNotification: number;
  activeFeedbackCount: number;
  activeReportCount: number;
}

export interface DashboardQuickLink {
  key: string;
  /** i18n title key. */
  titleKey: string;
  route: string;
  enabled: boolean;
  /** Optional badge count (vd unread). */
  badge?: number | null;
}

export interface DashboardResponse {
  character: DashboardCharacterSummary;
  progression: DashboardProgressionSummary;
  counters: DashboardCounters;
  todayChecklist: TodayChecklistItem[];
  warnings: DashboardWarning[];
  quickLinks: DashboardQuickLink[];
  lastUpdatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────
// Navigation Registry / Command Palette
// ─────────────────────────────────────────────────────────────────────

export const NAVIGATION_CATEGORIES = [
  'CORE',
  'CULTIVATION',
  'CONTENT',
  'SOCIAL',
  'ECONOMY',
  'SUPPORT',
  'ADMIN',
] as const;
export type NavigationCategory = (typeof NAVIGATION_CATEGORIES)[number];

export interface NavigationEntry {
  /** Stable key — dùng cho test, i18n. */
  key: string;
  /** i18n key cho title hiển thị trong palette. */
  titleKey: string;
  /** i18n key cho mô tả ngắn (tooltip / second line). */
  descriptionKey: string;
  /** Frontend route. */
  route: string;
  /** Keywords để search (lowercase, mix vi/en). */
  keywords: string[];
  category: NavigationCategory;
  /** Feature flag key Phase 15.4 (nếu cần); null = always enabled. */
  requiredFeatureFlag: string | null;
  /** Default enabled state ngoài flag check (vd ẩn admin page với PLAYER role). */
  enabled: boolean;
  /** Role tối thiểu để xem entry. */
  minRole: 'PLAYER' | 'MOD' | 'ADMIN';
}

/**
 * Static navigation catalog — Phase 41 entries (không bao gồm route legacy
 * gameplay sâu để tránh trùng UX hiện có). Sẽ mở rộng dần ở các phase QoL
 * sau khi có thêm view mới.
 */
export const NAVIGATION_REGISTRY: readonly NavigationEntry[] = Object.freeze([
  {
    key: 'home',
    titleKey: 'nav.home.title',
    descriptionKey: 'nav.home.description',
    route: '/home',
    keywords: ['home', 'trang chủ', 'main', 'menu', 'tổng'],
    category: 'CORE',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'dashboard',
    titleKey: 'nav.dashboard.title',
    descriptionKey: 'nav.dashboard.description',
    route: '/dashboard',
    keywords: ['dashboard', 'tổng quan', 'hôm nay', 'today', 'nên làm'],
    category: 'CORE',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'cultivation',
    titleKey: 'nav.cultivation.title',
    descriptionKey: 'nav.cultivation.description',
    route: '/breakthrough',
    keywords: ['cultivation', 'tu luyện', 'cảnh giới', 'breakthrough'],
    category: 'CULTIVATION',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'bodyCultivation',
    titleKey: 'nav.bodyCultivation.title',
    descriptionKey: 'nav.bodyCultivation.description',
    route: '/body-cultivation',
    keywords: ['body', 'luyện thể', 'thân thể'],
    category: 'CULTIVATION',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'alchemy',
    titleKey: 'nav.alchemy.title',
    descriptionKey: 'nav.alchemy.description',
    route: '/alchemy',
    keywords: ['alchemy', 'đan dược', 'luyện đan', 'pill'],
    category: 'CULTIVATION',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'cultivationMethod',
    titleKey: 'nav.cultivationMethod.title',
    descriptionKey: 'nav.cultivationMethod.description',
    route: '/cultivation-method-v2',
    keywords: ['method', 'công pháp', 'cultivation method'],
    category: 'CULTIVATION',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'inventory',
    titleKey: 'nav.inventory.title',
    descriptionKey: 'nav.inventory.description',
    route: '/inventory',
    keywords: ['inventory', 'túi đồ', 'bag', 'item'],
    category: 'CONTENT',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'dungeon',
    titleKey: 'nav.dungeon.title',
    descriptionKey: 'nav.dungeon.description',
    route: '/dungeon',
    keywords: ['dungeon', 'bí cảnh', 'phó bản'],
    category: 'CONTENT',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'boss',
    titleKey: 'nav.boss.title',
    descriptionKey: 'nav.boss.description',
    route: '/boss',
    keywords: ['boss', 'thế giới', 'world boss'],
    category: 'CONTENT',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'trialTower',
    titleKey: 'nav.trialTower.title',
    descriptionKey: 'nav.trialTower.description',
    route: '/trial-tower',
    keywords: ['tower', 'tháp', 'trial', 'đăng tiên'],
    category: 'CONTENT',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'sect',
    titleKey: 'nav.sect.title',
    descriptionKey: 'nav.sect.description',
    route: '/sect',
    keywords: ['sect', 'tông môn', 'guild'],
    category: 'SOCIAL',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'social',
    titleKey: 'nav.social.title',
    descriptionKey: 'nav.social.description',
    route: '/social',
    keywords: ['friend', 'bạn', 'social', 'block'],
    category: 'SOCIAL',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'mail',
    titleKey: 'nav.mail.title',
    descriptionKey: 'nav.mail.description',
    route: '/mail',
    keywords: ['mail', 'thư', 'inbox'],
    category: 'SOCIAL',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'mentor',
    titleKey: 'nav.mentor.title',
    descriptionKey: 'nav.mentor.description',
    route: '/mentor',
    keywords: ['mentor', 'sư phụ', 'sư đồ'],
    category: 'SOCIAL',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'returner',
    titleKey: 'nav.returner.title',
    descriptionKey: 'nav.returner.description',
    route: '/returner',
    keywords: ['returner', 'hồi quy'],
    category: 'SOCIAL',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'market',
    titleKey: 'nav.market.title',
    descriptionKey: 'nav.market.description',
    route: '/market',
    keywords: ['market', 'chợ', 'auction'],
    category: 'ECONOMY',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'shop',
    titleKey: 'nav.shop.title',
    descriptionKey: 'nav.shop.description',
    route: '/shop',
    keywords: ['shop', 'cửa hàng', 'buy'],
    category: 'ECONOMY',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'wallet',
    titleKey: 'nav.wallet.title',
    descriptionKey: 'nav.wallet.description',
    route: '/wallet',
    keywords: ['wallet', 'ví', 'currency', 'linh thạch', 'tiên ngọc'],
    category: 'ECONOMY',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'settings',
    titleKey: 'nav.settings.title',
    descriptionKey: 'nav.settings.description',
    route: '/settings',
    keywords: ['settings', 'cài đặt', 'font', 'chữ', 'theme'],
    category: 'CORE',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'logs',
    titleKey: 'nav.logs.title',
    descriptionKey: 'nav.logs.description',
    route: '/logs',
    keywords: ['log', 'nhật ký', 'audit', 'lịch sử'],
    category: 'CORE',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'feedback',
    titleKey: 'nav.feedback.title',
    descriptionKey: 'nav.feedback.description',
    route: '/support/feedback',
    keywords: ['feedback', 'báo lỗi', 'bug', 'report', 'góp ý'],
    category: 'SUPPORT',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'reportPlayer',
    titleKey: 'nav.reportPlayer.title',
    descriptionKey: 'nav.reportPlayer.description',
    route: '/support/report-player',
    keywords: ['report', 'tố cáo', 'người chơi', 'player'],
    category: 'SUPPORT',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'PLAYER',
  },
  {
    key: 'adminFeedback',
    titleKey: 'nav.adminFeedback.title',
    descriptionKey: 'nav.adminFeedback.description',
    route: '/admin/support/feedback',
    keywords: ['admin', 'feedback', 'support', 'mod'],
    category: 'ADMIN',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'MOD',
  },
  {
    key: 'adminReports',
    titleKey: 'nav.adminReports.title',
    descriptionKey: 'nav.adminReports.description',
    route: '/admin/support/reports',
    keywords: ['admin', 'report', 'tố cáo', 'mod'],
    category: 'ADMIN',
    requiredFeatureFlag: null,
    enabled: true,
    minRole: 'MOD',
  },
]);

export function filterNavigationEntries(
  role: 'PLAYER' | 'MOD' | 'ADMIN',
  query: string | null | undefined,
): NavigationEntry[] {
  const roleOrder: Record<'PLAYER' | 'MOD' | 'ADMIN', number> = {
    PLAYER: 0,
    MOD: 1,
    ADMIN: 2,
  };
  const myRole = roleOrder[role] ?? 0;
  const q = (query ?? '').trim().toLowerCase();
  return NAVIGATION_REGISTRY.filter((entry) => {
    if (!entry.enabled) return false;
    if (roleOrder[entry.minRole] > myRole) return false;
    if (q.length === 0) return true;
    if (entry.key.toLowerCase().includes(q)) return true;
    if (entry.route.toLowerCase().includes(q)) return true;
    if (entry.keywords.some((k) => k.toLowerCase().includes(q))) return true;
    return false;
  });
}

// ─────────────────────────────────────────────────────────────────────
// Error codes
// ─────────────────────────────────────────────────────────────────────

export const PLAYER_EXPERIENCE_ERROR_CODES = [
  'PLAYER_SETTINGS_NOT_FOUND',
  'PLAYER_SETTINGS_INVALID',
  'PLAYER_SETTINGS_PAYLOAD_TOO_LARGE',
  'FEEDBACK_NOT_FOUND',
  'FEEDBACK_VALIDATION_FAILED',
  'FEEDBACK_RATE_LIMITED',
  'REPORT_NOT_FOUND',
  'REPORT_VALIDATION_FAILED',
  'REPORT_RATE_LIMITED',
  'REPORT_TARGET_NOT_FOUND',
  'REPORT_SELF_NOT_ALLOWED',
  'DASHBOARD_UNAVAILABLE',
  'NAVIGATION_ENTRY_NOT_FOUND',
  'LOG_NOT_FOUND',
  'SUPPORT_PERMISSION_DENIED',
  'ADMIN_SUPPORT_PERMISSION_DENIED',
  'UNAUTHENTICATED',
  'NO_CHARACTER',
] as const;
export type PlayerExperienceErrorCode =
  (typeof PLAYER_EXPERIENCE_ERROR_CODES)[number];
