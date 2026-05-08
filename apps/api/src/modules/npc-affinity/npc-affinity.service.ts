import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AFFINITY_DELTA_CAP_PER_CHOICE,
  AFFINITY_DELTA_CAP_PER_QUEST_REWARD,
  AFFINITY_TIERS,
  NPC_AFFINITY,
  affinityTierForScore,
  clampAffinityScore,
  nextAffinityTierForScore,
  npcAffinityDefForKey,
  npcByKey,
  type AffinityTierDef,
  type AffinityUnlockHint,
  type NpcAffinityDef,
  type NpcDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

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

/** Source code dùng cho audit / metric (chưa persist — Phase 12.10.B). */
export type NpcAffinitySource =
  | 'STORY_DIALOGUE_CHOICE'
  | 'QUEST_REWARD'
  | 'ADMIN_GRANT'
  | 'TEST';

export class NpcAffinityError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'NPC_UNKNOWN'
      | 'NPC_AFFINITY_UNKNOWN'
      | 'INVALID_DELTA'
      | 'CAP_EXCEEDED',
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

@Injectable()
export class NpcAffinityService {
  constructor(private readonly prisma: PrismaService) {}

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
