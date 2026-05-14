/**
 * Phase 38.0 — Roguelike Bí Cảnh / Random Adventure V1.
 *
 * Static catalog + deterministic helpers for server-authoritative roguelike
 * runs. Runtime stores only seed/current state; floor/choice/reward previews are
 * derived from this catalog so the system can scale beyond the first authored
 * 30 floor templates without DB-backed content.
 */
import { REALMS, realmByKey } from './realms';

export const ROGUELIKE_FLOOR_TYPES = [
  'COMBAT',
  'ELITE',
  'MINI_BOSS',
  'TRAP',
  'TREASURE',
  'MERCHANT',
  'EVENT',
  'REST',
  'INHERITANCE',
] as const;
export type RoguelikeFloorType = (typeof ROGUELIKE_FLOOR_TYPES)[number];

export const ROGUELIKE_RUN_STATUSES = [
  'ACTIVE',
  'COMPLETED',
  'FAILED',
  'ABANDONED',
  'CLAIMED',
] as const;
export type RoguelikeRunStatus = (typeof ROGUELIKE_RUN_STATUSES)[number];

export const ROGUELIKE_BUFF_STATS = [
  'atkPct',
  'defPct',
  'hpPct',
  'critPct',
  'dodgePct',
  'dropPct',
] as const;
export type RoguelikeBuffStat = (typeof ROGUELIKE_BUFF_STATS)[number];

export const ROGUELIKE_CHOICE_RISKS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RoguelikeChoiceRisk = (typeof ROGUELIKE_CHOICE_RISKS)[number];

export const ROGUELIKE_CHOICE_REWARDS = [
  'SAFE_PROGRESS',
  'MORE_REWARD',
  'BUFF',
  'HEAL',
  'TREASURE',
  'INHERITANCE',
] as const;
export type RoguelikeChoiceReward = (typeof ROGUELIKE_CHOICE_REWARDS)[number];

export interface RoguelikeBuffDef {
  readonly key: string;
  readonly nameVi: string;
  readonly nameEn: string;
  readonly stat: RoguelikeBuffStat;
  /** Positive = buff, negative = debuff. Ephemeral; runtime stores in run JSON. */
  readonly valuePct: number;
  readonly durationFloors: number;
}

export interface RoguelikeChoiceDef {
  readonly key: string;
  readonly titleVi: string;
  readonly titleEn: string;
  readonly descriptionVi: string;
  readonly descriptionEn: string;
  readonly risk: RoguelikeChoiceRisk;
  readonly reward: RoguelikeChoiceReward;
  readonly hpDeltaPct: number;
  readonly resourceDelta: number;
  readonly scoreDelta: number;
  readonly rewardMultiplier: number;
  readonly buffKey?: string;
  readonly debuffKey?: string;
  readonly outcomeVi: string;
  readonly outcomeEn: string;
}

export interface RoguelikeFloorDef {
  readonly key: string;
  readonly floorNumber: number;
  readonly floorType: RoguelikeFloorType;
  readonly nameVi: string;
  readonly nameEn: string;
  readonly descriptionVi: string;
  readonly descriptionEn: string;
  readonly minRealmOrder: number;
  readonly powerMultiplier: number;
  readonly monsterKeys: readonly string[];
  readonly choiceKeys: readonly string[];
  readonly baseReward: {
    readonly linhThach: number;
    readonly exp: number;
  };
}

export interface RoguelikeRealmDef {
  readonly key: string;
  readonly nameVi: string;
  readonly nameEn: string;
  readonly descriptionVi: string;
  readonly descriptionEn: string;
  readonly requiredRealmOrder: number;
  readonly recommendedPower: number;
  readonly dailyEntryLimit: number;
  readonly weeklyRewardClaimLimit: number;
  readonly baseHp: number;
  readonly baseResource: number;
  readonly rewardMultiplier: number;
}

export interface RoguelikeRewardPreview {
  readonly linhThach: number;
  readonly exp: number;
  readonly items: readonly { itemKey: string; qty: number }[];
  readonly milestoneFloors: readonly number[];
}

export const ROGUELIKE_LIMITS = {
  minChoicesPerFloor: 1,
  maxChoicesPerFloor: 3,
  authoredFloorCount: 30,
  runCompletionFloor: 10,
  rewardFloorCap: 100,
  maxLinhThachPerClaim: 2400,
  maxExpPerClaim: 7000,
} as const;

export const ROGUELIKE_BUFFS: readonly RoguelikeBuffDef[] = [
  B('buff_blood_surge', 'Huyết khí bừng cháy', 'Blood Surge', 'atkPct', 12, 3),
  B('buff_stone_skin', 'Thạch giáp hộ thân', 'Stone Skin', 'defPct', 12, 3),
  B('buff_life_well', 'Sinh cơ dồi dào', 'Life Well', 'hpPct', 15, 4),
  B('buff_keen_sense', 'Linh giác sắc bén', 'Keen Sense', 'critPct', 8, 3),
  B('buff_shadow_step', 'Bộ pháp vô ảnh', 'Shadow Step', 'dodgePct', 8, 3),
  B('buff_lucky_omen', 'Cát triệu nhập mệnh', 'Lucky Omen', 'dropPct', 10, 4),
  B('debuff_poison_mist', 'Độc vụ nhập thể', 'Poison Mist', 'hpPct', -10, 3),
  B('debuff_cracked_guard', 'Hộ thể rạn nứt', 'Cracked Guard', 'defPct', -8, 3),
  B('debuff_exhausted', 'Khí lực suy kiệt', 'Exhausted', 'atkPct', -8, 2),
] as const;

export const ROGUELIKE_CHOICES: readonly RoguelikeChoiceDef[] = [
  C('fight_carefully', 'Đấu chắc từng bước', 'Fight Carefully', 'Giữ thế thủ, tiêu hao ít nhưng tiến ổn định.', 'Keep guard high for steady progress.', 'LOW', 'SAFE_PROGRESS', -6, 0, 8, 1, undefined, undefined, 'Bạn thắng một trận nhỏ và giữ được nhịp thở.', 'You win a small fight while keeping tempo.'),
  C('fight_all_in', 'Dốc lực phá trận', 'Commit Fully', 'Đánh nhanh thắng nhanh, đổi máu lấy nhiều chiến tích.', 'Trade health for a faster, richer clear.', 'HIGH', 'MORE_REWARD', -16, 0, 18, 1.35, 'buff_blood_surge', undefined, 'Sát khí bùng lên, chiến lợi phẩm tăng.', 'Killing intent surges and rewards improve.'),
  C('guard_and_probe', 'Thăm dò sơ hở', 'Probe Weakness', 'Tiến chậm, nhận chút phòng thủ tạm.', 'Advance slowly and gain temporary defense.', 'LOW', 'BUFF', -4, 0, 6, 0.9, 'buff_stone_skin', undefined, 'Bạn dựng thế phòng ngự vững vàng.', 'You settle into a stable guard.'),
  C('challenge_elite', 'Khiêu chiến tinh anh', 'Challenge Elite', 'Đối thủ mạnh hơn nhưng điểm vượt tầng cao.', 'A stronger foe grants better score.', 'HIGH', 'MORE_REWARD', -20, 0, 24, 1.45, 'buff_keen_sense', 'debuff_exhausted', 'Bạn thắng hiểm, linh giác mở rộng.', 'You barely win and sharpen your senses.'),
  C('kite_elite', 'Du đấu giữ khoảng cách', 'Kite the Elite', 'Giảm rủi ro, ít phần thưởng hơn.', 'Lower risk with smaller reward.', 'MEDIUM', 'SAFE_PROGRESS', -10, 0, 14, 1.1, 'buff_shadow_step', undefined, 'Bạn dùng thân pháp kéo giãn trận tuyến.', 'Footwork keeps the fight manageable.'),
  C('break_guard', 'Phá hộ thể', 'Break Guard', 'Tấn công điểm yếu để đổi lấy buff công kích.', 'Break a weak point for attack tempo.', 'HIGH', 'BUFF', -18, 0, 22, 1.25, 'buff_blood_surge', 'debuff_cracked_guard', 'Bạn phá giáp địch nhưng tự lộ sơ hở.', 'You break their guard but expose your own.'),
  C('duel_miniboss', 'Quyết đấu thủ hộ', 'Duel Guardian', 'Đấu boss nhỏ, mốc thưởng tốt hơn.', 'Face the guardian for milestone-grade value.', 'HIGH', 'MORE_REWARD', -24, 0, 32, 1.6, 'buff_lucky_omen', undefined, 'Thủ hộ ngã xuống, khí vận tụ lại.', 'The guardian falls and fortune gathers.'),
  C('outlast_miniboss', 'Cầm cự chờ thời', 'Outlast Guardian', 'Tốn ít máu hơn, nhận phòng thủ tạm.', 'Spend less health and gain defense.', 'MEDIUM', 'BUFF', -14, 0, 22, 1.2, 'buff_stone_skin', undefined, 'Bạn nhẫn nại mài mòn boss nhỏ.', 'Patience wears the guardian down.'),
  C('sacrifice_finish', 'Hiến tế kết liễu', 'Sacrifice Finish', 'Mất nhiều HP để nhận điểm cao.', 'Lose heavy HP for high score.', 'HIGH', 'INHERITANCE', -30, 0, 40, 1.75, 'buff_blood_surge', 'debuff_poison_mist', 'Một kích hiểm đổi lấy truyền thừa vụn.', 'A dangerous strike earns a shard of inheritance.'),
  C('disarm_trap', 'Giải bẫy trận văn', 'Disarm Formation', 'Giải bẫy an toàn, nhận ít tài nguyên tạm.', 'Safely disarm the trap for resources.', 'LOW', 'SAFE_PROGRESS', -3, 8, 8, 0.9, undefined, undefined, 'Trận văn tắt dần, bạn thu được linh tức.', 'The formation fades and yields spirit traces.'),
  C('force_trap', 'Cưỡng phá bẫy', 'Force the Trap', 'Chịu thương để mở đường tắt.', 'Take damage to force a shortcut.', 'HIGH', 'MORE_REWARD', -18, 4, 20, 1.3, undefined, 'debuff_cracked_guard', 'Bẫy vỡ tung, hộ thể của bạn rạn nứt.', 'The trap shatters and cracks your guard.'),
  C('avoid_trap', 'Né bẫy vòng ngoài', 'Skirt Around', 'Rất an toàn nhưng ít điểm.', 'Very safe, low score.', 'LOW', 'SAFE_PROGRESS', -1, 0, 4, 0.75, 'buff_shadow_step', undefined, 'Bạn lách qua mép trận đồ.', 'You slip around the formation edge.'),
  C('open_chest', 'Mở rương cổ', 'Open Ancient Chest', 'Nhận thêm thưởng nhưng có thể nhiễm độc.', 'Open treasure for reward with poison risk.', 'MEDIUM', 'TREASURE', -8, 0, 16, 1.35, undefined, 'debuff_poison_mist', 'Rương mở, độc khí mỏng quấn quanh tay.', 'The chest opens as faint poison coils out.'),
  C('inspect_chest', 'Quan sát minh văn', 'Inspect Runes', 'Ít thưởng hơn, tăng tỉ lệ rơi tạm.', 'Smaller gain, temporary drop chance.', 'LOW', 'BUFF', -2, 0, 10, 1.05, 'buff_lucky_omen', undefined, 'Bạn đọc được một đoạn cát văn.', 'You decipher a fortunate rune.'),
  C('leave_chest', 'Bỏ qua rương lạ', 'Leave It', 'Không tham, hồi chút HP.', 'Avoid greed and recover a little HP.', 'LOW', 'HEAL', 10, 0, 3, 0.6, undefined, undefined, 'Bạn giữ tâm cảnh ổn định.', 'You keep your mind steady.'),
  C('buy_talisman', 'Mua phù hộ thân', 'Buy Ward Talisman', 'Dùng tài nguyên tạm đổi phòng thủ.', 'Spend run resources for defense.', 'LOW', 'BUFF', 0, -12, 8, 0.9, 'buff_stone_skin', undefined, 'Lá phù ấm lên trước ngực.', 'A warm talisman settles near your chest.'),
  C('buy_elixir', 'Mua linh đan hồi phục', 'Buy Recovery Pill', 'Dùng tài nguyên để hồi HP.', 'Spend resources to heal.', 'LOW', 'HEAL', 18, -10, 6, 0.85, undefined, undefined, 'Đan dược tan ra, khí huyết hồi lại.', 'The pill restores your vitality.'),
  C('haggle_merchant', 'Mặc cả thương nhân', 'Haggle Merchant', 'Có lợi nếu may mắn, nhưng dễ bị nguyền.', 'Better value, with curse risk.', 'MEDIUM', 'TREASURE', -5, 8, 14, 1.15, 'buff_lucky_omen', 'debuff_exhausted', 'Thương nhân cười khó đoán.', 'The merchant smiles inscrutably.'),
  C('help_wanderer', 'Cứu tán tu lạc đường', 'Help Wanderer', 'Làm việc thiện nhận sinh cơ.', 'Help a wanderer and gain vitality.', 'LOW', 'HEAL', 12, 0, 10, 1, 'buff_life_well', undefined, 'Một lời cảm tạ hóa thành linh quang.', 'Gratitude turns into a gentle light.'),
  C('steal_omen', 'Đoạt cơ duyên', 'Seize Omen', 'Cướp kỳ ngộ, nhiều điểm nhưng giảm phòng thủ.', 'Seize an omen for score, losing guard.', 'HIGH', 'INHERITANCE', -20, 0, 28, 1.45, 'buff_keen_sense', 'debuff_cracked_guard', 'Cơ duyên vào tay, nhân quả cũng theo.', 'Fortune is yours, karma included.'),
  C('meditate_event', 'Tĩnh tọa nghe đạo âm', 'Meditate on Dao Echo', 'Không tham chiến, nhận buff nhẹ.', 'Meditate and gain a small buff.', 'LOW', 'BUFF', 4, 0, 8, 0.95, 'buff_life_well', undefined, 'Đạo âm làm dịu thương thế.', 'Dao echoes soothe your wounds.'),
  C('rest_deep', 'Nghỉ sâu một canh giờ', 'Deep Rest', 'Hồi nhiều HP nhưng ít điểm.', 'Recover more HP with little score.', 'LOW', 'HEAL', 28, 0, 2, 0.5, undefined, undefined, 'Bạn khép mắt dưỡng thần.', 'You rest and gather yourself.'),
  C('rest_light', 'Điều tức rồi đi tiếp', 'Brief Breath', 'Hồi ít HP, giữ nhịp vượt tầng.', 'Recover a little while keeping pace.', 'LOW', 'SAFE_PROGRESS', 14, 4, 7, 0.8, undefined, undefined, 'Hơi thở trở lại đều đặn.', 'Your breath steadies.'),
  C('skip_rest', 'Không nghỉ, tiếp tục', 'Press On', 'Không hồi HP, nhận điểm và buff công.', 'Skip healing for score and attack.', 'MEDIUM', 'BUFF', -6, 0, 16, 1.15, 'buff_blood_surge', 'debuff_exhausted', 'Ý chí ép thân thể tiến lên.', 'Willpower forces your body onward.'),
  C('accept_inheritance', 'Nhận truyền thừa', 'Accept Inheritance', 'Nhận buff mạnh, chịu phản phệ.', 'Gain a strong buff and backlash.', 'HIGH', 'INHERITANCE', -22, 0, 34, 1.55, 'buff_keen_sense', 'debuff_poison_mist', 'Một mảnh đạo niệm khắc vào thần hồn.', 'A shard of Dao brands your spirit.'),
  C('temper_inheritance', 'Rèn luyện lĩnh ngộ', 'Temper Insight', 'Buff vừa phải, ít phản phệ.', 'Moderate buff with less backlash.', 'MEDIUM', 'BUFF', -10, 0, 22, 1.2, 'buff_stone_skin', undefined, 'Lĩnh ngộ chậm mà chắc.', 'Insight settles slowly and safely.'),
  C('refuse_inheritance', 'Từ chối tà niệm', 'Refuse Dark Thought', 'Giữ an toàn, hồi HP.', 'Stay safe and recover.', 'LOW', 'HEAL', 16, 0, 6, 0.75, 'buff_life_well', undefined, 'Tâm cảnh trong trẻo hơn.', 'Your heart clears.'),
] as const;

const CHOICE_BY_TYPE: Record<RoguelikeFloorType, readonly string[]> = {
  COMBAT: ['fight_carefully', 'fight_all_in', 'guard_and_probe'],
  ELITE: ['challenge_elite', 'kite_elite', 'break_guard'],
  MINI_BOSS: ['duel_miniboss', 'outlast_miniboss', 'sacrifice_finish'],
  TRAP: ['disarm_trap', 'force_trap', 'avoid_trap'],
  TREASURE: ['open_chest', 'inspect_chest', 'leave_chest'],
  MERCHANT: ['buy_talisman', 'buy_elixir', 'haggle_merchant'],
  EVENT: ['help_wanderer', 'steal_omen', 'meditate_event'],
  REST: ['rest_deep', 'rest_light', 'skip_rest'],
  INHERITANCE: ['accept_inheritance', 'temper_inheritance', 'refuse_inheritance'],
} as const;

const FLOOR_PATTERN: readonly RoguelikeFloorType[] = [
  'COMBAT',
  'TRAP',
  'TREASURE',
  'COMBAT',
  'EVENT',
  'ELITE',
  'REST',
  'MERCHANT',
  'INHERITANCE',
  'MINI_BOSS',
] as const;

export const ROGUELIKE_REALMS: readonly RoguelikeRealmDef[] = [
  {
    key: 'mist_cave',
    nameVi: 'Mê Vụ Bí Cảnh',
    nameEn: 'Mistbound Secret Realm',
    descriptionVi: 'Bí cảnh nhập môn, nhiều bẫy nhẹ và cơ duyên nhỏ.',
    descriptionEn: 'Entry roguelike realm with light traps and small omens.',
    requiredRealmOrder: 0,
    recommendedPower: 80,
    dailyEntryLimit: 3,
    weeklyRewardClaimLimit: 14,
    baseHp: 100,
    baseResource: 30,
    rewardMultiplier: 1,
  },
  {
    key: 'sword_tomb',
    nameVi: 'Kiếm Mộ Bí Cảnh',
    nameEn: 'Sword Tomb Realm',
    descriptionVi: 'Mộ kiếm cổ, tinh anh dày đặc và truyền thừa nguy hiểm.',
    descriptionEn: 'An ancient sword tomb thick with elites and risky legacy.',
    requiredRealmOrder: 2,
    recommendedPower: 260,
    dailyEntryLimit: 2,
    weeklyRewardClaimLimit: 10,
    baseHp: 115,
    baseResource: 35,
    rewardMultiplier: 1.35,
  },
  {
    key: 'void_pagoda',
    nameVi: 'Hư Không Tháp',
    nameEn: 'Void Pagoda',
    descriptionVi: 'Bí cảnh cao cấp foundation, boss nhỏ ở mỗi mốc 10 tầng.',
    descriptionEn: 'Advanced foundation realm with guardian checks every 10 floors.',
    requiredRealmOrder: 4,
    recommendedPower: 620,
    dailyEntryLimit: 1,
    weeklyRewardClaimLimit: 7,
    baseHp: 130,
    baseResource: 42,
    rewardMultiplier: 1.8,
  },
] as const;

export const ROGUELIKE_FLOORS: readonly RoguelikeFloorDef[] = Array.from(
  { length: ROGUELIKE_LIMITS.authoredFloorCount },
  (_, idx) => {
    const floorNumber = idx + 1;
    const patternType = FLOOR_PATTERN[idx % FLOOR_PATTERN.length]!;
    const floorType =
      floorNumber % 50 === 0 || floorNumber % 20 === 0 || floorNumber % 10 === 0
        ? 'MINI_BOSS'
        : patternType;
    const minRealmOrder = Math.max(0, Math.floor((floorNumber - 1) / 10));
    const scale = 1 + Math.floor((floorNumber - 1) / 10) * 0.35;
    return {
      key: `rl_floor_${floorNumber.toString().padStart(2, '0')}`,
      floorNumber,
      floorType,
      nameVi: `${floorNameVi(floorType)} ${floorNumber}`,
      nameEn: `${floorNameEn(floorType)} ${floorNumber}`,
      descriptionVi: floorDescriptionVi(floorType),
      descriptionEn: floorDescriptionEn(floorType),
      minRealmOrder,
      powerMultiplier: Number(scale.toFixed(2)),
      monsterKeys: monsterKeysForType(floorType),
      choiceKeys: CHOICE_BY_TYPE[floorType],
      baseReward: {
        linhThach: Math.floor((18 + floorNumber * 3) * scale),
        exp: Math.floor((45 + floorNumber * 8) * scale),
      },
    } satisfies RoguelikeFloorDef;
  },
) as readonly RoguelikeFloorDef[];

export function roguelikeRealmByKey(key: string): RoguelikeRealmDef | undefined {
  return ROGUELIKE_REALMS.find((r) => r.key === key);
}

export function roguelikeFloorByNumber(floorNumber: number): RoguelikeFloorDef {
  const normalized = Math.max(1, Math.floor(floorNumber));
  const authored =
    ROGUELIKE_FLOORS[(normalized - 1) % ROGUELIKE_FLOORS.length]!;
  const loop = Math.floor((normalized - 1) / ROGUELIKE_FLOORS.length);
  if (loop === 0) return authored;
  const floorType =
    normalized % 50 === 0 || normalized % 20 === 0 || normalized % 10 === 0
      ? 'MINI_BOSS'
      : authored.floorType;
  const scale = 1 + Math.floor((normalized - 1) / 10) * 0.35;
  return {
    ...authored,
    key: `rl_floor_${normalized}`,
    floorNumber: normalized,
    floorType,
    nameVi: `${floorNameVi(floorType)} ${normalized}`,
    nameEn: `${floorNameEn(floorType)} ${normalized}`,
    minRealmOrder: Math.max(0, Math.floor((normalized - 1) / 10)),
    powerMultiplier: Number(scale.toFixed(2)),
    monsterKeys: monsterKeysForType(floorType),
    choiceKeys: CHOICE_BY_TYPE[floorType],
    baseReward: {
      linhThach: Math.floor((18 + normalized * 3) * scale),
      exp: Math.floor((45 + normalized * 8) * scale),
    },
  };
}

export function roguelikeChoiceByKey(
  key: string,
): RoguelikeChoiceDef | undefined {
  return ROGUELIKE_CHOICES.find((c) => c.key === key);
}

export function roguelikeBuffByKey(key: string): RoguelikeBuffDef | undefined {
  return ROGUELIKE_BUFFS.find((b) => b.key === key);
}

export function getRoguelikeChoicesForFloor(
  floorNumber: number,
  seed: string,
): readonly RoguelikeChoiceDef[] {
  const floor = roguelikeFloorByNumber(floorNumber);
  const keys = [...floor.choiceKeys];
  const count =
    1 + (hashToUint32(`${seed}:${floorNumber}:choice-count`) % ROGUELIKE_LIMITS.maxChoicesPerFloor);
  const shuffled = keys.sort(
    (a, b) =>
      hashToUint32(`${seed}:${floorNumber}:${a}`) -
      hashToUint32(`${seed}:${floorNumber}:${b}`),
  );
  return shuffled.slice(0, count).map((k) => roguelikeChoiceByKey(k)!);
}

export function computeRoguelikeRewardPreview(input: {
  readonly realmKey: string;
  readonly floorReached: number;
  readonly rewardMultiplier?: number;
}): RoguelikeRewardPreview {
  const realm = roguelikeRealmByKey(input.realmKey) ?? ROGUELIKE_REALMS[0]!;
  const cappedFloor = Math.max(
    0,
    Math.min(Math.floor(input.floorReached), ROGUELIKE_LIMITS.rewardFloorCap),
  );
  let linhThach = 0;
  let exp = 0;
  const milestoneFloors: number[] = [];
  for (let f = 1; f <= cappedFloor; f += 1) {
    const floor = roguelikeFloorByNumber(f);
    linhThach += floor.baseReward.linhThach;
    exp += floor.baseReward.exp;
    if (isRoguelikeMilestoneFloor(f)) {
      milestoneFloors.push(f);
      linhThach += Math.floor(80 + f * 8);
      exp += Math.floor(180 + f * 18);
    }
  }
  const mul = Math.max(0.1, input.rewardMultiplier ?? realm.rewardMultiplier);
  const items: { itemKey: string; qty: number }[] = [];
  if (cappedFloor >= 10) items.push({ itemKey: 'huyet_tinh', qty: 1 });
  if (cappedFloor >= 20) items.push({ itemKey: 'hoi_nguyen_dan', qty: 1 });
  if (cappedFloor >= 50) items.push({ itemKey: 'linh_tinh_dan', qty: 1 });
  return {
    linhThach: Math.min(
      ROGUELIKE_LIMITS.maxLinhThachPerClaim,
      Math.floor(linhThach * mul),
    ),
    exp: Math.min(ROGUELIKE_LIMITS.maxExpPerClaim, Math.floor(exp * mul)),
    items,
    milestoneFloors,
  };
}

export function isRoguelikeMilestoneFloor(floorNumber: number): boolean {
  if (floorNumber <= 0) return false;
  return floorNumber % 10 === 0 || floorNumber % 20 === 0 || floorNumber % 50 === 0;
}

export function roguelikeRealmUnlocked(
  realmKey: string,
  characterRealmKey: string,
): boolean {
  const def = roguelikeRealmByKey(realmKey);
  const realm = realmByKey(characterRealmKey) ?? REALMS[0]!;
  return !!def && realm.order >= def.requiredRealmOrder;
}

export function hashToUint32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function B(
  key: string,
  nameVi: string,
  nameEn: string,
  stat: RoguelikeBuffStat,
  valuePct: number,
  durationFloors: number,
): RoguelikeBuffDef {
  return { key, nameVi, nameEn, stat, valuePct, durationFloors };
}

function C(
  key: string,
  titleVi: string,
  titleEn: string,
  descriptionVi: string,
  descriptionEn: string,
  risk: RoguelikeChoiceRisk,
  reward: RoguelikeChoiceReward,
  hpDeltaPct: number,
  resourceDelta: number,
  scoreDelta: number,
  rewardMultiplier: number,
  buffKey: string | undefined,
  debuffKey: string | undefined,
  outcomeVi: string,
  outcomeEn: string,
): RoguelikeChoiceDef {
  return {
    key,
    titleVi,
    titleEn,
    descriptionVi,
    descriptionEn,
    risk,
    reward,
    hpDeltaPct,
    resourceDelta,
    scoreDelta,
    rewardMultiplier,
    buffKey,
    debuffKey,
    outcomeVi,
    outcomeEn,
  };
}

function floorNameVi(type: RoguelikeFloorType): string {
  return {
    COMBAT: 'Tầng Yêu Thú',
    ELITE: 'Tầng Tinh Anh',
    MINI_BOSS: 'Tầng Thủ Hộ',
    TRAP: 'Tầng Trận Bẫy',
    TREASURE: 'Tầng Cổ Rương',
    MERCHANT: 'Tầng Thương Nhân',
    EVENT: 'Tầng Kỳ Ngộ',
    REST: 'Tầng Tĩnh Dưỡng',
    INHERITANCE: 'Tầng Truyền Thừa',
  }[type];
}

function floorNameEn(type: RoguelikeFloorType): string {
  return {
    COMBAT: 'Beast Floor',
    ELITE: 'Elite Floor',
    MINI_BOSS: 'Guardian Floor',
    TRAP: 'Trap Floor',
    TREASURE: 'Ancient Chest Floor',
    MERCHANT: 'Merchant Floor',
    EVENT: 'Omen Floor',
    REST: 'Rest Floor',
    INHERITANCE: 'Inheritance Floor',
  }[type];
}

function floorDescriptionVi(type: RoguelikeFloorType): string {
  return {
    COMBAT: 'Quái vật tuần tra chắn đường.',
    ELITE: 'Một tinh anh bí cảnh đang chờ khiêu chiến.',
    MINI_BOSS: 'Thủ hộ tầng này kiểm tra sức bền của người vượt cảnh.',
    TRAP: 'Trận văn cổ ẩn trong sương mù.',
    TREASURE: 'Một rương cổ phát ra linh quang.',
    MERCHANT: 'Thương nhân vô danh mở quầy trong hư không.',
    EVENT: 'Một kỳ ngộ khó đoán xuất hiện.',
    REST: 'Khoảng lặng hiếm hoi để điều tức.',
    INHERITANCE: 'Đạo niệm cổ xưa để lại mảnh truyền thừa.',
  }[type];
}

function floorDescriptionEn(type: RoguelikeFloorType): string {
  return {
    COMBAT: 'Patrolling monsters block the way.',
    ELITE: 'An elite realm foe waits for a challenger.',
    MINI_BOSS: 'A guardian tests the delver’s endurance.',
    TRAP: 'Ancient formation lines hide in the mist.',
    TREASURE: 'An old chest glows with spirit light.',
    MERCHANT: 'A nameless merchant opens shop in the void.',
    EVENT: 'An unpredictable omen appears.',
    REST: 'A rare quiet place to regulate breath.',
    INHERITANCE: 'Ancient Dao intent leaves a shard of legacy.',
  }[type];
}

function monsterKeysForType(type: RoguelikeFloorType): readonly string[] {
  if (type === 'ELITE') return ['linh_lang', 'huyen_vien'];
  if (type === 'MINI_BOSS') return ['huyen_vien', 'boss_son_tinh'];
  return ['son_thu_lon', 'linh_lang'];
}
