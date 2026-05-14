/**
 * Phase 44.0 — Economy Integrity Audit (read-only).
 *
 * Pure logic module — chạy query trên Prisma client để phát hiện:
 *   - duplicate `MailAttachmentClaim` (cùng mailId+characterId > 1 row).
 *   - duplicate `SystemGiftClaim` (cùng giftKey+characterId > 1 row).
 *   - duplicate `CurrencyLedger` reward log (cùng characterId+reason+
 *     refType+refId > 1 row cho các reason "claim-style" KHÔNG được phép
 *     spam multiple).
 *   - admin grant với reason rỗng / quá ngắn (vi phạm reward policy).
 *   - admin grant vượt cap policy (linhThach / tienNgoc).
 *
 * Module này **read-only**: KHÔNG mutate DB, KHÔNG drop bảng. Dùng từ
 * `scripts/integrity-check.mjs` (CLI) + tương lai admin endpoint
 * `/admin/economy/integrity-audit`.
 *
 * Mọi check phải hoạt động trên Prisma `PrismaClient | TransactionClient`
 * (tham số `prisma`) để dùng được cả trong CLI script và NestJS service.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import {
  MAX_ADMIN_GRANT_LINH_THACH,
  MAX_ADMIN_GRANT_TIEN_NGOC,
  MIN_REASON_LENGTH,
} from '@xuantoi/shared';

/** Reason mà reward log dup phải bị flag — mỗi reason chỉ được 1 row /
 *  (characterId, refType, refId).
 *
 *  KHÔNG bao gồm các reason có thể chính đáng có > 1 row cùng refType +
 *  refId (vd `MARKET_BUY`, `MARKET_SELL`, `SHOP_BUY` — mỗi giao dịch có
 *  thể là 1 ref riêng nhưng cùng refType=SHOP nếu group; check sẽ false
 *  positive). Chỉ list các reason **claim-only** (one-time grant).
 */
export const CLAIM_ONLY_LEDGER_REASONS: ReadonlyArray<string> = [
  'MAIL_CLAIM',
  'MISSION_CLAIM',
  'QUEST_CLAIM',
  'DUNGEON_RUN_REWARD',
  'STORY_DUNGEON_REWARD',
  'SECT_WAR_REWARD',
  'SECT_SEASON_REWARD',
  'BOSS_REWARD',
  'GIFTCODE_REDEEM',
  'ONBOARDING_CLAIM',
  'DAILY_ENCOUNTER_CLAIM',
  'SECRET_REALM_CLAIM',
  'MENTOR_MILESTONE_CLAIM',
  'LIVEOPS_EVENT_REWARD',
];

/** Severity của 1 finding. */
export type FindingSeverity = 'ERROR' | 'WARN' | 'FATAL';

export interface IntegrityFinding {
  scope: 'mail' | 'system-gift' | 'reward-log' | 'admin-grant';
  severity: FindingSeverity;
  /** Stable code cho filter / alerting downstream. */
  code: string;
  /** Human-readable message. */
  message: string;
  /** Số lượng row vi phạm (nếu áp dụng). */
  count?: number;
  /** Optional sample (tối đa 5 row) để debug. */
  sample?: ReadonlyArray<Record<string, unknown>>;
}

type AnyPrisma = PrismaClient | Prisma.TransactionClient;

// ─── Mail claim duplicate ─────────────────────────────────────────────────

/**
 * Phát hiện trùng row `MailAttachmentClaim` trên `(mailId, characterId)`.
 *
 * Schema đã có `@@unique([mailId, characterId])` → constraint enforce ở
 * DB level, audit này defensive (nếu có drop unique do migration sai).
 */
export async function checkMailClaimDuplicates(
  prisma: AnyPrisma,
): Promise<IntegrityFinding[]> {
  const dupes = await prisma.$queryRaw<
    Array<{ mailId: string; characterId: string; c: number }>
  >`
    SELECT "mailId", "characterId", COUNT(*)::int AS c
    FROM "MailAttachmentClaim"
    GROUP BY "mailId", "characterId"
    HAVING COUNT(*) > 1
    LIMIT 50
  `;
  if (dupes.length === 0) return [];
  return [
    {
      scope: 'mail',
      severity: 'FATAL',
      code: 'MAIL_CLAIM_DUPLICATE',
      message: `${dupes.length} (mailId,characterId) pair có > 1 MailAttachmentClaim — UNIQUE constraint bị bypass?`,
      count: dupes.length,
      sample: dupes.slice(0, 5),
    },
  ];
}

// ─── SystemGiftClaim duplicate ────────────────────────────────────────────

/**
 * Phát hiện trùng row `SystemGiftClaim` trên `(giftKey, characterId)`.
 * Mirror MailClaim — `@@unique([giftKey, characterId])`.
 */
export async function checkSystemGiftDuplicates(
  prisma: AnyPrisma,
): Promise<IntegrityFinding[]> {
  const dupes = await prisma.$queryRaw<
    Array<{ giftKey: string; characterId: string; c: number }>
  >`
    SELECT "giftKey", "characterId", COUNT(*)::int AS c
    FROM "SystemGiftClaim"
    GROUP BY "giftKey", "characterId"
    HAVING COUNT(*) > 1
    LIMIT 50
  `;
  if (dupes.length === 0) return [];
  return [
    {
      scope: 'system-gift',
      severity: 'FATAL',
      code: 'SYSTEM_GIFT_DUPLICATE',
      message: `${dupes.length} (giftKey,characterId) pair có > 1 SystemGiftClaim — UNIQUE constraint bị bypass?`,
      count: dupes.length,
      sample: dupes.slice(0, 5),
    },
  ];
}

// ─── Reward-log duplicate (claim-only reasons) ────────────────────────────

/**
 * Phát hiện CurrencyLedger row trùng cho các reason claim-style. Mỗi
 * (characterId, currency, reason, refType, refId) chỉ được tối đa 1 row
 * khi reason ∈ `CLAIM_ONLY_LEDGER_REASONS`.
 *
 * Edge case: `MAIL_CLAIM` có thể có 2 row / mail (1 cho linhThach + 1
 * cho tienNgoc) — phân biệt bằng `currency`. Vì vậy query group cả
 * `currency`.
 */
export async function checkRewardLogDuplicates(
  prisma: AnyPrisma,
): Promise<IntegrityFinding[]> {
  const dupes = await prisma.$queryRaw<
    Array<{
      characterId: string;
      currency: string;
      reason: string;
      refType: string | null;
      refId: string | null;
      c: number;
    }>
  >`
    SELECT
      "characterId",
      "currency"::text AS currency,
      "reason",
      "refType",
      "refId",
      COUNT(*)::int AS c
    FROM "CurrencyLedger"
    WHERE "reason" = ANY(${CLAIM_ONLY_LEDGER_REASONS as readonly string[]}::text[])
      AND "refType" IS NOT NULL
      AND "refId" IS NOT NULL
    GROUP BY "characterId", "currency", "reason", "refType", "refId"
    HAVING COUNT(*) > 1
    LIMIT 50
  `;
  if (dupes.length === 0) return [];
  return [
    {
      scope: 'reward-log',
      severity: 'ERROR',
      code: 'REWARD_LOG_DUPLICATE',
      message: `${dupes.length} ledger row(s) trùng (characterId,currency,reason,refType,refId) cho claim-only reason — duplicate claim?`,
      count: dupes.length,
      sample: dupes.slice(0, 5),
    },
  ];
}

// ─── Admin grant policy violations ────────────────────────────────────────

/**
 * Phát hiện admin grant vi phạm reward policy:
 *   - reason rỗng / quá ngắn (meta.reason missing / trim().length < MIN).
 *   - delta linhThach > MAX_ADMIN_GRANT_LINH_THACH (defensive — service
 *     đã throw INVALID_INPUT, audit defensive khi service bypass).
 *   - delta tienNgoc > MAX_ADMIN_GRANT_TIEN_NGOC.
 *
 * Query chạy trên `CurrencyLedger` (single source of truth cho money
 * mutation) filter `reason='ADMIN_GRANT'`.
 */
export async function checkAdminGrantPolicy(
  prisma: AnyPrisma,
  opts?: { sinceDays?: number },
): Promise<IntegrityFinding[]> {
  const sinceDays = opts?.sinceDays ?? 90;
  const since = new Date(Date.now() - sinceDays * 24 * 3600 * 1000);

  // Note: Prisma JSON field `meta` chứa `{ reason: string }` từ admin.grant.
  // Dùng `Prisma.raw` để query JSON field portably (Postgres).
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      characterId: string;
      currency: string;
      delta: bigint;
      reason: string;
      meta: Prisma.JsonValue;
      actorUserId: string | null;
      createdAt: Date;
    }>
  >`
    SELECT id, "characterId", "currency"::text AS currency, delta, reason,
           meta, "actorUserId", "createdAt"
    FROM "CurrencyLedger"
    WHERE reason = 'ADMIN_GRANT'
      AND "createdAt" >= ${since}
    LIMIT 5000
  `;

  const findings: IntegrityFinding[] = [];
  const missingReason: typeof rows = [];
  const overCapLT: typeof rows = [];
  const overCapTN: typeof rows = [];

  for (const r of rows) {
    const metaReason = extractMetaReason(r.meta);
    if (
      metaReason === null ||
      metaReason.trim().length < MIN_REASON_LENGTH
    ) {
      missingReason.push(r);
    }
    if (r.currency === 'LINH_THACH') {
      const abs = r.delta < 0n ? -r.delta : r.delta;
      if (abs > MAX_ADMIN_GRANT_LINH_THACH) {
        overCapLT.push(r);
      }
    } else if (r.currency === 'TIEN_NGOC' || r.currency === 'TIEN_NGOC_KHOA') {
      const num = Number(r.delta);
      const abs = num < 0 ? -num : num;
      if (Number.isFinite(abs) && abs > MAX_ADMIN_GRANT_TIEN_NGOC) {
        overCapTN.push(r);
      }
    }
  }

  if (missingReason.length > 0) {
    findings.push({
      scope: 'admin-grant',
      severity: 'WARN',
      code: 'ADMIN_GRANT_REASON_MISSING_OR_SHORT',
      message: `${missingReason.length} admin grant row(s) có reason rỗng/quá ngắn (< ${MIN_REASON_LENGTH} chars) trong ${sinceDays}d gần nhất`,
      count: missingReason.length,
      sample: missingReason.slice(0, 5).map((r) => ({
        id: r.id,
        actorUserId: r.actorUserId,
        characterId: r.characterId,
        currency: r.currency,
        delta: r.delta.toString(),
        createdAt: r.createdAt.toISOString(),
      })),
    });
  }
  if (overCapLT.length > 0) {
    findings.push({
      scope: 'admin-grant',
      severity: 'ERROR',
      code: 'ADMIN_GRANT_LINH_THACH_OVER_POLICY',
      message: `${overCapLT.length} admin grant row(s) vượt cap linhThach (${MAX_ADMIN_GRANT_LINH_THACH.toString()}) trong ${sinceDays}d gần nhất`,
      count: overCapLT.length,
      sample: overCapLT.slice(0, 5).map((r) => ({
        id: r.id,
        actorUserId: r.actorUserId,
        delta: r.delta.toString(),
      })),
    });
  }
  if (overCapTN.length > 0) {
    findings.push({
      scope: 'admin-grant',
      severity: 'ERROR',
      code: 'ADMIN_GRANT_TIEN_NGOC_OVER_POLICY',
      message: `${overCapTN.length} admin grant row(s) vượt cap tienNgoc (${MAX_ADMIN_GRANT_TIEN_NGOC}) trong ${sinceDays}d gần nhất`,
      count: overCapTN.length,
      sample: overCapTN.slice(0, 5).map((r) => ({
        id: r.id,
        actorUserId: r.actorUserId,
        delta: r.delta.toString(),
      })),
    });
  }

  return findings;
}

/** Pure helper — extract `meta.reason` defensively. */
export function extractMetaReason(
  meta: Prisma.JsonValue | null | undefined,
): string | null {
  if (meta === null || meta === undefined) return null;
  if (typeof meta !== 'object' || Array.isArray(meta)) return null;
  const v = (meta as Record<string, unknown>).reason;
  return typeof v === 'string' ? v : null;
}

// ─── Aggregator ───────────────────────────────────────────────────────────

export interface IntegrityAuditResult {
  runAt: string;
  findings: IntegrityFinding[];
  /** Tổng số "row vi phạm" gộp lại (sum of finding.count when present, else 1). */
  totalIssueCount: number;
}

/** Chạy tất cả audit + aggregate. Cancel nếu Prisma đóng. */
export async function runEconomyIntegrityAudit(
  prisma: AnyPrisma,
  opts?: { adminGrantSinceDays?: number },
): Promise<IntegrityAuditResult> {
  const runAt = new Date().toISOString();
  const findings: IntegrityFinding[] = [];

  // Chạy song song — read-only, không conflict transaction.
  const [mailDup, sgDup, rewardDup, adminFindings] = await Promise.all([
    checkMailClaimDuplicates(prisma),
    checkSystemGiftDuplicates(prisma),
    checkRewardLogDuplicates(prisma),
    checkAdminGrantPolicy(prisma, {
      sinceDays: opts?.adminGrantSinceDays,
    }),
  ]);

  findings.push(...mailDup, ...sgDup, ...rewardDup, ...adminFindings);

  const totalIssueCount = findings.reduce(
    (a, f) => a + (typeof f.count === 'number' ? f.count : 1),
    0,
  );

  return { runAt, findings, totalIssueCount };
}
