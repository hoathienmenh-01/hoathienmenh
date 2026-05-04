import { Injectable } from '@nestjs/common';
import {
  REALMS,
  composePassiveTalentMods,
  computeTalentPointBudget,
  getTalentDef,
  type PassiveTalentMods,
  type TalentDef,
} from '@xuantoi/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/**
 * Map ổn định `realmKey → order` build 1 lần khi module load. `REALMS` là
 * `readonly` từ catalog nên map này invariant per-process.
 */
const REALM_KEY_TO_ORDER: ReadonlyMap<string, number> = new Map(
  REALMS.map((r) => [r.key, r.order]),
);

/**
 * Phase 11.7.B Talent (Thần Thông) MVP runtime — passive/active talent
 * persistence service.
 *
 * Server-authoritative talent service:
 *   - {@link learnTalent} validate realm + talent point budget + idempotency
 *     qua composite UNIQUE `(characterId, talentKey)`.
 *   - {@link listLearned} return rows + def metadata.
 *   - {@link getMods} compose `PassiveTalentMods` qua catalog
 *     `composePassiveTalentMods(learnedDefs)` (deterministic pure).
 *
 * Wire FUTURE (NOT in scope 11.7.B MVP):
 *   - `composePassiveTalentMods` vào `CharacterStatService.computeStats`
 *     → atk/def/hpMax/mpMax/spirit + drop/exp multiplier + element
 *     damage_bonus (Phase 11.7.C).
 *   - Active talent ("thần thông") `useActiveTalent` qua mp consume +
 *     cooldown turns enforce trong combat tick (Phase 11.7.C).
 */
@Injectable()
export class TalentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Learn 1 talent. Atomic via `prisma.$transaction`:
   *   1. Validate `getTalentDef(talentKey)` (catalog) → throw `TALENT_NOT_FOUND`.
   *   2. Validate character exists → throw `CHARACTER_NOT_FOUND`.
   *   3. Validate chưa học (composite UNIQUE) → throw `ALREADY_LEARNED`.
   *   4. Compute `currentRealmOrder` từ char.realmKey via `REALM_KEY_TO_ORDER`
   *      → throw `INVALID_REALM` nếu key không có trong catalog (defensive —
   *      legacy character nên có realm hợp lệ).
   *   5. Sum `talentPointCost` của talent đã học khác làm `pointsAlreadySpent`.
   *   6. Call `canCharacterLearnTalent(def, order, map, spent)` → nếu
   *      `!canLearn` throw với mã reason mapped (`REALM_TOO_LOW` |
   *      `INSUFFICIENT_TALENT_POINTS` | `INVALID_REALM_REQUIREMENT`).
   *   7. Insert `CharacterTalent` row + return.
   */
  async learnTalent(
    characterId: string,
    talentKey: string,
  ): Promise<{ talentKey: string; learnedAt: Date }> {
    const def = getTalentDef(talentKey);
    if (!def) throw new TalentError('TALENT_NOT_FOUND');

    return this.prisma.$transaction(async (tx) => {
      const character = await tx.character.findUnique({
        where: { id: characterId },
        select: { id: true, realmKey: true, bonusTalentPoints: true },
      });
      if (!character) throw new TalentError('CHARACTER_NOT_FOUND');

      const currentRealmOrder = REALM_KEY_TO_ORDER.get(character.realmKey);
      if (currentRealmOrder === undefined) {
        throw new TalentError('INVALID_REALM');
      }

      const existing = await tx.characterTalent.findUnique({
        where: {
          characterId_talentKey: { characterId, talentKey },
        },
      });
      if (existing) throw new TalentError('ALREADY_LEARNED');

      // Sum talent point cost của talent đã học khác. Budget = realm-derived
      // base + `character.bonusTalentPoints` (admin seed). Compute total
      // budget rồi check `remaining = budget - pointsAlreadySpent` ≥ cost
      // — đảm bảo nhất quán với `getRemainingTalentPoints` (FE hiển thị
      // "Còn X"). Trước đây dùng trick `effectiveSpent = max(0, spent - bonus)`
      // pass vào `canCharacterLearnTalent`, nhưng clamp 0 khiến bonus KHÔNG có
      // hiệu lực khi `pointsAlreadySpent < bonus` (vd char fresh chưa học gì).
      const learnedRows = await tx.characterTalent.findMany({
        where: { characterId },
        select: { talentKey: true },
      });
      let pointsAlreadySpent = 0;
      for (const row of learnedRows) {
        const learnedDef = getTalentDef(row.talentKey);
        if (learnedDef) pointsAlreadySpent += learnedDef.talentPointCost;
        // Defensive: nếu catalog đổi key → talent học cũ count = 0 (không
        // throw, chỉ skip — character vẫn có thể học talent mới).
      }

      // Realm gate first (canCharacterLearnTalent kiểm tra cùng logic).
      const reqOrder = REALM_KEY_TO_ORDER.get(def.realmRequirement);
      if (reqOrder === undefined) {
        throw new TalentError('INVALID_REALM_REQUIREMENT');
      }
      if (currentRealmOrder < reqOrder) {
        throw new TalentError('REALM_TOO_LOW');
      }

      // Budget = realm base + bonus (admin seed). Match getRemainingTalentPoints.
      const totalBudget =
        computeTalentPointBudget(currentRealmOrder) +
        character.bonusTalentPoints;
      const remaining = totalBudget - pointsAlreadySpent;
      if (remaining < def.talentPointCost) {
        throw new TalentError('INSUFFICIENT_TALENT_POINTS');
      }

      const created = await tx.characterTalent.create({
        data: { characterId, talentKey },
      });
      return {
        talentKey: created.talentKey,
        learnedAt: created.learnedAt,
      };
    });
  }

  /**
   * List talent character đã học (kèm metadata từ catalog). Defensive: nếu
   * row có `talentKey` không còn trong catalog (legacy / catalog rename) thì
   * skip khỏi return list.
   *
   * Phase 11.7.E++ — bổ sung `cooldownTurnsRemaining` từ persistence (default 0
   * cho legacy row / passive talent). Frontend dùng field này để hiển thị
   * cooldown badge trên talent card mà không cần probe `getCooldownRemaining`
   * theo từng key.
   */
  async listLearned(
    characterId: string,
  ): Promise<
    Array<{
      talentKey: string;
      learnedAt: Date;
      cooldownTurnsRemaining: number;
      def: TalentDef;
    }>
  > {
    const rows = await this.prisma.characterTalent.findMany({
      where: { characterId },
      orderBy: { learnedAt: 'asc' },
    });
    const result: Array<{
      talentKey: string;
      learnedAt: Date;
      cooldownTurnsRemaining: number;
      def: TalentDef;
    }> = [];
    for (const row of rows) {
      const def = getTalentDef(row.talentKey);
      if (!def) continue;
      result.push({
        talentKey: row.talentKey,
        learnedAt: row.learnedAt,
        cooldownTurnsRemaining: row.cooldownTurnsRemaining ?? 0,
        def,
      });
    }
    return result;
  }

  /**
   * Compute remaining talent point budget cho character (cho UI hiển thị
   * "còn X điểm ngộ đạo").
   */
  async getRemainingTalentPoints(characterId: string): Promise<number> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { realmKey: true, bonusTalentPoints: true },
    });
    if (!character) throw new TalentError('CHARACTER_NOT_FOUND');

    const currentRealmOrder = REALM_KEY_TO_ORDER.get(character.realmKey);
    if (currentRealmOrder === undefined) {
      throw new TalentError('INVALID_REALM');
    }
    const budget =
      computeTalentPointBudget(currentRealmOrder) + character.bonusTalentPoints;
    const learned = await this.listLearned(characterId);
    const spent = learned.reduce((s, l) => s + l.def.talentPointCost, 0);
    return budget - spent;
  }

  /**
   * Compose `PassiveTalentMods` cho character (combat/stat hệ wire FUTURE
   * Phase 11.7.C). Deterministic — return từ `composePassiveTalentMods` với
   * các `TalentDef` của talent đã học.
   */
  async getMods(characterId: string): Promise<PassiveTalentMods> {
    const learned = await this.listLearned(characterId);
    const keys = learned.map((l) => l.talentKey);
    return composePassiveTalentMods(keys);
  }

  /**
   * Phase 11.7.E — đọc số lượt cooldown còn lại của 1 active talent đã học.
   * Trả về 0 nếu chưa học (caller `actionViaActiveTalent` đã reject
   * `TALENT_NOT_LEARNED` riêng — method này chỉ phục vụ probe trạng thái
   * sẵn sàng cast).
   */
  async getCooldownRemaining(
    characterId: string,
    talentKey: string,
  ): Promise<number> {
    const row = await this.prisma.characterTalent.findUnique({
      where: {
        characterId_talentKey: { characterId, talentKey },
      },
      select: { cooldownTurnsRemaining: true },
    });
    return row?.cooldownTurnsRemaining ?? 0;
  }

  /**
   * Phase 11.7.E — set cooldown sau khi cast active talent thành công.
   * Gọi từ INSIDE `prisma.$transaction` đã có sẵn (truyền `tx`). `turns`
   * là `talent.activeEffect.cooldownTurns` từ catalog (3..10).
   */
  async setCooldown(
    tx: Prisma.TransactionClient,
    characterId: string,
    talentKey: string,
    turns: number,
  ): Promise<void> {
    await tx.characterTalent.update({
      where: {
        characterId_talentKey: { characterId, talentKey },
      },
      data: { cooldownTurnsRemaining: Math.max(0, Math.floor(turns)) },
    });
  }

  /**
   * Phase 11.7.E — decrement -1 cho mọi active talent đang còn cooldown
   * của character. Gọi sau MỌI action combat (skill flow + active talent
   * flow) để các talent active không cast turn này vẫn tick down. Idempotent
   * cho row đã =0 (clamp `Math.max(0, ...)` qua `updateMany` predicate
   * `cooldownTurnsRemaining > 0`).
   */
  async decrementAllCooldowns(
    tx: Prisma.TransactionClient,
    characterId: string,
  ): Promise<void> {
    await tx.characterTalent.updateMany({
      where: { characterId, cooldownTurnsRemaining: { gt: 0 } },
      data: { cooldownTurnsRemaining: { decrement: 1 } },
    });
  }
}

export class TalentError extends Error {
  constructor(
    public code:
      | 'TALENT_NOT_FOUND'
      | 'CHARACTER_NOT_FOUND'
      | 'ALREADY_LEARNED'
      | 'REALM_TOO_LOW'
      | 'INSUFFICIENT_TALENT_POINTS'
      | 'INVALID_REALM_REQUIREMENT'
      | 'INVALID_REALM',
  ) {
    super(code);
  }
}
