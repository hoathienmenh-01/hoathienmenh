/**
 * Phase 35.0 — Pet snapshot service.
 *
 * `getEquippedPetSnapshot(characterId, context)` trả snapshot pet đang equip
 * tại slot 0 sau khi clamp theo context. Combat/PvP/Boss/Dungeon/SecretRealm
 * gọi đây để cộng buff — KHÔNG tự đọc `CharacterPet`.
 *
 * Hệ quả invariants:
 *   - PvE total contribution ≤ 12% (PET_PVE_CAP_PERCENT).
 *   - PvP damage contribution ≤ 5% (PET_PVP_DAMAGE_CAP_PERCENT) + skill
 *     effect ×0.4 (PET_PVP_EFFECT_MULTIPLIER).
 *   - BOSS damage contribution ≤ 8% (PET_BOSS_DAMAGE_CAP_PERCENT).
 *
 * Phase 44.1:
 *   - `getCombatBonus(characterId, context)` — adapter trả về flat percent
 *     values cho combat tick / preview consumer. KHÔNG sửa formula combat —
 *     consumer tự apply (FE preview + backend combat/boss/dungeon wired).
 *   - `getPreviewForAllContexts(characterId)` — render-helper trả 5 contexts
 *     trong 1 call (profile/combat preview UI).
 */
import { Injectable } from '@nestjs/common';
import {
  PET_COMBAT_CONTEXTS,
  computePetSnapshot,
  petByKey,
  type PetCombatContext,
  type PetSnapshotOutput,
} from '@xuantoi/shared';

import { PetCollectionService } from './pet-collection.service';

export interface PetCombatBonus {
  /** % damage contribution tối đa được phép (theo context — đã clamp). */
  damageContributionCapPercent: number;
  /** % HP/stat contribution tối đa được phép (theo context — đã clamp). */
  contributionCapPercent: number;
  /** Pet stats sau khi context multiplier áp dụng. */
  petStats: PetSnapshotOutput['stats'];
  /** PvP multiplier (mặc định 0.4 hoặc theo catalog). */
  pvpEffectivenessMultiplier: number;
  /** Skill snapshot (key + level + clamped effect). */
  skills: PetSnapshotOutput['skills'];
}

export interface PetCombatPreview {
  petKey: string | null;
  petName: string | null;
  rarity: string | null;
  level: number;
  star: number;
  evolutionStage: number;
  /** Snapshot cho TẤT CẢ contexts — UI render side-by-side cap rõ ràng. */
  byContext: Record<PetCombatContext, PetSnapshotOutput | null>;
}

@Injectable()
export class PetSnapshotService {
  constructor(private readonly collection: PetCollectionService) {}

  async getEquippedPetSnapshot(
    characterId: string,
    context: PetCombatContext,
  ): Promise<PetSnapshotOutput | null> {
    const eq = await this.collection.getEquipped(characterId);
    if (!eq || !eq.row || !eq.catalog) return null;
    const skillLevels =
      (eq.row.skillLevelsJson as Record<string, number> | null) ?? {};
    return computePetSnapshot(eq.catalog, {
      petKey: eq.row.petKey,
      level: eq.row.level,
      star: eq.row.star,
      evolutionStage: eq.row.evolutionStage,
      skillLevels,
      context,
    });
  }

  /**
   * Phase 44.1 — Pet combat adapter. Trả về dạng `PetCombatBonus` simplified
   * cho consumer (combat tick / preview). Trả `null` nếu user không có pet
   * equipped — caller phải null-guard.
   *
   * Wired: combat.service.ts (DUNGEON context, PR Phase 44.2) +
   * boss.service.ts (BOSS context, PR Phase 44.2). FE preview cũng dùng.
   */
  async getCombatBonus(
    characterId: string,
    context: PetCombatContext,
  ): Promise<PetCombatBonus | null> {
    const snap = await this.getEquippedPetSnapshot(characterId, context);
    if (!snap) return null;
    return {
      damageContributionCapPercent: snap.damageContributionCapPercent,
      contributionCapPercent: snap.contributionCapPercent,
      petStats: snap.stats,
      pvpEffectivenessMultiplier: snap.pvpEffectivenessMultiplier,
      skills: snap.skills,
    };
  }

  /**
   * Phase 44.1 — Profile/combat preview helper. Trả về snapshot cho tất cả 5
   * contexts trong 1 query (FE render bảng "Pet giúp gì ở chỗ nào").
   */
  async getPreviewForAllContexts(
    characterId: string,
  ): Promise<PetCombatPreview> {
    const eq = await this.collection.getEquipped(characterId);
    if (!eq || !eq.row || !eq.catalog) {
      return {
        petKey: null,
        petName: null,
        rarity: null,
        level: 0,
        star: 0,
        evolutionStage: 0,
        byContext: {
          PVE: null,
          PVP: null,
          BOSS: null,
          DUNGEON: null,
          SECRET_REALM: null,
        },
      };
    }
    const skillLevels =
      (eq.row.skillLevelsJson as Record<string, number> | null) ?? {};
    const byContext: Record<PetCombatContext, PetSnapshotOutput | null> = {
      PVE: null,
      PVP: null,
      BOSS: null,
      DUNGEON: null,
      SECRET_REALM: null,
    };
    for (const ctx of PET_COMBAT_CONTEXTS) {
      byContext[ctx] = computePetSnapshot(eq.catalog, {
        petKey: eq.row.petKey,
        level: eq.row.level,
        star: eq.row.star,
        evolutionStage: eq.row.evolutionStage,
        skillLevels,
        context: ctx,
      });
    }
    return {
      petKey: eq.row.petKey,
      petName: eq.catalog.nameVi,
      rarity: eq.catalog.rarity,
      level: eq.row.level,
      star: eq.row.star,
      evolutionStage: eq.row.evolutionStage,
      byContext,
    };
  }

  computeFor(
    petKey: string,
    state: {
      level: number;
      star: number;
      evolutionStage: number;
      skillLevels: Record<string, number>;
    },
    context: PetCombatContext,
  ): PetSnapshotOutput | null {
    const def = petByKey(petKey);
    if (!def) return null;
    return computePetSnapshot(def, { petKey, context, ...state });
  }
}
