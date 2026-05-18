import { Injectable, Optional } from '@nestjs/common';
import { CurrencyKind, Prisma } from '@prisma/client';
import {
  STORY_CHAPTERS_V2,
  STORY_QUEST_DIALOGUES,
  STORY_QUEST_EXPANSION,
  npcByKey,
  phase33DialoguesByPhase,
  phase33DialoguesForQuest,
  phase33QuestByKey,
  phase33QuestsByChapter,
  realmByKey,
  type Phase33DialoguePhase,
  type Phase33QuestDef,
  type Phase33QuestStepDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { CurrencyService } from '../character/currency.service';
import { InventoryService } from '../inventory/inventory.service';
import { NpcAffinityService } from '../npc-affinity/npc-affinity.service';
import { OnboardingQuestService } from '../onboarding-quest/onboarding-quest.service';

/**
 * Phase 33.1 — Story V2 Runtime Service.
 *
 * Wire Phase 33 catalog (`STORY_QUEST_EXPANSION` + `STORY_QUEST_DIALOGUES` đã
 * ship qua PR A #567) vào runtime:
 *   - Lazy-create AVAILABLE rows cho quest đã thoả realm/prereq/storyFlag/
 *     affinity gate.
 *   - Status flow: LOCKED → AVAILABLE → ACCEPTED → COMPLETED → CLAIMED.
 *   - Reward grant atomic qua `CurrencyService.applyTx` + `InventoryService.
 *     grantTx` + `NpcAffinityService.addAffinityTx` mirror Phase 12 PR-3
 *     pattern (race-safe CAS guard).
 *
 * Forbidden Phase 33.1:
 *   - KHÔNG sửa Phase 12 `QuestService` / `QuestProgress`.
 *   - KHÔNG wire kill/collect step (defer Phase 33.3 World Objective Deep
 *     Wire). Phase 33.1 chỉ hỗ trợ progress qua talk/explore/choice/flag_set.
 *   - KHÔNG daily/weekly reset scheduler (player vẫn accept/claim 1 lần đầu).
 */

export type Phase33QuestStatus =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'ACCEPTED'
  | 'COMPLETED'
  | 'CLAIMED';

export type Phase33ChapterStatus =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'COMPLETED';

export class Phase33StoryError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'STORY_V2_QUEST_UNKNOWN'
      | 'STORY_V2_CHAPTER_UNKNOWN'
      | 'STORY_V2_QUEST_LOCKED_REALM'
      | 'STORY_V2_QUEST_LOCKED_PREREQUISITE'
      | 'STORY_V2_QUEST_LOCKED_FLAG'
      | 'STORY_V2_QUEST_LOCKED_AFFINITY'
      | 'STORY_V2_QUEST_NOT_AVAILABLE'
      | 'STORY_V2_QUEST_NOT_ACCEPTED'
      | 'STORY_V2_QUEST_NOT_COMPLETED'
      | 'STORY_V2_QUEST_ALREADY_CLAIMED'
      | 'STORY_V2_QUEST_NOT_FOUND_PROGRESS'
      | 'STORY_V2_QUEST_STEP_UNKNOWN'
      | 'STORY_V2_QUEST_STEP_KIND_NOT_SUPPORTED',
  ) {
    super(code);
  }
}

export interface Phase33QuestStepView {
  id: string;
  kind: Phase33QuestStepDef['kind'];
  description: string;
  targetType: Phase33QuestStepDef['targetType'];
  targetId: string;
  count: number;
  currentCount: number;
  done: boolean;
}

export interface Phase33QuestView {
  questKey: string;
  kind: Phase33QuestDef['kind'];
  chapKey: string;
  volumeKey: string;
  titleVi: string;
  titleEn: string;
  descriptionVi: string;
  descriptionEn: string;
  giverNpcKey: string;
  requiredRealmKey: string;
  requiredRealmOrder: number;
  prerequisiteQuestKey: string | null;
  status: Phase33QuestStatus;
  steps: readonly Phase33QuestStepView[];
  completable: boolean;
  acceptedAt: string | null;
  completedAt: string | null;
  claimedAt: string | null;
  rewards: Phase33QuestDef['rewards'];
}

export interface Phase33ChapterView {
  chapKey: string;
  volumeKey: string;
  titleVi: string;
  titleEn: string;
  themeVi: string;
  themeEn: string;
  status: Phase33ChapterStatus;
  mainQuestsTotal: number;
  mainQuestsCompletedCount: number;
  unlockedAt: string | null;
  completedAt: string | null;
  storyFlags: readonly string[];
}

export interface Phase33DialogueView {
  dialogueId: string;
  questKey: string;
  chapterKey: string;
  speakerNpcKey: string;
  phase: Phase33DialoguePhase;
  textVi: string;
  textEn: string;
}

export interface Phase33ClaimResult {
  questKey: string;
  claimedAt: Date;
  granted: {
    linhThach: number;
    exp: number;
    congHien: number;
    items: Array<{ itemKey: string; qty: number }>;
    affinity: Array<{ npcKey: string; delta: number }>;
    storyFlags: readonly string[];
  };
}

export interface Phase33ProgressInput {
  questKey: string;
  stepId: string;
  /** Default 1 for talk/explore/choice/flag_set. */
  amount?: number;
}

/* ─────────────────────── helpers ──────────────────────── */

function readStepProgress(
  raw: Prisma.JsonValue | null | undefined,
): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      out[k] = Math.floor(v);
    }
  }
  return out;
}

function emptyStepProgress(def: Phase33QuestDef): Record<string, number> {
  const m: Record<string, number> = {};
  for (const step of def.steps) m[step.id] = 0;
  return m;
}

function isAllStepsDone(
  def: Phase33QuestDef,
  progress: Record<string, number>,
): boolean {
  for (const step of def.steps) {
    if ((progress[step.id] ?? 0) < step.count) return false;
  }
  return true;
}

function readStoryFlags(raw: Prisma.JsonValue | null | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}

/** Step kinds supported by `progressQuest` in Phase 33.1. */
const SUPPORTED_PROGRESS_STEP_KINDS: ReadonlySet<Phase33QuestStepDef['kind']> =
  new Set(['talk', 'explore', 'choice', 'flag_set']);

@Injectable()
export class Phase33StoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly inventory: InventoryService,
    private readonly npcAffinity: NpcAffinityService,
    @Optional() private readonly onboarding?: OnboardingQuestService,
  ) {}

  /**
   * Returns visible chapter list cho character — chapter chưa unlock (realm
   * gate chưa thoả) sẽ ẨN. Lazy-create row khi chapter mới unlock.
   */
  async listChaptersForUser(userId: string): Promise<Phase33ChapterView[]> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true },
    });
    if (!char) throw new Phase33StoryError('NO_CHARACTER');
    const realmOrder = realmByKey(char.realmKey)?.order ?? 0;

    const rows = await this.prisma.characterStoryV2ChapterProgress.findMany({
      where: { characterId: char.id },
    });
    const byKey = new Map(rows.map((r) => [r.chapKey, r]));

    // Lazy-create AVAILABLE rows cho chapter mới unlock.
    const toCreate: Prisma.CharacterStoryV2ChapterProgressCreateManyInput[] = [];
    for (const chap of STORY_CHAPTERS_V2) {
      if (byKey.has(chap.chapKey)) continue;
      const realmReq = realmByKey(chap.requiredRealmKey)?.order ?? 999;
      if (realmReq > realmOrder) continue;
      toCreate.push({
        characterId: char.id,
        chapKey: chap.chapKey,
        status: 'AVAILABLE',
        unlockedAt: new Date(),
      });
    }
    if (toCreate.length > 0) {
      await this.prisma.characterStoryV2ChapterProgress.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
      const fresh = await this.prisma.characterStoryV2ChapterProgress.findMany({
        where: {
          characterId: char.id,
          chapKey: { in: toCreate.map((c) => c.chapKey) },
        },
      });
      for (const r of fresh) byKey.set(r.chapKey, r);
    }

    const views: Phase33ChapterView[] = [];
    for (const chap of STORY_CHAPTERS_V2) {
      const row = byKey.get(chap.chapKey);
      if (!row) continue; // chưa unlock — ẩn.
      const mainQuests = phase33QuestsByChapter(chap.chapKey).filter(
        (q) => q.kind === 'main',
      );
      views.push({
        chapKey: chap.chapKey,
        volumeKey: chap.volumeKey,
        titleVi: chap.titleVi,
        titleEn: chap.titleEn,
        themeVi: chap.themeVi,
        themeEn: chap.themeEn,
        status: row.status as Phase33ChapterStatus,
        mainQuestsTotal: mainQuests.length,
        mainQuestsCompletedCount: row.mainQuestsCompletedCount,
        unlockedAt: row.unlockedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        storyFlags: readStoryFlags(row.storyFlags),
      });
    }
    return views;
  }

  /**
   * Returns toàn bộ quest visible cho chapter — bao gồm AVAILABLE/ACCEPTED/
   * COMPLETED/CLAIMED. LOCKED quest (chưa thoả realm/prereq/storyFlag/affinity
   * gate) ẨN. Lazy-create AVAILABLE row.
   */
  async listQuestsForChapter(
    userId: string,
    chapKey: string,
  ): Promise<Phase33QuestView[]> {
    const chap = STORY_CHAPTERS_V2.find((c) => c.chapKey === chapKey);
    if (!chap) throw new Phase33StoryError('STORY_V2_CHAPTER_UNKNOWN');

    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true },
    });
    if (!char) throw new Phase33StoryError('NO_CHARACTER');
    const realmOrder = realmByKey(char.realmKey)?.order ?? 0;

    // Tìm tất cả quest catalog của chapter.
    const chapQuests = phase33QuestsByChapter(chapKey);
    if (chapQuests.length === 0) return [];

    const rows = await this.prisma.characterStoryV2QuestProgress.findMany({
      where: { characterId: char.id, chapKey },
    });
    const byKey = new Map(rows.map((r) => [r.questKey, r]));

    // Story flags hiện tại của character (cross-chapter aggregated).
    const allChapRows =
      await this.prisma.characterStoryV2ChapterProgress.findMany({
        where: { characterId: char.id },
        select: { storyFlags: true },
      });
    const flagSet = new Set<string>();
    for (const r of allChapRows) {
      for (const f of readStoryFlags(r.storyFlags)) flagSet.add(f);
    }

    // Set of CLAIMED quest keys (cross-chapter) cho prereq check.
    const claimedRows = await this.prisma.characterStoryV2QuestProgress.findMany({
      where: {
        characterId: char.id,
        status: { in: ['CLAIMED', 'COMPLETED'] },
      },
      select: { questKey: true },
    });
    const claimedKeys = new Set(claimedRows.map((r) => r.questKey));

    // Affinity rows cho gate check.
    const affinityRows = await this.prisma.characterNpcAffinity.findMany({
      where: { characterId: char.id },
      select: { npcKey: true, score: true },
    });
    const affinityByNpc = new Map(affinityRows.map((r) => [r.npcKey, r.score]));

    const toCreate: Prisma.CharacterStoryV2QuestProgressCreateManyInput[] = [];
    for (const def of chapQuests) {
      if (byKey.has(def.questKey)) continue;
      if (def.requiredRealmOrder > realmOrder) continue;
      if (
        def.prerequisiteQuestKey &&
        !claimedKeys.has(def.prerequisiteQuestKey)
      ) {
        continue;
      }
      if (def.requiredStoryFlags.some((f) => !flagSet.has(f))) continue;
      if (
        def.requiredAffinityNpcKey &&
        def.requiredAffinityScore !== null &&
        (affinityByNpc.get(def.requiredAffinityNpcKey) ?? 0) <
          def.requiredAffinityScore
      ) {
        continue;
      }
      toCreate.push({
        characterId: char.id,
        questKey: def.questKey,
        chapKey: def.chapKey,
        status: 'AVAILABLE',
        stepProgress: emptyStepProgress(def) as Prisma.InputJsonValue,
      });
    }
    if (toCreate.length > 0) {
      await this.prisma.characterStoryV2QuestProgress.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
      const fresh = await this.prisma.characterStoryV2QuestProgress.findMany({
        where: {
          characterId: char.id,
          questKey: { in: toCreate.map((c) => c.questKey) },
        },
      });
      for (const r of fresh) byKey.set(r.questKey, r);
    }

    const views: Phase33QuestView[] = [];
    for (const def of chapQuests) {
      const row = byKey.get(def.questKey);
      if (!row) continue;
      views.push(buildQuestView(def, row));
    }
    return views;
  }

  /** Return dialogues for a quest. Quest phải đã unlock (có row). */
  async listDialoguesForQuest(
    userId: string,
    questKey: string,
    phase?: Phase33DialoguePhase,
  ): Promise<Phase33DialogueView[]> {
    const def = phase33QuestByKey(questKey);
    if (!def) throw new Phase33StoryError('STORY_V2_QUEST_UNKNOWN');

    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!char) throw new Phase33StoryError('NO_CHARACTER');

    const row = await this.prisma.characterStoryV2QuestProgress.findUnique({
      where: {
        characterId_questKey: { characterId: char.id, questKey },
      },
      select: { status: true },
    });
    if (!row) throw new Phase33StoryError('STORY_V2_QUEST_NOT_FOUND_PROGRESS');

    const all = phase ? phase33DialoguesByPhase(phase) : STORY_QUEST_DIALOGUES;
    const list = all.filter((d) => d.questKey === questKey);
    return list.map((d) => ({
      dialogueId: d.dialogueId,
      questKey: d.questKey,
      chapterKey: d.chapterKey,
      speakerNpcKey: d.speakerNpcKey,
      phase: d.phase,
      textVi: d.textVi,
      textEn: d.textEn,
    }));
  }

  /**
   * Accept quest. CAS guard `status='AVAILABLE'` → 1 winner.
   */
  async acceptQuest(userId: string, questKey: string): Promise<Phase33QuestView> {
    const def = phase33QuestByKey(questKey);
    if (!def) throw new Phase33StoryError('STORY_V2_QUEST_UNKNOWN');

    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, realmKey: true },
    });
    if (!char) throw new Phase33StoryError('NO_CHARACTER');
    const realmOrder = realmByKey(char.realmKey)?.order ?? 0;

    if (def.requiredRealmOrder > realmOrder) {
      throw new Phase33StoryError('STORY_V2_QUEST_LOCKED_REALM');
    }

    if (def.prerequisiteQuestKey) {
      const prereq =
        await this.prisma.characterStoryV2QuestProgress.findUnique({
          where: {
            characterId_questKey: {
              characterId: char.id,
              questKey: def.prerequisiteQuestKey,
            },
          },
          select: { status: true },
        });
      if (!prereq || (prereq.status !== 'CLAIMED' && prereq.status !== 'COMPLETED')) {
        throw new Phase33StoryError('STORY_V2_QUEST_LOCKED_PREREQUISITE');
      }
    }

    // Story flag gate.
    if (def.requiredStoryFlags.length > 0) {
      const allChapRows =
        await this.prisma.characterStoryV2ChapterProgress.findMany({
          where: { characterId: char.id },
          select: { storyFlags: true },
        });
      const flagSet = new Set<string>();
      for (const r of allChapRows) {
        for (const f of readStoryFlags(r.storyFlags)) flagSet.add(f);
      }
      if (def.requiredStoryFlags.some((f) => !flagSet.has(f))) {
        throw new Phase33StoryError('STORY_V2_QUEST_LOCKED_FLAG');
      }
    }

    // Affinity gate.
    if (def.requiredAffinityNpcKey && def.requiredAffinityScore !== null) {
      const aff = await this.prisma.characterNpcAffinity.findUnique({
        where: {
          characterId_npcKey: {
            characterId: char.id,
            npcKey: def.requiredAffinityNpcKey,
          },
        },
        select: { score: true },
      });
      if ((aff?.score ?? 0) < def.requiredAffinityScore) {
        throw new Phase33StoryError('STORY_V2_QUEST_LOCKED_AFFINITY');
      }
    }

    // Lazy-create AVAILABLE row nếu chưa có.
    await this.prisma.characterStoryV2QuestProgress.upsert({
      where: {
        characterId_questKey: { characterId: char.id, questKey },
      },
      create: {
        characterId: char.id,
        questKey,
        chapKey: def.chapKey,
        status: 'AVAILABLE',
        stepProgress: emptyStepProgress(def) as Prisma.InputJsonValue,
      },
      update: {},
    });

    // CAS guard chỉ flip AVAILABLE → ACCEPTED.
    const acceptedAt = new Date();
    const upd = await this.prisma.characterStoryV2QuestProgress.updateMany({
      where: {
        characterId: char.id,
        questKey,
        status: 'AVAILABLE',
      },
      data: { status: 'ACCEPTED', acceptedAt },
    });
    if (upd.count !== 1) {
      // Đã ACCEPTED hoặc COMPLETED/CLAIMED — không phải lỗi, return current state.
      const cur = await this.prisma.characterStoryV2QuestProgress.findUnique({
        where: {
          characterId_questKey: { characterId: char.id, questKey },
        },
      });
      if (!cur) throw new Phase33StoryError('STORY_V2_QUEST_NOT_AVAILABLE');
      return buildQuestView(def, cur);
    }

    // Update chapter row to IN_PROGRESS nếu đang AVAILABLE.
    await this.prisma.characterStoryV2ChapterProgress.updateMany({
      where: {
        characterId: char.id,
        chapKey: def.chapKey,
        status: 'AVAILABLE',
      },
      data: { status: 'IN_PROGRESS' },
    });

    const row = await this.prisma.characterStoryV2QuestProgress.findUnique({
      where: {
        characterId_questKey: { characterId: char.id, questKey },
      },
    });
    return buildQuestView(def, row!);
  }

  /**
   * Increment step counter cho talk/explore/choice/flag_set. Auto-flip
   * COMPLETED khi all steps done.
   */
  async progressQuest(
    userId: string,
    input: Phase33ProgressInput,
  ): Promise<Phase33QuestView> {
    const def = phase33QuestByKey(input.questKey);
    if (!def) throw new Phase33StoryError('STORY_V2_QUEST_UNKNOWN');

    const step = def.steps.find((s) => s.id === input.stepId);
    if (!step) throw new Phase33StoryError('STORY_V2_QUEST_STEP_UNKNOWN');
    if (!SUPPORTED_PROGRESS_STEP_KINDS.has(step.kind)) {
      throw new Phase33StoryError('STORY_V2_QUEST_STEP_KIND_NOT_SUPPORTED');
    }

    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!char) throw new Phase33StoryError('NO_CHARACTER');

    const row = await this.prisma.characterStoryV2QuestProgress.findUnique({
      where: {
        characterId_questKey: { characterId: char.id, questKey: input.questKey },
      },
    });
    if (!row) throw new Phase33StoryError('STORY_V2_QUEST_NOT_FOUND_PROGRESS');
    if (row.status !== 'ACCEPTED') {
      throw new Phase33StoryError('STORY_V2_QUEST_NOT_ACCEPTED');
    }

    const amount = Math.max(1, Math.min(100, Math.floor(input.amount ?? 1)));
    const progress = readStepProgress(row.stepProgress);
    const cur = progress[step.id] ?? 0;
    const next = Math.min(step.count, cur + amount);
    if (next !== cur) {
      progress[step.id] = next;
      await this.prisma.characterStoryV2QuestProgress.updateMany({
        where: { id: row.id, status: 'ACCEPTED' },
        data: { stepProgress: progress as Prisma.InputJsonValue },
      });
    }

    if (isAllStepsDone(def, progress)) {
      await this.transitionToCompleted(row.id);
      // Phase 44.1 — onboarding auto-track. Fire-and-forget.
      if (this.onboarding) {
        void this.onboarding.notifyAction(char.id, 'STORY_PROGRESS');
      }
    }

    const fresh = await this.prisma.characterStoryV2QuestProgress.findUnique({
      where: { id: row.id },
    });
    return buildQuestView(def, fresh!);
  }

  /**
   * Explicit move ACCEPTED→COMPLETED nếu all steps done. Idempotent.
   */
  async completeQuest(
    userId: string,
    questKey: string,
  ): Promise<Phase33QuestView> {
    const def = phase33QuestByKey(questKey);
    if (!def) throw new Phase33StoryError('STORY_V2_QUEST_UNKNOWN');

    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!char) throw new Phase33StoryError('NO_CHARACTER');

    const row = await this.prisma.characterStoryV2QuestProgress.findUnique({
      where: {
        characterId_questKey: { characterId: char.id, questKey },
      },
    });
    if (!row) throw new Phase33StoryError('STORY_V2_QUEST_NOT_FOUND_PROGRESS');
    if (row.status === 'COMPLETED' || row.status === 'CLAIMED') {
      return buildQuestView(def, row);
    }
    if (row.status !== 'ACCEPTED') {
      throw new Phase33StoryError('STORY_V2_QUEST_NOT_ACCEPTED');
    }

    const progress = readStepProgress(row.stepProgress);
    if (!isAllStepsDone(def, progress)) {
      throw new Phase33StoryError('STORY_V2_QUEST_NOT_COMPLETED');
    }

    await this.transitionToCompleted(row.id);

    const fresh = await this.prisma.characterStoryV2QuestProgress.findUnique({
      where: { id: row.id },
    });
    return buildQuestView(def, fresh!);
  }

  /**
   * Atomic claim — mirror `QuestService.claim` (Phase 12 PR-3):
   *   1. CAS guard `updateMany({ status: 'COMPLETED', claimedAt: null })`.
   *   2. Grant linhThach qua `CurrencyService.applyTx`.
   *   3. Grant exp/congHien qua `tx.character.update({ increment })`.
   *   4. Grant items qua `InventoryService.grantTx`.
   *   5. Grant affinity qua `NpcAffinityService.addAffinityTx`.
   *   6. Apply rewards.storyFlags vào chapter row (additive set).
   *   7. Insert `CharacterStoryV2RewardClaim` audit row.
   *   8. Increment chapter.mainQuestsCompletedCount nếu quest là MAIN.
   */
  async claimReward(
    userId: string,
    questKey: string,
  ): Promise<Phase33ClaimResult> {
    const def = phase33QuestByKey(questKey);
    if (!def) throw new Phase33StoryError('STORY_V2_QUEST_UNKNOWN');

    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!char) throw new Phase33StoryError('NO_CHARACTER');

    const characterId = char.id;

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.characterStoryV2QuestProgress.findUnique({
        where: {
          characterId_questKey: { characterId, questKey },
        },
        select: { id: true, status: true, claimedAt: true },
      });
      if (!row)
        throw new Phase33StoryError('STORY_V2_QUEST_NOT_FOUND_PROGRESS');
      if (row.status === 'CLAIMED' || row.claimedAt !== null) {
        throw new Phase33StoryError('STORY_V2_QUEST_ALREADY_CLAIMED');
      }
      if (row.status !== 'COMPLETED') {
        throw new Phase33StoryError('STORY_V2_QUEST_NOT_COMPLETED');
      }

      const claimedAt = new Date();
      const upd = await tx.characterStoryV2QuestProgress.updateMany({
        where: { id: row.id, status: 'COMPLETED', claimedAt: null },
        data: { status: 'CLAIMED', claimedAt },
      });
      if (upd.count !== 1) {
        throw new Phase33StoryError('STORY_V2_QUEST_ALREADY_CLAIMED');
      }

      const r = def.rewards;
      const linhThach = r.linhThach ?? 0;
      const exp = r.exp ?? 0;
      const congHien = r.congHien ?? 0;

      if (linhThach > 0) {
        await this.currency.applyTx(tx, {
          characterId,
          currency: CurrencyKind.LINH_THACH,
          delta: BigInt(linhThach),
          reason: 'STORY_V2_QUEST_CLAIM',
          refType: 'Phase33Quest',
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

      const itemsGranted: Array<{ itemKey: string; qty: number }> = [];
      if (r.items && r.items.length > 0) {
        const items = r.items.map((i) => ({ itemKey: i.itemKey, qty: i.qty }));
        await this.inventory.grantTx(tx, characterId, items, {
          reason: 'STORY_V2_QUEST_CLAIM',
          refType: 'Phase33Quest',
          refId: questKey,
        });
        itemsGranted.push(...items);
      }

      const affinityGranted: Array<{ npcKey: string; delta: number }> = [];
      if (r.affinity && r.affinity.length > 0) {
        for (const a of r.affinity) {
          if (!npcByKey(a.npcKey)) continue;
          await this.npcAffinity.addAffinityTx(tx, {
            characterId,
            npcKey: a.npcKey,
            delta: a.delta,
            source: 'QUEST_REWARD',
          });
          affinityGranted.push({ npcKey: a.npcKey, delta: a.delta });
        }
      }

      // Apply story flags vào chapter row (additive set).
      const storyFlags = r.storyFlags ?? [];
      if (storyFlags.length > 0) {
        const chapRow =
          await tx.characterStoryV2ChapterProgress.findUnique({
            where: {
              characterId_chapKey: { characterId, chapKey: def.chapKey },
            },
            select: { id: true, storyFlags: true },
          });
        if (chapRow) {
          const existing = new Set(readStoryFlags(chapRow.storyFlags));
          for (const f of storyFlags) existing.add(f);
          await tx.characterStoryV2ChapterProgress.update({
            where: { id: chapRow.id },
            data: {
              storyFlags: Array.from(existing) as Prisma.InputJsonValue,
            },
          });
        }
      }

      // Increment mainQuestsCompletedCount nếu quest là MAIN.
      if (def.kind === 'main') {
        await tx.characterStoryV2ChapterProgress.updateMany({
          where: { characterId, chapKey: def.chapKey },
          data: { mainQuestsCompletedCount: { increment: 1 } },
        });
      }

      // Audit row.
      await tx.characterStoryV2RewardClaim.create({
        data: {
          characterId,
          questKey,
          linhThachGranted: BigInt(linhThach),
          tienNgocGranted: 0,
          expGranted: BigInt(exp),
          congHienGranted: congHien,
          itemsGranted: itemsGranted as Prisma.InputJsonValue,
          affinityGranted: affinityGranted as Prisma.InputJsonValue,
          claimedAt,
        },
      });

      return {
        questKey,
        claimedAt,
        granted: {
          linhThach,
          exp,
          congHien,
          items: itemsGranted,
          affinity: affinityGranted,
          storyFlags,
        },
      };
    });
  }

  /**
   * Phase 33.3 — World Objective Deep Wire. Fail-soft hook gọi từ
   * `DungeonRunService` / `CombatService` / `StoryDungeonService` khi
   * người chơi kill monster hoặc collect item.
   *
   * Mirror Phase 12 `QuestService.track` pattern: tìm các quest ACCEPTED
   * có step `kind === kind && targetType === targetType && targetId === targetId`,
   * tăng `stepProgress[step.id]` lên min(step.count, cur + amount), auto-flip
   * COMPLETED nếu all-steps done.
   *
   * Phase 33.3 mở rộng `SUPPORTED_PROGRESS_STEP_KINDS` (chỉ talk/explore/
   * choice/flag_set) bằng cách thêm cửa riêng `track()` không kiểm tra
   * SUPPORTED_PROGRESS_STEP_KINDS, vì caller (combat / dungeon) chỉ gọi
   * cho kill/collect. `progressQuest()` user-facing vẫn block kill/collect
   * (player KHÔNG self-track combat — runtime auto-hook).
   *
   * No-op nếu user chưa accept quest có step match.
   */
  async track(
    characterId: string,
    kind: 'kill' | 'collect',
    targetType: Phase33QuestStepDef['targetType'],
    targetId: string,
    amount = 1,
  ): Promise<void> {
    if (amount <= 0) return;
    const matchingQuestKeys: string[] = [];
    for (const def of STORY_QUEST_EXPANSION) {
      for (const step of def.steps) {
        if (
          step.kind === kind &&
          step.targetType === targetType &&
          step.targetId === targetId
        ) {
          matchingQuestKeys.push(def.questKey);
          break;
        }
      }
    }
    if (matchingQuestKeys.length === 0) return;

    const rows = await this.prisma.characterStoryV2QuestProgress.findMany({
      where: {
        characterId,
        questKey: { in: matchingQuestKeys },
        status: 'ACCEPTED',
      },
    });
    for (const row of rows) {
      const def = phase33QuestByKey(row.questKey);
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
      await this.prisma.characterStoryV2QuestProgress.updateMany({
        where: { id: row.id, status: 'ACCEPTED' },
        data: { stepProgress: progress as Prisma.InputJsonValue },
      });
      if (isAllStepsDone(def, progress)) {
        await this.transitionToCompleted(row.id);
      }
    }
  }

  /* ─────────────── internal helpers ───────────────── */

  private async transitionToCompleted(rowId: string): Promise<void> {
    const completedAt = new Date();
    await this.prisma.characterStoryV2QuestProgress.updateMany({
      where: { id: rowId, status: 'ACCEPTED' },
      data: { status: 'COMPLETED', completedAt },
    });
  }
}

/* ─────────────────────── build view ──────────────────────── */

function buildQuestView(
  def: Phase33QuestDef,
  row: {
    status: string;
    stepProgress: Prisma.JsonValue;
    acceptedAt: Date | null;
    completedAt: Date | null;
    claimedAt: Date | null;
  },
): Phase33QuestView {
  const progress = readStepProgress(row.stepProgress);
  const steps: Phase33QuestStepView[] = def.steps.map((step) => ({
    id: step.id,
    kind: step.kind,
    description: step.descriptionVi,
    targetType: step.targetType,
    targetId: step.targetId,
    count: step.count,
    currentCount: Math.min(step.count, progress[step.id] ?? 0),
    done: (progress[step.id] ?? 0) >= step.count,
  }));
  return {
    questKey: def.questKey,
    kind: def.kind,
    chapKey: def.chapKey,
    volumeKey: def.volumeKey,
    titleVi: def.titleVi,
    titleEn: def.titleEn,
    descriptionVi: def.descriptionVi,
    descriptionEn: def.descriptionEn,
    giverNpcKey: def.giverNpcKey,
    requiredRealmKey: def.requiredRealmKey,
    requiredRealmOrder: def.requiredRealmOrder,
    prerequisiteQuestKey: def.prerequisiteQuestKey,
    status: row.status as Phase33QuestStatus,
    steps,
    completable: isAllStepsDone(def, progress),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    rewards: def.rewards,
  };
}

// Avoid unused import warning: STORY_QUEST_EXPANSION/phase33DialoguesForQuest
// are exposed for tests + future PR C consumption.
void STORY_QUEST_EXPANSION;
void phase33DialoguesForQuest;
