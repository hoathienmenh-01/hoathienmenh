import type { MissionGoalKind } from './missions';

export type ReputationGroup =
  | 'TIEN_DAO'
  | 'DAN_DAO'
  | 'CHIEN_DAU'
  | 'BI_CANH'
  | 'TONG_MON'
  | 'XA_HOI'
  | 'SU_KIEN'
  | 'THUONG_HOI';

export type LongTermGoalCategory =
  | 'realm'
  | 'body'
  | 'pet'
  | 'dungeon'
  | 'boss'
  | 'sect';

export type LongTermGoalTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface ReputationGroupDef {
  readonly key: ReputationGroup;
  readonly nameVi: string;
  readonly nameEn: string;
  readonly descriptionVi: string;
  readonly descriptionEn: string;
  readonly dailyCap: number;
}

export interface LongTermGoalReward {
  readonly reputation?: Partial<Record<ReputationGroup, number>>;
}

export interface LongTermGoalDef {
  readonly key: string;
  readonly nameVi: string;
  readonly nameEn: string;
  readonly descriptionVi: string;
  readonly descriptionEn: string;
  readonly category: LongTermGoalCategory;
  readonly tier: LongTermGoalTier;
  readonly goalKind: MissionGoalKind;
  readonly goalAmount: number;
  readonly reward: LongTermGoalReward;
}

export const REPUTATION_GROUPS: readonly ReputationGroupDef[] = [
  {
    key: 'TIEN_DAO',
    nameVi: 'Tiên Đạo',
    nameEn: 'Immortal Dao',
    descriptionVi: 'Uy danh từ tu luyện, phá cảnh và đạo tâm bền bỉ.',
    descriptionEn: 'Renown from cultivation, breakthroughs and steady dao heart.',
    dailyCap: 300,
  },
  {
    key: 'DAN_DAO',
    nameVi: 'Đan Đạo',
    nameEn: 'Alchemy Dao',
    descriptionVi: 'Uy tín của luyện đan sư qua tích luỹ chế đan an toàn.',
    descriptionEn: 'Alchemist reputation from safe pill-crafting milestones.',
    dailyCap: 220,
  },
  {
    key: 'CHIEN_DAU',
    nameVi: 'Chiến Đấu',
    nameEn: 'Combat',
    descriptionVi: 'Danh vọng chiến đấu qua trảm yêu, boss và thử thách.',
    descriptionEn: 'Combat renown from monster slaying, bosses and trials.',
    dailyCap: 260,
  },
  {
    key: 'BI_CANH',
    nameVi: 'Bí Cảnh',
    nameEn: 'Secret Realms',
    descriptionVi: 'Dấu ấn khai phá bí cảnh, phó bản và vùng nguy hiểm.',
    descriptionEn: 'Exploration standing from dungeons and dangerous realms.',
    dailyCap: 240,
  },
  {
    key: 'TONG_MON',
    nameVi: 'Tông Môn',
    nameEn: 'Sect',
    descriptionVi: 'Uy vọng đóng góp cho tông môn và đồng đạo.',
    descriptionEn: 'Sect standing from contributions and shared progress.',
    dailyCap: 220,
  },
  {
    key: 'XA_HOI',
    nameVi: 'Xã Hội',
    nameEn: 'Social',
    descriptionVi: 'Thiện danh từ tương tác cộng đồng không sinh sức mạnh.',
    descriptionEn: 'Social reputation from community actions without power rewards.',
    dailyCap: 180,
  },
  {
    key: 'SU_KIEN',
    nameVi: 'Sự Kiện',
    nameEn: 'Events',
    descriptionVi: 'Dấu ấn tham gia hoạt động mùa và sự kiện an toàn.',
    descriptionEn: 'Event reputation from safe seasonal participation.',
    dailyCap: 200,
  },
  {
    key: 'THUONG_HOI',
    nameVi: 'Thương Hội',
    nameEn: 'Merchant Guild',
    descriptionVi: 'Uy tín giao thương qua mua bán có kiểm soát.',
    descriptionEn: 'Commerce reputation from controlled market participation.',
    dailyCap: 200,
  },
];

export const LONG_TERM_GOALS: readonly LongTermGoalDef[] = [
  {
    key: 'dao_seed_first_breakthrough',
    nameVi: 'Mầm Đạo Phá Cảnh',
    nameEn: 'Dao Seed Breakthrough',
    descriptionVi: 'Hoàn thành lần phá cảnh đầu tiên để mở đường dài hạn.',
    descriptionEn: 'Complete the first breakthrough to open the long road.',
    category: 'realm',
    tier: 'bronze',
    goalKind: 'BREAKTHROUGH',
    goalAmount: 1,
    reward: { reputation: { TIEN_DAO: 40 } },
  },
  {
    key: 'dao_path_ten_breakthroughs',
    nameVi: 'Thập Bộ Tiên Lộ',
    nameEn: 'Ten Steps on the Immortal Road',
    descriptionVi: 'Tích luỹ 10 lần phá cảnh, chỉ ghi nhận tiến độ foundation.',
    descriptionEn: 'Accumulate 10 breakthroughs as a long-term foundation target.',
    category: 'realm',
    tier: 'silver',
    goalKind: 'BREAKTHROUGH',
    goalAmount: 10,
    reward: { reputation: { TIEN_DAO: 120 } },
  },
  {
    key: 'body_temper_24h',
    nameVi: 'Luyện Thể Bền Bỉ',
    nameEn: 'Steady Body Tempering',
    descriptionVi: 'Tích luỹ 24 giờ tu luyện để đại diện cho nền luyện thể.',
    descriptionEn: 'Accumulate 24 hours of cultivation as body-tempering foundation.',
    category: 'body',
    tier: 'bronze',
    goalKind: 'CULTIVATE_SECONDS',
    goalAmount: 86_400,
    reward: { reputation: { TIEN_DAO: 50 } },
  },
  {
    key: 'pet_bond_foundation',
    nameVi: 'Linh Thú Đồng Hành',
    nameEn: 'Spirit Beast Companion',
    descriptionVi: 'Mốc foundation cho pet, tạm dùng tiến độ EXP đến khi hook pet sâu hơn.',
    descriptionEn: 'Pet foundation goal using EXP progress until deeper pet hooks land.',
    category: 'pet',
    tier: 'bronze',
    goalKind: 'GAIN_EXP',
    goalAmount: 10_000,
    reward: { reputation: { SU_KIEN: 30 } },
  },
  {
    key: 'secret_realm_first_clear',
    nameVi: 'Khai Môn Bí Cảnh',
    nameEn: 'Secret Realm Gate',
    descriptionVi: 'Hoàn thành bí cảnh/phó bản đầu tiên.',
    descriptionEn: 'Clear the first dungeon or secret realm.',
    category: 'dungeon',
    tier: 'bronze',
    goalKind: 'CLEAR_DUNGEON',
    goalAmount: 1,
    reward: { reputation: { BI_CANH: 40 } },
  },
  {
    key: 'secret_realm_hundred_clears',
    nameVi: 'Bách Cảnh Du Hành',
    nameEn: 'Hundred Realm Wanderer',
    descriptionVi: 'Tích luỹ 100 lượt hoàn thành bí cảnh/phó bản.',
    descriptionEn: 'Accumulate 100 dungeon or secret-realm clears.',
    category: 'dungeon',
    tier: 'gold',
    goalKind: 'CLEAR_DUNGEON',
    goalAmount: 100,
    reward: { reputation: { BI_CANH: 180 } },
  },
  {
    key: 'boss_hunter_foundation',
    nameVi: 'Sơ Chiến Đại Yêu',
    nameEn: 'First Boss Hunter',
    descriptionVi: 'Chạm trán boss 10 lần để ghi nhận nhịp hoạt động dài hạn.',
    descriptionEn: 'Hit bosses 10 times to record long-term engagement cadence.',
    category: 'boss',
    tier: 'silver',
    goalKind: 'BOSS_HIT',
    goalAmount: 10,
    reward: { reputation: { CHIEN_DAU: 90 } },
  },
  {
    key: 'sect_contributor_long_road',
    nameVi: 'Tông Môn Trụ Cột',
    nameEn: 'Sect Pillar',
    descriptionVi: 'Tích luỹ 10.000 điểm đóng góp tông môn.',
    descriptionEn: 'Accumulate 10,000 sect contribution progress.',
    category: 'sect',
    tier: 'gold',
    goalKind: 'SECT_CONTRIBUTE',
    goalAmount: 10_000,
    reward: { reputation: { TONG_MON: 200 } },
  },
];

export const REPUTATION_GROUP_KEYS = REPUTATION_GROUPS.map((g) => g.key);

export function getReputationGroupDef(
  key: ReputationGroup,
): ReputationGroupDef | undefined {
  return REPUTATION_GROUPS.find((g) => g.key === key);
}

export function isReputationGroup(key: string): key is ReputationGroup {
  return REPUTATION_GROUPS.some((g) => g.key === key);
}

export function getLongTermGoalDef(
  key: string,
): LongTermGoalDef | undefined {
  return LONG_TERM_GOALS.find((g) => g.key === key);
}

export function longTermGoalsByCategory(
  category: LongTermGoalCategory,
): LongTermGoalDef[] {
  return LONG_TERM_GOALS.filter((g) => g.category === category);
}
