import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  composeBuffMods,
  computeBuffExpiresAt,
  getBuffDef,
  type ActiveBuff,
  type BuffMods,
  type BuffSource,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 11.8.B Buff MVP runtime — duration-based buff/debuff persistence.
 *
 * Server-authoritative buff service:
 *   - {@link applyBuff} upsert qua composite unique `(characterId, buffKey)`:
 *     non-stackable refresh `expiresAt`; stackable increment `stacks` cap
 *     `def.maxStacks` + refresh `expiresAt`.
 *   - {@link removeBuff} xóa explicit row (rare — usually expiresAt sweep).
 *   - {@link listActive} auto-prune expired trước khi return.
 *   - {@link pruneExpired} batch xóa toàn DB (cron sweep) hoặc theo character.
 *   - {@link getMods} rely vào `composeBuffMods` từ shared catalog (deterministic
 *     pure function — không runtime dependency).
 *
 * Wire FUTURE (NOT in scope 11.8.B MVP):
 *   - tribulation FAIL Tâm Ma → `applyBuff('debuff_taoma', 'tribulation')`.
 *   - alchemy pill → `applyBuff('buff_pill_*', 'pill')`.
 *   - skill DOT/CC → `applyBuff('debuff_*', 'skill')` trong combat tick.
 *   - `getMods()` wire vào `CharacterStatService.computeStats` để mod
 *     atk/def/hpMax/mpMax/spirit áp dụng combat + cultivation tick.
 */
@Injectable()
export class BuffService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Apply 1 buff lên character. Idempotent qua composite unique
   * `(characterId, buffKey)`:
   *   - Buff không tồn tại → create row mới với `stacks=1` + `expiresAt = now
   *     + def.durationSec`.
   *   - Buff non-stackable đã tồn tại → refresh `expiresAt` (KHÔNG đụng
   *     `stacks`).
   *   - Buff stackable đã tồn tại → `stacks = min(stacks+1, def.maxStacks)` +
   *     refresh `expiresAt`.
   *
   * @param now timestamp gốc cho expiresAt; default `new Date()`. Inject từ
   *   test để control timeline.
   */
  async applyBuff(
    characterId: string,
    buffKey: string,
    source: BuffSource,
    now: Date = new Date(),
  ): Promise<{
    buffKey: string;
    stacks: number;
    source: BuffSource;
    expiresAt: Date;
  }> {
    return this.prisma.$transaction((tx) =>
      this.applyBuffTx(tx, characterId, buffKey, source, now),
    );
  }

  /**
   * Tx-aware variant của `applyBuff` — dùng từ INSIDE 1 `$transaction` đã
   * có sẵn. Giữ nguyên ngữ nghĩa idempotent + stackable cap.
   *
   * Phase 11.8.D-2 wire — `TribulationService.attemptTribulation()` FAIL path
   * apply `debuff_taoma` cùng tx với character update + `TribulationAttemptLog`
   * write — rollback toàn bộ nếu DB fail.
   *
   * @param expiresAtOverride nếu set, dùng làm `expiresAt` thay vì
   *   `computeBuffExpiresAt(now, def)` từ catalog `durationSec`. Use case:
   *   tribulation FAIL có per-tier `taoMaDebuffDurationMinutes` (15/30/60/120)
   *   override default catalog 60 phút.
   *
   * @throws BuffError('BUFF_NOT_FOUND') nếu buffKey không có trong catalog.
   * @throws BuffError('CHARACTER_NOT_FOUND') nếu character không tồn tại.
   */
  async applyBuffTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    buffKey: string,
    source: BuffSource,
    now: Date = new Date(),
    expiresAtOverride?: Date,
  ): Promise<{
    buffKey: string;
    stacks: number;
    source: BuffSource;
    expiresAt: Date;
  }> {
    const def = getBuffDef(buffKey);
    if (!def) throw new BuffError('BUFF_NOT_FOUND');

    const character = await tx.character.findUnique({
      where: { id: characterId },
      select: { id: true },
    });
    if (!character) throw new BuffError('CHARACTER_NOT_FOUND');

    const expiresAt = expiresAtOverride ?? computeBuffExpiresAt(now, def);

    // Race-safe pattern (Phase 13.0 audit pass #4): try insert-or-ignore
    // first qua `createMany({ skipDuplicates: true })` (atomic
    // `INSERT … ON CONFLICT DO NOTHING` ở Postgres). Prisma's `upsert` KHÔNG
    // atomic (find-then-create) → 2 tx concurrent cùng (characterId, buffKey)
    // race loser hits P2002 + tx abort → boss reward hook lost subsequent
    // ops (currency/inventory grant) dù try/catch swallowed P2002.
    //
    // Nếu count > 0 (race winner) → trả về row mới với stacks=1.
    // Nếu count === 0 (existing row) → UPDATE để bump stacks (cap maxStacks)
    // + refresh expiresAt + source. Stacks race có window nhỏ (2 caller cùng
    // miss existing → cùng compute newStacks=1) nhưng acceptable: stackable
    // buff về source-of-truth là expiresAt + count, non-stackable không bị
    // ảnh hưởng. UPDATE never throws P2002 → tx outer an toàn.
    const { count } = await tx.characterBuff.createMany({
      data: [
        {
          characterId,
          buffKey,
          stacks: 1,
          source,
          expiresAt,
        },
      ],
      skipDuplicates: true,
    });

    if (count === 0) {
      // Existing row → bump stacks (atomic increment cap maxStacks) + refresh.
      // Source có thể đổi (vd buff stat từ pill rồi từ event refresh) —
      // ghi nhận source mới nhất.
      const existing = await tx.characterBuff.findUniqueOrThrow({
        where: {
          characterId_buffKey: { characterId, buffKey },
        },
        select: { stacks: true },
      });
      const newStacks = def.stackable
        ? Math.min(existing.stacks + 1, def.maxStacks)
        : existing.stacks;
      await tx.characterBuff.update({
        where: {
          characterId_buffKey: { characterId, buffKey },
        },
        data: {
          stacks: newStacks,
          expiresAt,
          source,
        },
      });
    }

    const row = await tx.characterBuff.findUniqueOrThrow({
      where: {
        characterId_buffKey: { characterId, buffKey },
      },
      select: {
        buffKey: true,
        stacks: true,
        source: true,
        expiresAt: true,
      },
    });

    return {
      buffKey: row.buffKey,
      stacks: row.stacks,
      source: row.source as BuffSource,
      expiresAt: row.expiresAt,
    };
  }

  /**
   * Xóa buff explicit (vd dispel item, sect leave, equip swap). Idempotent —
   * không error nếu buff không tồn tại.
   */
  async removeBuff(characterId: string, buffKey: string): Promise<boolean> {
    const result = await this.prisma.characterBuff.deleteMany({
      where: { characterId, buffKey },
    });
    return result.count > 0;
  }

  /**
   * List active (non-expired) buffs cho character. Auto-prune expired row
   * trước khi return — caller không cần worry về stale data.
   */
  async listActive(
    characterId: string,
    now: Date = new Date(),
  ): Promise<
    Array<{
      buffKey: string;
      stacks: number;
      source: BuffSource;
      expiresAt: Date;
    }>
  > {
    await this.pruneExpired(characterId, now);
    const rows = await this.prisma.characterBuff.findMany({
      where: { characterId, expiresAt: { gt: now } },
      orderBy: { expiresAt: 'asc' },
    });
    return rows.map((r) => ({
      buffKey: r.buffKey,
      stacks: r.stacks,
      source: r.source as BuffSource,
      expiresAt: r.expiresAt,
    }));
  }

  /**
   * Prune buffs đã expired. Nếu `characterId` undefined → batch toàn DB
   * (cron sweep). Return số row đã xóa.
   */
  async pruneExpired(
    characterId?: string,
    now: Date = new Date(),
  ): Promise<number> {
    const where = characterId
      ? { characterId, expiresAt: { lte: now } }
      : { expiresAt: { lte: now } };
    const result = await this.prisma.characterBuff.deleteMany({ where });
    return result.count;
  }

  /**
   * Compose `BuffMods` cho character (combat/stat hệ wire FUTURE). Deterministic
   * — return từ `composeBuffMods(activeBuffs)` với expired buff đã prune.
   */
  async getMods(
    characterId: string,
    now: Date = new Date(),
  ): Promise<BuffMods> {
    const active = await this.listActive(characterId, now);
    const activeBuffs: ActiveBuff[] = active.map((a) => ({
      buffKey: a.buffKey,
      stacks: a.stacks,
    }));
    return composeBuffMods(activeBuffs);
  }
}

export class BuffError extends Error {
  constructor(public code: 'BUFF_NOT_FOUND' | 'CHARACTER_NOT_FOUND') {
    super(code);
  }
}
