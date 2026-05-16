import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AFFINITY_DELTA_CAP_PER_CHOICE,
  AFFINITY_DELTA_CAP_PER_QUEST_REWARD,
  AFFINITY_TIERS,
  NPC_AFFINITY,
  NPC_GIFT_PREFERENCES,
  acceptedGiftItemFor,
  affinityTierForScore,
  clampAffinityScore,
  computeGiftAffinityDelta,
  itemByKey,
  nextAffinityTierForScore,
  npcAffinityDefForKey,
  npcByKey,
  npcGiftPreferenceForKey,
  type AffinityTierDef,
  type AffinityUnlockHint,
  type NpcAffinityDef,
  type NpcDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Phase 12.10.A — NPC Affinity & Relationship Foundation.
 *
 * Service mutate `CharacterNpcAffinity` (per-(character, npcKey) row) atomic:
 *   - `addAffinityTx(tx, ...)` — add delta inside an existing `$transaction`
 *     (caller wrap với mark_seen + grant effect → atomic). Mutate qua
 *     `upsert` + clamp `[minScore, maxScore]` của `NpcAffinityDef`.
 *   - `addAffinity(characterId, npcKey, delta, source)` — convenience top-level
 *     wrapper, mở `$transaction` mới (admin / test path).
 *   - `listForCharacter(...)` / `getForNpc(...)` — read view, fallback
 *     `initialScore` cho NPC chưa có row.
 *
 * Idempotency:
 *   - `add`-style API KHÔNG idempotent tự thân — caller (StoryDialogueService)
 *     phải gắn idempotency guard (`hasGrantEffect && seen.includes(node.id)`
 *     → throw `ALREADY_APPLIED` mirror `give_reward`).
 *   - Atomic: mọi mutate dùng `tx` của Prisma → no race với concurrent calls
 *     trong cùng dialogue choice (DB unique constraint + upsert pattern).
 *
 * KHÔNG ledger riêng cho affinity (catalog reward nhỏ + audit log của dialogue
 * service đã đủ). Phase 12.10.B sau (gift / shop) sẽ bổ sung
 * `CharacterNpcAffinityLedger` nếu cần truy vết granular.
 */

/** Source code dùng cho audit / metric. Phase 12.10.B thêm `GIFT`. */
export type NpcAffinitySource =
  | 'STORY_DIALOGUE_CHOICE'
  | 'QUEST_REWARD'
  | 'GIFT'
  | 'ADMIN_GRANT'
  | 'TEST';

export class NpcAffinityError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'NPC_UNKNOWN'
      | 'NPC_AFFINITY_UNKNOWN'
      | 'INVALID_DELTA'
      | 'CAP_EXCEEDED'
      // Phase 12.10.B — gift path errors.
      | 'NPC_GIFT_NOT_CONFIGURED'
      | 'ITEM_NOT_ACCEPTED'
      | 'ITEM_NOT_IN_INVENTORY'
      | 'DAILY_LIMIT_REACHED',
    public detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export interface NpcAffinityUnlockHintView {
  tierKey: AffinityTierDef['key'];
  tierLabel: string;
  tierLabelEn: string;
  tierMinScore: number;
  /** Mô tả unlock — tiếng Việt. */
  description: string;
  /** Mô tả unlock — tiếng Anh fallback. */
  descriptionEn: string;
  /** True = player đã đạt tier này. */
  reached: boolean;
}

export interface NpcAffinityView {
  npcKey: string;
  npcName: string;
  /** Score hiện tại (clamp `[minScore, maxScore]`). */
  score: number;
  minScore: number;
  maxScore: number;
  initialScore: number;
  /** Tier hiện tại (định bởi `affinityTierForScore`). */
  currentTier: {
    key: AffinityTierDef['key'];
    label: string;
    labelEn: string;
    minScore: number;
    order: number;
  };
  /** Tier kế tiếp (null nếu đã đạt max). */
  nextTier: {
    key: AffinityTierDef['key'];
    label: string;
    labelEn: string;
    minScore: number;
    order: number;
    /** Số điểm còn cần để lên tier này (≥ 0). */
    pointsToReach: number;
  } | null;
  /** Phẳng hoá hint (per-tier) — FE render thẳng list. */
  unlocks: NpcAffinityUnlockHintView[];
}

export interface AddAffinityInput {
  characterId: string;
  npcKey: string;
  delta: number;
  source: NpcAffinitySource;
}

export interface AddAffinityResult {
  npcKey: string;
  /** Score trước khi apply (post-lazy-create). */
  previousScore: number;
  /** Score sau khi apply (clamped). */
  newScore: number;
  /** Tier thay đổi sau apply hay không. */
  tierChanged: boolean;
  previousTier: AffinityTierDef;
  newTier: AffinityTierDef;
}

/** Tx type alias mirror Prisma `$transaction((tx) => ...)` callback param. */
export type AffinityTx = Prisma.TransactionClient;

/**
 * Phase 12.10.B — input cho `giftNpcTx` / `giftNpc`.
 *
 * Server compute `affinityDelta` từ catalog (`computeGiftAffinityDelta`) →
 * KHÔNG cho client truyền delta. Client chỉ truyền `npcKey` + `itemKey`.
 */
export interface GiftNpcInput {
  characterId: string;
  npcKey: string;
  itemKey: string;
  /** Optional override `Date.now()` cho test deterministic dayBucket. */
  now?: Date;
}

export interface GiftNpcResult {
  npcKey: string;
  itemKey: string;
  /** Delta affinity đã apply (clamped). */
  affinityDelta: number;
  /** Score trước khi apply (post-lazy-create). */
  previousScore: number;
  /** Score sau khi apply (clamped). */
  newScore: number;
  /** Tier thay đổi sau apply. */
  tierChanged: boolean;
  previousTier: AffinityTierDef;
  newTier: AffinityTierDef;
  /** ISO `YYYY-MM-DD` UTC bucket gift đã ghi. */
  dayBucket: string;
  /** Sequence trong ngày — bắt đầu 1, ≤ `dailyLimit`. */
  sequence: number;
  /** Số gift còn lại trong ngày sau gift này (≥ 0). */
  remainingToday: number;
  /** Snapshot daily limit của catalog (FE display tiện). */
  dailyLimit: number;
}

@Injectable()
export class NpcAffinityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * Atomic add affinity bên trong existing transaction. Caller chịu trách
   * nhiệm wrap idempotency guard (vd `seen.includes(nodeId)` ở
   * `StoryDialogueService.applyChoice`).
   *
   * Cap: `|delta|` ≤ `AFFINITY_DELTA_CAP_PER_CHOICE` (story dialogue) hoặc
   * `AFFINITY_DELTA_CAP_PER_QUEST_REWARD` (quest reward) — caller pre-flight
   * check trước khi gọi (validator catalog cũng enforce). Service làm hard cap
   * `AFFINITY_DELTA_CAP_PER_QUEST_REWARD` (lớn hơn) ở runtime cho safety.
   */
  async addAffinityTx(
    tx: AffinityTx,
    input: AddAffinityInput,
  ): Promise<AddAffinityResult> {
    const def = npcAffinityDefForKey(input.npcKey);
    if (!def) {
      throw new NpcAffinityError('NPC_AFFINITY_UNKNOWN', input.npcKey);
    }
    if (!Number.isFinite(input.delta) || !Number.isInteger(input.delta)) {
      throw new NpcAffinityError('INVALID_DELTA', `${input.delta} not an integer`);
    }
    if (input.delta === 0) {
      throw new NpcAffinityError('INVALID_DELTA', 'delta must be non-zero');
    }
    if (Math.abs(input.delta) > AFFINITY_DELTA_CAP_PER_QUEST_REWARD) {
      throw new NpcAffinityError(
        'CAP_EXCEEDED',
        `|delta|=${Math.abs(input.delta)} > ${AFFINITY_DELTA_CAP_PER_QUEST_REWARD}`,
      );
    }

    // Lazy upsert pattern — tránh stale read nếu concurrent với Phase 12.10.B
    // gift logic: dùng `upsert` để đảm bảo row exist, rồi đọc lại trong cùng tx
    // để compute clamp + tier diff. Composite UNIQUE (characterId, npcKey)
    // đảm bảo single row.
    await tx.characterNpcAffinity.upsert({
      where: {
        characterId_npcKey: {
          characterId: input.characterId,
          npcKey: input.npcKey,
        },
      },
      create: {
        characterId: input.characterId,
        npcKey: input.npcKey,
        score: def.initialScore,
      },
      update: {},
    });

    const row = await tx.characterNpcAffinity.findUnique({
      where: {
        characterId_npcKey: {
          characterId: input.characterId,
          npcKey: input.npcKey,
        },
      },
      select: { score: true },
    });
    if (!row) {
      // Không thể xảy ra sau upsert — guard cho TypeScript narrowing.
      throw new NpcAffinityError('NPC_AFFINITY_UNKNOWN', 'upsert race');
    }
    const previousScore = row.score;
    const targetScore = clampAffinityScore(input.npcKey, previousScore + input.delta);

    if (targetScore !== previousScore) {
      await tx.characterNpcAffinity.update({
        where: {
          characterId_npcKey: {
            characterId: input.characterId,
            npcKey: input.npcKey,
          },
        },
        data: { score: targetScore },
      });
    }

    const previousTier = affinityTierForScore(previousScore);
    const newTier = affinityTierForScore(targetScore);

    return {
      npcKey: input.npcKey,
      previousScore,
      newScore: targetScore,
      tierChanged: previousTier.key !== newTier.key,
      previousTier,
      newTier,
    };
  }

  /**
   * Convenience wrapper — open new `$transaction` cho call site không đã có tx
   * (admin grant, test seed).
   */
  async addAffinity(input: AddAffinityInput): Promise<AddAffinityResult> {
    return this.prisma.$transaction((tx) => this.addAffinityTx(tx, input));
  }

  /**
   * Phase 12.10.B — gift item cho NPC. Atomic 4-step inside `$transaction`:
   *   1. Validate `npcKey` ∈ `NPC_GIFT_PREFERENCES`, `itemKey` ∈ `acceptedItems`.
   *   2. Count gift hôm nay (`CharacterNpcGiftLog` rows / dayBucket) →
   *      enforce `dailyLimit`.
   *   3. Atomic decrement 1 stack `itemKey` qua `inventory.consumeOneByItemKeyTx`.
   *   4. Insert `CharacterNpcGiftLog` row (composite UNIQUE
   *      `(characterId, npcKey, dayBucket, sequence)` → CAS guard).
   *   5. Apply affinity qua `addAffinityTx` (lazy-create + clamp).
   *
   * Tất cả 5 step trong cùng `$transaction` → all-or-nothing. Race condition:
   *   - 2 gift cùng lúc cùng dayBucket: count = (sequence+1)? cho cả 2 thread →
   *     thread A insert seq=2 OK, thread B race insert seq=2 → P2002 → retry
   *     1 lần với seq=3 (cap `dailyLimit` lần thử trước khi throw
   *     `DAILY_LIMIT_REACHED`).
   *   - Item race: nếu inventory cạn giữa count + decrement → throw
   *     `ITEM_NOT_IN_INVENTORY` (mapped từ `INVENTORY_ITEM_NOT_FOUND`).
   *
   * Caller dùng `now` override cho test deterministic dayBucket.
   */
  async giftNpcTx(
    tx: AffinityTx,
    input: GiftNpcInput,
  ): Promise<GiftNpcResult> {
    const giftDef = npcGiftPreferenceForKey(input.npcKey);
    if (!giftDef) {
      throw new NpcAffinityError('NPC_GIFT_NOT_CONFIGURED', input.npcKey);
    }
    const accepted = acceptedGiftItemFor(input.npcKey, input.itemKey);
    if (!accepted) {
      throw new NpcAffinityError('ITEM_NOT_ACCEPTED', input.itemKey);
    }
    if (!itemByKey(input.itemKey)) {
      // Catalog drift guard: gift catalog reference item không tồn tại trong
      // ITEMS. Validator catalog đã enforce nhưng giữ runtime guard.
      throw new NpcAffinityError('ITEM_NOT_ACCEPTED', `${input.itemKey} not in catalog`);
    }

    const now = input.now ?? new Date();
    const dayBucket = NpcAffinityService.dayBucketFor(now);

    // Count gift today: server-authoritative daily limit. UNIQUE constraint
    // sẽ catch concurrent insert race (P2002 → retry seq+1).
    const todayCount = await tx.characterNpcGiftLog.count({
      where: {
        characterId: input.characterId,
        npcKey: input.npcKey,
        dayBucket,
      },
    });
    if (todayCount >= giftDef.dailyLimit) {
      throw new NpcAffinityError(
        'DAILY_LIMIT_REACHED',
        `${input.npcKey} reached ${giftDef.dailyLimit}/day`,
      );
    }
    const sequence = todayCount + 1;

    // Compute server-authoritative delta từ catalog (midpoint deterministic).
    const affinityDelta = computeGiftAffinityDelta(accepted);

    // Step 3: atomic decrement 1 stack of itemKey. Throws InventoryError
    // 'INVENTORY_ITEM_NOT_FOUND' nếu inventory cạn → map sang
    // NpcAffinityError 'ITEM_NOT_IN_INVENTORY'.
    try {
      await this.inventory.consumeOneByItemKeyTx(tx, input.characterId, input.itemKey, {
        reason: 'NPC_GIFT',
        refType: 'NpcGift',
        refId: `${input.npcKey}:${dayBucket}:${sequence}`,
        extra: { npcKey: input.npcKey, itemKey: input.itemKey, dayBucket, sequence },
      });
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === 'INVENTORY_ITEM_NOT_FOUND'
      ) {
        throw new NpcAffinityError('ITEM_NOT_IN_INVENTORY', input.itemKey);
      }
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === 'ITEM_NOT_FOUND'
      ) {
        throw new NpcAffinityError('ITEM_NOT_ACCEPTED', `${input.itemKey} not in ITEMS catalog`);
      }
      throw err;
    }

    // Step 4: apply affinity (lazy-create + clamp). Cap pre-checked above
    // (≤ NPC_GIFT_AFFINITY_DELTA_CAP_PER_GIFT < AFFINITY_DELTA_CAP_PER_QUEST_REWARD).
    const affinityResult = await this.addAffinityTx(tx, {
      characterId: input.characterId,
      npcKey: input.npcKey,
      delta: affinityDelta,
      source: 'GIFT',
    });

    // Step 5: insert audit log. Composite UNIQUE catch race với concurrent
    // gift cùng (npc, dayBucket, seq) → P2002 → caller retry (`giftNpc`
    // wrapper) với updated count.
    await tx.characterNpcGiftLog.create({
      data: {
        characterId: input.characterId,
        npcKey: input.npcKey,
        itemKey: input.itemKey,
        affinityDelta,
        previousScore: affinityResult.previousScore,
        newScore: affinityResult.newScore,
        dayBucket,
        sequence,
      },
    });

    const remainingToday = Math.max(0, giftDef.dailyLimit - sequence);

    return {
      npcKey: input.npcKey,
      itemKey: input.itemKey,
      affinityDelta,
      previousScore: affinityResult.previousScore,
      newScore: affinityResult.newScore,
      tierChanged: affinityResult.tierChanged,
      previousTier: affinityResult.previousTier,
      newTier: affinityResult.newTier,
      dayBucket,
      sequence,
      remainingToday,
      dailyLimit: giftDef.dailyLimit,
    };
  }

  /**
   * Convenience wrapper — open new `$transaction` + retry once trên P2002 race
   * (UNIQUE `(characterId, npcKey, dayBucket, sequence)`).
   */
  async giftNpc(input: GiftNpcInput): Promise<GiftNpcResult> {
    try {
      return await this.prisma.$transaction((tx) => this.giftNpcTx(tx, input));
    } catch (err) {
      // P2002 race retry once — concurrent gift insert chiếm sequence trước.
      // Sau retry, daily limit count đã updated → throw DAILY_LIMIT_REACHED
      // nếu thực sự đầy.
      if (this.isUniqueConstraintError(err)) {
        return await this.prisma.$transaction((tx) => this.giftNpcTx(tx, input));
      }
      throw err;
    }
  }

  /**
   * Phase 12.10.B — daily count breakdown / NPC dùng cho FE panel hiển thị
   * "Còn 2/3 hôm nay". Caller pass `now` cho deterministic test.
   */
  async getDailyGiftCounts(
    characterId: string,
    now: Date = new Date(),
  ): Promise<Map<string, { used: number; limit: number; remaining: number }>> {
    const dayBucket = NpcAffinityService.dayBucketFor(now);
    const rows = await this.prisma.characterNpcGiftLog.groupBy({
      by: ['npcKey'],
      where: { characterId, dayBucket },
      _count: { _all: true },
    });
    const usedByNpc = new Map<string, number>(
      rows.map((r) => [r.npcKey, r._count._all]),
    );
    const out = new Map<string, { used: number; limit: number; remaining: number }>();
    for (const def of NPC_GIFT_PREFERENCES) {
      const used = usedByNpc.get(def.npcKey) ?? 0;
      out.set(def.npcKey, {
        used,
        limit: def.dailyLimit,
        remaining: Math.max(0, def.dailyLimit - used),
      });
    }
    return out;
  }

  /**
   * ISO date `YYYY-MM-DD` theo timezone vận hành `Asia/Ho_Chi_Minh`
   * (UTC+07, không DST). Daily reset boundary: 00:00 ICT = 17:00 UTC
   * hôm trước.
   *
   * Phase 18.x — align với mission/daily-login/dungeon (đều reset theo ICT),
   * trước đây dùng UTC khiến reset gift NPC lệch 7 giờ so với reset mission
   * (mission reset 17:00 UTC, gift reset 00:00 UTC). Player ở VN gift sau
   * 00:00 UTC (= 07:00 sáng ICT) đã bị reset count nhưng mission chưa,
   * dẫn đến UX bất nhất "đang trong ngày mà gift counter đã reset".
   *
   * Reuse `Intl.DateTimeFormat` (en-CA → YYYY-MM-DD bất kể locale). Mirror
   * exact pattern của `daily-login.service.ts:getLocalDateString` để tránh
   * drift giữa các module reset daily.
   *
   * Boundary examples:
   *   - 23:30 ICT (16:30 UTC) → bucket = "ngày hiện tại" (chưa reset).
   *   - 00:30 ICT (17:30 UTC) → bucket = "ngày mới" (đã reset).
   *   - 00:30 UTC = 07:30 ICT → vẫn cùng bucket ngày ICT (giữa ngày).
   */
  static dayBucketFor(date: Date): string {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(date);
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    );
  }

  /**
   * List affinity của character cho TẤT CẢ NPC trong catalog `NPC_AFFINITY`.
   * NPC chưa có row → fallback `initialScore` (lazy-create on next add).
   */
  async listForCharacter(characterId: string): Promise<NpcAffinityView[]> {
    const rows = await this.prisma.characterNpcAffinity.findMany({
      where: { characterId },
      select: { npcKey: true, score: true },
    });
    const byKey = new Map(rows.map((r) => [r.npcKey, r.score]));

    return NPC_AFFINITY.map((def) => this.buildView(def, byKey.get(def.npcKey) ?? def.initialScore));
  }

  /**
   * Get single NPC affinity row. Fallback `initialScore` nếu chưa có row.
   * Throw `NPC_AFFINITY_UNKNOWN` nếu npcKey không thuộc catalog (FE bug).
   */
  async getForNpc(characterId: string, npcKey: string): Promise<NpcAffinityView> {
    const def = npcAffinityDefForKey(npcKey);
    if (!def) {
      throw new NpcAffinityError('NPC_AFFINITY_UNKNOWN', npcKey);
    }
    const row = await this.prisma.characterNpcAffinity.findUnique({
      where: {
        characterId_npcKey: { characterId, npcKey },
      },
      select: { score: true },
    });
    return this.buildView(def, row?.score ?? def.initialScore);
  }

  /**
   * Return raw `Map<npcKey, score>` — story dialogue ctx loader dùng evaluate
   * `affinity_min` condition mà không cần build full view (perf).
   */
  async loadScoreMap(characterId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.characterNpcAffinity.findMany({
      where: { characterId },
      select: { npcKey: true, score: true },
    });
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.npcKey, r.score);
    return map;
  }

  /**
   * Resolve score cho condition `affinity_min` — fallback `initialScore` nếu
   * chưa có row (`map` không có key).
   */
  static resolveScore(map: Map<string, number>, npcKey: string): number {
    const cur = map.get(npcKey);
    if (cur !== undefined) return cur;
    const def = npcAffinityDefForKey(npcKey);
    return def ? def.initialScore : 0;
  }

  private buildView(def: NpcAffinityDef, rawScore: number): NpcAffinityView {
    const score = clampAffinityScore(def.npcKey, rawScore);
    const npcDef: NpcDef | undefined = npcByKey(def.npcKey);
    const cur = affinityTierForScore(score);
    const next = nextAffinityTierForScore(score);

    const tierByKey = new Map(AFFINITY_TIERS.map((t) => [t.key, t]));
    const unlocks: NpcAffinityUnlockHintView[] = def.unlockHints.map((h: AffinityUnlockHint) => {
      const tier = tierByKey.get(h.tierKey);
      // catalog validator đã đảm bảo tierKey hợp lệ → tier always defined.
      const tierDef = tier ?? AFFINITY_TIERS[0];
      return {
        tierKey: tierDef.key,
        tierLabel: tierDef.label,
        tierLabelEn: tierDef.labelEn,
        tierMinScore: tierDef.minScore,
        description: h.description,
        descriptionEn: h.descriptionEn,
        reached: score >= tierDef.minScore,
      };
    });
    // Sort theo tier order tăng dần (catalog có thể đã đúng nhưng đảm bảo
    // deterministic FE render).
    unlocks.sort((a, b) => {
      const aOrder = tierByKey.get(a.tierKey)?.order ?? 0;
      const bOrder = tierByKey.get(b.tierKey)?.order ?? 0;
      return aOrder - bOrder;
    });

    return {
      npcKey: def.npcKey,
      npcName: npcDef?.name ?? def.npcKey,
      score,
      minScore: def.minScore,
      maxScore: def.maxScore,
      initialScore: def.initialScore,
      currentTier: {
        key: cur.key,
        label: cur.label,
        labelEn: cur.labelEn,
        minScore: cur.minScore,
        order: cur.order,
      },
      nextTier: next
        ? {
            key: next.key,
            label: next.label,
            labelEn: next.labelEn,
            minScore: next.minScore,
            order: next.order,
            pointsToReach: Math.max(0, next.minScore - score),
          }
        : null,
      unlocks,
    };
  }
}

/** Re-export cap constants ở module scope để controller / test consume. */
export const NPC_AFFINITY_CAPS = {
  perChoice: AFFINITY_DELTA_CAP_PER_CHOICE,
  perQuestReward: AFFINITY_DELTA_CAP_PER_QUEST_REWARD,
} as const;
