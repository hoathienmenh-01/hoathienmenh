import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  computeCapDecision,
  dailyRewardCapFor,
  isRewardSource,
  type RewardSource,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { getLocalDateString } from '../daily-login/daily-login.service';

/**
 * Phase 16.5 — Daily Reward Cap timezone resolver.
 *
 * Default Asia/Ho_Chi_Minh (đồng bộ với daily-login + sect-mission +
 * shop reset). Có thể override qua env `DAILY_REWARD_CAP_TZ` cho
 * staging/test (vd 'UTC' để reproducible test).
 *
 * Export ra ngoài để service test + admin tooling lookup chính xác
 * dayBucket hiện hành.
 */
export function getDailyRewardCapTz(): string {
  const v = (process.env.DAILY_REWARD_CAP_TZ ?? '').trim();
  return v.length > 0 ? v : 'Asia/Ho_Chi_Minh';
}

/** Compute `dayBucket` chuỗi YYYY-MM-DD theo timezone reset. */
export function dayBucketFor(now: Date = new Date(), tz?: string): string {
  return getLocalDateString(now, tz ?? getDailyRewardCapTz());
}

export interface RewardCapApplyInput {
  characterId: string;
  source: RewardSource;
  /** EXP requested (≥ 0n). Service tự coerce âm → 0n cho an toàn. */
  requestedExp: bigint;
  /** Linh thạch requested (≥ 0n). */
  requestedLinhThach: bigint;
  /**
   * Realm key của character TẠI TIME OF CALL — caller chịu trách nhiệm
   * load (thường đã có trong lookup `Character` row trước đó). Nếu
   * không truyền, service tự load thêm 1 query `findUnique` (chậm hơn).
   */
  realmKey?: string;
  /** Audit trail context. */
  refType?: string;
  refId?: string;
  meta?: Record<string, unknown>;
  /** Override `now` cho test reproducible — production luôn dùng `new Date()`. */
  now?: Date;
}

export interface RewardCapApplyResult {
  /** EXP thực được phép grant sau cap. ≥ 0n. */
  grantedExp: bigint;
  /** Linh thạch thực được phép grant sau cap. ≥ 0n. */
  grantedLinhThach: bigint;
  /** EXP bị cắt khỏi requested (nếu có). ≥ 0n. */
  cappedExp: bigint;
  /** Linh thạch bị cắt. ≥ 0n. */
  cappedLinhThach: bigint;
  /** True nếu request bất kỳ phần nào bị cap (granted < requested). */
  wasCapped: boolean;
  /** EXP cap còn lại trong ngày sau khi grant. */
  remainingExp: bigint;
  /** Linh thạch cap còn lại trong ngày sau khi grant. */
  remainingLinhThach: bigint;
  /** `dayBucket` (YYYY-MM-DD) đã dùng — caller log thêm context. */
  dayBucket: string;
}

/**
 * Phase 16.5 — Service runtime apply daily reward cap.
 *
 * Thiết kế:
 *   - **Pure compute** (cap math) tách sang helper `computeCapDecision`
 *     ở `packages/shared/src/daily-reward-cap.ts` — unit-testable không
 *     cần Prisma.
 *   - **Stateful upsert** (CharacterDailyRewardBucket) ở đây — chạy
 *     INSIDE 1 `$transaction` mà caller cung cấp (Prisma.TransactionClient).
 *   - **Race-safety** qua atomic upsert + UNIQUE composite
 *     `(characterId, dayBucket, source)`. 2 grant concurrent
 *     cùng (char, day, source):
 *       1. T1 + T2 cùng SELECT row hiện tại (row-lock theo isolation;
 *          mặc định Prisma READ COMMITTED → hai snapshot có thể bằng nhau).
 *       2. T1 commit increment +X. T2 cố increment +Y theo CAS guard
 *          `expAccum: oldT2_value` → CAS miss vì row đã được T1 update.
 *       3. T2 retry (xem retry loop bên dưới). Sau retry: snapshot mới
 *          = T1 committed → cap còn lại = cap - (T1 grant) → T2 chỉ
 *          grant phần còn lại.
 *     Tổng cộng: invariant `accum ≤ cap` luôn giữ.
 *   - **Idempotency**: bucket UNIQUE giữ accum đúng; nhưng caller
 *     CHỊU TRÁCH NHIỆM idempotency (CAS guard `claimedAt=null` ở mission/
 *     dungeon đã đảm bảo claim duy nhất 1 lần → applyCapTx cũng đúng 1
 *     lần / claim).
 *   - **No throw on cap-hit**: caller quyết định flow (vd grant 0,
 *     return `{ capped: true, granted: 0 }` cho FE). Service KHÔNG ném
 *     exception trừ khi DB error.
 *
 * KHÔNG cap admin grant: admin path KHÔNG GỌI service này. Audit chính
 * thức trong `docs/ECONOMY_MODEL.md` §Daily Reward Cap.
 */
@Injectable()
export class RewardCapService {
  private readonly logger = new Logger(RewardCapService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Áp cap cho 1 grant request. Gọi từ INSIDE 1 transaction.
   *
   * Caller workflow điển hình:
   * ```
   * await prisma.$transaction(async (tx) => {
   *   const cap = await rewardCap.applyCapTx(tx, { characterId, source, ... });
   *   if (cap.grantedExp > 0n) await tx.character.update({ data: { exp: { increment: cap.grantedExp } } });
   *   if (cap.grantedLinhThach > 0n) await currency.applyTx(tx, { delta: cap.grantedLinhThach, reason });
   *   // ledger ghi `delta = cap.grantedLinhThach` — KHÔNG ghi requested.
   * });
   * ```
   */
  async applyCapTx(
    tx: Prisma.TransactionClient,
    input: RewardCapApplyInput,
  ): Promise<RewardCapApplyResult> {
    if (!isRewardSource(input.source)) {
      throw new Error(`RewardCapService: unknown source ${input.source}`);
    }

    const reqExp = input.requestedExp < 0n ? 0n : input.requestedExp;
    const reqLinh =
      input.requestedLinhThach < 0n ? 0n : input.requestedLinhThach;
    const dayBucket = dayBucketFor(input.now);

    // Resolve realm — nếu caller không truyền, query thêm 1 lần. Service
    // ưu tiên caller truyền realmKey để không tốn round-trip.
    let realmKey = input.realmKey ?? null;
    if (realmKey === null) {
      const c = await tx.character.findUnique({
        where: { id: input.characterId },
        select: { realmKey: true },
      });
      if (!c) {
        throw new Error(
          `RewardCapService: character ${input.characterId} not found`,
        );
      }
      realmKey = c.realmKey;
    }

    const cap = dailyRewardCapFor(realmKey, input.source);

    // Short-circuit: zero-request → return zero-decision sớm, KHÔNG tạo
    // bucket row dư thừa. Caller có thể gọi với 0n (vd CULTIVATION không
    // grant linhThach) → vẫn cần resolve cap nhưng không tạo row.
    if (reqExp === 0n && reqLinh === 0n) {
      return {
        grantedExp: 0n,
        grantedLinhThach: 0n,
        cappedExp: 0n,
        cappedLinhThach: 0n,
        wasCapped: false,
        remainingExp: cap.expCap,
        remainingLinhThach: cap.linhThachCap,
        dayBucket,
      };
    }

    // Race-safe upsert qua Postgres `INSERT ... ON CONFLICT DO UPDATE`.
    //
    // Tại sao KHÔNG dùng CAS+retry pattern: trong Prisma interactive
    // transaction, một P2002 (UNIQUE violation) sẽ làm Postgres abort
    // cả transaction (`current transaction is aborted, commands ignored
    // until end of transaction block`). Retry trong cùng tx không khả
    // thi → phải dùng atomic row-lock pattern.
    //
    // Cơ chế:
    //   1. `INSERT ... ON CONFLICT (...) DO UPDATE SET updatedAt=NOW()
    //      RETURNING ...` — atomic ensure row exists + acquire row lock.
    //      Concurrent calls cùng (characterId, dayBucket, source):
    //        - 1st commit: insert thành công, lock row.
    //        - 2nd commit: chờ lock của 1st giải phóng (DO UPDATE branch
    //          sẽ acquire row lock chứ không throw), trả về accum đã
    //          được 1st cập nhật.
    //   2. Tính decision dựa trên accum vừa lock.
    //   3. `UPDATE` accum (row vẫn locked trong tx).
    //   4. Nếu wasCapped → insert RewardCapEvent audit log.
    //
    // Đảm bảo invariant `accum ≤ cap` luôn giữ kể cả 100 caller song song.
    const upsertRows = await tx.$queryRaw<
      Array<{
        id: string;
        expAccum: bigint;
        linhThachAccum: bigint;
      }>
    >(Prisma.sql`
      INSERT INTO "CharacterDailyRewardBucket" (
        "id", "characterId", "dayBucket", "source",
        "expAccum", "linhThachAccum",
        "createdAt", "updatedAt"
      )
      VALUES (
        gen_random_uuid(),
        ${input.characterId},
        ${dayBucket},
        ${input.source},
        0, 0,
        NOW(), NOW()
      )
      ON CONFLICT ("characterId", "dayBucket", "source")
      DO UPDATE SET "updatedAt" = NOW()
      RETURNING "id", "expAccum", "linhThachAccum"
    `);

    if (upsertRows.length === 0) {
      throw new Error(
        `RewardCapService: upsert returned no row (character ${input.characterId} source ${input.source})`,
      );
    }
    const row = upsertRows[0];

    const decision = computeCapDecision(
      { expDelta: row.expAccum, linhThachDelta: row.linhThachAccum },
      cap,
      { expDelta: reqExp, linhThachDelta: reqLinh },
    );

    // Update accum nếu có thực gain. Row đã locked ở trên → safe.
    if (
      decision.granted.expDelta > 0n ||
      decision.granted.linhThachDelta > 0n
    ) {
      await tx.characterDailyRewardBucket.update({
        where: { id: row.id },
        data: {
          expAccum: row.expAccum + decision.granted.expDelta,
          linhThachAccum:
            row.linhThachAccum + decision.granted.linhThachDelta,
        },
      });
    }

    // Audit log nếu wasCapped=true. KHÔNG log khi không cap (giữ table
    // signal-noise cao). Caller CAS guard ở mission/dungeon đã đảm bảo
    // applyCapTx chỉ được gọi 1 lần / claim → không cần idempotency riêng.
    if (decision.wasCapped) {
      await tx.rewardCapEvent.create({
        data: {
          characterId: input.characterId,
          dayBucket,
          source: input.source,
          requestedExp: reqExp,
          requestedLinhThach: reqLinh,
          grantedExp: decision.granted.expDelta,
          grantedLinhThach: decision.granted.linhThachDelta,
          cappedExp: decision.remainder.expDelta,
          cappedLinhThach: decision.remainder.linhThachDelta,
          reason: `cap-hit:${input.source}`,
          refType: input.refType ?? null,
          refId: input.refId ?? null,
          meta: (input.meta ?? {}) as Prisma.InputJsonValue,
        },
      });
    }

    return this.toResult(decision, dayBucket);
  }

  private toResult(
    decision: ReturnType<typeof computeCapDecision>,
    dayBucket: string,
  ): RewardCapApplyResult {
    return {
      grantedExp: decision.granted.expDelta,
      grantedLinhThach: decision.granted.linhThachDelta,
      cappedExp: decision.remainder.expDelta,
      cappedLinhThach: decision.remainder.linhThachDelta,
      wasCapped: decision.wasCapped,
      remainingExp: decision.remaining.expDelta,
      remainingLinhThach: decision.remaining.linhThachDelta,
      dayBucket,
    };
  }
}
