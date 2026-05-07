import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  composeTitleMods,
  getTitleDef,
  type TitleDef,
  type TitleMods,
  type TitleSource,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 11.9.B Title (Danh hiệu) MVP runtime — title ownership persistence.
 *
 * Server-authoritative title service:
 *   - {@link unlockTitle} idempotent qua composite UNIQUE
 *     `(characterId, titleKey)` — re-unlock cùng key trả về row hiện có.
 *   - {@link equipTitle} validate ownership (phải đã unlock) trước khi set
 *     `Character.title` (single-slot equip — Character.title là cosmetic
 *     display + key cho `composeTitleMods`).
 *   - {@link unequipTitle} clear `Character.title = null` (idempotent).
 *   - {@link listOwned} return rows + def metadata (defensive skip nếu
 *     catalog rename).
 *   - {@link getEquipped} read `Character.title` + return TitleDef.
 *   - {@link getMods} rely vào `composeTitleMods([equipped])` từ shared
 *     catalog (deterministic pure function).
 *
 * Wire FUTURE (NOT in scope 11.9.B MVP):
 *   - auto-grant trên realm breakthrough event → `unlockTitle('realm_*',
 *     'realm_milestone')` qua `titleForRealmMilestone(realmKey)`.
 *   - auto-grant trên achievement complete (Phase 11.10) → `unlockTitle(...,
 *     'achievement')` qua `titleForAchievement(achievementKey)`.
 *   - auto-grant trên sect role change → `unlockTitle(..., 'sect_rank')`.
 *   - `getMods()` wire vào `CharacterStatService.computeStats` để flavor stat
 *     bonus áp combat/cultivation tick.
 */
@Injectable()
export class TitleService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Unlock 1 title cho character. Idempotent qua composite UNIQUE
   * `(characterId, titleKey)`:
   *   - Title chưa unlock → create row mới.
   *   - Title đã unlock → trả về row hiện có (KHÔNG tăng số lần / KHÔNG
   *     update source).
   *
   * @throws TitleError('TITLE_NOT_FOUND') nếu titleKey không có trong catalog.
   * @throws TitleError('CHARACTER_NOT_FOUND') nếu character không tồn tại.
   */
  async unlockTitle(
    characterId: string,
    titleKey: string,
    source: TitleSource,
  ): Promise<{ titleKey: string; source: TitleSource; unlockedAt: Date }> {
    return this.prisma.$transaction((tx) =>
      this.unlockTitleTx(tx, characterId, titleKey, source),
    );
  }

  /**
   * Tx-aware variant của `unlockTitle` — dùng từ INSIDE 1 `$transaction` đã
   * có sẵn. Giữ nguyên ngữ nghĩa idempotent.
   *
   * Phase 11.10.C-1 dùng method này khi `AchievementService.claimReward`
   * auto-unlock title qua `titleForAchievement(achievementKey)` — cần atomic
   * cùng tx với CAS update `claimedAt` để rollback toàn bộ nếu currency grant
   * fail.
   *
   * @throws TitleError('TITLE_NOT_FOUND') nếu titleKey không có trong catalog.
   * @throws TitleError('CHARACTER_NOT_FOUND') nếu character không tồn tại.
   */
  async unlockTitleTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    titleKey: string,
    source: TitleSource,
  ): Promise<{ titleKey: string; source: TitleSource; unlockedAt: Date }> {
    const def = getTitleDef(titleKey);
    if (!def) throw new TitleError('TITLE_NOT_FOUND');

    const character = await tx.character.findUnique({
      where: { id: characterId },
      select: { id: true },
    });
    if (!character) throw new TitleError('CHARACTER_NOT_FOUND');

    // Atomic insert-or-ignore (INSERT … ON CONFLICT DO NOTHING) — race-safe so
    // that concurrent boss reward hooks for the SAME (characterId, titleKey)
    // don't throw P2002 mid-tx and abort the wrapping transaction (Phase 13.0
    // audit pass #4). Prisma's `upsert` is NOT atomic at Postgres level
    // (find-then-update/create), nhưng `createMany({ skipDuplicates: true })`
    // dịch sang `INSERT … ON CONFLICT DO NOTHING` — đúng atomic.
    await tx.characterTitleUnlock.createMany({
      data: [{ characterId, titleKey, source }],
      skipDuplicates: true,
    });
    const row = await tx.characterTitleUnlock.findUniqueOrThrow({
      where: { characterId_titleKey: { characterId, titleKey } },
      select: { titleKey: true, source: true, unlockedAt: true },
    });
    return {
      titleKey: row.titleKey,
      source: row.source as TitleSource,
      unlockedAt: row.unlockedAt,
    };
  }

  /**
   * Equip 1 title (set `Character.title = titleKey`). Single-slot — equip
   * mới thay thế equipped cũ. Validate ownership: title phải đã unlock cho
   * character này.
   *
   * @throws TitleError('TITLE_NOT_FOUND') nếu titleKey không có trong catalog.
   * @throws TitleError('CHARACTER_NOT_FOUND') nếu character không tồn tại.
   * @throws TitleError('TITLE_NOT_OWNED') nếu character chưa unlock title này.
   */
  async equipTitle(characterId: string, titleKey: string): Promise<void> {
    const def = getTitleDef(titleKey);
    if (!def) throw new TitleError('TITLE_NOT_FOUND');

    await this.prisma.$transaction(async (tx) => {
      const character = await tx.character.findUnique({
        where: { id: characterId },
        select: { id: true },
      });
      if (!character) throw new TitleError('CHARACTER_NOT_FOUND');

      const owned = await tx.characterTitleUnlock.findUnique({
        where: { characterId_titleKey: { characterId, titleKey } },
        select: { id: true },
      });
      if (!owned) throw new TitleError('TITLE_NOT_OWNED');

      await tx.character.update({
        where: { id: characterId },
        data: { title: titleKey },
      });
    });
  }

  /**
   * Unequip title hiện tại — clear `Character.title = null`. Idempotent
   * (no-op nếu chưa equip).
   *
   * @throws TitleError('CHARACTER_NOT_FOUND') nếu character không tồn tại.
   */
  async unequipTitle(characterId: string): Promise<void> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true },
    });
    if (!character) throw new TitleError('CHARACTER_NOT_FOUND');

    await this.prisma.character.update({
      where: { id: characterId },
      data: { title: null },
    });
  }

  /**
   * List tất cả title đã unlock + def metadata. Sort theo `unlockedAt asc`
   * (chronological). Defensive: skip catalog-missing keys (catalog có thể
   * rename, không want service crash).
   */
  async listOwned(
    characterId: string,
  ): Promise<
    Array<{ titleKey: string; source: TitleSource; unlockedAt: Date; def: TitleDef }>
  > {
    const rows = await this.prisma.characterTitleUnlock.findMany({
      where: { characterId },
      orderBy: { unlockedAt: 'asc' },
    });
    const out: Array<{
      titleKey: string;
      source: TitleSource;
      unlockedAt: Date;
      def: TitleDef;
    }> = [];
    for (const r of rows) {
      const def = getTitleDef(r.titleKey);
      if (!def) continue;
      out.push({
        titleKey: r.titleKey,
        source: r.source as TitleSource,
        unlockedAt: r.unlockedAt,
        def,
      });
    }
    return out;
  }

  /**
   * Lookup currently-equipped title cho character. Trả về `null` nếu chưa
   * equip hoặc title key đã rename (catalog miss).
   */
  async getEquipped(
    characterId: string,
  ): Promise<{ titleKey: string; def: TitleDef } | null> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { title: true },
    });
    if (!character) throw new TitleError('CHARACTER_NOT_FOUND');
    if (!character.title) return null;
    const def = getTitleDef(character.title);
    if (!def) return null;
    return { titleKey: character.title, def };
  }

  /**
   * Compose flavor stat mods cho character từ equipped title (single-slot).
   *
   * Trả về identity (atkMul=1, …) nếu chưa equip hoặc catalog miss. Phase
   * 11.9.C wire vào `CharacterStatService.computeStats` (multiplicative
   * compose với buff/talent/socket/refine mods).
   */
  async getMods(characterId: string): Promise<TitleMods> {
    const equipped = await this.getEquipped(characterId);
    const keys = equipped ? [equipped.titleKey] : [];
    return composeTitleMods(keys);
  }
}

/**
 * Error class cho TitleService.
 *
 * Codes:
 *   - `TITLE_NOT_FOUND`: titleKey không tồn tại trong catalog `TITLES`.
 *   - `CHARACTER_NOT_FOUND`: characterId không tồn tại trong DB.
 *   - `TITLE_NOT_OWNED`: equipTitle gọi với title chưa unlock.
 */
export type TitleErrorCode =
  | 'TITLE_NOT_FOUND'
  | 'CHARACTER_NOT_FOUND'
  | 'TITLE_NOT_OWNED';

export class TitleError extends Error {
  readonly code: TitleErrorCode;
  constructor(code: TitleErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'TitleError';
    this.code = code;
  }
}
