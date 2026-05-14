/**
 * Phase 16.5 — Daily Reward Cap catalog.
 *
 * Pure data + deterministic helpers. KHÔNG runtime/schema/migration ở
 * file này — runtime cap apply ở
 * `apps/api/src/modules/economy/reward-cap.service.ts`.
 *
 * Mục tiêu:
 *   - Giới hạn tổng EXP / linhThach mỗi character có thể nhận trong 1
 *     ngày (theo timezone reset, mặc định Asia/Ho_Chi_Minh) **theo cảnh
 *     giới + theo nguồn**.
 *   - Cap rộng tay đủ để không phá retention người chơi bình thường,
 *     nhưng đủ chặt để chặn farm bot / exploit / multi-account abuse.
 *   - Cap scale theo `realm.order` — realm cao cap cao hơn (đi farm cao
 *     hơn cũng có giá trị reward cao hơn), nhưng monotonic
 *     không-giảm để khỏi tạo "vùng punish" khi lên realm mới.
 *
 * NGUYÊN TẮC:
 *   - **Không** cap ở mức quá tight (target: người chơi cày 4–6 tiếng/ngày
 *     vẫn không chạm cap).
 *   - **Không** cap admin grant (`ADMIN_GRANT` reason) — admin compensation /
 *     refund / event grant đi qua path riêng, RewardCapService bypass.
 *   - **Cap riêng theo nguồn** (`RewardSource`) — cultivation farm hết cap
 *     thì dungeon vẫn còn cap riêng, mission vẫn còn cap riêng. Chống
 *     stack tổng nhưng không giết end-game variety.
 *   - **Reset theo ngày local timezone** (vd Asia/Ho_Chi_Minh 00:00) —
 *     tái sử dụng pattern `getLocalDateString` đã có ở
 *     `daily-login.service.ts`.
 *
 * Source-of-truth balance: `docs/BALANCE_MODEL.md` §16 + `docs/ECONOMY_MODEL.md`
 * §Daily Reward Cap.
 */

import { REALMS, realmByKey } from './realms';

/**
 * Nguồn reward mà cap có hiệu lực. **Cap riêng theo nguồn** —
 * mỗi nguồn có 1 bucket riêng `(characterId, dayBucket, source)`.
 *
 * Chỉ thêm source vào enum này khi runtime đã wire cap path. Mỗi source
 * mới CẦN có entry trong `DAILY_REWARD_CAP_BY_REALM_AND_SOURCE` +
 * invariant test bao phủ.
 */
export const REWARD_SOURCES = [
  /**
   * Cultivation tick reward (EXP) — wire ở `cultivation.processor.ts`.
   * linhThach cap = 0 (cultivation không trao linhThach trực tiếp; nếu
   * trong tương lai thêm thì update cap tại đây).
   */
  'CULTIVATION',
  /**
   * Body cultivation tick reward (bodyExp) — riêng bucket với CULTIVATION để
   * player vẫn có progression Luyện Thể song song nhưng không farm vô hạn.
   */
  'BODY_CULTIVATION',
  /**
   * Dungeon run claim — wire ở `dungeon-run.service.ts:claimRun`.
   * Bao gồm cả linhThach + EXP từ `dungeon.runReward` + territory buff
   * bonus (đã apply trước cap → cap apply trên total = base + bonus).
   */
  'DUNGEON',
  /**
   * Mission claim — wire ở `mission.service.ts:claim`. EXP + linhThach
   * từ `MissionDef.rewards`. Mission 1 ngày tổng số reward bị cap.
   */
  'MISSION',
  /**
   * Phase 38.0 — Roguelike Bí Cảnh final claim. Reward preview theo tầng
   * sâu, claim idempotent qua `RoguelikeRun.status COMPLETED → CLAIMED`.
   */
  'ROGUELIKE',
] as const;

export type RewardSource = (typeof REWARD_SOURCES)[number];

export function isRewardSource(value: string): value is RewardSource {
  return (REWARD_SOURCES as readonly string[]).includes(value);
}

/**
 * Cap entry cho 1 (realm, source) pair.
 *
 * - `expCap`: cap tổng EXP/ngày từ source này. `bigint` để khớp
 *   `Character.exp` BigInt + tránh overflow ở realm cao.
 * - `linhThachCap`: cap tổng linh thạch/ngày từ source này. `bigint`
 *   để khớp `Character.linhThach`. Cho phép `0n` (vd CULTIVATION
 *   không grant linhThach trực tiếp).
 *
 * Cả hai ≥ 0n. `0n` nghĩa là **không cho grant** từ source này (hard
 * gate). Nếu muốn "vô hạn" (không cap), dùng số rất lớn — KHÔNG dùng
 * sentinel `-1n` để giảm điều kiện đặc biệt trong runtime.
 */
export interface DailyRewardCap {
  readonly expCap: bigint;
  readonly linhThachCap: bigint;
}

/**
 * Realm-aware cap multiplier tier.
 *
 * Ý tưởng: realm cao có cap cao hơn theo bậc, nhưng KHÔNG mọi realm
 * đều unique — chia thành band để dễ cân bằng:
 *
 *   - phamnhan / luyenkhi / truc_co (order 0–2): "early game" — cap
 *     tight để chống bot tạo char mới farm cày trade lậu.
 *   - kim_dan / nguyen_anh / hoa_than (order 3–5): "mid game" —
 *     ×3 cap.
 *   - luyen_hu+ (order ≥ 6): "late game" — ×8 cap.
 *
 * Multiplier áp dụng vào BASE cap dưới. Monotonic non-decreasing theo
 * realm.order — verified bằng invariant test.
 */
function realmCapTierMultiplier(realmOrder: number): number {
  if (realmOrder <= 2) return 1;
  if (realmOrder <= 5) return 3;
  return 8;
}

/**
 * Base cap cho realm tier 1 (order 0–2). Mỗi source có ngân sách riêng.
 * Số được chọn từ kinh nghiệm playtest:
 *   - cultivation EXP/ngày tier 1 ~ rate 5–7 EXP × 600 tick/ngày ≈
 *     3000–4200 EXP → cap 6000n (2× bình thường) đủ headroom.
 *   - dungeon: 1 dungeon clear ~ 50 linhThach + 200 EXP. Cap
 *     linhThach 600n / EXP 2400n ≈ 12 clear/ngày tier 1.
 *   - mission: daily mission ~ 100 linhThach. Cap 500n đủ cho
 *     mission daily + weekly trong 1 ngày bùng nổ.
 *
 * Cap số float / fractional → BigInt rounding chỉ lúc compose, KHÔNG
 * lúc balance dial vì ta muốn integer literal cho audit.
 */
const BASE_CAPS: Record<RewardSource, DailyRewardCap> = {
  CULTIVATION: { expCap: 6000n, linhThachCap: 0n },
  BODY_CULTIVATION: { expCap: 3300n, linhThachCap: 0n },
  DUNGEON: { expCap: 2400n, linhThachCap: 600n },
  MISSION: { expCap: 1500n, linhThachCap: 500n },
  ROGUELIKE: { expCap: 7000n, linhThachCap: 2400n },
};

/**
 * Compose cap thực tế cho `(realmKey, source)` pair. Service runtime
 * gọi helper `dailyRewardCapFor(realmKey, source)` thay vì tra map
 * 2 chiều — nhờ đó balance dial chỉ cần edit 1 hằng số.
 *
 * Lookup miss (realm key sai) → fallback realm phamnhan (order 0)
 * — phòng tuyến cuối: cap tight thay vì grant infinite.
 */
export function dailyRewardCapFor(
  realmKey: string,
  source: RewardSource,
): DailyRewardCap {
  const realm = realmByKey(realmKey) ?? REALMS[0]!;
  const mul = realmCapTierMultiplier(realm.order);
  const base = BASE_CAPS[source];
  return {
    expCap: base.expCap * BigInt(mul),
    linhThachCap: base.linhThachCap * BigInt(mul),
  };
}

/**
 * Map đầy đủ `(realm.key) -> Record<RewardSource, DailyRewardCap>` cho
 * docs / admin view. KHÔNG dùng trong hot path runtime — runtime gọi
 * `dailyRewardCapFor` để cache miss-aware.
 *
 * Frozen `as const` để tránh runtime mutation. Mỗi entry tham chiếu
 * `dailyRewardCapFor` cùng cặp giá trị — single source-of-truth.
 */
export const DAILY_REWARD_CAP_BY_REALM_AND_SOURCE: Readonly<
  Record<string, Readonly<Record<RewardSource, DailyRewardCap>>>
> = Object.freeze(
  Object.fromEntries(
    REALMS.map((r) => [
      r.key,
      Object.freeze({
        CULTIVATION: dailyRewardCapFor(r.key, 'CULTIVATION'),
        BODY_CULTIVATION: dailyRewardCapFor(r.key, 'BODY_CULTIVATION'),
        DUNGEON: dailyRewardCapFor(r.key, 'DUNGEON'),
        MISSION: dailyRewardCapFor(r.key, 'MISSION'),
      } satisfies Record<RewardSource, DailyRewardCap>),
    ]),
  ),
);

/**
 * Output của 1 lần apply cap — pure compute, KHÔNG side effect (runtime
 * service gọi helper này rồi quyết định grant số `granted`, ghi bucket
 * + ledger event riêng).
 *
 * Invariants:
 *   - `granted.expDelta + remainder.expDelta === requested.expDelta`
 *   - `granted.linhThachDelta + remainder.linhThachDelta === requested.linhThachDelta`
 *   - `granted.expDelta >= 0n`, `granted.linhThachDelta >= 0n`
 *   - `wasCapped === true` chỉ khi remainder bất kỳ field > 0n.
 */
export interface RewardDelta {
  expDelta: bigint;
  linhThachDelta: bigint;
}

export interface CapDecision {
  granted: RewardDelta;
  /** Phần bị cắt khỏi `requested` (capped amount). */
  remainder: RewardDelta;
  wasCapped: boolean;
  /** Cap còn lại sau khi grant — 0n nghĩa là đã hết cap nguồn này hôm nay. */
  remaining: RewardDelta;
}

/**
 * Compute cap decision cho 1 request. Pure function — input là số đã
 * accum trong bucket hôm nay + cap config + requested delta.
 *
 * Caller (RewardCapService) load `accum` trong cùng transaction (CAS
 * guard `(characterId, dayBucket, source)` UNIQUE) — pure compute này
 * KHÔNG biết transaction. Thiết kế này cho phép unit-test cap math
 * không cần Prisma.
 *
 * Negative `requested` → trả về granted=0 (cap không xử lý refund;
 * runtime caller chịu trách nhiệm validate dấu trước khi gọi).
 */
export function computeCapDecision(
  accum: RewardDelta,
  cap: DailyRewardCap,
  requested: RewardDelta,
): CapDecision {
  const reqExp = requested.expDelta < 0n ? 0n : requested.expDelta;
  const reqLinh = requested.linhThachDelta < 0n ? 0n : requested.linhThachDelta;

  const remainingExpBefore =
    cap.expCap > accum.expDelta ? cap.expCap - accum.expDelta : 0n;
  const remainingLinhBefore =
    cap.linhThachCap > accum.linhThachDelta
      ? cap.linhThachCap - accum.linhThachDelta
      : 0n;

  const grantedExp = reqExp < remainingExpBefore ? reqExp : remainingExpBefore;
  const grantedLinh =
    reqLinh < remainingLinhBefore ? reqLinh : remainingLinhBefore;

  const remainderExp = reqExp - grantedExp;
  const remainderLinh = reqLinh - grantedLinh;

  return {
    granted: { expDelta: grantedExp, linhThachDelta: grantedLinh },
    remainder: { expDelta: remainderExp, linhThachDelta: remainderLinh },
    wasCapped: remainderExp > 0n || remainderLinh > 0n,
    remaining: {
      expDelta: remainingExpBefore - grantedExp,
      linhThachDelta: remainingLinhBefore - grantedLinh,
    },
  };
}
