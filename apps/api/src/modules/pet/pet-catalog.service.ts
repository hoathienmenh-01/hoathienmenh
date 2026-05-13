/**
 * Phase 35.0 — Pet catalog service.
 *
 * Read-only wrapper quanh shared `PETS` / `PET_SKILLS`. Server-authoritative
 * source — client KHÔNG được tự build catalog. Mọi mutate qua admin tool sẽ
 * cập nhật code shared + ship rate version mới.
 */
import { Injectable } from '@nestjs/common';
import {
  PETS,
  PET_SKILLS,
  petByKey,
  petSkillByKey,
  auditPetCatalog,
  PET_PVE_CAP_PERCENT,
  PET_PVP_DAMAGE_CAP_PERCENT,
  PET_PVP_EFFECT_MULTIPLIER,
  type PetCatalogEntry,
  type PetSkillDef,
  type PetCatalogIssue,
} from '@xuantoi/shared';

@Injectable()
export class PetCatalogService {
  list(filter?: {
    type?: 'PET' | 'LINH_THU';
    element?: string;
    rarity?: string;
    role?: string;
    eventOnly?: boolean;
  }): readonly PetCatalogEntry[] {
    let arr: readonly PetCatalogEntry[] = PETS;
    if (filter?.type) arr = arr.filter((p) => p.type === filter.type);
    if (filter?.element) arr = arr.filter((p) => p.element === filter.element);
    if (filter?.rarity) arr = arr.filter((p) => p.rarity === filter.rarity);
    if (filter?.role) arr = arr.filter((p) => p.role === filter.role);
    if (filter?.eventOnly === true) arr = arr.filter((p) => p.isEventLimited);
    if (filter?.eventOnly === false) arr = arr.filter((p) => !p.isEventLimited);
    return arr;
  }

  get(petKey: string): PetCatalogEntry | undefined {
    return petByKey(petKey);
  }

  listSkills(): readonly PetSkillDef[] {
    return PET_SKILLS;
  }

  skill(skillKey: string): PetSkillDef | undefined {
    return petSkillByKey(skillKey);
  }

  audit(): readonly PetCatalogIssue[] {
    return auditPetCatalog();
  }

  caps() {
    return {
      pvePercent: PET_PVE_CAP_PERCENT,
      pvpDamagePercent: PET_PVP_DAMAGE_CAP_PERCENT,
      pvpEffectMultiplier: PET_PVP_EFFECT_MULTIPLIER,
    };
  }
}
