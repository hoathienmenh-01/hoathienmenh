/**
 * Phase 35.0D — Pet Sources / Drops / Event Exchange catalog.
 * Pure shared catalog — KHÔNG I/O. Mô tả nơi farm pet/shard/material.
 *
 * `runtimeStatus`:
 *   - `WIRED`   = đã có hook runtime (drop service / event / quest).
 *   - `UNWIRED` = catalog-only, follow-up wire ở PR sau.
 *
 * **Invariant**:
 *   - Mọi pet (trừ premium-only & event-limited) bắt buộc có ≥1 source
 *     thuộc {FREE/EVENT/DUNGEON/BOSS/SECRET_REALM/ACHIEVEMENT/TRIAL_TOWER}
 *     để giữ non-gacha path. Test enforce qua `auditPetSources`.
 *   - Không có source rơi pet THẦN phẩm nguyên con — chỉ shard / box.
 *   - Source rare cần daily/weekly cap.
 */

import { PETS, type PetSourceTag, petByKey } from './pets';

export const PET_SOURCE_KINDS = [
  'STARTER_GIFT',
  'ACHIEVEMENT',
  'DUNGEON_DROP',
  'BOSS_DROP',
  'SECRET_REALM_DROP',
  'TRIAL_TOWER_REWARD',
  'KY_NGO_ENCOUNTER',
  'EVENT_EXCHANGE',
  'EVENT_BOX',
  'SHOP_BUY',
  'BOX_OPEN',
] as const;
export type PetSourceKind = (typeof PET_SOURCE_KINDS)[number];

export type PetSourceRuntimeStatus = 'WIRED' | 'UNWIRED';

export interface PetSourceEntry {
  /** Pet target (nếu shard hoặc pet drop). */
  petKey?: string;
  /** Item/material target (nếu source drop material). */
  itemKey?: string;
  /** Loại source. */
  kind: PetSourceKind;
  /** Source identifier (mapKey/bossKey/dungeonKey/eventKey/shopKey). */
  sourceRef?: string;
  /** Source label hiển thị (VI/EN). */
  labelVi: string;
  labelEn: string;
  /** Tỉ lệ ước tính (UI hint). */
  estDropRatePct?: number;
  /** Cap daily/weekly nếu có. */
  dailyCap?: number;
  weeklyCap?: number;
  /** Realm/yêu cầu để access. */
  realmRequired?: string;
  /** Trạng thái wire. */
  runtimeStatus: PetSourceRuntimeStatus;
  /** Tag thẻ tag liên kết với `PetSourceTag`. */
  tag: PetSourceTag;
  /** Note bổ sung. */
  notes?: string;
}

export const PET_SOURCES: readonly PetSourceEntry[] = [
  // Starter gifts (achievement)
  {
    petKey: 'pet_lapin_qi',
    kind: 'STARTER_GIFT',
    labelVi: 'Quà chào mừng người chơi mới',
    labelEn: 'Newbie welcome gift',
    runtimeStatus: 'UNWIRED',
    tag: 'FREE',
    notes: 'Wire qua AchievementService hoặc DailyLoginClaim — follow-up.',
  },
  {
    petKey: 'pet_squirrel_explorer',
    kind: 'ACHIEVEMENT',
    sourceRef: 'achievement_explore_first_dungeon',
    labelVi: 'Hoàn thành bí cảnh đầu tiên',
    labelEn: 'Complete your first dungeon',
    runtimeStatus: 'UNWIRED',
    tag: 'ACHIEVEMENT',
  },
  {
    petKey: 'pet_fox_courier',
    kind: 'ACHIEVEMENT',
    sourceRef: 'achievement_reach_realm_5',
    labelVi: 'Đạt cảnh giới Trúc Cơ',
    labelEn: 'Reach Foundation Establishment realm',
    runtimeStatus: 'UNWIRED',
    tag: 'ACHIEVEMENT',
  },

  // Dungeon drops (shards)
  {
    petKey: 'pet_cat_lucky',
    kind: 'DUNGEON_DROP',
    sourceRef: 'dungeon_linh_son',
    labelVi: 'Bí cảnh Linh Sơn (shard 5)',
    labelEn: 'Linh Son Dungeon (shard 5)',
    estDropRatePct: 8,
    dailyCap: 3,
    runtimeStatus: 'UNWIRED',
    tag: 'DUNGEON',
  },
  {
    petKey: 'pet_owl_secret',
    kind: 'DUNGEON_DROP',
    sourceRef: 'dungeon_huyen_minh',
    labelVi: 'Bí cảnh Huyền Minh (shard 3)',
    labelEn: 'Huyen Minh Dungeon (shard 3)',
    estDropRatePct: 5,
    dailyCap: 2,
    runtimeStatus: 'UNWIRED',
    tag: 'DUNGEON',
  },
  {
    petKey: 'pet_moc_bear',
    kind: 'DUNGEON_DROP',
    sourceRef: 'dungeon_thuong_co',
    labelVi: 'Bí cảnh Thượng Cổ Trúc Lâm',
    labelEn: 'Ancient Bamboo Dungeon',
    estDropRatePct: 4,
    dailyCap: 2,
    runtimeStatus: 'UNWIRED',
    tag: 'DUNGEON',
  },

  // Boss drops (shards only — never whole high-rarity pet)
  {
    petKey: 'pet_hoa_phoenix',
    kind: 'BOSS_DROP',
    sourceRef: 'world_boss_huyet_long',
    labelVi: 'World Boss Huyết Long (shard 2)',
    labelEn: 'Blood Dragon World Boss (shard 2)',
    estDropRatePct: 2,
    weeklyCap: 6,
    runtimeStatus: 'UNWIRED',
    tag: 'BOSS',
  },
  {
    petKey: 'pet_kim_qilin',
    kind: 'BOSS_DROP',
    sourceRef: 'sect_boss_kim_linh',
    labelVi: 'Sect Boss Kim Linh (shard 3)',
    labelEn: 'Kim Linh Sect Boss (shard 3)',
    estDropRatePct: 3,
    weeklyCap: 4,
    runtimeStatus: 'UNWIRED',
    tag: 'BOSS',
  },
  {
    petKey: 'pet_loi_dragon',
    kind: 'BOSS_DROP',
    sourceRef: 'world_boss_loi_de',
    labelVi: 'World Boss Lôi Đế (shard 2)',
    labelEn: 'Thunder Emperor World Boss (shard 2)',
    estDropRatePct: 2,
    weeklyCap: 6,
    runtimeStatus: 'UNWIRED',
    tag: 'BOSS',
  },

  // Secret Realm drops
  {
    petKey: 'pet_moc_long',
    kind: 'SECRET_REALM_DROP',
    sourceRef: 'secret_realm_thuy_long',
    labelVi: 'Bí cảnh Thuỷ Long Đảo',
    labelEn: 'Water Dragon Island Secret Realm',
    estDropRatePct: 3,
    weeklyCap: 5,
    runtimeStatus: 'UNWIRED',
    tag: 'SECRET_REALM',
  },
  {
    petKey: 'pet_quang_crane',
    kind: 'SECRET_REALM_DROP',
    sourceRef: 'secret_realm_thien_quang',
    labelVi: 'Bí cảnh Thiên Quang',
    labelEn: 'Heavenly Light Secret Realm',
    estDropRatePct: 3,
    weeklyCap: 5,
    runtimeStatus: 'UNWIRED',
    tag: 'SECRET_REALM',
  },
  {
    petKey: 'pet_tho_tortoise',
    kind: 'SECRET_REALM_DROP',
    sourceRef: 'secret_realm_dia_phach',
    labelVi: 'Bí cảnh Địa Phách',
    labelEn: 'Earthsoul Secret Realm',
    estDropRatePct: 3,
    weeklyCap: 5,
    runtimeStatus: 'UNWIRED',
    tag: 'SECRET_REALM',
  },

  // Trial Tower
  {
    itemKey: 'pet_mat_thu_hon_thach',
    kind: 'TRIAL_TOWER_REWARD',
    sourceRef: 'trial_tower_floor_30',
    labelVi: 'Linh Tháp tầng 30',
    labelEn: 'Trial Tower floor 30',
    weeklyCap: 10,
    runtimeStatus: 'UNWIRED',
    tag: 'TRIAL_TOWER',
  },
  {
    itemKey: 'pet_mat_ngu_hanh_tinh_tuy',
    kind: 'TRIAL_TOWER_REWARD',
    sourceRef: 'trial_tower_floor_60',
    labelVi: 'Linh Tháp tầng 60',
    labelEn: 'Trial Tower floor 60',
    weeklyCap: 8,
    runtimeStatus: 'UNWIRED',
    tag: 'TRIAL_TOWER',
  },

  // Kỳ ngộ (opportunity encounter)
  {
    petKey: 'pet_butterfly_breeze',
    kind: 'KY_NGO_ENCOUNTER',
    sourceRef: 'ky_ngo_phong_dieu',
    labelVi: 'Kỳ ngộ Phong Điệp',
    labelEn: 'Wind Butterfly Opportunity',
    estDropRatePct: 12,
    weeklyCap: 1,
    runtimeStatus: 'UNWIRED',
    tag: 'FREE',
  },
  {
    itemKey: 'pet_mat_huyet_mach_tinh_hoa',
    kind: 'KY_NGO_ENCOUNTER',
    sourceRef: 'ky_ngo_huyet_mach',
    labelVi: 'Kỳ ngộ Huyết Mạch',
    labelEn: 'Bloodline Opportunity',
    weeklyCap: 1,
    runtimeStatus: 'UNWIRED',
    tag: 'FREE',
  },

  // Event exchange (token → ticket / shard)
  {
    itemKey: 'pet_ticket_event',
    kind: 'EVENT_EXCHANGE',
    sourceRef: 'event_festival_token',
    labelVi: 'Đổi token sự kiện lấy vé sự kiện',
    labelEn: 'Exchange event token for festival ticket',
    runtimeStatus: 'UNWIRED',
    tag: 'EVENT',
  },
  {
    petKey: 'pet_event_lantern',
    kind: 'EVENT_BOX',
    sourceRef: 'pet_box_event_festival',
    labelVi: 'Hộp Linh Thú Sự Kiện',
    labelEn: 'Festival Pet Box',
    estDropRatePct: 4,
    runtimeStatus: 'WIRED',
    tag: 'EVENT',
  },

  // Shop buy (material)
  {
    itemKey: 'pet_mat_linh_thao',
    kind: 'SHOP_BUY',
    sourceRef: 'shop_pet_general',
    labelVi: 'Tiệm Linh Thú phổ thông',
    labelEn: 'General Pet Shop',
    runtimeStatus: 'UNWIRED',
    tag: 'SHOP',
  },

  // Box open
  ...PETS.filter((p) => p.sourceTags.includes('BOX')).map((p) => ({
    petKey: p.petKey,
    kind: 'BOX_OPEN' as PetSourceKind,
    sourceRef: 'pet_box_standard',
    labelVi: 'Mở Hộp Linh Thú',
    labelEn: 'Open Pet Box',
    runtimeStatus: 'WIRED' as PetSourceRuntimeStatus,
    tag: 'BOX' as PetSourceTag,
  })),

  // Generic per-tag entries để guarantee free-path cho mọi pet có
  // sourceTag tương ứng. Run-time service sẽ resolve cụ thể dungeon/boss
  // map. Đây là catalog hint level — KHÔNG generate reward.
  ...PETS.flatMap((p): PetSourceEntry[] => {
    const out: PetSourceEntry[] = [];
    if (p.sourceTags.includes('DUNGEON')) {
      out.push({
        petKey: p.petKey,
        kind: 'DUNGEON_DROP',
        sourceRef: `dungeon_generic_${p.element.toLowerCase()}`,
        labelVi: `Bí cảnh hệ ${p.element}`,
        labelEn: `${p.element} elemental dungeons`,
        runtimeStatus: 'UNWIRED',
        tag: 'DUNGEON',
        notes: 'Auto: spec mở shard rơi ở bí cảnh cùng hệ.',
      });
    }
    if (p.sourceTags.includes('BOSS')) {
      out.push({
        petKey: p.petKey,
        kind: 'BOSS_DROP',
        sourceRef: `boss_generic_${p.element.toLowerCase()}`,
        labelVi: `Boss hệ ${p.element}`,
        labelEn: `${p.element} elemental bosses`,
        weeklyCap: 4,
        runtimeStatus: 'UNWIRED',
        tag: 'BOSS',
      });
    }
    if (p.sourceTags.includes('SECRET_REALM')) {
      out.push({
        petKey: p.petKey,
        kind: 'SECRET_REALM_DROP',
        sourceRef: `secret_realm_generic_${p.element.toLowerCase()}`,
        labelVi: `Bí cảnh ẩn hệ ${p.element}`,
        labelEn: `${p.element} secret realms`,
        weeklyCap: 3,
        runtimeStatus: 'UNWIRED',
        tag: 'SECRET_REALM',
      });
    }
    if (p.sourceTags.includes('EVENT')) {
      out.push({
        petKey: p.petKey,
        kind: 'EVENT_EXCHANGE',
        sourceRef: 'event_exchange_default',
        labelVi: 'Đổi token sự kiện',
        labelEn: 'Event token exchange',
        runtimeStatus: 'UNWIRED',
        tag: 'EVENT',
      });
    }
    if (p.sourceTags.includes('ACHIEVEMENT')) {
      out.push({
        petKey: p.petKey,
        kind: 'ACHIEVEMENT',
        sourceRef: `achievement_collect_${p.petKey}`,
        labelVi: 'Thành tựu sưu tầm',
        labelEn: 'Collection achievement',
        runtimeStatus: 'UNWIRED',
        tag: 'ACHIEVEMENT',
      });
    }
    if (p.sourceTags.includes('TRIAL_TOWER')) {
      out.push({
        petKey: p.petKey,
        kind: 'TRIAL_TOWER_REWARD',
        sourceRef: 'trial_tower_default',
        labelVi: 'Linh Tháp',
        labelEn: 'Trial Tower',
        weeklyCap: 2,
        runtimeStatus: 'UNWIRED',
        tag: 'TRIAL_TOWER',
      });
    }
    if (p.sourceTags.includes('FREE')) {
      out.push({
        petKey: p.petKey,
        kind: 'STARTER_GIFT',
        sourceRef: 'free_default',
        labelVi: 'Quà miễn phí / mốc tu luyện',
        labelEn: 'Free / cultivation milestone',
        runtimeStatus: 'UNWIRED',
        tag: 'FREE',
      });
    }
    return out;
  }),
];

/**
 * Tra source theo petKey hoặc itemKey.
 */
export function sourcesForPet(petKey: string): PetSourceEntry[] {
  return PET_SOURCES.filter((s) => s.petKey === petKey);
}

export function sourcesForMaterial(itemKey: string): PetSourceEntry[] {
  return PET_SOURCES.filter((s) => s.itemKey === itemKey);
}

export interface PetSourceIssue {
  petKey?: string;
  itemKey?: string;
  code: 'PET_NO_SOURCE' | 'PET_NO_FREE_PATH' | 'INVALID_SOURCE_REF' | 'CAP_INVALID';
  message: string;
}

/**
 * Audit catalog source: mọi pet phải có ≥1 source; pet không premium-only/
 * event-limited phải có free-path; cap không bị âm.
 */
export function auditPetSources(
  pets = PETS,
  sources: readonly PetSourceEntry[] = PET_SOURCES,
): PetSourceIssue[] {
  const issues: PetSourceIssue[] = [];
  const freeTags: PetSourceTag[] = ['FREE', 'EVENT', 'DUNGEON', 'SECRET_REALM', 'BOSS', 'ACHIEVEMENT', 'TRIAL_TOWER'];

  for (const p of pets) {
    const ownSources = sources.filter((s) => s.petKey === p.petKey);
    if (ownSources.length === 0) {
      issues.push({ petKey: p.petKey, code: 'PET_NO_SOURCE', message: 'no entry in PET_SOURCES' });
      continue;
    }
    if (!p.isPremiumVisualOnly && !p.isEventLimited) {
      const hasFree = ownSources.some((s) => freeTags.includes(s.tag));
      if (!hasFree) {
        issues.push({ petKey: p.petKey, code: 'PET_NO_FREE_PATH', message: 'no free/event/dungeon/boss/etc source' });
      }
    }
  }
  for (const s of sources) {
    if (s.petKey && !petByKey(s.petKey)) {
      issues.push({ petKey: s.petKey, code: 'INVALID_SOURCE_REF', message: `pet ${s.petKey} missing in catalog` });
    }
    if (s.dailyCap !== undefined && s.dailyCap < 0) {
      issues.push({ petKey: s.petKey, itemKey: s.itemKey, code: 'CAP_INVALID', message: 'dailyCap < 0' });
    }
    if (s.weeklyCap !== undefined && s.weeklyCap < 0) {
      issues.push({ petKey: s.petKey, itemKey: s.itemKey, code: 'CAP_INVALID', message: 'weeklyCap < 0' });
    }
  }
  return issues;
}
