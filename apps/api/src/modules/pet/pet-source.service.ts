/**
 * Phase 35.0D — Pet sources read-only service.
 *
 * Trả về `PET_SOURCES` catalog entries (FREE / EVENT / DUNGEON / BOSS /
 * SECRET_REALM / ACHIEVEMENT / TRIAL_TOWER / BOX / SHOP). `runtimeStatus`
 * marker giúp UI hiển thị "đang chuẩn bị" vs "đã wire vào game".
 *
 * Player được encourage tìm shard / pet qua các nguồn này — KHÔNG ép paid.
 */
import { Injectable } from '@nestjs/common';
import {
  PET_SOURCES,
  sourcesForPet,
  sourcesForMaterial,
  auditPetSources,
  type PetSourceEntry,
  type PetSourceIssue,
} from '@xuantoi/shared';

@Injectable()
export class PetSourceService {
  list(): readonly PetSourceEntry[] {
    return PET_SOURCES;
  }

  forPet(petKey: string): PetSourceEntry[] {
    return sourcesForPet(petKey);
  }

  forMaterial(itemKey: string): PetSourceEntry[] {
    return sourcesForMaterial(itemKey);
  }

  audit(): readonly PetSourceIssue[] {
    return auditPetSources();
  }
}
