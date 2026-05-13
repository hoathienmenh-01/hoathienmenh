/**
 * Phase 34.2 — Secret Realm / Bí Cảnh Runtime catalog.
 *
 * Lightweight catalog wrapping a small set of "secret realm" instances that
 * a character can enter once per cooldown window. Each realm has gating
 * (realm order, optional story flag, optional entry-ticket item), an
 * objective set, and a capped reward profile.
 *
 * Reward guardrails (audited by `secret-realm.test.ts`):
 *  - Only `linhThach` ∈ [200, 1500] per realm clear.
 *  - Only `exp` ∈ [400, 4000] per realm clear.
 *  - **NO** `tienNgoc` minted (catalog enforces `tienNgoc = 0`).
 *  - **NO** endgame item / inventory grant (catalog `items: []`).
 *  - Realm clears do NOT alter Phase 33 chapter/quest state — they ONLY
 *    grant currency/exp and write a journal row.
 */
import type { ElementKey } from './combat';

export const SECRET_REALM_STATUSES = [
  'LOCKED',
  'AVAILABLE',
  'ENTERED',
  'CLEARED',
  'CLAIMED',
  'EXPIRED',
] as const;
export type SecretRealmStatus = (typeof SECRET_REALM_STATUSES)[number];

export const SECRET_REALM_OBJECTIVE_KINDS = [
  'clear_rooms',
  'defeat_guardian',
  'collect_realm_item',
  'solve_formation',
] as const;
export type SecretRealmObjectiveKind =
  (typeof SECRET_REALM_OBJECTIVE_KINDS)[number];

export const SECRET_REALM_REWARD_CAPS = {
  linhThachMax: 1500,
  expMax: 4000,
  /** Maximum runs per realm per day (per character). */
  dailyRunsPerRealm: 1,
} as const;

export interface SecretRealmObjectiveDef {
  /** Objective slot key (must be unique within a realm). */
  key: string;
  kind: SecretRealmObjectiveKind;
  /** Target count, e.g. clear 3 rooms / defeat 1 guardian. */
  target: number;
  /** UI label. */
  titleVi: string;
  titleEn: string;
}

export interface SecretRealmRewardDef {
  linhThach: number;
  exp: number;
  tienNgoc: 0;
  items: readonly { itemKey: string; qty: number; bind?: boolean }[];
}

export interface SecretRealmDef {
  /** Stable key (also stored in `CharacterSecretRealmRun.secretRealmKey`). */
  key: string;
  /** UI title. */
  nameVi: string;
  nameEn: string;
  /** Short description / flavour text. */
  descriptionVi: string;
  descriptionEn: string;
  /** Optional Ngũ Hành affinity hint (cosmetic, no combat impact in v1). */
  elementAffinity?: ElementKey;
  /** Required realm order to be allowed to enter. */
  requiredRealmOrder: number;
  /** Recommended power (UI hint only). */
  recommendedPower: number;
  /** Optional consumable item-key required to enter (1 stack on enter). */
  entryTicketItemKey?: string;
  /** Cooldown between successful clears (hours, MAX_SAFE_INTEGER for one-shot). */
  cooldownHours: number;
  /** Optional Phase 33 story-flag gate. */
  requiredStoryFlags?: readonly string[];
  /** Objective set — UI displays as checklist. */
  objectives: readonly SecretRealmObjectiveDef[];
  /** Capped reward profile. */
  rewardProfile: SecretRealmRewardDef;
  /** Optional `WorldContent` cross-link key (informational only). */
  worldContentKey?: string;
}

const R = (
  key: string,
  nameVi: string,
  nameEn: string,
  descriptionVi: string,
  descriptionEn: string,
  requiredRealmOrder: number,
  cooldownHours: number,
  reward: { linhThach: number; exp: number },
  objectives: readonly SecretRealmObjectiveDef[],
  extras: Partial<
    Pick<
      SecretRealmDef,
      | 'elementAffinity'
      | 'entryTicketItemKey'
      | 'requiredStoryFlags'
      | 'worldContentKey'
      | 'recommendedPower'
    >
  > = {},
): SecretRealmDef => ({
  key,
  nameVi,
  nameEn,
  descriptionVi,
  descriptionEn,
  requiredRealmOrder,
  recommendedPower: extras.recommendedPower ?? requiredRealmOrder * 100,
  cooldownHours,
  rewardProfile: {
    linhThach: reward.linhThach,
    exp: reward.exp,
    tienNgoc: 0,
    items: [],
  },
  objectives,
  ...extras,
});

export const SECRET_REALMS: readonly SecretRealmDef[] = [
  R(
    'sr_pham_cavern',
    'Hang Phàm Khí',
    'Mundane Cavern',
    'Một hang động cũ ở vùng phàm giới, vắng vẻ và ẩm thấp.',
    'An old cavern in the mortal realm, damp and quiet.',
    1,
    12,
    { linhThach: 200, exp: 400 },
    [
      {
        key: 'clear_3_rooms',
        kind: 'clear_rooms',
        target: 3,
        titleVi: 'Vượt qua 3 gian phòng',
        titleEn: 'Clear 3 chambers',
      },
    ],
    { elementAffinity: 'tho' },
  ),
  R(
    'sr_linh_grotto',
    'Linh Hang Cốc',
    'Spirit Grotto',
    'Một sơn cốc linh khí nồng đặc, ánh sáng trắng nhẹ.',
    'A grotto thick with spirit qi, soft white light filtering through.',
    3,
    18,
    { linhThach: 400, exp: 900 },
    [
      {
        key: 'clear_5_rooms',
        kind: 'clear_rooms',
        target: 5,
        titleVi: 'Vượt qua 5 gian phòng',
        titleEn: 'Clear 5 chambers',
      },
      {
        key: 'collect_essence',
        kind: 'collect_realm_item',
        target: 1,
        titleVi: 'Thu thập linh khí tinh hoa',
        titleEn: 'Gather essence shard',
      },
    ],
    { elementAffinity: 'moc' },
  ),
  R(
    'sr_huyen_array',
    'Huyền Trận Cổ',
    'Mystic Array',
    'Trận pháp huyền môn nửa rớt, giải mã giúp đột phá nhanh hơn.',
    'A half-decayed mystic array — solving it expedites breakthrough.',
    5,
    24,
    { linhThach: 700, exp: 1600 },
    [
      {
        key: 'solve_formation',
        kind: 'solve_formation',
        target: 1,
        titleVi: 'Giải trận pháp',
        titleEn: 'Solve the array',
      },
      {
        key: 'defeat_array_guardian',
        kind: 'defeat_guardian',
        target: 1,
        titleVi: 'Đánh bại trận thủ',
        titleEn: 'Defeat the array guardian',
      },
    ],
    { elementAffinity: 'kim' },
  ),
  R(
    'sr_tien_pavilion',
    'Tiên Đình Bí Cảnh',
    'Immortal Pavilion Realm',
    'Một mảnh đình các tiên gia ẩn hiện, lấp lánh tiên khí.',
    'A flickering remnant of an immortal pavilion, shimmering with sky-qi.',
    8,
    36,
    { linhThach: 1100, exp: 2800 },
    [
      {
        key: 'clear_7_rooms',
        kind: 'clear_rooms',
        target: 7,
        titleVi: 'Vượt qua 7 gian phòng',
        titleEn: 'Clear 7 chambers',
      },
      {
        key: 'defeat_pavilion_guardian',
        kind: 'defeat_guardian',
        target: 1,
        titleVi: 'Đánh bại đình thủ',
        titleEn: 'Defeat the pavilion guardian',
      },
    ],
    { elementAffinity: 'hoa', requiredStoryFlags: ['ch11_intro_done'] },
  ),
  R(
    'sr_than_threshold',
    'Thần Tịch Bí Cảnh',
    'Divine Threshold Realm',
    'Đường biên của Thần đạo, chỉ cao nhân Bản Nguyên trở lên mới chịu nổi.',
    'The threshold of the Divine Path — only Source-tier cultivators endure.',
    12,
    48,
    { linhThach: 1500, exp: 4000 },
    [
      {
        key: 'clear_10_rooms',
        kind: 'clear_rooms',
        target: 10,
        titleVi: 'Vượt qua 10 gian phòng',
        titleEn: 'Clear 10 chambers',
      },
      {
        key: 'defeat_threshold_guardian',
        kind: 'defeat_guardian',
        target: 1,
        titleVi: 'Đánh bại thần thủ',
        titleEn: 'Defeat the divine guardian',
      },
      {
        key: 'collect_divine_shard',
        kind: 'collect_realm_item',
        target: 3,
        titleVi: 'Thu thập 3 mảnh thần ngọc',
        titleEn: 'Collect 3 divine shards',
      },
    ],
    { elementAffinity: 'thuy', requiredStoryFlags: ['ch17_intro_done'] },
  ),
] as const;

/** O(1) lookup. */
export function secretRealmByKey(key: string): SecretRealmDef | undefined {
  return SECRET_REALMS.find((r) => r.key === key);
}

/**
 * Compute `LOCKED` / `AVAILABLE` view-status from gating only — runtime
 * status (`ENTERED`, `CLEARED`, `CLAIMED`) is layered on top by the service.
 */
export function secretRealmGateStatusFor(
  def: SecretRealmDef,
  ctx: {
    realmOrder: number;
    storyFlags?: ReadonlySet<string>;
    lastClearedAt?: Date | null;
    nowMs?: number;
  },
): 'LOCKED' | 'AVAILABLE' {
  if (def.requiredRealmOrder > ctx.realmOrder) return 'LOCKED';
  if (def.requiredStoryFlags && def.requiredStoryFlags.length > 0) {
    const flags = ctx.storyFlags ?? new Set<string>();
    for (const f of def.requiredStoryFlags) {
      if (!flags.has(f)) return 'LOCKED';
    }
  }
  if (ctx.lastClearedAt) {
    const now = ctx.nowMs ?? Date.now();
    const elapsedMs = now - ctx.lastClearedAt.getTime();
    const cooldownMs = def.cooldownHours * 60 * 60 * 1000;
    if (elapsedMs < cooldownMs) return 'LOCKED';
  }
  return 'AVAILABLE';
}

/**
 * Aggregate objective progress vs catalog. Returns `true` if every objective
 * has `currentCount >= target`.
 */
export function isSecretRealmCleared(
  def: SecretRealmDef,
  objectiveProgress: Readonly<Record<string, number>>,
): boolean {
  for (const obj of def.objectives) {
    const current = objectiveProgress[obj.key] ?? 0;
    if (current < obj.target) return false;
  }
  return true;
}
