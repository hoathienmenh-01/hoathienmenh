import { Injectable, Optional } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import {
  QUESTS,
  questByKey,
  REALMS,
  realmByKey,
  type QuestAffinityRewardDef,
  type QuestDef,
  type QuestStepDef,
  type QuestStepKind,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { NpcAffinityService } from '../npc-affinity/npc-affinity.service';
import { SectWarService } from '../sect-war/sect-war.service';

/**
 * Phase 12 Story PR-2 — Quest runtime persistence.
 *
 * Service xoay quanh `QuestProgress` table + `Character.storyChapter`.
 * Status flow: LOCKED → AVAILABLE → ACCEPTED → COMPLETED → CLAIMED (PR-3).
 *
 * Server-authoritative validation:
 *   - Realm gate (`Character.realmStage` order >= `QuestDef.requiredRealmOrder`).
 *   - Prerequisite (`QuestDef.prerequisiteQuestKey` phải CLAIMED — fallback
 *     COMPLETED nếu chain quest chưa qua PR-3 claim path; PR-3 sẽ harden CLAIMED only).
 *   - Status transitions only via service (FE KHÔNG được tự cộng).
 *
 * Idempotency:
 *   - `accept` dùng CAS guard `where { id, status: AVAILABLE }`.
 *   - `progress` step kind kill/collect dùng atomic `updateMany` cộng counter qua
 *     re-read + write race-safe (chấp nhận eventual consistency cho quest tracking,
 *     không phải currency-grade).
 */

export type QuestStatus = 'LOCKED' | 'AVAILABLE' | 'ACCEPTED' | 'COMPLETED' | 'CLAIMED';

export class QuestError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'QUEST_UNKNOWN'
      | 'QUEST_LOCKED_REALM'
      | 'QUEST_LOCKED_PREREQUISITE'
      | 'QUEST_NOT_AVAILABLE'
      | 'QUEST_NOT_ACCEPTED'
      | 'QUEST_STEP_UNKNOWN'
      | 'QUEST_STEP_KIND_MISMATCH'
      // Phase 12 Story PR-3 — Quest claim path.
      | 'QUEST_NOT_FOUND_PROGRESS'
      | 'QUEST_NOT_COMPLETED'
      | 'QUEST_ALREADY_CLAIMED',
  ) {
    super(code);
  }
}

export interface QuestStepView {
  id: string;
  kind: QuestStepKind;
  description: string;
  targetType: QuestStepDef['targetType'];
  targetId: string;
  count: number;
  currentCount: number;
  done: boolean;
}

export interface QuestProgressView {
  key: string;
  name: string;
  description: string;
  kind: QuestDef['kind'];
  realmKey: string;
  requiredRealmOrder: number;
  giverNpcKey: string;
  chainKey: string | null;
  prerequisiteQuestKey: string | null;
  status: QuestStatus;
  steps: QuestStepView[];
  /** Tất cả step.done. */
  completable: boolean;
  acceptedAt: string | null;
  completedAt: string | null;
  claimedAt: string | null;
  rewards: QuestDef['rewards'];
}

/** Tham số input cho `progress()` — talk/explore/choice (kill/collect dùng `track()`). */
export interface QuestProgressInput {
  questKey: string;
  stepId: string;
  /** Cho talk/explore/choice = 1 (count fixed = 1). */
  amount?: number;
}

/** Internal: parse `stepProgress` Json → Map. */
function readStepProgress(raw: Prisma.JsonValue | null | undefined): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      out[k] = Math.floor(v);
    }
  }
  return out;
}

function emptyStepProgress(def: QuestDef): Record<string, number> {
  const m: Record<string, number> = {};
  for (const step of def.steps) m[step.id] = 0;
  return m;
}

function isAllStepsDone(def: QuestDef, progress: Record<string, number>): boolean {
  for (const step of def.steps) {
    if ((progress[step.id] ?? 0) < step.count) return false;
  }
  return true;
}

/**
 * Output của `QuestService.claim()` — Phase 12 PR-3.
 *
 * Reward đã grant atomic trong `$transaction`; nếu transaction throw, currency/
 * item/exp/congHien KHÔNG bị mutate (Prisma rollback) + status vẫn COMPLETED.
 */
export interface QuestClaimResult {
  questKey: string;
  claimedAt: Date;
  granted: {
    linhThach: number;
    tienNgoc: number;
    exp: number;
    congHien: number;
    items: Array<{ itemKey: string; qty: number }>;
    /**
     * Phase 12.10.B — affinity grants applied trong cùng claim transaction.
     * Empty array nếu quest không có `rewards.affinity`. CAS guard
     * (`updateMany({ status: 'COMPLETED', claimedAt: null })`) đảm bảo apply
     * đúng 1 lần ngay cả khi player retry claim.
     */
    affinity: Array<QuestAffinityRewardDef>;
  };
}

@Injectable()
export class QuestService {
  constructor(
    private readonly prisma: PrismaService,
    // Phase 12 PR-3 — claim path. Wire qua `QuestModule` (CharacterModule
    // export `CurrencyService`; InventoryModule export `InventoryService`).
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
    // Phase 12.10.B — quest reward affinity grant. Wire qua
    // `NpcAffinityModule.exports.NpcAffinityService`.
    private readonly npcAffinity: NpcAffinityService,
    @Optional() private readonly sectWar?: SectWarService,
  ) {}

  /**
   * Trả về toàn bộ quest visible cho character — bao gồm AVAILABLE/ACCEPTED/COMPLETED/CLAIMED.
   * LOCKED quest (chưa thoả realm gate hoặc prerequisite) ẨN khỏi response (FE chỉ thấy
   * khi đã unlock).
   *
   * Lazy-create AVAILABLE row cho quest đã thoả gate nhưng chưa có row.
   */
  async listForUser(userId: string): Promise<QuestProgressView[]> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true, realmStage: true },
    });
    if (!char) throw new QuestError('NO_CHARACTER');
    const realmOrder = realmByKey(char.realmKey)?.order ?? 0;

    const rows = await this.prisma.questProgress.findMany({
      where: { characterId: char.id },
    });
    const byKey = new Map(rows.map((r) => [r.questKey, r]));

    const claimedKeys = new Set(
      rows.filter((r) => r.status === 'CLAIMED' || r.status === 'COMPLETED').map((r) => r.questKey),
    );

    // Lazy-create AVAILABLE rows cho quest mới unlock (gate đã thoả + prereq satisfied).
    const toCreate: Prisma.QuestProgressCreateManyInput[] = [];
    for (const def of QUESTS) {
      if (byKey.has(def.key)) continue;
      if (def.requiredRealmOrder > realmOrder) continue;
      if (def.prerequisiteQuestKey && !claimedKeys.has(def.prerequisiteQuestKey)) continue;
      toCreate.push({
        characterId: char.id,
        questKey: def.key,
        status: 'AVAILABLE',
        stepProgress: emptyStepProgress(def) as Prisma.InputJsonValue,
      });
    }
    if (toCreate.length > 0) {
      await this.prisma.questProgress.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
      const fresh = await this.prisma.questProgress.findMany({
        where: { characterId: char.id, questKey: { in: toCreate.map((c) => c.questKey) } },
      });
      for (const r of fresh) byKey.set(r.questKey, r);
    }

    // Build view — chỉ render quest nào có row (đã unlock).
    const views: QuestProgressView[] = [];
    for (const def of QUESTS) {
      const row = byKey.get(def.key);
      if (!row) continue; // LOCKED — ẩn.
      const progress = readStepProgress(row.stepProgress);
      const steps: QuestStepView[] = def.steps.map((step) => ({
        id: step.id,
        kind: step.kind,
        description: step.description,
        targetType: step.targetType,
        targetId: step.targetId,
        count: step.count,
        currentCount: Math.min(step.count, progress[step.id] ?? 0),
        done: (progress[step.id] ?? 0) >= step.count,
      }));
      views.push({
        key: def.key,
        name: def.name,
        description: def.description,
        kind: def.kind,
        realmKey: def.realmKey,
        requiredRealmOrder: def.requiredRealmOrder,
        giverNpcKey: def.giverNpcKey,
        chainKey: def.chainKey,
        prerequisiteQuestKey: def.prerequisiteQuestKey,
        status: row.status as QuestStatus,
        steps,
        completable: row.status === 'ACCEPTED' && isAllStepsDone(def, progress),
        acceptedAt: row.acceptedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        claimedAt: row.claimedAt?.toISOString() ?? null,
        rewards: def.rewards,
      });
    }
    return views;
  }

  /**
   * Player accept quest. Validate gate + prereq + status=AVAILABLE.
   * CAS guard `where { id, status: AVAILABLE }` chống double-accept.
   */
  async accept(userId: string, questKey: string): Promise<QuestProgressView> {
    const def = questByKey(questKey);
    if (!def) throw new QuestError('QUEST_UNKNOWN');

    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true },
    });
    if (!char) throw new QuestError('NO_CHARACTER');
    const realmOrder = realmByKey(char.realmKey)?.order ?? 0;
    if (def.requiredRealmOrder > realmOrder) {
      throw new QuestError('QUEST_LOCKED_REALM');
    }

    if (def.prerequisiteQuestKey) {
      const prereq = await this.prisma.questProgress.findUnique({
        where: {
          characterId_questKey: {
            characterId: char.id,
            questKey: def.prerequisiteQuestKey,
          },
        },
        select: { status: true },
      });
      // Phase 12 PR-2 chấp nhận COMPLETED hoặc CLAIMED (claim path PR-3 chưa wire).
      if (!prereq || (prereq.status !== 'COMPLETED' && prereq.status !== 'CLAIMED')) {
        throw new QuestError('QUEST_LOCKED_PREREQUISITE');
      }
    }

    // Lazy-create row nếu chưa có (do list chưa được gọi).
    const existing = await this.prisma.questProgress.findUnique({
      where: { characterId_questKey: { characterId: char.id, questKey } },
    });
    if (!existing) {
      await this.prisma.questProgress.create({
        data: {
          characterId: char.id,
          questKey,
          status: 'AVAILABLE',
          stepProgress: emptyStepProgress(def) as Prisma.InputJsonValue,
        },
      });
    }

    // CAS: AVAILABLE → ACCEPTED.
    const upd = await this.prisma.questProgress.updateMany({
      where: { characterId: char.id, questKey, status: 'AVAILABLE' },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    if (upd.count !== 1) {
      throw new QuestError('QUEST_NOT_AVAILABLE');
    }

    return this.viewOne(char.id, def);
  }

  /**
   * Player tự khai báo progress cho step kind: talk / explore / choice.
   * Kill / collect KHÔNG đi qua endpoint này — sẽ trigger qua `track()` trong
   * service nội bộ (CombatService, InventoryService) chống FE self-cộng.
   *
   * Server validate: questKey accepted + step exists + step.kind ∈ talk/explore/choice.
   * count cộng dồn tới step.count, không vượt. Khi tất cả step done → status COMPLETED.
   */
  async progress(userId: string, input: QuestProgressInput): Promise<QuestProgressView> {
    const def = questByKey(input.questKey);
    if (!def) throw new QuestError('QUEST_UNKNOWN');
    const step = def.steps.find((s) => s.id === input.stepId);
    if (!step) throw new QuestError('QUEST_STEP_UNKNOWN');
    // Player-driven endpoint chỉ accept talk/explore/choice. kill/collect chỉ tăng qua `track()`.
    if (step.kind !== 'talk' && step.kind !== 'explore' && step.kind !== 'choice') {
      throw new QuestError('QUEST_STEP_KIND_MISMATCH');
    }

    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!char) throw new QuestError('NO_CHARACTER');

    const row = await this.prisma.questProgress.findUnique({
      where: { characterId_questKey: { characterId: char.id, questKey: def.key } },
    });
    if (!row || row.status !== 'ACCEPTED') {
      throw new QuestError('QUEST_NOT_ACCEPTED');
    }

    const amount = Math.max(1, Math.floor(input.amount ?? 1));
    const progress = readStepProgress(row.stepProgress);
    const cur = progress[step.id] ?? 0;
    const newAmt = Math.min(step.count, cur + amount);
    if (newAmt !== cur) {
      progress[step.id] = newAmt;
      await this.prisma.questProgress.updateMany({
        where: { id: row.id, status: 'ACCEPTED' },
        data: { stepProgress: progress as Prisma.InputJsonValue },
      });
    }

    // Auto-complete khi all steps done.
    if (isAllStepsDone(def, progress)) {
      await this.transitionToCompleted(row.id);
    }

    return this.viewOne(char.id, def);
  }

  /**
   * Internal hook — gameplay services gọi sau khi player kill monster /
   * collect item (fail-soft, KHÔNG throw bubble lên gameplay).
   *
   * Tự match `step.kind` + `step.targetType` + `step.targetId` của các quest
   * ACCEPTED của character; cộng counter atomic.
   *
   * Use-case examples:
   *   - CombatService: `await quests.track(charId, 'kill', 'monster', 'son_thu', 1)`.
   *   - InventoryService grant: `await quests.track(charId, 'collect', 'item', 'linh_co', n)`.
   */
  async track(
    characterId: string,
    kind: 'kill' | 'collect',
    targetType: QuestStepDef['targetType'],
    targetId: string,
    amount = 1,
  ): Promise<void> {
    if (amount <= 0) return;
    const matchingQuestKeys: string[] = [];
    for (const def of QUESTS) {
      for (const step of def.steps) {
        if (
          step.kind === kind &&
          step.targetType === targetType &&
          step.targetId === targetId
        ) {
          matchingQuestKeys.push(def.key);
          break;
        }
      }
    }
    if (matchingQuestKeys.length === 0) return;

    const rows = await this.prisma.questProgress.findMany({
      where: {
        characterId,
        questKey: { in: matchingQuestKeys },
        status: 'ACCEPTED',
      },
    });
    for (const row of rows) {
      const def = questByKey(row.questKey);
      if (!def) continue;
      const progress = readStepProgress(row.stepProgress);
      let changed = false;
      for (const step of def.steps) {
        if (
          step.kind !== kind ||
          step.targetType !== targetType ||
          step.targetId !== targetId
        ) {
          continue;
        }
        const cur = progress[step.id] ?? 0;
        if (cur >= step.count) continue;
        const next = Math.min(step.count, cur + amount);
        if (next === cur) continue;
        progress[step.id] = next;
        changed = true;
      }
      if (!changed) continue;
      await this.prisma.questProgress.updateMany({
        where: { id: row.id, status: 'ACCEPTED' },
        data: { stepProgress: progress as Prisma.InputJsonValue },
      });
      if (isAllStepsDone(def, progress)) {
        await this.transitionToCompleted(row.id);
      }
    }
  }

  /**
   * Phase 12 Story PR-3 — Quest claim reward.
   *
   * Atomic flow trong 1 `prisma.$transaction`:
   *   1. CAS guard `updateMany({ where: { id, status: 'COMPLETED', claimedAt: null } })`
   *      → set `status='CLAIMED'`, `claimedAt=now()`. Race-safe: 2 concurrent
   *      claim cùng questKey, đúng 1 winner; loser nhận `QUEST_ALREADY_CLAIMED`
   *      (count !== 1).
   *   2. Grant linhThach / tienNgoc qua `CurrencyService.applyTx` với
   *      `reason='QUEST_CLAIM'`, `refType='Quest'`, `refId=questKey` →
   *      ghi `CurrencyLedger` row (1 / currency / claim).
   *   3. Grant exp / congHien trực tiếp qua `tx.character.update({ increment })`
   *      (mirror MissionService pattern; 2 cột này KHÔNG có ledger riêng).
   *   4. Grant items qua `InventoryService.grantTx` với `reason='QUEST_CLAIM'` →
   *      ghi `ItemLedger` rows (positive qtyDelta).
   *
   * Idempotency: composite `(characterId, QUEST_CLAIM, questKey)` thực thi
   * qua CAS guard ở step 1 (ECONOMY_MODEL.md §3.5) — race winner duy nhất
   * grant + ghi ledger; loser throw KHÔNG mutate.
   *
   * @throws QuestError('NO_CHARACTER') user chưa có character.
   * @throws QuestError('QUEST_UNKNOWN') questKey không tồn tại trong catalog.
   * @throws QuestError('QUEST_NOT_FOUND_PROGRESS') chưa từng accept (no row).
   * @throws QuestError('QUEST_NOT_COMPLETED') status != COMPLETED.
   * @throws QuestError('QUEST_ALREADY_CLAIMED') row.claimedAt đã set (CAS lose).
   */
  async claim(userId: string, questKey: string): Promise<QuestClaimResult> {
    const def = questByKey(questKey);
    if (!def) throw new QuestError('QUEST_UNKNOWN');

    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!char) throw new QuestError('NO_CHARACTER');

    const characterId = char.id;

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.questProgress.findUnique({
        where: { characterId_questKey: { characterId, questKey } },
        select: { id: true, status: true, claimedAt: true },
      });
      if (!row) throw new QuestError('QUEST_NOT_FOUND_PROGRESS');
      if (row.status === 'CLAIMED' || row.claimedAt !== null) {
        throw new QuestError('QUEST_ALREADY_CLAIMED');
      }
      if (row.status !== 'COMPLETED') {
        throw new QuestError('QUEST_NOT_COMPLETED');
      }

      // CAS race guard: chỉ set claimedAt nếu vẫn COMPLETED + claimedAt=null.
      // Mirror AchievementService.claimReward pattern.
      const claimedAt = new Date();
      const upd = await tx.questProgress.updateMany({
        where: { id: row.id, status: 'COMPLETED', claimedAt: null },
        data: { status: 'CLAIMED', claimedAt },
      });
      if (upd.count !== 1) {
        throw new QuestError('QUEST_ALREADY_CLAIMED');
      }

      const r = def.rewards;
      const linhThach = r.linhThach ?? 0;
      const tienNgoc = r.tienNgoc ?? 0;
      const exp = r.exp ?? 0;
      const congHien = r.congHien ?? 0;

      if (linhThach > 0) {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(linhThach),
          reason: 'QUEST_CLAIM',
          refType: 'Quest',
          refId: questKey,
        });
      }
      if (tienNgoc > 0) {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.TIEN_NGOC,
          delta: BigInt(tienNgoc),
          reason: 'QUEST_CLAIM',
          refType: 'Quest',
          refId: questKey,
        });
      }
      if (exp > 0) {
        await tx.character.update({
          where: { id: characterId },
          data: { exp: { increment: BigInt(exp) } },
        });
      }
      if (congHien > 0) {
        await tx.character.update({
          where: { id: characterId },
          data: { congHien: { increment: congHien } },
        });
      }

      const granted: Array<{ itemKey: string; qty: number }> = [];
      if (r.items && r.items.length > 0) {
        const grantList = r.items.map((it) => ({
          itemKey: it.itemKey,
          qty: it.qty,
        }));
        await this.inventory.grantTx(tx, characterId, grantList, {
          reason: 'QUEST_CLAIM',
          refType: 'Quest',
          refId: questKey,
        });
        granted.push(...grantList);
      }

      // Phase 12.10.B — quest reward affinity grant. CAS guard
      // (`updateMany({ status: 'COMPLETED', claimedAt: null })`) ở trên đã
      // đảm bảo claim chỉ run đúng 1 lần / quest / character → addAffinityTx
      // tự nhiên idempotent (không cần extra `seen` set như story dialogue).
      // Sai catalog (`npcKey` không thuộc `NPC_AFFINITY`) → throw inside tx
      // → rollback toàn bộ claim. Validator catalog ở `validateQuestCatalog`
      // (test-only) đảm bảo không drift.
      const affinityGranted: QuestAffinityRewardDef[] = [];
      if (r.affinity && r.affinity.length > 0) {
        for (const aff of r.affinity) {
          await this.npcAffinity.addAffinityTx(tx, {
            characterId,
            npcKey: aff.npcKey,
            delta: aff.delta,
            source: 'QUEST_REWARD',
          });
          affinityGranted.push({ npcKey: aff.npcKey, delta: aff.delta });
        }
      }

      // Phase 13.1.A — Sect War contribution hook. Idempotent qua composite
      // UNIQUE `(weekKey, characterId, activityKey, sourceType, sourceId)`
      // với sourceId = questKey — re-claim cùng quest không double điểm
      // (đồng thời CAS `claimedAt` ở trên đã ngăn double-claim hard).
      // Fail-soft: quest reward đã grant.
      if (this.sectWar) {
        try {
          await this.sectWar.addContributionTx(tx, {
            characterId,
            activityKey: 'quest_complete',
            sourceId: questKey,
          });
        } catch {
          // swallow — sect-war không phá flow.
        }
      }

      return {
        questKey,
        claimedAt,
        granted: {
          linhThach,
          tienNgoc,
          exp,
          congHien,
          items: granted,
          affinity: affinityGranted,
        },
      };
    });
  }

  private async transitionToCompleted(progressId: string): Promise<void> {
    // CAS: ACCEPTED → COMPLETED. Đánh dấu hoàn thành; reward claim ở Phase 12 PR-3.
    const upd = await this.prisma.questProgress.updateMany({
      where: { id: progressId, status: 'ACCEPTED' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    if (upd.count !== 1) return;

    // Phase 12 PR-2 — bump `Character.storyChapter` khi main quest gate hoàn thành.
    // (Tách riêng khỏi claim để storyline có thể tiến cả khi player chưa claim reward.)
    const row = await this.prisma.questProgress.findUnique({
      where: { id: progressId },
      select: { characterId: true, questKey: true },
    });
    if (!row) return;
    const def = questByKey(row.questKey);
    if (!def || def.kind !== 'main') return;
    // Chapter index = realmOrder + 1 (chapter 1 ≡ phamnhan main, chapter 2 ≡ luyenkhi main, ...).
    const targetChapter = def.requiredRealmOrder + 1;
    await this.prisma.character.updateMany({
      where: { id: row.characterId, storyChapter: { lt: targetChapter } },
      data: { storyChapter: targetChapter },
    });
  }

  /** Build single view (sau accept/progress). */
  private async viewOne(characterId: string, def: QuestDef): Promise<QuestProgressView> {
    const row = await this.prisma.questProgress.findUnique({
      where: { characterId_questKey: { characterId, questKey: def.key } },
    });
    if (!row) throw new QuestError('QUEST_NOT_AVAILABLE');
    const progress = readStepProgress(row.stepProgress);
    return {
      key: def.key,
      name: def.name,
      description: def.description,
      kind: def.kind,
      realmKey: def.realmKey,
      requiredRealmOrder: def.requiredRealmOrder,
      giverNpcKey: def.giverNpcKey,
      chainKey: def.chainKey,
      prerequisiteQuestKey: def.prerequisiteQuestKey,
      status: row.status as QuestStatus,
      steps: def.steps.map((step) => ({
        id: step.id,
        kind: step.kind,
        description: step.description,
        targetType: step.targetType,
        targetId: step.targetId,
        count: step.count,
        currentCount: Math.min(step.count, progress[step.id] ?? 0),
        done: (progress[step.id] ?? 0) >= step.count,
      })),
      completable: row.status === 'ACCEPTED' && isAllStepsDone(def, progress),
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      claimedAt: row.claimedAt?.toISOString() ?? null,
      rewards: def.rewards,
    };
  }
}

// Re-export catalog metadata for downstream callers.
export { REALMS };
