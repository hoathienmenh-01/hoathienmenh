import { Injectable } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import {
  AFFINITY_TIERS,
  affinityTierForScore,
  affinityTierDefForKey,
  chainClaimedFlagKey,
  clampAffinityScore,
  itemByKey,
  npcAffinityDefForKey,
  npcByKey,
  npcRelationshipChainByKey,
  npcRelationshipChainsForNpc,
  questByKey,
  type AffinityTierDef,
  type AffinityTierKey,
  type NpcRelationshipChainEndingFlags,
  type NpcRelationshipChainRewardHint,
  type NpcRelationshipQuestChainDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { NpcAffinityService } from './npc-affinity.service';

/**
 * Phase 12.10.D — NPC Relationship Quest Chain runtime.
 *
 * Chain catalog là static (`NPC_RELATIONSHIP_QUEST_CHAINS`); service xoay
 * quanh:
 *   - LIST chain của 1 NPC + state (locked/unlocked/in-progress/completable
 *     /claimed) derive từ `Character.realmKey`, `CharacterNpcAffinity.score`,
 *     `QuestProgress.status` per quest, và `Character.storyFlags[claimFlag]`.
 *   - CLAIM chain (1-shot): atomic `$transaction` ghi storyFlags +
 *     endingFlags, grant affinity/currency/items reward, idempotent qua
 *     JSON-path CAS guard `where: { storyFlags: { path:[flag], equals: Prisma.DbNull } }`.
 *
 * KHÔNG có "start chain" mutation riêng — chain UNLOCKED chỉ là điều kiện FE
 * hiển thị quest list cho NPC; player vẫn dùng QuestService.accept để nhận
 * từng quest. Lý do: tránh thêm runtime state (`CharacterNpcChainProgress`)
 * không cần thiết — chain progress fully derive từ QuestProgress + storyFlags.
 *
 * Idempotency:
 *   - `claimChain` race-safe qua CAS: `tx.character.updateMany({ where: { id,
 *     NOT: { storyFlags: { path:[flag], equals: '1' } } }, data })`. Loser
 *     thấy `count===0` → throw `CHAIN_ALREADY_CLAIMED`, tx rollback.
 *   - Reward catalog (`NPC_RELATIONSHIP_QUEST_CHAINS[].rewardHint`) cap thấp
 *     (linhThach ≤ 500, tienNgoc ≤ 10, exp ≤ 600, affinity ≤ 40) — verified
 *     bởi `validateNpcRelationshipChainsCatalog`.
 */

export class NpcRelationshipChainError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'CHAIN_UNKNOWN'
      | 'CHAIN_LOCKED_TIER'
      | 'CHAIN_NOT_COMPLETABLE'
      | 'CHAIN_ALREADY_CLAIMED',
    public detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

/** Per-quest progress view inside chain. */
export interface ChainQuestStatusView {
  questKey: string;
  questName: string;
  status:
    | 'LOCKED' // chưa unlock (realm/prereq) → FE chưa thấy quest
    | 'AVAILABLE'
    | 'ACCEPTED'
    | 'COMPLETED'
    | 'CLAIMED';
  giverNpcKey: string;
  /** True nếu quest này hiển thị trong QuestService.listForUser(). */
  unlocked: boolean;
}

export interface ChainRewardPreview extends NpcRelationshipChainRewardHint {
  /** Resolved item def name + stackable for FE preview chip. */
  items: ReadonlyArray<{
    itemKey: string;
    qty: number;
    name: string | null;
  }>;
}

export interface NpcRelationshipChainView {
  chainKey: string;
  npcKey: string;
  npcName: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  requiredAffinityTier: AffinityTierKey;
  requiredAffinityTierLabel: string;
  requiredAffinityTierLabelEn: string;
  requiredAffinityMinScore: number;
  /** Chain hiện tại lock theo tier hay không. */
  tierUnlocked: boolean;
  /** Score affinity hiện tại của character (post-clamp). */
  currentAffinityScore: number;
  currentAffinityTier: AffinityTierKey;
  /** Tất cả quest trong chain (theo thứ tự narrative). */
  quests: ChainQuestStatusView[];
  /** Số quest đã CLAIMED / total — driver progress bar. */
  claimedCount: number;
  totalCount: number;
  /** True nếu mọi quest claimed. */
  completable: boolean;
  /** True nếu player đã claim chain reward (storyFlags claim flag set). */
  claimed: boolean;
  /** ISO timestamp khi chain được claim (read từ flag value, fallback null). */
  claimedAt: string | null;
  /** True = chain ẩn cho đến khi tier reached (FE render hint nhẹ). */
  hidden: boolean;
  /** True nếu chain visible trong UI: luôn `true` cho non-hidden, hoặc tier reached. */
  visible: boolean;
  rewardPreview: ChainRewardPreview;
  endingFlags: NpcRelationshipChainEndingFlags;
  dialogueNodeKeys: ReadonlyArray<string>;
}

/** Internal helper — parse storyFlags JSON. */
function readFlags(raw: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return { ...(raw as Record<string, unknown>) };
}

function isFlagTruthy(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (v === '1' || v === 1 || v === true) return true;
  if (typeof v === 'string' && v.length > 0 && v !== '0' && v !== 'false') return true;
  return false;
}

function flagAsIso(v: unknown): string | null {
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

export interface ClaimChainInput {
  characterId: string;
  chainKey: string;
}

export interface ClaimChainResult {
  chainKey: string;
  npcKey: string;
  granted: {
    affinity: number;
    linhThach: number;
    tienNgoc: number;
    exp: number;
    items: Array<{ itemKey: string; qty: number }>;
    flags: Record<string, string | number | boolean>;
  };
  newAffinityScore: number;
  newAffinityTier: AffinityTierKey;
  claimedAt: Date;
}

@Injectable()
export class NpcRelationshipChainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
    private readonly affinity: NpcAffinityService,
  ) {}

  /**
   * List tất cả relationship chain của NPC + state per character. Build view
   * fully từ:
   *   - `CharacterNpcAffinity.score` (lazy fallback `initialScore`).
   *   - `QuestProgress` (filter chain.questKeys).
   *   - `Character.storyFlags` (claim flag + ending flags).
   *
   * KHÔNG mutate gì — pure read. FE gọi sau mỗi claim/transition để refresh.
   */
  async listForCharacter(
    characterId: string,
    npcKey: string,
  ): Promise<NpcRelationshipChainView[]> {
    const npc = npcByKey(npcKey);
    if (!npc) return [];
    const chains = npcRelationshipChainsForNpc(npcKey);
    if (chains.length === 0) return [];

    const char = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true, storyFlags: true },
    });
    if (!char) throw new NpcRelationshipChainError('NO_CHARACTER');

    const affinityRow = await this.prisma.characterNpcAffinity.findUnique({
      where: { characterId_npcKey: { characterId, npcKey } },
      select: { score: true },
    });
    const def = npcAffinityDefForKey(npcKey);
    const score =
      affinityRow?.score ??
      (def ? def.initialScore : 0);
    const currentTier = affinityTierForScore(score);

    // Load all quest progress rows for chain questKeys (in batch, one query).
    const allQuestKeys = Array.from(new Set(chains.flatMap((c) => c.questKeys)));
    const progressRows =
      allQuestKeys.length === 0
        ? []
        : await this.prisma.questProgress.findMany({
            where: { characterId, questKey: { in: allQuestKeys } },
            select: { questKey: true, status: true },
          });
    const progressByKey = new Map(progressRows.map((r) => [r.questKey, r.status]));

    const flags = readFlags(char.storyFlags);

    return chains.map((chain) =>
      this.buildView(chain, score, currentTier, progressByKey, flags),
    );
  }

  /**
   * Get single chain view. Convenience cho `POST claim` response (refresh
   * sau mutate).
   */
  async getOne(
    characterId: string,
    chainKey: string,
  ): Promise<NpcRelationshipChainView> {
    const chain = npcRelationshipChainByKey(chainKey);
    if (!chain) throw new NpcRelationshipChainError('CHAIN_UNKNOWN');
    const views = await this.listForCharacter(characterId, chain.npcKey);
    const v = views.find((x) => x.chainKey === chainKey);
    if (!v) throw new NpcRelationshipChainError('CHAIN_UNKNOWN');
    return v;
  }

  /**
   * Claim chain reward. Phải đáp ứng:
   *   1. Chain tồn tại trong catalog.
   *   2. Player tier ≥ `requiredAffinityTier`.
   *   3. Tất cả `chain.questKeys` đã CLAIMED.
   *   4. `storyFlags[claimFlag]` chưa set (idempotent).
   *
   * Atomic transaction: ghi flags first via CAS guard, sau đó grant rewards.
   * CAS đảm bảo: 2 concurrent claim cùng chainKey, đúng 1 thắng → 1 ledger
   * row / chain / character.
   */
  async claimChain(input: ClaimChainInput): Promise<ClaimChainResult> {
    const chain = npcRelationshipChainByKey(input.chainKey);
    if (!chain) throw new NpcRelationshipChainError('CHAIN_UNKNOWN');

    const flagKey = chainClaimedFlagKey(chain.chainKey);
    const claimedAt = new Date();
    const now = claimedAt.toISOString();

    return this.prisma.$transaction(async (tx) => {
      const charRow = await tx.character.findUnique({
        where: { id: input.characterId },
        select: { id: true, storyFlags: true },
      });
      if (!charRow) throw new NpcRelationshipChainError('NO_CHARACTER');

      const flags = readFlags(charRow.storyFlags);
      if (isFlagTruthy(flags[flagKey])) {
        throw new NpcRelationshipChainError('CHAIN_ALREADY_CLAIMED');
      }

      // Tier gate.
      const affRow = await tx.characterNpcAffinity.findUnique({
        where: {
          characterId_npcKey: {
            characterId: input.characterId,
            npcKey: chain.npcKey,
          },
        },
        select: { score: true },
      });
      const def = npcAffinityDefForKey(chain.npcKey);
      const score = affRow?.score ?? (def ? def.initialScore : 0);
      const tier = affinityTierForScore(score);
      const requiredTier = affinityTierDefForKey(chain.requiredAffinityTier);
      if (tier.order < requiredTier.order) {
        throw new NpcRelationshipChainError(
          'CHAIN_LOCKED_TIER',
          `requires ${chain.requiredAffinityTier}`,
        );
      }

      // Quest completion gate — all questKeys CLAIMED.
      const progressRows = await tx.questProgress.findMany({
        where: {
          characterId: input.characterId,
          questKey: { in: [...chain.questKeys] },
        },
        select: { questKey: true, status: true },
      });
      const byKey = new Map(progressRows.map((r) => [r.questKey, r.status]));
      const allClaimed = chain.questKeys.every((qk) => byKey.get(qk) === 'CLAIMED');
      if (!allClaimed) {
        throw new NpcRelationshipChainError('CHAIN_NOT_COMPLETABLE');
      }

      // Build merged flags: set claim flag + each ending flag (last-write-wins).
      const merged: Record<string, unknown> = { ...flags };
      merged[flagKey] = '1';
      merged[`${flagKey}_at`] = now;
      const grantedFlags: Record<string, string | number | boolean> = {};
      grantedFlags[flagKey] = '1';
      for (const [k, v] of Object.entries(chain.endingFlags)) {
        merged[k] = v;
        grantedFlags[k] = v;
      }

      // CAS guard: only update if claim flag still missing/falsy. Prisma
      // JSON `NOT { path: [...], equals: '1' }` filter excludes rows where
      // the key is ABSENT (jsonb `#>>` returns NULL → `NULL = '1'` is
      // unknown → `NOT unknown` is unknown → excluded). Use raw SQL with
      // `IS DISTINCT FROM '1'` so missing key passes the guard. Atomic +
      // race-safe: 2 concurrent claim cùng chainKey, đúng 1 winner.
      const flagsJson = JSON.stringify(merged);
      const upd = await tx.$executeRaw(Prisma.sql`
        UPDATE "Character"
        SET "storyFlags" = ${flagsJson}::jsonb
        WHERE "id" = ${input.characterId}
          AND ("storyFlags" ->> ${flagKey}) IS DISTINCT FROM '1'
      `);
      if (upd !== 1) {
        throw new NpcRelationshipChainError('CHAIN_ALREADY_CLAIMED');
      }

      // Grant reward inside same tx — rollback all on any failure.
      const r = chain.rewardHint;
      if (r.linhThach > 0) {
        await this.currency.applyTx(tx, {
          characterId: input.characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(r.linhThach),
          reason: 'NPC_RELATIONSHIP_CHAIN_REWARD',
          refType: 'NpcRelationshipChain',
          refId: chain.chainKey,
        });
      }
      if (r.tienNgoc > 0) {
        await this.currency.applyTx(tx, {
          characterId: input.characterId,
          currency: CurrencyKind.TIEN_NGOC,
          delta: BigInt(r.tienNgoc),
          reason: 'NPC_RELATIONSHIP_CHAIN_REWARD',
          refType: 'NpcRelationshipChain',
          refId: chain.chainKey,
        });
      }
      if (r.exp > 0) {
        await tx.character.update({
          where: { id: input.characterId },
          data: { exp: { increment: BigInt(r.exp) } },
        });
      }
      const grantedItems: Array<{ itemKey: string; qty: number }> = [];
      if (r.items.length > 0) {
        const list = r.items.map((it) => ({ itemKey: it.itemKey, qty: it.qty }));
        await this.inventory.grantTx(tx, input.characterId, list, {
          reason: 'NPC_RELATIONSHIP_CHAIN_REWARD',
          refType: 'NpcRelationshipChain',
          refId: chain.chainKey,
        });
        grantedItems.push(...list);
      }

      let newAffinityScore = score;
      let newAffinityTier = tier.key;
      if (r.affinity > 0) {
        const res = await this.affinity.addAffinityTx(tx, {
          characterId: input.characterId,
          npcKey: chain.npcKey,
          delta: r.affinity,
          source: 'QUEST_REWARD',
        });
        newAffinityScore = res.newScore;
        newAffinityTier = res.newTier.key as AffinityTierKey;
      }

      return {
        chainKey: chain.chainKey,
        npcKey: chain.npcKey,
        granted: {
          affinity: r.affinity,
          linhThach: r.linhThach,
          tienNgoc: r.tienNgoc,
          exp: r.exp,
          items: grantedItems,
          flags: grantedFlags,
        },
        newAffinityScore,
        newAffinityTier,
        claimedAt,
      };
    });
  }

  // -- helpers ---------------------------------------------------------------

  private buildView(
    chain: NpcRelationshipQuestChainDef,
    affinityScore: number,
    currentTier: AffinityTierDef,
    progressByKey: Map<string, string>,
    flags: Record<string, unknown>,
  ): NpcRelationshipChainView {
    const required = affinityTierDefForKey(chain.requiredAffinityTier);
    const tierUnlocked = currentTier.order >= required.order;
    const visible = !chain.hidden || tierUnlocked;

    const quests: ChainQuestStatusView[] = chain.questKeys.map((qk) => {
      const def = questByKey(qk);
      const rawStatus = progressByKey.get(qk);
      const status: ChainQuestStatusView['status'] = rawStatus
        ? (rawStatus as ChainQuestStatusView['status'])
        : 'LOCKED';
      return {
        questKey: qk,
        questName: def?.name ?? qk,
        status,
        giverNpcKey: def?.giverNpcKey ?? '',
        unlocked: status !== 'LOCKED',
      };
    });

    const claimedCount = quests.filter((q) => q.status === 'CLAIMED').length;
    const totalCount = quests.length;
    const flagKey = chainClaimedFlagKey(chain.chainKey);
    const claimed = isFlagTruthy(flags[flagKey]);
    const claimedAt = flagAsIso(flags[`${flagKey}_at`]);

    return {
      chainKey: chain.chainKey,
      npcKey: chain.npcKey,
      npcName: npcByKey(chain.npcKey)?.name ?? chain.npcKey,
      title: chain.title,
      titleEn: chain.titleEn,
      description: chain.description,
      descriptionEn: chain.descriptionEn,
      requiredAffinityTier: chain.requiredAffinityTier,
      requiredAffinityTierLabel: required.label,
      requiredAffinityTierLabelEn: required.labelEn,
      requiredAffinityMinScore: required.minScore,
      tierUnlocked,
      currentAffinityScore: clampAffinityScore(chain.npcKey, affinityScore),
      currentAffinityTier: currentTier.key,
      quests,
      claimedCount,
      totalCount,
      completable: claimedCount === totalCount && totalCount > 0,
      claimed,
      claimedAt,
      hidden: !!chain.hidden,
      visible,
      rewardPreview: this.buildRewardPreview(chain.rewardHint),
      endingFlags: chain.endingFlags,
      dialogueNodeKeys: chain.dialogueNodeKeys,
    };
  }

  private buildRewardPreview(hint: NpcRelationshipChainRewardHint): ChainRewardPreview {
    return {
      ...hint,
      items: hint.items.map((it) => ({
        itemKey: it.itemKey,
        qty: it.qty,
        name: itemNameSafe(it.itemKey),
      })),
    };
  }
}

function itemNameSafe(key: string): string | null {
  return itemByKey(key)?.name ?? null;
}

// Re-export for tests that want to assert affinity tier order without
// importing both shared + service.
export { AFFINITY_TIERS };
