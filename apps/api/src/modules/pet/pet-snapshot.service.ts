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
 */
import { Injectable } from '@nestjs/common';
import {
  computePetSnapshot,
  petByKey,
  type PetCombatContext,
  type PetSnapshotOutput,
} from '@xuantoi/shared';

import { PetCollectionService } from './pet-collection.service';

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
